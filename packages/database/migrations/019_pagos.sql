-- 019_pagos.sql
-- Pagos con Wompi y en el mostrador, devoluciones, disputas y cuadre de
-- caja (Sprint 24).
--
-- Compatible hacia atras con los servicios del Sprint 23: tablas nuevas,
-- columnas con default y un CHECK ampliado. Los turnos anteriores quedan
-- con anticipo_estado = 'no_requiere' (no se les empieza a cobrar ni
-- vencen de golpe al desplegar).
--
-- El dinero lo cobra Wompi con las llaves DE CADA TALLER y va a su cuenta:
-- TurnoPro nunca lo recibe. Aca no hay ningun dato de tarjeta: el pago se
-- hace en el checkout de Wompi y solo vuelven el id de la transaccion, el
-- estado y el tipo de medio.

-- ------------------------------------------------------------------ turnos
ALTER TABLE turnos
    -- no_requiere: el servicio no pide anticipo (o el turno es anterior a
    -- esta migracion). pendiente: reservado a la espera del pago; si hay
    -- anticipo_vence_en, al pasar se libera. pagado: confirmado.
    ADD COLUMN anticipo_estado  TEXT NOT NULL DEFAULT 'no_requiere',
    ADD COLUMN anticipo_vence_en TIMESTAMPTZ,
    ADD CONSTRAINT turnos_anticipo_estado_valores
        CHECK (anticipo_estado IN ('no_requiere', 'pendiente', 'pagado')),
    ADD CONSTRAINT turnos_anticipo_vence_solo_pendiente
        CHECK (anticipo_vence_en IS NULL OR anticipo_estado = 'pendiente');

-- 'sistema': el turno que se libero porque el anticipo no se pago a
-- tiempo. Como 'taller', nunca suma strike.
ALTER TABLE turnos DROP CONSTRAINT turnos_cancelado_por_valores;
ALTER TABLE turnos ADD CONSTRAINT turnos_cancelado_por_valores
    CHECK (cancelado_por IN ('cliente', 'taller', 'sistema'));

CREATE INDEX idx_turnos_anticipo_por_vencer ON turnos (anticipo_vence_en)
    WHERE anticipo_estado = 'pendiente' AND anticipo_vence_en IS NOT NULL
      AND estado = 'programado';

-- Cuanto tiene el cliente para pagar el anticipo antes de que se libere.
ALTER TABLE politica_cancelacion
    ADD COLUMN plazo_anticipo_minutos SMALLINT NOT NULL DEFAULT 30,
    ADD CONSTRAINT politica_cancelacion_plazo_anticipo
        CHECK (plazo_anticipo_minutos BETWEEN 10 AND 1440);

-- ------------------------------------------------------------------- pagos
CREATE TABLE pagos (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
    taller_id           UUID        NOT NULL,
    turno_id            UUID        NOT NULL,
    -- Quien paga (el titular del turno).
    usuario_id          UUID,
    concepto            TEXT        NOT NULL,
    canal               TEXT        NOT NULL,
    monto_centavos      BIGINT      NOT NULL,
    moneda              TEXT        NOT NULL DEFAULT 'COP',
    -- Wompi: la referencia del checkout (unica en todo el sistema). En el
    -- mostrador, NULL.
    referencia          TEXT,
    -- creado: se genero el checkout, todavia no hay transaccion.
    -- pendiente: Wompi informo la transaccion y no es final (PSE, Nequi).
    -- aprobado | rechazado | error: finales de Wompi.
    -- anulado: la transaccion quedo VOIDED (devolucion o reversion).
    -- expirado: checkout nunca usado.
    -- en_disputa | revertido: reversion (Ley 1480, art. 51) o contracargo.
    estado              TEXT        NOT NULL,
    wompi_transaccion_id TEXT,
    -- CARD, PSE, NEQUI, BANCOLOMBIA_TRANSFER... o efectivo | datafono |
    -- transferencia en el mostrador.
    metodo              TEXT,
    estado_proveedor    TEXT,
    -- Timestamp del ultimo evento aplicado: un evento viejo que llega tarde
    -- no pisa uno nuevo.
    ultimo_evento_en    TIMESTAMPTZ,
    aprobado_en         TIMESTAMPTZ,
    -- La expiracion firmada en el checkout (la del anticipo).
    vence_en            TIMESTAMPTZ,
    -- Version de las condiciones del taller aceptada antes de pagar
    -- (Sprint 23). NULL: el taller no tenia condiciones publicadas.
    condiciones_version INTEGER,
    -- Mostrador: quien lo registro y el comprobante (voucher del datafono,
    -- numero de la transferencia).
    registrado_por      UUID,
    comprobante         TEXT,
    -- Aprobado cuando el concepto ya estaba cubierto: se devuelve solo.
    duplicado           BOOLEAN     NOT NULL DEFAULT false,
    disputa_tipo        TEXT,
    disputa_detalle     TEXT,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pagos_pkey PRIMARY KEY (id),
    CONSTRAINT pagos_taller_fkey FOREIGN KEY (taller_id) REFERENCES talleres (id) ON DELETE CASCADE,
    CONSTRAINT pagos_turno_fkey FOREIGN KEY (turno_id) REFERENCES turnos (id) ON DELETE CASCADE,
    CONSTRAINT pagos_usuario_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
    CONSTRAINT pagos_referencia_key UNIQUE (referencia),
    CONSTRAINT pagos_wompi_transaccion_key UNIQUE (wompi_transaccion_id),
    CONSTRAINT pagos_concepto_valores CHECK (concepto IN ('anticipo', 'saldo')),
    CONSTRAINT pagos_canal_valores
        CHECK (canal IN ('wompi', 'efectivo', 'datafono', 'transferencia')),
    CONSTRAINT pagos_estado_valores CHECK (estado IN (
        'creado', 'pendiente', 'aprobado', 'rechazado', 'error', 'anulado',
        'expirado', 'en_disputa', 'revertido')),
    CONSTRAINT pagos_monto_positivo CHECK (monto_centavos > 0),
    CONSTRAINT pagos_moneda_cop CHECK (moneda = 'COP'),
    CONSTRAINT pagos_wompi_con_referencia CHECK ((canal = 'wompi') = (referencia IS NOT NULL)),
    CONSTRAINT pagos_mostrador_registrado CHECK (
        canal = 'wompi' OR (registrado_por IS NOT NULL AND estado IN ('aprobado', 'en_disputa', 'revertido'))),
    CONSTRAINT pagos_disputa_tipo CHECK (disputa_tipo IN ('reversion', 'contracargo')),
    CONSTRAINT pagos_disputa_consistente CHECK (
        (estado IN ('en_disputa', 'revertido')) <= (disputa_tipo IS NOT NULL))
);
CREATE INDEX idx_pagos_turno ON pagos (turno_id);
CREATE INDEX idx_pagos_taller_aprobado ON pagos (taller_id, aprobado_en) WHERE aprobado_en IS NOT NULL;
-- Lo que la conciliacion revisa.
CREATE INDEX idx_pagos_por_conciliar ON pagos (creado_en)
    WHERE canal = 'wompi' AND estado IN ('creado', 'pendiente');

-- -------------------------------------------------------------- reembolsos
-- Una devolucion por pago (el pago entero: el anticipo se devuelve
-- completo). Tarjeta: se anula por la API de Wompi. PSE, Nequi,
-- Bancolombia y el mostrador no tienen devolucion por API: quedan en
-- pendiente_manual hasta que el taller registra que devolvio el dinero.
CREATE TABLE reembolsos (
    id              UUID        NOT NULL DEFAULT gen_random_uuid(),
    taller_id       UUID        NOT NULL,
    pago_id         UUID        NOT NULL,
    monto_centavos  BIGINT      NOT NULL,
    motivo          TEXT        NOT NULL,
    -- por_anular: tarjeta; la anulacion se pide a Wompi DESPUES del commit
    -- (una llamada de red no va dentro de la transaccion) y la conciliacion
    -- la reintenta si el proceso se cayo en el medio. solicitado: Wompi la
    -- acepto y se espera el VOIDED. pendiente_manual: lo tiene que hacer el
    -- taller (medio sin devolucion por API, o la anulacion fallo).
    estado          TEXT        NOT NULL,
    via             TEXT        NOT NULL,
    nota            TEXT,
    registrado_por  UUID,
    completado_en   TIMESTAMPTZ,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT reembolsos_pkey PRIMARY KEY (id),
    CONSTRAINT reembolsos_taller_fkey FOREIGN KEY (taller_id) REFERENCES talleres (id) ON DELETE CASCADE,
    CONSTRAINT reembolsos_pago_fkey FOREIGN KEY (pago_id) REFERENCES pagos (id) ON DELETE CASCADE,
    CONSTRAINT reembolsos_pago_key UNIQUE (pago_id),
    CONSTRAINT reembolsos_monto_positivo CHECK (monto_centavos > 0),
    CONSTRAINT reembolsos_motivo_valores CHECK (motivo IN (
        'cancelacion_en_ventana', 'cancelacion_taller', 'turno_liberado', 'pago_duplicado')),
    CONSTRAINT reembolsos_estado_valores
        CHECK (estado IN ('por_anular', 'solicitado', 'pendiente_manual', 'completado')),
    CONSTRAINT reembolsos_via_valores CHECK (via IN ('wompi_anulacion', 'manual')),
    CONSTRAINT reembolsos_completado CHECK ((estado = 'completado') = (completado_en IS NOT NULL))
);
CREATE INDEX idx_reembolsos_pendientes ON reembolsos (taller_id)
    WHERE estado IN ('por_anular', 'solicitado', 'pendiente_manual');

-- ---------------------------------------------------------- eventos Wompi
-- Idempotencia: el mismo evento (transaccion + estado + timestamp) se
-- procesa una sola vez. Wompi reintenta si no recibe 200, y el mismo
-- evento puede llegar dos veces.
CREATE TABLE eventos_wompi (
    taller_id        UUID        NOT NULL,
    transaccion_id   TEXT        NOT NULL,
    estado           TEXT        NOT NULL,
    timestamp_evento BIGINT      NOT NULL,
    referencia       TEXT,
    resultado        TEXT        NOT NULL,
    recibido_en      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT eventos_wompi_pkey PRIMARY KEY (taller_id, transaccion_id, estado, timestamp_evento),
    CONSTRAINT eventos_wompi_taller_fkey FOREIGN KEY (taller_id) REFERENCES talleres (id) ON DELETE CASCADE
);

-- ------------------------------------------------------------------ alertas
-- Lo que el taller tiene que mirar: reversiones, contracargos, pagos que
-- no cuadran, devoluciones que no se pudieron hacer solas.
CREATE TABLE alertas_pago (
    id           UUID        NOT NULL DEFAULT gen_random_uuid(),
    taller_id    UUID        NOT NULL,
    pago_id      UUID,
    tipo         TEXT        NOT NULL,
    mensaje      TEXT        NOT NULL,
    creada_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    atendida_en  TIMESTAMPTZ,
    atendida_por UUID,

    CONSTRAINT alertas_pago_pkey PRIMARY KEY (id),
    CONSTRAINT alertas_pago_taller_fkey FOREIGN KEY (taller_id) REFERENCES talleres (id) ON DELETE CASCADE,
    CONSTRAINT alertas_pago_pago_fkey FOREIGN KEY (pago_id) REFERENCES pagos (id) ON DELETE CASCADE,
    CONSTRAINT alertas_pago_tipo_valores CHECK (tipo IN (
        'reversion', 'contracargo', 'anulacion_externa', 'monto_inconsistente',
        'pago_duplicado', 'pago_tardio', 'reembolso_pendiente', 'reembolso_fallido'))
);
CREATE INDEX idx_alertas_pago_abiertas ON alertas_pago (taller_id) WHERE atendida_en IS NULL;

-- ------------------------------------------------------------- caja diaria
CREATE TABLE cierres_caja (
    taller_id          UUID        NOT NULL,
    fecha              DATE        NOT NULL,
    -- Efectivo segun el sistema (cobros menos devoluciones en efectivo).
    esperado_centavos  BIGINT      NOT NULL,
    contado_centavos   BIGINT      NOT NULL,
    nota               TEXT,
    cerrado_por        UUID        NOT NULL,
    cerrado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT cierres_caja_pkey PRIMARY KEY (taller_id, fecha),
    CONSTRAINT cierres_caja_taller_fkey FOREIGN KEY (taller_id) REFERENCES talleres (id) ON DELETE CASCADE,
    CONSTRAINT cierres_caja_contado CHECK (contado_centavos >= 0)
);

-- Si el taller cobra en linea (tiene Wompi configurado). SECURITY DEFINER:
-- el cliente que reserva no puede leer credenciales_taller (RLS de 016),
-- pero hay que saber si su anticipo vence o se cobra en el mostrador.
CREATE FUNCTION taller_cobra_en_linea(p_taller UUID) RETURNS BOOLEAN
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $
    SELECT coalesce((SELECT wompi_llave_publica IS NOT NULL
                       AND wompi_secreto_integridad_cifrado IS NOT NULL
                       AND wompi_secreto_eventos_cifrado IS NOT NULL
                  FROM credenciales_taller WHERE taller_id = p_taller), false)
$;
REVOKE ALL ON FUNCTION taller_cobra_en_linea(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION taller_cobra_en_linea(UUID) TO turnos_app;

-- ------------------------------------------------------ permisos y RLS
GRANT SELECT, INSERT, UPDATE ON pagos, reembolsos, alertas_pago TO turnos_app;
GRANT SELECT, INSERT ON cierres_caja TO turnos_app;
-- eventos_wompi: solo modo sistema (el webhook no tiene sesion).

-- pagos: el titular ve los suyos; el personal, los del taller. Crear: el
-- cliente, un checkout de un turno propio en el taller de la sesion; el
-- personal, cualquiera del taller. Actualizar: el personal (disputas); los
-- estados de Wompi los escribe el modo sistema (webhook, conciliacion).
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;
CREATE POLICY pagos_ver ON pagos FOR SELECT
    USING (usuario_id = app_usuario() OR (taller_id = app_taller() AND app_es_personal()));
CREATE POLICY pagos_crear ON pagos FOR INSERT
    WITH CHECK (
        taller_id = app_taller()
        AND (app_es_personal()
             OR (usuario_id = app_usuario() AND canal = 'wompi'
                 AND EXISTS (SELECT 1 FROM turnos t
                              WHERE t.id = turno_id AND t.usuario_id = app_usuario())))
    );
CREATE POLICY pagos_modificar ON pagos FOR UPDATE
    USING (taller_id = app_taller() AND app_es_personal())
    WITH CHECK (taller_id = app_taller() AND app_es_personal());

ALTER TABLE reembolsos ENABLE ROW LEVEL SECURITY;
CREATE POLICY reembolsos_ver ON reembolsos FOR SELECT
    USING (
        (taller_id = app_taller() AND app_es_personal())
        OR EXISTS (SELECT 1 FROM pagos p WHERE p.id = pago_id AND p.usuario_id = app_usuario())
    );
CREATE POLICY reembolsos_escribir ON reembolsos FOR INSERT
    WITH CHECK (taller_id = app_taller() AND app_es_personal());
CREATE POLICY reembolsos_modificar ON reembolsos FOR UPDATE
    USING (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'))
    WITH CHECK (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'));

ALTER TABLE alertas_pago ENABLE ROW LEVEL SECURITY;
CREATE POLICY alertas_pago_taller ON alertas_pago FOR ALL
    USING (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'))
    WITH CHECK (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'));

ALTER TABLE cierres_caja ENABLE ROW LEVEL SECURITY;
CREATE POLICY cierres_caja_taller ON cierres_caja FOR ALL
    USING (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'))
    WITH CHECK (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin')
                AND cerrado_por = app_usuario());

ALTER TABLE eventos_wompi ENABLE ROW LEVEL SECURITY;
