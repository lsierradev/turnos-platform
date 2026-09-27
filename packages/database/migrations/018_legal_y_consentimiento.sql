-- 018_legal_y_consentimiento.sql
-- Documentos legales, registro de aceptaciones y derechos del titular
-- (Sprint 23).
--
-- Compatible hacia atras con los servicios del Sprint 22: solo agrega
-- tablas y una columna nullable.
--
-- Los textos de TurnoPro (terminos del taller, politica de datos,
-- autorizacion) viven versionados en usuarios-service
-- (src/modules/legal/textos); aca se guarda QUIEN acepto QUE version.
-- Las condiciones de cada taller con sus clientes son texto del taller y
-- se guardan aca, una fila por version publicada.

-- --------------------------------------------------- condiciones del taller
-- Inmutables: cada publicacion es una version nueva. Lo que el cliente
-- acepto tiene que poder mostrarse tal cual, aunque el taller lo cambie
-- despues.
CREATE TABLE condiciones_taller (
    taller_id          UUID        NOT NULL,
    version            INTEGER     NOT NULL,
    contenido          TEXT        NOT NULL,
    -- SHA-256 del contenido: lo que guarda la aceptacion.
    sha256             TEXT        NOT NULL,
    -- De que version de la plantilla de TurnoPro partio.
    plantilla_version  INTEGER     NOT NULL,
    publicado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    publicado_por      UUID        NOT NULL,

    CONSTRAINT condiciones_taller_pkey PRIMARY KEY (taller_id, version),
    CONSTRAINT condiciones_taller_taller_fkey FOREIGN KEY (taller_id)
        REFERENCES talleres (id) ON DELETE CASCADE,
    CONSTRAINT condiciones_taller_publicado_por_fkey FOREIGN KEY (publicado_por)
        REFERENCES usuarios (id) ON DELETE CASCADE,
    CONSTRAINT condiciones_taller_version_positiva CHECK (version > 0),
    CONSTRAINT condiciones_taller_contenido_largo
        CHECK (length(contenido) BETWEEN 200 AND 60000),
    CONSTRAINT condiciones_taller_sha256_formato CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

-- ----------------------------------------------------------- aceptaciones
-- Una fila por aceptacion: usuario, documento, version, fecha, IP y canal.
-- Nunca se modifica ni se borra desde la app (turnos_app solo tiene
-- SELECT e INSERT): es la prueba de la autorizacion (articulo 8 del
-- Decreto 1377 de 2013) y sobrevive a la supresion del titular, que
-- anonimiza la fila de usuarios en vez de borrarla.
--
-- ON DELETE CASCADE solo para las limpiezas de las suites de pruebas: la
-- aplicacion nunca borra usuarios ni talleres.
CREATE TABLE aceptaciones_legales (
    id              UUID        NOT NULL DEFAULT gen_random_uuid(),
    usuario_id      UUID        NOT NULL,
    documento       TEXT        NOT NULL,
    version         INTEGER     NOT NULL,
    sha256          TEXT        NOT NULL,
    -- terminos_taller: el taller que queda obligado. condiciones_taller:
    -- el taller de esas condiciones. Politica y autorizacion: el taller
    -- donde se registro en el mostrador, o NULL si la acepto el titular.
    taller_id       UUID,
    -- web / app: el titular, desde su sesion. presencial: el personal del
    -- taller deja constancia de que el titular acepto en el mostrador.
    canal           TEXT        NOT NULL,
    ip              INET,
    user_agent      TEXT,
    registrado_por  UUID,
    aceptado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT aceptaciones_legales_pkey PRIMARY KEY (id),
    CONSTRAINT aceptaciones_legales_usuario_fkey FOREIGN KEY (usuario_id)
        REFERENCES usuarios (id) ON DELETE CASCADE,
    CONSTRAINT aceptaciones_legales_taller_fkey FOREIGN KEY (taller_id)
        REFERENCES talleres (id) ON DELETE CASCADE,
    CONSTRAINT aceptaciones_legales_registrado_por_fkey FOREIGN KEY (registrado_por)
        REFERENCES usuarios (id) ON DELETE CASCADE,
    CONSTRAINT aceptaciones_legales_documento_valores CHECK (documento IN (
        'terminos_taller', 'politica_datos', 'autorizacion_datos', 'condiciones_taller')),
    CONSTRAINT aceptaciones_legales_canal_valores
        CHECK (canal IN ('web', 'app', 'presencial')),
    CONSTRAINT aceptaciones_legales_version_positiva CHECK (version > 0),
    CONSTRAINT aceptaciones_legales_sha256_formato CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT aceptaciones_legales_con_taller CHECK (
        documento NOT IN ('terminos_taller', 'condiciones_taller') OR taller_id IS NOT NULL),
    -- Presencial = alguien del taller la registro, en ese taller.
    CONSTRAINT aceptaciones_legales_presencial CHECK (
        (canal = 'presencial') = (registrado_por IS NOT NULL)
        AND (canal <> 'presencial' OR taller_id IS NOT NULL))
);
-- "Ultima version aceptada" por usuario y documento (pendientes y reserva).
CREATE INDEX idx_aceptaciones_usuario_documento
    ON aceptaciones_legales (usuario_id, documento, version DESC);
CREATE INDEX idx_aceptaciones_taller_documento
    ON aceptaciones_legales (taller_id, documento, version DESC)
    WHERE taller_id IS NOT NULL;

-- --------------------------------------------------- solicitudes del titular
-- Traza de lo que el titular pidio sobre sus datos (Ley 1581 de 2012,
-- articulos 14 y 15): exportacion, rectificacion y supresion. La consulta
-- en pantalla no se registra: es leer lo propio.
CREATE TABLE solicitudes_titular (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    usuario_id  UUID        NOT NULL,
    tipo        TEXT        NOT NULL,
    -- Que campos cambio (rectificacion) o que se conservo (supresion).
    detalle     JSONB       NOT NULL DEFAULT '{}',
    ip          INET,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT solicitudes_titular_pkey PRIMARY KEY (id),
    CONSTRAINT solicitudes_titular_usuario_fkey FOREIGN KEY (usuario_id)
        REFERENCES usuarios (id) ON DELETE CASCADE,
    CONSTRAINT solicitudes_titular_tipo_valores
        CHECK (tipo IN ('exportacion', 'rectificacion', 'supresion'))
);
CREATE INDEX idx_solicitudes_titular_usuario ON solicitudes_titular (usuario_id);

-- ---------------------------------------------------------------- usuarios
-- Supresion (Sprint 23): la fila queda anonimizada (los turnos, las
-- recepciones y las aceptaciones la nombran), con la fecha de supresion.
ALTER TABLE usuarios ADD COLUMN suprimido_en TIMESTAMPTZ;

-- ------------------------------------------------------ permisos y RLS
-- Solo SELECT e INSERT: ni una aceptacion ni una version publicada se
-- modifican desde la app.
GRANT SELECT, INSERT ON condiciones_taller, aceptaciones_legales, solicitudes_titular
    TO turnos_app;

-- condiciones: publicas, como la politica de cancelacion (el cliente las
-- lee antes de reservar en cualquier taller). Las publica el admin.
ALTER TABLE condiciones_taller ENABLE ROW LEVEL SECURITY;
CREATE POLICY condiciones_taller_ver ON condiciones_taller FOR SELECT
    USING (true);
CREATE POLICY condiciones_taller_publicar ON condiciones_taller FOR INSERT
    WITH CHECK (
        taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin')
        AND publicado_por = app_usuario()
    );

-- aceptaciones: el titular ve las suyas; el admin, las de su taller (los
-- terminos que acepto el taller y las condiciones que aceptaron sus
-- clientes).
ALTER TABLE aceptaciones_legales ENABLE ROW LEVEL SECURITY;
CREATE POLICY aceptaciones_legales_ver ON aceptaciones_legales FOR SELECT
    USING (
        usuario_id = app_usuario()
        OR (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'))
    );
CREATE POLICY aceptaciones_legales_crear ON aceptaciones_legales FOR INSERT
    WITH CHECK (
        -- El titular, por si mismo. Los terminos del taller solo los acepta
        -- un admin, por SU taller; las condiciones, las del taller de la
        -- sesion.
        (usuario_id = app_usuario() AND canal <> 'presencial'
            AND (documento <> 'terminos_taller'
                 OR (app_rol() = 'admin' AND taller_id = app_taller()))
            AND (documento <> 'condiciones_taller' OR taller_id = app_taller()))
        -- El admin, en el mostrador, por un cliente de su taller. Nunca los
        -- terminos (son del taller, no del cliente).
        OR (canal = 'presencial' AND registrado_por = app_usuario()
            AND app_rol() IN ('admin', 'superadmin') AND taller_id = app_taller()
            AND documento <> 'terminos_taller'
            AND EXISTS (SELECT 1 FROM clientes_taller ct
                         WHERE ct.usuario_id = aceptaciones_legales.usuario_id
                           AND ct.taller_id = app_taller()))
    );

ALTER TABLE solicitudes_titular ENABLE ROW LEVEL SECURITY;
CREATE POLICY solicitudes_titular_propias ON solicitudes_titular FOR SELECT
    USING (usuario_id = app_usuario());
CREATE POLICY solicitudes_titular_crear ON solicitudes_titular FOR INSERT
    WITH CHECK (usuario_id = app_usuario());
