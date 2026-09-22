-- 002_create_usuarios.sql
-- Tabla de usuarios (identidad, RNF-01).

CREATE TYPE rol_usuario AS ENUM ('admin', 'cliente', 'tecnico');

CREATE TABLE usuarios (
    id             UUID        NOT NULL DEFAULT gen_random_uuid(),
    email          TEXT        NOT NULL,
    password_hash  TEXT        NOT NULL,
    nombre         TEXT        NOT NULL,
    rol            rol_usuario NOT NULL DEFAULT 'cliente',
    -- Dato sensible cifrado en la capa de aplicacion (AES-256-GCM) antes de
    -- llegar aca; se almacena como texto (iv:authTag:data en hex).
    telefono       TEXT,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT usuarios_pkey PRIMARY KEY (id),
    CONSTRAINT usuarios_email_key UNIQUE (email)
);
