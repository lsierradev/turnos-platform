-- 007_turnos_rango_tiempo_tstzrange.sql
-- rango_tiempo era TSRANGE (timestamp SIN zona horaria). La app siempre
-- escribio y penso esos valores como UTC, pero un tipo sin zona horaria
-- descarta el offset al guardar: al releerlo, el string de texto que
-- devuelve Postgres no trae ninguna marca de zona, y Node lo interpreta
-- como hora LOCAL del proceso -- corrompiendo silenciosamente el horario
-- de cada turno en cualquier servidor que no corra en UTC. Se migra a
-- TSTZRANGE, que preserva el offset end-to-end (confirmado que Node parsea
-- bien el formato de salida de Postgres para timestamptz con offset).
--
-- Los valores existentes se reinterpretan explicitamente como UTC (que es
-- lo que siempre representaron, aunque el tipo de columna no lo garantizara).

ALTER TABLE turnos DROP CONSTRAINT turnos_bahia_rango_excl;
ALTER TABLE turnos DROP CONSTRAINT turnos_tecnico_rango_excl;
ALTER TABLE turnos DROP CONSTRAINT turnos_rango_tiempo_no_vacio;

ALTER TABLE turnos
    ALTER COLUMN rango_tiempo TYPE TSTZRANGE
    USING tstzrange(
        lower(rango_tiempo) AT TIME ZONE 'UTC',
        upper(rango_tiempo) AT TIME ZONE 'UTC',
        '[)'
    );

ALTER TABLE turnos
    ADD CONSTRAINT turnos_rango_tiempo_no_vacio CHECK (NOT isempty(rango_tiempo));

ALTER TABLE turnos
    ADD CONSTRAINT turnos_bahia_rango_excl EXCLUDE USING gist (
        bahia_id WITH =,
        rango_tiempo WITH &&
    );

ALTER TABLE turnos
    ADD CONSTRAINT turnos_tecnico_rango_excl EXCLUDE USING gist (
        tecnico_id WITH =,
        rango_tiempo WITH &&
    );
