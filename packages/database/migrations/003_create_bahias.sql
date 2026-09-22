-- 003_create_bahias.sql
-- Tabla de bahias (capacidad operativa).

CREATE TABLE bahias (
    id             UUID        NOT NULL DEFAULT gen_random_uuid(),
    nombre         TEXT        NOT NULL,
    activa         BOOLEAN     NOT NULL DEFAULT true,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT bahias_pkey PRIMARY KEY (id)
);
