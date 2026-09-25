-- 017_recepcion_y_cancelacion.sql
-- Recepcion del vehiculo, ciclo del turno y politica de cancelacion
-- (Sprint 22).
--
-- Compatible hacia atras con los servicios del Sprint 21: solo agrega
-- tablas y columnas nullable o con default.

-- --------------------------------------------------------------- vehiculos
-- Del cliente, no del taller: el cliente es global (015) y lleva el mismo
-- carro a cualquier taller. El taller ve los de SUS clientes.
CREATE TABLE vehiculos (
    id           UUID        NOT NULL DEFAULT gen_random_uuid(),
    usuario_id   UUID        NOT NULL,
    -- Normalizada por la app: mayusculas, sin espacios ni guiones.
    placa        TEXT        NOT NULL,
    marca        TEXT        NOT NULL,
    modelo       TEXT        NOT NULL,
    anio         SMALLINT    NOT NULL,
    -- Ultimo kilometraje conocido. La recepcion lo actualiza.
    kilometraje  INTEGER     NOT NULL,
    -- Baja logica: las recepciones y turnos pasados lo siguen nombrando.
    activo       BOOLEAN     NOT NULL DEFAULT true,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT vehiculos_pkey PRIMARY KEY (id),
    CONSTRAINT vehiculos_usuario_fkey FOREIGN KEY (usuario_id)
        REFERENCES usuarios (id) ON DELETE CASCADE,
    CONSTRAINT vehiculos_placa_formato CHECK (placa ~ '^[A-Z0-9]{5,7}$'),
    CONSTRAINT vehiculos_anio_rango CHECK (anio BETWEEN 1950 AND 2100),
    CONSTRAINT vehiculos_km_rango CHECK (kilometraje BETWEEN 0 AND 3000000)
);
-- La misma placa dos veces para el mismo cliente es un error de carga; en
-- clientes distintos puede pasar (el carro se vendio).
CREATE UNIQUE INDEX vehiculos_usuario_placa_key
    ON vehiculos (usuario_id, placa) WHERE activo;

-- ------------------------------------------------------ garantia (servicio)
-- Termino de garantia del servicio en dias (Decreto 735 de 2013). NULL: el
-- taller no lo definio; la orden dice que rige la garantia legal.
ALTER TABLE servicios
    ADD COLUMN garantia_dias SMALLINT,
    ADD CONSTRAINT servicios_garantia_dias_rango
        CHECK (garantia_dias IS NULL OR garantia_dias BETWEEN 0 AND 3650);

-- ------------------------------------------------------------------ turnos
ALTER TABLE turnos
    ADD COLUMN vehiculo_id          UUID,
    -- Quien cancelo. 'taller' nunca genera strike al cliente.
    ADD COLUMN cancelado_por        TEXT,
    ADD COLUMN cancelado_en         TIMESTAMPTZ,
    ADD COLUMN motivo_cancelacion   TEXT,
    -- Reprogramar = cancelar este y crear otro; este apunta al nuevo.
    ADD COLUMN reprogramado_a       UUID,
    ADD COLUMN notas_atencion       TEXT,
    -- Foto de la garantia al cerrar como atendido (como el precio en 016):
    -- cambiar el servicio despues no altera una orden ya entregada.
    ADD COLUMN garantia_dias        SMALLINT,
    ADD COLUMN garantia_hasta       DATE,
    -- 3 strikes vigentes: el turno se paga 100% por adelantado
    -- (anticipo_centavos = total_centavos; se cobra en el Sprint 24).
    ADD COLUMN anticipo_por_strikes BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT turnos_vehiculo_fkey FOREIGN KEY (vehiculo_id)
        REFERENCES vehiculos (id),
    ADD CONSTRAINT turnos_reprogramado_fkey FOREIGN KEY (reprogramado_a)
        REFERENCES turnos (id),
    ADD CONSTRAINT turnos_cancelado_por_valores
        CHECK (cancelado_por IN ('cliente', 'taller')),
    -- Los datos de la cancelacion van juntos y solo en un cancelado: un
    -- turno reactivado (sale de cancelado) tiene que limpiarlos. Un
    -- cancelado sin quien ni cuando es ANTERIOR a esta migracion: no se
    -- inventa quien lo cancelo.
    ADD CONSTRAINT turnos_cancelacion_consistente CHECK (
        (estado <> 'cancelado' AND cancelado_por IS NULL AND cancelado_en IS NULL
            AND motivo_cancelacion IS NULL AND reprogramado_a IS NULL)
        OR (estado = 'cancelado' AND (cancelado_por IS NULL) = (cancelado_en IS NULL))
    ),
    ADD CONSTRAINT turnos_garantia_consistente CHECK (
        garantia_hasta IS NULL OR (estado = 'atendido' AND garantia_dias IS NOT NULL)
    );
CREATE INDEX idx_turnos_vehiculo ON turnos (vehiculo_id) WHERE vehiculo_id IS NOT NULL;

-- ------------------------------------------------------ politica del taller
CREATE TABLE politica_cancelacion (
    taller_id               UUID     NOT NULL,
    -- Cancelar o reprogramar gratis hasta N horas antes del turno.
    ventana_horas           SMALLINT NOT NULL DEFAULT 4,
    -- Cuanto dura un strike antes de vencer.
    vigencia_strikes_meses  SMALLINT NOT NULL DEFAULT 12,
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT politica_cancelacion_pkey PRIMARY KEY (taller_id),
    CONSTRAINT politica_cancelacion_taller_fkey FOREIGN KEY (taller_id)
        REFERENCES talleres (id) ON DELETE CASCADE,
    CONSTRAINT politica_cancelacion_ventana CHECK (ventana_horas BETWEEN 0 AND 72),
    CONSTRAINT politica_cancelacion_vigencia CHECK (vigencia_strikes_meses BETWEEN 1 AND 36)
);
INSERT INTO politica_cancelacion (taller_id) SELECT id FROM talleres;

-- El alta de taller (016) ahora tambien crea la politica.
CREATE OR REPLACE FUNCTION inicializar_taller() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO configuracion_fiscal (taller_id) VALUES (NEW.id);
    INSERT INTO credenciales_taller (taller_id) VALUES (NEW.id);
    INSERT INTO horarios_taller (taller_id, dia_semana, apertura, cierre)
    SELECT NEW.id, d, '08:00', '18:00' FROM generate_series(1, 7) AS d;
    INSERT INTO politica_cancelacion (taller_id) VALUES (NEW.id);
    RETURN NEW;
END
$$;

-- ----------------------------------------------------------------- strikes
-- Por taller: un cliente puede estar al dia en un taller y bloqueado en
-- otro. Uno por turno como maximo (UNIQUE): un turno no se cancela tarde Y
-- se falta.
CREATE TABLE strikes (
    id           UUID        NOT NULL DEFAULT gen_random_uuid(),
    taller_id    UUID        NOT NULL,
    usuario_id   UUID        NOT NULL,
    turno_id     UUID        NOT NULL,
    motivo       TEXT        NOT NULL,
    -- Texto para el cliente: que turno y cuanto antes cancelo.
    detalle      TEXT        NOT NULL,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Se fija al crearlo con la vigencia de ese momento: cambiar la
    -- politica no alarga ni acorta strikes ya puestos.
    vence_en     TIMESTAMPTZ NOT NULL,
    anulado_en   TIMESTAMPTZ,
    anulado_por  UUID,
    justificacion_anulacion TEXT,

    CONSTRAINT strikes_pkey PRIMARY KEY (id),
    CONSTRAINT strikes_taller_fkey FOREIGN KEY (taller_id) REFERENCES talleres (id),
    CONSTRAINT strikes_usuario_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
    CONSTRAINT strikes_turno_fkey FOREIGN KEY (turno_id) REFERENCES turnos (id),
    CONSTRAINT strikes_turno_key UNIQUE (turno_id),
    CONSTRAINT strikes_motivo_valores
        CHECK (motivo IN ('cancelacion_tardia', 'reprogramacion_tardia', 'no_asistio')),
    CONSTRAINT strikes_vence_despues CHECK (vence_en > creado_en),
    -- Anular exige quien y por que: el cliente ve la justificacion.
    CONSTRAINT strikes_anulacion_completa CHECK (
        (anulado_en IS NULL AND anulado_por IS NULL AND justificacion_anulacion IS NULL)
        OR (anulado_en IS NOT NULL AND anulado_por IS NOT NULL
            AND length(trim(justificacion_anulacion)) >= 10)
    )
);
-- "Cuantos strikes vigentes tiene este cliente en este taller": se consulta
-- en cada reserva.
CREATE INDEX idx_strikes_vigentes ON strikes (taller_id, usuario_id, vence_en)
    WHERE anulado_en IS NULL;
CREATE INDEX idx_strikes_usuario ON strikes (usuario_id);

-- Reclamo del cliente sobre un strike. Tabla aparte y no columnas en
-- strikes: el cliente escribe aca, y RLS no puede limitar QUE columnas de
-- una fila modifica; si el reclamo viviera en strikes, el cliente que puede
-- reclamar podria tambien anularse el strike.
CREATE TABLE reclamos_strike (
    strike_id    UUID        NOT NULL,
    taller_id    UUID        NOT NULL,
    usuario_id   UUID        NOT NULL,
    texto        TEXT        NOT NULL,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Respuesta del taller. Si lo acepta, el strike queda anulado (con la
    -- misma justificacion); si no, queda rechazado con la respuesta.
    resultado    TEXT,
    respuesta    TEXT,
    resuelto_en  TIMESTAMPTZ,
    resuelto_por UUID,

    CONSTRAINT reclamos_strike_pkey PRIMARY KEY (strike_id),
    CONSTRAINT reclamos_strike_strike_fkey FOREIGN KEY (strike_id)
        REFERENCES strikes (id) ON DELETE CASCADE,
    CONSTRAINT reclamos_strike_texto CHECK (length(trim(texto)) BETWEEN 10 AND 2000),
    CONSTRAINT reclamos_strike_resultado
        CHECK (resultado IN ('aceptado', 'rechazado')),
    CONSTRAINT reclamos_strike_resuelto_completo CHECK (
        (resultado IS NULL AND respuesta IS NULL AND resuelto_en IS NULL AND resuelto_por IS NULL)
        OR (resultado IS NOT NULL AND length(trim(respuesta)) >= 10
            AND resuelto_en IS NOT NULL AND resuelto_por IS NOT NULL)
    )
);
CREATE INDEX idx_reclamos_pendientes ON reclamos_strike (taller_id)
    WHERE resultado IS NULL;

-- ------------------------------------------------------------- recepciones
-- Constancia de entrega del vehiculo para reparacion (Ley 1480 de 2011,
-- art. 18). Una por turno. Mientras no la acepta el cliente es un borrador
-- que el taller corrige; aceptada, no cambia mas (trigger de abajo).
CREATE TABLE recepciones (
    id                 UUID        NOT NULL DEFAULT gen_random_uuid(),
    taller_id          UUID        NOT NULL,
    turno_id           UUID        NOT NULL,
    vehiculo_id        UUID        NOT NULL,
    -- Consecutivo del taller: numero de la orden de trabajo.
    numero             INTEGER     NOT NULL,
    kilometraje        INTEGER     NOT NULL,
    -- Cuartos de tanque: 0 = reserva ... 4 = lleno.
    nivel_combustible  SMALLINT    NOT NULL,
    estado_vehiculo    TEXT        NOT NULL,
    objetos_dejados    TEXT        NOT NULL,
    observaciones      TEXT,
    fecha_probable_entrega TIMESTAMPTZ NOT NULL,
    recibido_por       UUID        NOT NULL,
    creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Aceptacion del cliente: desde su cuenta, o en el mostrador (nombre y
    -- documento de quien entrega, que puede no ser el titular).
    aceptada_en        TIMESTAMPTZ,
    aceptada_medio     TEXT,
    aceptada_nombre    TEXT,
    aceptada_documento TEXT,

    CONSTRAINT recepciones_pkey PRIMARY KEY (id),
    CONSTRAINT recepciones_taller_fkey FOREIGN KEY (taller_id) REFERENCES talleres (id),
    CONSTRAINT recepciones_turno_fkey FOREIGN KEY (turno_id) REFERENCES turnos (id),
    CONSTRAINT recepciones_vehiculo_fkey FOREIGN KEY (vehiculo_id) REFERENCES vehiculos (id),
    CONSTRAINT recepciones_turno_key UNIQUE (turno_id),
    CONSTRAINT recepciones_numero_key UNIQUE (taller_id, numero),
    CONSTRAINT recepciones_km_rango CHECK (kilometraje BETWEEN 0 AND 3000000),
    CONSTRAINT recepciones_combustible CHECK (nivel_combustible BETWEEN 0 AND 4),
    CONSTRAINT recepciones_estado_texto CHECK (length(trim(estado_vehiculo)) > 0),
    CONSTRAINT recepciones_aceptacion CHECK (
        (aceptada_en IS NULL AND aceptada_medio IS NULL
            AND aceptada_nombre IS NULL AND aceptada_documento IS NULL)
        OR (aceptada_en IS NOT NULL AND aceptada_medio = 'cuenta')
        OR (aceptada_en IS NOT NULL AND aceptada_medio = 'presencial'
            AND length(trim(aceptada_nombre)) > 0 AND length(trim(aceptada_documento)) > 0)
    )
);

-- Fotos opcionales de la recepcion. En la base (bytea) y no en un bucket:
-- hoy no hay almacenamiento de objetos en la plataforma, son pocas (tope
-- en la app) y ya llegan reducidas desde el navegador.
CREATE TABLE recepcion_fotos (
    id            UUID        NOT NULL DEFAULT gen_random_uuid(),
    recepcion_id  UUID        NOT NULL,
    taller_id     UUID        NOT NULL,
    tipo_mime     TEXT        NOT NULL,
    datos         BYTEA       NOT NULL,
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT recepcion_fotos_pkey PRIMARY KEY (id),
    CONSTRAINT recepcion_fotos_recepcion_fkey FOREIGN KEY (recepcion_id)
        REFERENCES recepciones (id) ON DELETE CASCADE,
    CONSTRAINT recepcion_fotos_mime CHECK (tipo_mime IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT recepcion_fotos_tamano CHECK (octet_length(datos) BETWEEN 1 AND 2097152)
);
CREATE INDEX idx_recepcion_fotos_recepcion ON recepcion_fotos (recepcion_id);

-- Aceptada = firmada: la aplicacion no la puede cambiar, ni a ella ni a
-- sus fotos. Lo unico que se permite es el UPDATE que la acepta (OLD sin
-- aceptar). Aplica al rol de la app: el dueño de las tablas (migraciones,
-- una correccion a mano, la limpieza de los tests) no queda bloqueado.
CREATE FUNCTION recepcion_inmutable() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    recepcion UUID;
BEGIN
    IF current_user <> 'turnos_app' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    IF TG_TABLE_NAME = 'recepciones' THEN
        IF OLD.aceptada_en IS NOT NULL THEN
            RAISE EXCEPTION 'La recepcion % ya fue aceptada por el cliente y no se puede modificar', OLD.numero
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    -- recepcion_fotos
    recepcion := CASE WHEN TG_OP = 'DELETE' THEN OLD.recepcion_id ELSE NEW.recepcion_id END;
    IF EXISTS (SELECT 1 FROM recepciones r
                WHERE r.id = recepcion AND r.aceptada_en IS NOT NULL) THEN
        RAISE EXCEPTION 'La recepcion ya fue aceptada: no se agregan ni quitan fotos'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER recepciones_inmutables
    BEFORE UPDATE OR DELETE ON recepciones
    FOR EACH ROW EXECUTE FUNCTION recepcion_inmutable();
CREATE TRIGGER recepcion_fotos_inmutables
    BEFORE INSERT OR DELETE ON recepcion_fotos
    FOR EACH ROW EXECUTE FUNCTION recepcion_inmutable();

-- ------------------------------------------------------ permisos y RLS
GRANT SELECT, INSERT, UPDATE, DELETE
    ON vehiculos, politica_cancelacion, strikes, reclamos_strike,
       recepciones, recepcion_fotos
    TO turnos_app;

-- Personal del taller (o superadmin operando en el): lo que en las
-- politicas de abajo es "el taller". Un cliente tambien opera "en" un
-- taller (X-Taller) y NO tiene que ver lo de otros clientes.
CREATE FUNCTION app_es_personal() RETURNS BOOLEAN
    LANGUAGE sql STABLE AS $$ SELECT app_rol() IN ('admin', 'tecnico', 'superadmin') $$;

-- vehiculos: los propios, y los de los clientes del taller para el personal.
ALTER TABLE vehiculos ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehiculos_acceso ON vehiculos FOR ALL
    USING (
        usuario_id = app_usuario()
        OR (app_es_personal() AND EXISTS (
            SELECT 1 FROM clientes_taller ct
             WHERE ct.usuario_id = vehiculos.usuario_id AND ct.taller_id = app_taller()))
    )
    WITH CHECK (
        usuario_id = app_usuario()
        OR (app_es_personal() AND EXISTS (
            SELECT 1 FROM clientes_taller ct
             WHERE ct.usuario_id = vehiculos.usuario_id AND ct.taller_id = app_taller()))
    );

-- politica: la lee cualquiera, de cualquier taller. Es publica (se le
-- muestra al cliente antes de reservar) y "Mis turnos" junta turnos de
-- varios talleres, cada uno con su ventana. La cambia el admin.
ALTER TABLE politica_cancelacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY politica_cancelacion_ver ON politica_cancelacion FOR SELECT
    USING (true);
CREATE POLICY politica_cancelacion_modificar ON politica_cancelacion FOR UPDATE
    USING (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'))
    WITH CHECK (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'));

-- strikes: el cliente ve los suyos de todos los talleres; el personal, los
-- del taller. Se crean en el taller de la sesion (la cancelacion tardia la
-- hace el propio cliente: solo sobre si mismo). Anular: solo el admin.
ALTER TABLE strikes ENABLE ROW LEVEL SECURITY;
CREATE POLICY strikes_ver ON strikes FOR SELECT
    USING (usuario_id = app_usuario() OR (taller_id = app_taller() AND app_es_personal()));
CREATE POLICY strikes_crear ON strikes FOR INSERT
    WITH CHECK (taller_id = app_taller() AND (app_es_personal() OR usuario_id = app_usuario()));
CREATE POLICY strikes_anular ON strikes FOR UPDATE
    USING (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'))
    WITH CHECK (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'));

ALTER TABLE reclamos_strike ENABLE ROW LEVEL SECURITY;
CREATE POLICY reclamos_strike_ver ON reclamos_strike FOR SELECT
    USING (usuario_id = app_usuario() OR (taller_id = app_taller() AND app_es_personal()));
CREATE POLICY reclamos_strike_crear ON reclamos_strike FOR INSERT
    WITH CHECK (
        usuario_id = app_usuario()
        AND EXISTS (SELECT 1 FROM strikes s
                     WHERE s.id = strike_id AND s.usuario_id = app_usuario()
                       AND s.taller_id = reclamos_strike.taller_id)
    );
CREATE POLICY reclamos_strike_resolver ON reclamos_strike FOR UPDATE
    USING (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'))
    WITH CHECK (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'));

-- recepciones y fotos: el personal del taller las escribe; el cliente lee
-- las de sus turnos. El cliente NO tiene UPDATE: con una politica de
-- UPDATE podria cambiar el kilometraje o el estado antes de aceptar. Acepta
-- por aceptar_recepcion(), que solo toca las columnas de la aceptacion.
ALTER TABLE recepciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY recepciones_ver ON recepciones FOR SELECT
    USING (
        (taller_id = app_taller() AND app_es_personal())
        OR EXISTS (SELECT 1 FROM turnos t
                    WHERE t.id = recepciones.turno_id AND t.usuario_id = app_usuario())
    );
CREATE POLICY recepciones_escribir ON recepciones FOR ALL
    USING (taller_id = app_taller() AND app_es_personal())
    WITH CHECK (taller_id = app_taller() AND app_es_personal());

-- Aceptacion de la constancia. SECURITY DEFINER para que el cliente pueda
-- aceptar sin permiso de UPDATE; por eso verifica aca quien llama:
--   'cuenta'     -> el titular del turno, desde su sesion.
--   'presencial' -> el personal del taller, en el mostrador, con nombre y
--                   documento de quien entrega.
-- Devuelve la fila aceptada; NULL si no existe, no le corresponde o ya
-- estaba aceptada (la app distingue con una lectura previa).
CREATE FUNCTION aceptar_recepcion(
    p_recepcion UUID, p_medio TEXT, p_nombre TEXT, p_documento TEXT
) RETURNS SETOF recepciones
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_medio = 'cuenta' THEN
        RETURN QUERY
        UPDATE recepciones r
           SET aceptada_en = now(), aceptada_medio = 'cuenta'
          FROM turnos t
         WHERE r.id = p_recepcion AND t.id = r.turno_id
           AND t.usuario_id = app_usuario()
           AND r.aceptada_en IS NULL
        RETURNING r.*;
    ELSIF p_medio = 'presencial' THEN
        RETURN QUERY
        UPDATE recepciones r
           SET aceptada_en = now(), aceptada_medio = 'presencial',
               aceptada_nombre = trim(p_nombre), aceptada_documento = trim(p_documento)
         WHERE r.id = p_recepcion
           AND r.taller_id = app_taller() AND app_es_personal()
           AND r.aceptada_en IS NULL
        RETURNING r.*;
    END IF;
END
$$;
REVOKE ALL ON FUNCTION aceptar_recepcion(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aceptar_recepcion(UUID, TEXT, TEXT, TEXT) TO turnos_app;

ALTER TABLE recepcion_fotos ENABLE ROW LEVEL SECURITY;
CREATE POLICY recepcion_fotos_ver ON recepcion_fotos FOR SELECT
    USING (
        (taller_id = app_taller() AND app_es_personal())
        OR EXISTS (SELECT 1 FROM recepciones r JOIN turnos t ON t.id = r.turno_id
                    WHERE r.id = recepcion_fotos.recepcion_id AND t.usuario_id = app_usuario())
    );
CREATE POLICY recepcion_fotos_escribir ON recepcion_fotos FOR ALL
    USING (taller_id = app_taller() AND app_es_personal())
    WITH CHECK (taller_id = app_taller() AND app_es_personal());
