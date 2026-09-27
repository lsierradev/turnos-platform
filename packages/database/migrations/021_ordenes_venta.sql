-- 021_ordenes_venta.sql
-- Orden de venta: servicios, repuestos y anticipos (Sprint 26).
--
-- Compatible hacia atras: tablas nuevas, una columna nueva en
-- politica_cancelacion (con default) y una columna nullable en
-- movimientos_inventario (Sprint 25). No toca ninguna fila existente.

-- ---------------------------------------------------- tope de descuento
-- Sin descuentos hasta que el admin configure uno (default 0): igual que
-- responsable_iva en 016, el default deja el comportamiento actual (nadie
-- podia descontar) hasta que se elige lo contrario.
ALTER TABLE politica_cancelacion
    ADD COLUMN descuento_maximo_porcentaje SMALLINT NOT NULL DEFAULT 0,
    ADD CONSTRAINT politica_cancelacion_descuento_maximo
        CHECK (descuento_maximo_porcentaje BETWEEN 0 AND 100);

-- ------------------------------------------------------------ ordenes_venta
-- Estados: borrador -> confirmada -> pagada -> anulada (anulada tambien
-- desde confirmada: no hace falta cobrar para poder anular). El CHECK de
-- abajo no modela la transicion en si (eso es del servicio, con un FOR
-- UPDATE); modela que los datos de cada etapa esten completos y ninguno de
-- una etapa posterior aparezca antes de tiempo.
CREATE TABLE ordenes_venta (
    id                     UUID        NOT NULL DEFAULT gen_random_uuid(),
    taller_id              UUID        NOT NULL,
    -- Consecutivo del taller (como recepciones.numero, migracion 017).
    numero                 INTEGER     NOT NULL,
    -- El turno del que sale la orden (su servicio se agrega solo, con el
    -- precio con el que se reservo). NULL: venta de mostrador.
    turno_id               UUID,
    -- Cliente titular, para la cotizacion por correo. NULL: venta de
    -- mostrador sin cliente identificado.
    usuario_id             UUID,
    estado                 TEXT        NOT NULL DEFAULT 'borrador',
    -- Se congelan al confirmar (la orden en borrador se recalcula al vuelo
    -- desde sus lineas vigentes; ver VentasService.calcular). Una vez
    -- confirmada, cambiar un precio o el catalogo despues no la altera --
    -- mismo criterio que el precio guardado del turno (Sprint 21).
    subtotal_centavos      BIGINT,
    descuento_centavos     BIGINT,
    iva_centavos           BIGINT,
    total_centavos         BIGINT,
    -- Lo ya pagado del turno (pagos, Sprint 24) al momento de confirmar.
    anticipo_centavos      BIGINT,
    saldo_centavos         BIGINT,
    -- Foto de si el taller cobraba IVA al confirmar (igual que
    -- turnos.tarifa_iva, Sprint 21): si despues cambia la configuracion
    -- fiscal, una orden ya confirmada no se recalcula distinto.
    responsable_iva        BOOLEAN,
    creado_por             UUID        NOT NULL,
    creado_en              TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmada_en          TIMESTAMPTZ,
    confirmada_por         UUID,
    pagada_en              TIMESTAMPTZ,
    pagada_por             UUID,
    medio_pago             TEXT,
    comprobante_pago       TEXT,
    anulada_en             TIMESTAMPTZ,
    anulada_por            UUID,
    motivo_anulacion       TEXT,
    -- Cotizacion (punto 4 del Sprint 26): la orden en borrador se manda por
    -- correo y el cliente la acepta antes de que el taller pueda confirmarla.
    cotizacion_enviada_en  TIMESTAMPTZ,
    cotizacion_aceptada_en TIMESTAMPTZ,

    CONSTRAINT ordenes_venta_pkey PRIMARY KEY (id),
    CONSTRAINT ordenes_venta_taller_fkey FOREIGN KEY (taller_id)
        REFERENCES talleres (id) ON DELETE CASCADE,
    CONSTRAINT ordenes_venta_turno_fkey FOREIGN KEY (turno_id) REFERENCES turnos (id),
    CONSTRAINT ordenes_venta_usuario_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
    CONSTRAINT ordenes_venta_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES usuarios (id),
    CONSTRAINT ordenes_venta_confirmada_por_fkey FOREIGN KEY (confirmada_por) REFERENCES usuarios (id),
    CONSTRAINT ordenes_venta_pagada_por_fkey FOREIGN KEY (pagada_por) REFERENCES usuarios (id),
    CONSTRAINT ordenes_venta_anulada_por_fkey FOREIGN KEY (anulada_por) REFERENCES usuarios (id),
    CONSTRAINT ordenes_venta_numero_key UNIQUE (taller_id, numero),
    CONSTRAINT ordenes_venta_estado_valores
        CHECK (estado IN ('borrador', 'confirmada', 'pagada', 'anulada')),
    -- confirmada_en/por aparecen desde "confirmada" en adelante y ya no se
    -- borran (anular no deshace la confirmacion, es una etapa posterior).
    CONSTRAINT ordenes_venta_confirmada_consistente CHECK (
        (estado = 'borrador') = (confirmada_en IS NULL)
        AND (confirmada_en IS NULL) = (confirmada_por IS NULL)
    ),
    CONSTRAINT ordenes_venta_totales_desde_confirmada CHECK (
        (estado = 'borrador') = (total_centavos IS NULL)
        AND (subtotal_centavos IS NULL) = (total_centavos IS NULL)
        AND (descuento_centavos IS NULL) = (total_centavos IS NULL)
        AND (iva_centavos IS NULL) = (total_centavos IS NULL)
        AND (anticipo_centavos IS NULL) = (total_centavos IS NULL)
        AND (saldo_centavos IS NULL) = (total_centavos IS NULL)
        AND (responsable_iva IS NULL) = (total_centavos IS NULL)
    ),
    -- pagada_en persiste si despues se anula (fue pagada y despues
    -- anulada: las dos cosas pasaron y las dos quedan). Por eso no es
    -- "(estado = 'pagada') = (pagada_en IS NOT NULL)".
    CONSTRAINT ordenes_venta_pagada_consistente CHECK (
        (pagada_en IS NULL OR estado IN ('pagada', 'anulada'))
        AND (pagada_en IS NULL) = (pagada_por IS NULL)
        AND (pagada_en IS NULL) = (medio_pago IS NULL)
    ),
    CONSTRAINT ordenes_venta_anulada_consistente CHECK (
        (estado = 'anulada') = (anulada_en IS NOT NULL)
        AND (anulada_en IS NULL) = (anulada_por IS NULL)
        AND (anulada_en IS NULL OR length(trim(coalesce(motivo_anulacion, ''))) >= 10)
    ),
    CONSTRAINT ordenes_venta_medio_pago_valores
        CHECK (medio_pago IS NULL OR medio_pago IN ('efectivo', 'datafono', 'transferencia', 'wompi', 'otro')),
    CONSTRAINT ordenes_venta_cotizacion_consistente
        CHECK (cotizacion_aceptada_en IS NULL OR cotizacion_enviada_en IS NOT NULL)
);
CREATE INDEX idx_ordenes_venta_taller ON ordenes_venta (taller_id, creado_en DESC);
CREATE INDEX idx_ordenes_venta_turno ON ordenes_venta (turno_id) WHERE turno_id IS NOT NULL;
CREATE INDEX idx_ordenes_venta_usuario ON ordenes_venta (usuario_id) WHERE usuario_id IS NOT NULL;

-- ------------------------------------------------------ ordenes_venta_lineas
CREATE TABLE ordenes_venta_lineas (
    id                       UUID        NOT NULL DEFAULT gen_random_uuid(),
    orden_id                 UUID        NOT NULL,
    tipo                     TEXT        NOT NULL,
    servicio_id              UUID,
    item_id                  UUID,
    -- Nombre del servicio o repuesto en el momento de agregarlo: si el
    -- catalogo cambia el nombre despues, la orden ya emitida no cambia.
    descripcion              TEXT        NOT NULL,
    cantidad                 NUMERIC(12, 3) NOT NULL,
    -- Snapshot del precio BASE (sin IVA) al agregar la linea.
    precio_unitario_centavos BIGINT      NOT NULL,
    tarifa_iva               SMALLINT    NOT NULL,
    descuento_porcentaje     SMALLINT    NOT NULL DEFAULT 0,
    -- Calculado y guardado (no se recalcula distinto en cada lectura): es
    -- lo que de verdad se descuenta, en centavos, para la factura.
    descuento_centavos       BIGINT      NOT NULL DEFAULT 0,
    descuento_aplicado_por   UUID,
    creado_en                TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ordenes_venta_lineas_pkey PRIMARY KEY (id),
    CONSTRAINT ordenes_venta_lineas_orden_fkey FOREIGN KEY (orden_id)
        REFERENCES ordenes_venta (id) ON DELETE CASCADE,
    CONSTRAINT ordenes_venta_lineas_servicio_fkey FOREIGN KEY (servicio_id) REFERENCES servicios (id),
    CONSTRAINT ordenes_venta_lineas_item_fkey FOREIGN KEY (item_id) REFERENCES items_inventario (id),
    CONSTRAINT ordenes_venta_lineas_descuento_por_fkey FOREIGN KEY (descuento_aplicado_por)
        REFERENCES usuarios (id),
    CONSTRAINT ordenes_venta_lineas_tipo_valores CHECK (tipo IN ('servicio', 'repuesto')),
    CONSTRAINT ordenes_venta_lineas_referencia CHECK (
        (tipo = 'servicio' AND servicio_id IS NOT NULL AND item_id IS NULL)
        OR (tipo = 'repuesto' AND item_id IS NOT NULL AND servicio_id IS NULL)
    ),
    CONSTRAINT ordenes_venta_lineas_cantidad_positiva CHECK (cantidad > 0),
    CONSTRAINT ordenes_venta_lineas_precio_no_negativo CHECK (precio_unitario_centavos >= 0),
    CONSTRAINT ordenes_venta_lineas_tarifa_iva CHECK (tarifa_iva IN (0, 5, 19)),
    CONSTRAINT ordenes_venta_lineas_descuento_pct_rango
        CHECK (descuento_porcentaje BETWEEN 0 AND 100),
    CONSTRAINT ordenes_venta_lineas_descuento_centavos_no_negativo
        CHECK (descuento_centavos >= 0),
    -- Quien aplico el descuento queda registrado solo si hubo descuento.
    CONSTRAINT ordenes_venta_lineas_descuento_por_consistente
        CHECK ((descuento_porcentaje = 0) = (descuento_aplicado_por IS NULL))
);
CREATE INDEX idx_ordenes_venta_lineas_orden ON ordenes_venta_lineas (orden_id);

-- Una orden confirmada (o pagada, o anulada) es un documento cerrado: sus
-- lineas no se tocan mas. Mismo principio que recepcion_inmutable (017):
-- la garantia esta en la base, no en que el codigo se acuerde de chequear
-- el estado antes de escribir.
CREATE FUNCTION linea_venta_solo_en_borrador() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    v_orden_id UUID := coalesce(NEW.orden_id, OLD.orden_id);
    v_estado   TEXT;
BEGIN
    SELECT estado INTO v_estado FROM ordenes_venta WHERE id = v_orden_id;
    IF v_estado IS DISTINCT FROM 'borrador' THEN
        RAISE EXCEPTION 'La orden de venta ya no esta en borrador: sus lineas no se modifican'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER ordenes_venta_lineas_inmutables
    BEFORE INSERT OR UPDATE OR DELETE ON ordenes_venta_lineas
    FOR EACH ROW EXECUTE FUNCTION linea_venta_solo_en_borrador();

-- -------------------------------------------- repuestos: kardex de la venta
-- Un repuesto de una orden de venta descuenta stock (tipo 'salida') recien
-- al confirmar, y "anular devuelve el stock" es una 'devolucion' -- nunca
-- se corrige el movimiento original (mismo principio de kardex de solo
-- insercion del Sprint 25). orden_venta_id ata las dos puntas para poder
-- auditar de que orden vino cada descuento y cada devolucion.
ALTER TABLE movimientos_inventario
    ADD COLUMN orden_venta_id UUID REFERENCES ordenes_venta (id);
CREATE INDEX idx_movimientos_inventario_orden_venta ON movimientos_inventario (orden_venta_id)
    WHERE orden_venta_id IS NOT NULL;

-- ------------------------------------------------------ permisos y RLS
GRANT SELECT, INSERT, UPDATE ON ordenes_venta TO turnos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ordenes_venta_lineas TO turnos_app;

-- Solo el personal del taller arma y gestiona ordenes de venta; el cliente
-- ve (y acepta) la suya, nunca las de otro.
ALTER TABLE ordenes_venta ENABLE ROW LEVEL SECURITY;
CREATE POLICY ordenes_venta_ver ON ordenes_venta FOR SELECT
    USING (
        (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'))
        OR usuario_id = app_usuario()
    );
CREATE POLICY ordenes_venta_crear ON ordenes_venta FOR INSERT
    WITH CHECK (
        taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin')
        AND creado_por = app_usuario()
    );
CREATE POLICY ordenes_venta_modificar ON ordenes_venta FOR UPDATE
    USING (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'))
    WITH CHECK (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'));

ALTER TABLE ordenes_venta_lineas ENABLE ROW LEVEL SECURITY;
CREATE POLICY ordenes_venta_lineas_ver ON ordenes_venta_lineas FOR SELECT
    USING (
        EXISTS (SELECT 1 FROM ordenes_venta o
                 WHERE o.id = orden_id
                   AND ((o.taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'))
                        OR o.usuario_id = app_usuario()))
    );
CREATE POLICY ordenes_venta_lineas_escribir ON ordenes_venta_lineas FOR ALL
    USING (
        EXISTS (SELECT 1 FROM ordenes_venta o
                 WHERE o.id = orden_id AND o.taller_id = app_taller()
                   AND app_rol() IN ('admin', 'superadmin'))
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM ordenes_venta o
                 WHERE o.id = orden_id AND o.taller_id = app_taller()
                   AND app_rol() IN ('admin', 'superadmin'))
    );

-- Aceptar la cotizacion: SECURITY DEFINER para que el cliente pueda
-- actualizar sin permiso general de UPDATE (igual que aceptar_recepcion,
-- 017); por eso valida aca mismo que quien llama sea el titular y que la
-- orden siga elegible. Sin fila devuelta = no encontrada o no elegible; la
-- app distingue con una lectura previa.
CREATE FUNCTION aceptar_cotizacion_venta(p_orden UUID) RETURNS SETOF ordenes_venta
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN QUERY
    UPDATE ordenes_venta o
       SET cotizacion_aceptada_en = now()
     WHERE o.id = p_orden
       AND o.usuario_id = app_usuario()
       AND o.estado = 'borrador'
       AND o.cotizacion_enviada_en IS NOT NULL
       AND o.cotizacion_aceptada_en IS NULL
    RETURNING o.*;
END
$$;
REVOKE ALL ON FUNCTION aceptar_cotizacion_venta(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aceptar_cotizacion_venta(UUID) TO turnos_app;
