-- 013_tokens_contrasena.sql
-- Enlaces de un solo uso para definir o restablecer la contrasena (Sprint 18).
--
-- Dos motivos:
-- - 'alta': un admin dio de alta al cliente desde el formulario de reserva.
--   La cuenta nace con una contrasena al azar que nadie conoce y el cliente
--   recibe por correo un enlace para definir la suya.
-- - 'olvido': "Olvide mi contrasena" en el login.
--
-- Se guarda el SHA-256 del token, nunca el token: quien lea esta tabla (un
-- backup, un acceso de solo lectura) no puede usar los enlaces vigentes.
-- Un token de 32 bytes al azar no necesita sal ni bcrypt: no hay diccionario
-- contra el cual probar.
CREATE TABLE tokens_contrasena (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    usuario_id  UUID        NOT NULL,
    token_hash  TEXT        NOT NULL,
    motivo      TEXT        NOT NULL,
    expira_en   TIMESTAMPTZ NOT NULL,
    usado_en    TIMESTAMPTZ,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT tokens_contrasena_pkey PRIMARY KEY (id),
    CONSTRAINT tokens_contrasena_hash_key UNIQUE (token_hash),
    CONSTRAINT tokens_contrasena_motivo_check CHECK (motivo IN ('alta', 'olvido')),
    -- Borrar un usuario se lleva sus enlaces: no tienen sentido sin el.
    CONSTRAINT tokens_contrasena_usuario_fkey FOREIGN KEY (usuario_id)
        REFERENCES usuarios (id) ON DELETE CASCADE
);

CREATE INDEX idx_tokens_contrasena_usuario ON tokens_contrasena (usuario_id);
