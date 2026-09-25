-- 015_multi_taller.sql
-- TurnoPro atiende varios talleres (Sprint 20).
--
-- Cada dato operativo pertenece a un taller. El aislamiento NO depende de
-- que el codigo se acuerde de filtrar: lo garantiza Postgres con Row Level
-- Security. Los servicios corren cada request con `SET LOCAL ROLE
-- turnos_app` (un rol sin privilegios especiales) y el taller y el usuario
-- de la sesion en variables de la transaccion (app.taller_id,
-- app.usuario_id, app.rol). Las politicas de abajo filtran cada fila contra
-- esas variables: ni un SELECT * olvidado cruza de un taller a otro.
--
-- Lo que corre sin rol de app (el dueño de las tablas): las migraciones,
-- el login y los enlaces de contraseña (se buscan por correo o token, antes
-- de saber de que taller es alguien) y los recordatorios programados. Ese
-- "modo sistema" es explicito en el codigo (ver ContextoDb).
--
-- Modelo:
--   - talleres.
--   - Personal (admin, tecnico): pertenece a UN taller (usuarios.taller_id).
--   - Cliente: identidad global (un correo, una cuenta) que se relaciona
--     con cada taller en el que reserva (clientes_taller). Cada taller ve
--     solo a sus clientes y los turnos que tienen con el.
--   - Superadmin (TurnoPro): sin taller; elige en cual opera.

-- ---------------------------------------------------------------- talleres
CREATE TABLE talleres (
    id             UUID        NOT NULL DEFAULT gen_random_uuid(),
    nombre         TEXT        NOT NULL,
    slug           TEXT        NOT NULL,
    activo         BOOLEAN     NOT NULL DEFAULT true,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT talleres_pkey PRIMARY KEY (id),
    CONSTRAINT talleres_slug_key UNIQUE (slug),
    CONSTRAINT talleres_slug_formato CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- Todo lo que existe hoy pasa a este taller. Id fijo: los seeds y la
-- documentacion lo pueden nombrar.
INSERT INTO talleres (id, nombre, slug)
VALUES ('00000000-0000-4000-8000-000000000001', 'Taller principal', 'principal');

-- Nuevo rol de la plataforma. ADD VALUE dentro de una transaccion esta
-- permitido, pero el valor no se puede USAR en la misma transaccion: por
-- eso ninguna constraint de abajo lo nombra.
ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'superadmin';

-- ---------------------------------------------------------------- usuarios
ALTER TABLE usuarios ADD COLUMN taller_id UUID;
UPDATE usuarios
   SET taller_id = '00000000-0000-4000-8000-000000000001'
 WHERE rol IN ('admin', 'tecnico');
ALTER TABLE usuarios
    ADD CONSTRAINT usuarios_taller_id_fkey FOREIGN KEY (taller_id) REFERENCES talleres (id),
    -- El personal tiene taller; clientes y superadmin, no.
    ADD CONSTRAINT usuarios_personal_con_taller
        CHECK ((rol IN ('admin', 'tecnico')) = (taller_id IS NOT NULL)),
    -- Destino de la FK compuesta de turnos.tecnico_id (ver abajo).
    ADD CONSTRAINT usuarios_id_taller_key UNIQUE (id, taller_id);
CREATE INDEX idx_usuarios_taller_id ON usuarios (taller_id);

-- --------------------------------------------------------- clientes_taller
CREATE TABLE clientes_taller (
    taller_id  UUID        NOT NULL,
    usuario_id UUID        NOT NULL,
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT clientes_taller_pkey PRIMARY KEY (taller_id, usuario_id),
    CONSTRAINT clientes_taller_taller_fkey FOREIGN KEY (taller_id)
        REFERENCES talleres (id) ON DELETE CASCADE,
    CONSTRAINT clientes_taller_usuario_fkey FOREIGN KEY (usuario_id)
        REFERENCES usuarios (id) ON DELETE CASCADE
);
CREATE INDEX idx_clientes_taller_usuario ON clientes_taller (usuario_id);

INSERT INTO clientes_taller (taller_id, usuario_id)
SELECT '00000000-0000-4000-8000-000000000001', id FROM usuarios WHERE rol = 'cliente';

-- ------------------------------------------------------ bahias y servicios
ALTER TABLE bahias ADD COLUMN taller_id UUID;
UPDATE bahias SET taller_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE bahias
    ALTER COLUMN taller_id SET NOT NULL,
    ADD CONSTRAINT bahias_taller_id_fkey FOREIGN KEY (taller_id) REFERENCES talleres (id),
    ADD CONSTRAINT bahias_id_taller_key UNIQUE (id, taller_id);
CREATE INDEX idx_bahias_taller_id ON bahias (taller_id);

ALTER TABLE servicios ADD COLUMN taller_id UUID;
UPDATE servicios SET taller_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE servicios
    ALTER COLUMN taller_id SET NOT NULL,
    ADD CONSTRAINT servicios_taller_id_fkey FOREIGN KEY (taller_id) REFERENCES talleres (id),
    ADD CONSTRAINT servicios_id_taller_key UNIQUE (id, taller_id);
CREATE INDEX idx_servicios_taller_id ON servicios (taller_id);

-- ------------------------------------------------------------------ turnos
ALTER TABLE turnos ADD COLUMN taller_id UUID;
UPDATE turnos SET taller_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE turnos
    ALTER COLUMN taller_id SET NOT NULL,
    ADD CONSTRAINT turnos_taller_id_fkey FOREIGN KEY (taller_id) REFERENCES talleres (id);

-- FKs compuestas: bahia, servicio y tecnico tienen que ser DEL MISMO taller
-- que el turno. Con las FK simples de antes, un turno del taller A podia
-- apuntar a una bahia del taller B si un bug dejaba pasar el id. (El
-- cliente no: es global.)
ALTER TABLE turnos
    DROP CONSTRAINT turnos_bahia_id_fkey,
    DROP CONSTRAINT turnos_servicio_id_fkey,
    DROP CONSTRAINT turnos_tecnico_id_fkey;
ALTER TABLE turnos
    ADD CONSTRAINT turnos_bahia_taller_fkey FOREIGN KEY (bahia_id, taller_id)
        REFERENCES bahias (id, taller_id),
    ADD CONSTRAINT turnos_servicio_taller_fkey FOREIGN KEY (servicio_id, taller_id)
        REFERENCES servicios (id, taller_id),
    -- MATCH SIMPLE (default): un turno sin tecnico no se chequea.
    ADD CONSTRAINT turnos_tecnico_taller_fkey FOREIGN KEY (tecnico_id, taller_id)
        REFERENCES usuarios (id, taller_id);

-- Las consultas de agenda, panel y dashboard filtran siempre por taller y
-- rango: el indice de KPIs (009) no lleva taller.
CREATE INDEX idx_turnos_taller_inicio ON turnos (taller_id, lower(rango_tiempo));

-- ---------------------------------------------------------- notificaciones
ALTER TABLE notificaciones ADD COLUMN taller_id UUID;
UPDATE notificaciones n SET taller_id = t.taller_id FROM turnos t WHERE t.id = n.turno_id;
ALTER TABLE notificaciones
    ALTER COLUMN taller_id SET NOT NULL,
    ADD CONSTRAINT notificaciones_taller_id_fkey FOREIGN KEY (taller_id) REFERENCES talleres (id);

-- ------------------------------------------------------- rol de la app
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'turnos_app') THEN
        CREATE ROLE turnos_app NOLOGIN;
    END IF;
END
$$;
-- El usuario con el que se conectan los servicios tiene que poder hacer
-- SET ROLE turnos_app. (Un superusuario ya puede; en produccion el usuario
-- de la app normalmente no lo es.)
GRANT turnos_app TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO turnos_app;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON talleres, usuarios, clientes_taller, bahias, servicios, turnos, notificaciones
    TO turnos_app;
-- Sin permisos sobre tokens_contrasena ni schema_migrations: solo el modo
-- sistema los toca. Las tablas NUEVAS no heredan nada: cada migracion que
-- cree una tabla tiene que darle permisos y politica a turnos_app.

-- Variables de la sesion. current_setting(..., true) devuelve NULL si no
-- esta seteada y '' si se seteo vacia: las dos cuentan como "sin valor".
CREATE FUNCTION app_taller() RETURNS UUID
    LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.taller_id', true), '')::uuid $$;
CREATE FUNCTION app_usuario() RETURNS UUID
    LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.usuario_id', true), '')::uuid $$;
CREATE FUNCTION app_rol() RETURNS TEXT
    LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.rol', true), '') $$;

-- ------------------------------------------------------------ politicas
-- talleres: todos ven los activos (el cliente elige donde reservar) y el
-- propio; solo el superadmin crea o modifica.
ALTER TABLE talleres ENABLE ROW LEVEL SECURITY;
CREATE POLICY talleres_ver ON talleres FOR SELECT
    USING (activo OR id = app_taller() OR app_rol() = 'superadmin');
CREATE POLICY talleres_crear ON talleres FOR INSERT
    WITH CHECK (app_rol() = 'superadmin');
CREATE POLICY talleres_modificar ON talleres FOR UPDATE
    USING (app_rol() = 'superadmin') WITH CHECK (app_rol() = 'superadmin');

-- turnos: los del taller de la sesion y, ademas, los propios del cliente en
-- cualquier taller ("Mis turnos"). Escribir, solo en el taller de la sesion.
ALTER TABLE turnos ENABLE ROW LEVEL SECURITY;
CREATE POLICY turnos_ver ON turnos FOR SELECT
    USING (taller_id = app_taller() OR usuario_id = app_usuario());
CREATE POLICY turnos_crear ON turnos FOR INSERT
    WITH CHECK (taller_id = app_taller());
CREATE POLICY turnos_modificar ON turnos FOR UPDATE
    USING (taller_id = app_taller()) WITH CHECK (taller_id = app_taller());
CREATE POLICY turnos_borrar ON turnos FOR DELETE
    USING (taller_id = app_taller());

-- bahias y servicios: las del taller y, para leer, las de los turnos
-- propios del cliente en otros talleres (sin eso "Mis turnos" no puede
-- mostrar en que bahia ni que servicio).
ALTER TABLE bahias ENABLE ROW LEVEL SECURITY;
CREATE POLICY bahias_ver ON bahias FOR SELECT
    USING (
        taller_id = app_taller()
        OR EXISTS (SELECT 1 FROM turnos t WHERE t.bahia_id = bahias.id AND t.usuario_id = app_usuario())
    );
CREATE POLICY bahias_escribir ON bahias FOR ALL
    USING (taller_id = app_taller()) WITH CHECK (taller_id = app_taller());

ALTER TABLE servicios ENABLE ROW LEVEL SECURITY;
CREATE POLICY servicios_ver ON servicios FOR SELECT
    USING (
        taller_id = app_taller()
        OR EXISTS (SELECT 1 FROM turnos t WHERE t.servicio_id = servicios.id AND t.usuario_id = app_usuario())
    );
CREATE POLICY servicios_escribir ON servicios FOR ALL
    USING (taller_id = app_taller()) WITH CHECK (taller_id = app_taller());

-- clientes_taller: la relacion de los clientes con el taller de la sesion,
-- y las propias del cliente. Crear, solo en el taller de la sesion.
ALTER TABLE clientes_taller ENABLE ROW LEVEL SECURITY;
CREATE POLICY clientes_taller_ver ON clientes_taller FOR SELECT
    USING (taller_id = app_taller() OR usuario_id = app_usuario());
CREATE POLICY clientes_taller_crear ON clientes_taller FOR INSERT
    WITH CHECK (taller_id = app_taller());
CREATE POLICY clientes_taller_borrar ON clientes_taller FOR DELETE
    USING (taller_id = app_taller());

-- usuarios: uno mismo, el personal del taller, sus clientes y los tecnicos
-- que atendieron turnos propios (para mostrar el nombre en "Mis turnos").
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY usuarios_ver ON usuarios FOR SELECT
    USING (
        id = app_usuario()
        OR taller_id = app_taller()
        OR EXISTS (SELECT 1 FROM clientes_taller ct
                    WHERE ct.usuario_id = usuarios.id AND ct.taller_id = app_taller())
        OR EXISTS (SELECT 1 FROM turnos t
                    WHERE t.tecnico_id = usuarios.id AND t.usuario_id = app_usuario())
    );
-- Alta: personal del propio taller, o un cliente (global, sin taller). La
-- relacion cliente-taller se crea aparte en clientes_taller.
CREATE POLICY usuarios_crear ON usuarios FOR INSERT
    WITH CHECK (app_taller() IS NOT NULL AND (taller_id = app_taller() OR taller_id IS NULL));
CREATE POLICY usuarios_modificar ON usuarios FOR UPDATE
    USING (id = app_usuario() OR taller_id = app_taller())
    WITH CHECK (id = app_usuario() OR taller_id = app_taller());

ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY notificaciones_taller ON notificaciones FOR ALL
    USING (taller_id = app_taller()) WITH CHECK (taller_id = app_taller());

-- Enlaces de contraseña: solo modo sistema. RLS encendida y sin politicas
-- = nadie con turnos_app ve ni una fila (ademas de no tener permisos).
ALTER TABLE tokens_contrasena ENABLE ROW LEVEL SECURITY;
