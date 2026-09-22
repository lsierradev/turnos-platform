-- 009_add_estado_y_atencion_a_turnos.sql
-- RF-04: datos de los que salen los KPIs del dashboard.
--
-- Hasta Sprint 7 un turno solo sabia CUANDO estaba agendado (rango_tiempo),
-- no que paso con el. Los dos KPIs de la historia necesitan justamente eso:
--   - tasa de asistencia       -> hace falta distinguir atendido de no_asistio
--   - tiempo promedio servicio -> hace falta la duracion REAL, no la
--                                 planificada (servicios.duracion_minutos)
--
-- atencion_inicio/atencion_fin son nullable a proposito: un turno puede
-- marcarse 'atendido' sin que nadie haya cronometrado la atencion. Esas
-- filas cuentan para la tasa de asistencia pero quedan fuera del promedio
-- de duracion -- por eso el endpoint devuelve `turnosMedidos` aparte de
-- `turnosAtendidos`: si la cobertura de medicion es baja, el promedio se
-- calculo sobre pocas filas y el admin tiene que poder verlo.

CREATE TYPE estado_turno AS ENUM (
    'programado',
    'atendido',
    'no_asistio',
    'cancelado'
);

ALTER TABLE turnos
    ADD COLUMN estado          estado_turno NOT NULL DEFAULT 'programado',
    ADD COLUMN atencion_inicio TIMESTAMPTZ,
    ADD COLUMN atencion_fin    TIMESTAMPTZ;

-- Sin esta constraint, un atencion_fin < atencion_inicio (dedazo al cargar
-- la hora, o un turno que cruza la medianoche cargado con la fecha de ayer)
-- mete una duracion NEGATIVA en el AVG del dashboard y arrastra el KPI
-- hacia abajo sin que nada falle visiblemente. Mismo criterio que
-- turnos_rango_tiempo_no_vacio en 001: la DB rechaza el dato imposible.
ALTER TABLE turnos
    ADD CONSTRAINT turnos_atencion_rango_check CHECK (
        atencion_inicio IS NULL
        OR atencion_fin IS NULL
        OR atencion_fin > atencion_inicio
    );

-- OPTIMIZACION DE LA CONSULTA DE KPIs (tarea 3 de RF-04).
--
-- El dashboard filtra por fecha de inicio del turno. Sin este indice la
-- unica alternativa de Postgres es un seq scan de `turnos` entero en cada
-- carga del dashboard -- y `turnos` es la tabla caliente del motor de
-- reservas, asi que ese scan compite por I/O y buffer cache justo con los
-- INSERT de POST /appointments.
--
-- Por que un btree sobre lower(rango_tiempo) y no reusar los GiST que ya
-- existen: los indices de 001/006 son EXCLUDE USING gist sobre
-- (bahia_id, rango_tiempo) y (tecnico_id, rango_tiempo). Con el bahia_id /
-- tecnico_id como primera columna y sin ningun filtro por bahia o tecnico
-- en la consulta de KPIs, esos indices no sirven para un rango de fechas
-- global. lower(anyrange) es IMMUTABLE, asi que se puede indexar directo.
--
-- El INCLUDE lleva al indice las tres columnas que la agregacion lee, de
-- modo que la consulta puede resolverse con un index-only scan y no tocar
-- el heap de turnos en absoluto. Ojo: el index-only scan depende de que el
-- visibility map este al dia, o sea de que autovacuum haya pasado -- en una
-- tabla con muchos INSERT recientes (el caso de turnos) es esperable que
-- las paginas nuevas todavia requieran visita al heap.
--
-- COSTO en el camino de escritura: un indice mas a mantener por cada INSERT
-- de turno. Es un btree chico y de clave creciente (los turnos se crean
-- ordenados por fecha), que es el mejor caso posible para un btree: los
-- splits caen siempre en la pagina de la derecha. Se acepta ese costo
-- constante y acotado a cambio de sacar el seq scan del camino de lectura.
CREATE INDEX idx_turnos_kpi_inicio
    ON turnos (lower(rango_tiempo))
    INCLUDE (estado, atencion_inicio, atencion_fin);
