-- 008_create_notificaciones.sql
-- Tabla de notificaciones (RF-03: recordatorio 24h antes del turno).
--
-- La constraint UNIQUE de abajo es la garantia de idempotencia: el
-- scheduler puede volver a evaluar el mismo turno en corridas sucesivas del
-- cron (la ventana de tiempo se solapa a proposito, ver
-- notifications-scheduler.service.ts) sin riesgo de mandar el mismo
-- recordatorio dos veces por el mismo canal -- el INSERT simplemente no
-- inserta nada si ya existe la fila (ON CONFLICT DO NOTHING). Mismo
-- principio que turnos_bahia_rango_excl desde Sprint 1: la DB es la fuente
-- de verdad de unicidad, no un chequeo previo en la aplicacion.

CREATE TYPE canal_notificacion AS ENUM ('email', 'whatsapp');
CREATE TYPE estado_notificacion AS ENUM ('pendiente', 'enviado', 'fallido');

CREATE TABLE notificaciones (
    id             UUID                 NOT NULL DEFAULT gen_random_uuid(),
    turno_id       UUID                 NOT NULL,
    canal          canal_notificacion   NOT NULL,
    destinatario   TEXT                 NOT NULL,
    -- Texto libre en vez de enum: hoy solo existe 'recordatorio_24h', pero
    -- agregar un segundo tipo de notificacion no deberia requerir una
    -- migracion de esquema (ALTER TYPE ... ADD VALUE).
    tipo           TEXT                 NOT NULL DEFAULT 'recordatorio_24h',
    estado         estado_notificacion  NOT NULL DEFAULT 'pendiente',
    intentos       INTEGER              NOT NULL DEFAULT 0,
    error          TEXT,
    enviado_en     TIMESTAMPTZ,
    creado_en      TIMESTAMPTZ          NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ          NOT NULL DEFAULT now(),

    CONSTRAINT notificaciones_pkey PRIMARY KEY (id),
    CONSTRAINT notificaciones_turno_id_fkey FOREIGN KEY (turno_id) REFERENCES turnos (id),
    CONSTRAINT notificaciones_turno_tipo_canal_key UNIQUE (turno_id, tipo, canal)
);

CREATE INDEX idx_notificaciones_turno_id ON notificaciones (turno_id);
CREATE INDEX idx_notificaciones_estado ON notificaciones (estado);
