-- 001_init_turnos.sql
-- Esquema inicial: tabla turnos con prevencion de double-booking a nivel de DB.
--
-- La constraint EXCLUDE USING gist garantiza que no puedan existir dos filas
-- con el mismo bahia_id cuyo rango_tiempo se solape, sin necesidad de locking
-- ni validacion en la capa de aplicacion.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE turnos (
    id             UUID        NOT NULL DEFAULT gen_random_uuid(),
    bahia_id       UUID        NOT NULL,
    rango_tiempo   TSRANGE     NOT NULL,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT turnos_pkey PRIMARY KEY (id),
    CONSTRAINT turnos_rango_tiempo_no_vacio CHECK (NOT isempty(rango_tiempo)),

    -- Bloquea a nivel de DB dos turnos con rangos solapados en la misma bahia.
    CONSTRAINT turnos_bahia_rango_excl EXCLUDE USING gist (
        bahia_id WITH =,
        rango_tiempo WITH &&
    )
);

CREATE INDEX idx_turnos_bahia_id ON turnos (bahia_id);
