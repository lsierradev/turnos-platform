-- 004_create_servicios.sql
-- Tabla de servicios (categorias: Mecanica, Electrica, Latoneria).

CREATE TYPE categoria_servicio AS ENUM ('mecanica', 'electrica', 'latoneria');

CREATE TABLE servicios (
    id               UUID               NOT NULL DEFAULT gen_random_uuid(),
    nombre           TEXT               NOT NULL,
    categoria        categoria_servicio NOT NULL,
    duracion_minutos INTEGER            NOT NULL,
    precio           NUMERIC(10, 2)     NOT NULL,
    activo           BOOLEAN            NOT NULL DEFAULT true,
    creado_en        TIMESTAMPTZ        NOT NULL DEFAULT now(),
    actualizado_en   TIMESTAMPTZ        NOT NULL DEFAULT now(),

    CONSTRAINT servicios_pkey PRIMARY KEY (id),
    CONSTRAINT servicios_duracion_minutos_check CHECK (duracion_minutos > 0),
    CONSTRAINT servicios_precio_check CHECK (precio >= 0)
);
