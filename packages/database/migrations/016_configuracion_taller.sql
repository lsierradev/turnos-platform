-- 016_configuracion_taller.sql
-- Configuracion fiscal, precios con IVA, horario y festivos por taller
-- (Sprint 21).
--
-- Igual que 015, esta migracion NO es compatible con la version anterior
-- de los servicios: servicios.precio desaparece (pasa a centavos enteros).
-- Desplegarla junto con los servicios del Sprint 21.

-- ------------------------------------------------------ datos fiscales
-- Lo que se puede mostrar: el cliente del taller necesita saber si el
-- taller cobra IVA para ver el precio final, y razon social y NIT van
-- impresos en cualquier factura. Las credenciales van aparte (abajo), con
-- una politica que el cliente no pasa.
CREATE TABLE configuracion_fiscal (
    taller_id       UUID        NOT NULL,
    razon_social    TEXT,
    -- Sin digito de verificacion ni puntos: solo los digitos del NIT.
    nit             TEXT,
    dv              SMALLINT,
    direccion       TEXT,
    municipio       TEXT,
    departamento    TEXT,
    -- Default false a proposito: hasta Sprint 20 el precio cargado era el
    -- que veia el cliente. Tratarlo como base "No responsable" deja cada
    -- precio igual que antes hasta que el admin configure otra cosa.
    responsable_iva BOOLEAN     NOT NULL DEFAULT false,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT configuracion_fiscal_pkey PRIMARY KEY (taller_id),
    CONSTRAINT configuracion_fiscal_taller_fkey
        FOREIGN KEY (taller_id) REFERENCES talleres (id) ON DELETE CASCADE,
    CONSTRAINT configuracion_fiscal_nit_formato CHECK (nit ~ '^[0-9]{5,15}$'),
    CONSTRAINT configuracion_fiscal_dv_rango CHECK (dv BETWEEN 0 AND 9)
);

-- ---------------------------------------------------------- credenciales
-- Tokens y llaves de los proveedores del taller. Los secretos llegan ya
-- cifrados por la aplicacion (AES-256-GCM, paquete crypto); la llave
-- publica de Wompi no es secreta (va en el checkout del navegador).
CREATE TABLE credenciales_taller (
    taller_id                        UUID        NOT NULL,
    proveedor_facturacion            TEXT,
    facturacion_usuario              TEXT,
    facturacion_token_cifrado        TEXT,
    wompi_ambiente                   TEXT,
    wompi_llave_publica              TEXT,
    wompi_llave_privada_cifrada      TEXT,
    wompi_secreto_integridad_cifrado TEXT,
    wompi_secreto_eventos_cifrado    TEXT,
    actualizado_en                   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT credenciales_taller_pkey PRIMARY KEY (taller_id),
    CONSTRAINT credenciales_taller_taller_fkey
        FOREIGN KEY (taller_id) REFERENCES talleres (id) ON DELETE CASCADE,
    CONSTRAINT credenciales_taller_proveedor
        CHECK (proveedor_facturacion IN ('alegra', 'siigo')),
    CONSTRAINT credenciales_taller_wompi_ambiente
        CHECK (wompi_ambiente IN ('pruebas', 'produccion'))
);

-- ---------------------------------------------------------------- horario
-- Una fila por dia de la semana que el taller atiende (ISO: 1 = lunes,
-- 7 = domingo). Sin fila = cerrado ese dia. Cuartos de hora: la grilla de
-- reserva avanza de a 15 minutos.
CREATE TABLE horarios_taller (
    taller_id  UUID     NOT NULL,
    dia_semana SMALLINT NOT NULL,
    apertura   TIME     NOT NULL,
    cierre     TIME     NOT NULL,

    CONSTRAINT horarios_taller_pkey PRIMARY KEY (taller_id, dia_semana),
    CONSTRAINT horarios_taller_taller_fkey
        FOREIGN KEY (taller_id) REFERENCES talleres (id) ON DELETE CASCADE,
    CONSTRAINT horarios_taller_dia CHECK (dia_semana BETWEEN 1 AND 7),
    CONSTRAINT horarios_taller_orden CHECK (apertura < cierre),
    CONSTRAINT horarios_taller_cuartos CHECK (
        extract(minute FROM apertura)::int % 15 = 0 AND extract(second FROM apertura) = 0
        AND extract(minute FROM cierre)::int % 15 = 0 AND extract(second FROM cierre) = 0
    )
);

-- Dias puntuales sin atencion (festivos, vacaciones colectivas).
CREATE TABLE feriados_taller (
    taller_id UUID NOT NULL,
    fecha     DATE NOT NULL,
    motivo    TEXT NOT NULL,

    CONSTRAINT feriados_taller_pkey PRIMARY KEY (taller_id, fecha),
    CONSTRAINT feriados_taller_taller_fkey
        FOREIGN KEY (taller_id) REFERENCES talleres (id) ON DELETE CASCADE,
    CONSTRAINT feriados_taller_motivo CHECK (length(trim(motivo)) > 0)
);

-- Todo taller nace con su configuracion y el horario que regia hasta
-- Sprint 20 (todos los dias, 08:00-18:00): asi un taller recien creado, o
-- sembrado por SQL en los tests, reserva igual que antes. El admin lo
-- ajusta despues. Trigger y no codigo: cubre cualquier ruta de alta.
CREATE FUNCTION inicializar_taller() RETURNS trigger
    -- SECURITY DEFINER: el alta puede correr como turnos_app (sin INSERT en
    -- estas tablas) y la configuracion inicial igual tiene que crearse.
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO configuracion_fiscal (taller_id) VALUES (NEW.id);
    INSERT INTO credenciales_taller (taller_id) VALUES (NEW.id);
    INSERT INTO horarios_taller (taller_id, dia_semana, apertura, cierre)
    SELECT NEW.id, d, '08:00', '18:00' FROM generate_series(1, 7) AS d;
    RETURN NEW;
END
$$;
CREATE TRIGGER talleres_inicializar
    AFTER INSERT ON talleres
    FOR EACH ROW EXECUTE FUNCTION inicializar_taller();

INSERT INTO configuracion_fiscal (taller_id) SELECT id FROM talleres;
INSERT INTO credenciales_taller (taller_id) SELECT id FROM talleres;
INSERT INTO horarios_taller (taller_id, dia_semana, apertura, cierre)
SELECT t.id, d, '08:00', '18:00' FROM talleres t CROSS JOIN generate_series(1, 7) AS d;

-- --------------------------------------------------------------- servicios
-- Precio en centavos enteros (como Wompi, amount_in_cents): sin redondeos
-- de punto flotante entre lo que ve el cliente, el cobro y la factura. El
-- admin carga el valor BASE; el IVA se calcula con la tarifa del servicio
-- si el taller es responsable.
ALTER TABLE servicios
    ADD COLUMN precio_base_centavos BIGINT,
    ADD COLUMN tarifa_iva           SMALLINT NOT NULL DEFAULT 19,
    ADD COLUMN requiere_anticipo    BOOLEAN  NOT NULL DEFAULT false,
    ADD COLUMN porcentaje_anticipo  SMALLINT;
UPDATE servicios SET precio_base_centavos = round(precio * 100);
ALTER TABLE servicios
    ALTER COLUMN precio_base_centavos SET NOT NULL,
    DROP COLUMN precio,
    ADD CONSTRAINT servicios_precio_base_check CHECK (precio_base_centavos >= 0),
    -- Tarifas de IVA vigentes en Colombia: general 19, reducida 5, 0 para
    -- exentos/excluidos.
    ADD CONSTRAINT servicios_tarifa_iva_check CHECK (tarifa_iva IN (0, 5, 19)),
    -- Anticipo 15-20% (politica del Sprint 21); sin anticipo, sin porcentaje.
    ADD CONSTRAINT servicios_anticipo_check CHECK (
        (NOT requiere_anticipo AND porcentaje_anticipo IS NULL)
        OR (requiere_anticipo AND porcentaje_anticipo BETWEEN 15 AND 20)
    );

-- ----------------------------------------------------------------- turnos
-- Foto del precio al reservar: cambiar el precio del servicio o la
-- configuracion fiscal no toca turnos existentes. NULL en los turnos
-- anteriores a esta migracion (no se inventa con que precio se tomaron).
-- tarifa_iva NULL = el taller no era responsable de IVA al reservar.
ALTER TABLE turnos
    ADD COLUMN precio_base_centavos BIGINT,
    ADD COLUMN iva_centavos         BIGINT,
    ADD COLUMN total_centavos       BIGINT,
    ADD COLUMN tarifa_iva           SMALLINT,
    ADD COLUMN anticipo_centavos    BIGINT,
    ADD CONSTRAINT turnos_precio_consistente CHECK (
        (precio_base_centavos IS NULL AND iva_centavos IS NULL AND total_centavos IS NULL)
        OR (precio_base_centavos >= 0 AND iva_centavos >= 0
            AND total_centavos = precio_base_centavos + iva_centavos)
    ),
    ADD CONSTRAINT turnos_anticipo_check CHECK (
        anticipo_centavos IS NULL
        OR (total_centavos IS NOT NULL AND anticipo_centavos BETWEEN 0 AND total_centavos)
    );

-- --------------------------------------------------------------- usuarios
-- Baja de personal (Sprint 21): no se borra (sus turnos pasados lo
-- nombran), deja de poder entrar y de aparecer para reservar.
ALTER TABLE usuarios ADD COLUMN activo BOOLEAN NOT NULL DEFAULT true;

-- Turnos futuros sin tecnico (el suyo se dio de baja): la lista que el
-- panel muestra para reasignar.
CREATE INDEX idx_turnos_sin_tecnico ON turnos (taller_id, lower(rango_tiempo))
    WHERE tecnico_id IS NULL AND estado = 'programado';

-- ------------------------------------------------------ permisos y RLS
GRANT SELECT, INSERT, UPDATE, DELETE
    ON configuracion_fiscal, credenciales_taller, horarios_taller, feriados_taller
    TO turnos_app;

-- Datos fiscales, horario y festivos: los lee cualquiera que opere en el
-- taller (el cliente tambien: precio con IVA, dias que atiende). Los
-- escribe el admin del taller o el superadmin que opera en el.
ALTER TABLE configuracion_fiscal ENABLE ROW LEVEL SECURITY;
CREATE POLICY configuracion_fiscal_ver ON configuracion_fiscal FOR SELECT
    USING (taller_id = app_taller());
CREATE POLICY configuracion_fiscal_modificar ON configuracion_fiscal FOR UPDATE
    USING (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'))
    WITH CHECK (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'));

ALTER TABLE horarios_taller ENABLE ROW LEVEL SECURITY;
CREATE POLICY horarios_taller_ver ON horarios_taller FOR SELECT
    USING (taller_id = app_taller());
CREATE POLICY horarios_taller_escribir ON horarios_taller FOR ALL
    USING (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'))
    WITH CHECK (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'));

ALTER TABLE feriados_taller ENABLE ROW LEVEL SECURITY;
CREATE POLICY feriados_taller_ver ON feriados_taller FOR SELECT
    USING (taller_id = app_taller());
CREATE POLICY feriados_taller_escribir ON feriados_taller FOR ALL
    USING (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'))
    WITH CHECK (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'));

-- Credenciales: ni leer. Un cliente opera "en" el taller (X-Taller) y con
-- solo taller_id = app_taller() podria leer los secretos cifrados si algun
-- endpoint los consultara por error.
ALTER TABLE credenciales_taller ENABLE ROW LEVEL SECURITY;
CREATE POLICY credenciales_taller_admin ON credenciales_taller FOR ALL
    USING (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'))
    WITH CHECK (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'));
