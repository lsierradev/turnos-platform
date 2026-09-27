-- 020_inventario.sql
-- Inventario de repuestos (Sprint 25).
--
-- Compatible hacia atras: tablas nuevas, no toca nada existente.
--
-- El stock de un item NUNCA se guarda como un numero: es siempre la suma
-- de sus movimientos (kardex). Nada de una columna "stock actual" que se
-- pueda desincronizar del historial -- si algo no cuadra, se audita el
-- kardex y ya, no hay dos fuentes de verdad para reconciliar.
--
-- Lo que si hay que proteger en la base es que esa suma NUNCA sea
-- negativa, tambien con salidas simultaneas del mismo item (dos ventas del
-- ultimo filtro a la vez). Eso lo hace el trigger de abajo con un lock de
-- fila (SELECT ... FOR UPDATE) sobre el item: la segunda transaccion
-- espera a que la primera termine (commit o rollback) antes de sumar sus
-- propios movimientos, asi que nunca ven "hay 1 disponible" las dos a la
-- vez. Mismo principio que las EXCLUDE de turnos desde el Sprint 1: la
-- garantia esta en la base, no en que el codigo se acuerde de chequear
-- antes de escribir.

-- ------------------------------------------------------------- catalogo
CREATE TABLE items_inventario (
    id              UUID        NOT NULL DEFAULT gen_random_uuid(),
    taller_id       UUID        NOT NULL,
    -- Codigo del taller para el repuesto. Unico por taller; no se edita
    -- despues de creado (si se cargo mal, se da de baja y se crea otro:
    -- mismo criterio que bahias y servicios).
    sku             TEXT        NOT NULL,
    nombre          TEXT        NOT NULL,
    marca           TEXT,
    -- Unidad de medida: "unidad", "litro", "juego", "metro"... Texto libre
    -- y corto, no un enum: el catalogo de un taller de motos no es el de
    -- uno de camiones.
    unidad          TEXT        NOT NULL DEFAULT 'unidad',
    -- Costo de la ULTIMA compra (lo actualiza el trigger de abajo en cada
    -- entrada). Mas simple que un promedio ponderado y alcanza para la
    -- valorizacion; ver el trigger para el porque.
    costo_centavos  BIGINT      NOT NULL DEFAULT 0,
    -- Precio BASE (sin IVA), igual que servicios.precio_base_centavos: el
    -- cliente siempre ve el precio con el IVA incluido (common/precios.util).
    precio_base_centavos BIGINT NOT NULL,
    tarifa_iva      SMALLINT    NOT NULL DEFAULT 19,
    -- Bajo este nivel, el item aparece en la alerta de stock bajo.
    stock_minimo    NUMERIC(12,3) NOT NULL DEFAULT 0,
    -- Baja logica: los movimientos pasados lo siguen nombrando.
    activo          BOOLEAN     NOT NULL DEFAULT true,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT items_inventario_pkey PRIMARY KEY (id),
    CONSTRAINT items_inventario_taller_fkey FOREIGN KEY (taller_id)
        REFERENCES talleres (id) ON DELETE CASCADE,
    CONSTRAINT items_inventario_sku_key UNIQUE (taller_id, sku),
    CONSTRAINT items_inventario_sku_formato CHECK (sku ~ '^[A-Za-z0-9._-]{1,40}$'),
    CONSTRAINT items_inventario_nombre_no_vacio CHECK (length(trim(nombre)) > 0),
    CONSTRAINT items_inventario_unidad_no_vacia CHECK (length(trim(unidad)) BETWEEN 1 AND 20),
    CONSTRAINT items_inventario_costo_no_negativo CHECK (costo_centavos >= 0),
    CONSTRAINT items_inventario_precio_no_negativo CHECK (precio_base_centavos >= 0),
    CONSTRAINT items_inventario_tarifa_iva CHECK (tarifa_iva IN (0, 5, 19)),
    CONSTRAINT items_inventario_stock_minimo_no_negativo CHECK (stock_minimo >= 0)
);
CREATE INDEX idx_items_inventario_taller ON items_inventario (taller_id);

-- ------------------------------------------------------------ kardex
-- Un movimiento por fila, nunca se modifica ni se borra (igual que
-- aceptaciones_legales, Sprint 23): el historial es la prueba de como se
-- llego al stock actual, y turnos_app solo tiene SELECT e INSERT sobre
-- ella (ver permisos, abajo).
CREATE TABLE movimientos_inventario (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
    taller_id           UUID        NOT NULL,
    item_id             UUID        NOT NULL,
    tipo                TEXT        NOT NULL,
    -- Con signo: positiva suma stock, negativa lo resta. El signo lo pone
    -- la aplicacion segun el tipo (ver movimientos_inventario_signo); el
    -- cliente HTTP manda una cantidad siempre positiva y el tipo.
    cantidad            NUMERIC(12,3) NOT NULL,
    -- Solo en 'entrada': lo que costo comprarlo, por unidad.
    costo_unitario_centavos BIGINT,
    proveedor           TEXT,
    factura_proveedor   TEXT,
    -- Solo en 'salida': el turno en el que se uso el repuesto. NULL = venta
    -- directa de mostrador, sin turno.
    turno_id            UUID,
    -- Obligatorio en 'ajuste' (por que se corrigio el stock); libre en el
    -- resto (una nota, p. ej. a quien se le vendio o por que se devolvio).
    motivo              TEXT,
    creado_por          UUID,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT movimientos_inventario_pkey PRIMARY KEY (id),
    CONSTRAINT movimientos_inventario_taller_fkey FOREIGN KEY (taller_id)
        REFERENCES talleres (id) ON DELETE CASCADE,
    CONSTRAINT movimientos_inventario_item_fkey FOREIGN KEY (item_id)
        REFERENCES items_inventario (id),
    CONSTRAINT movimientos_inventario_turno_fkey FOREIGN KEY (turno_id)
        REFERENCES turnos (id),
    CONSTRAINT movimientos_inventario_creado_por_fkey FOREIGN KEY (creado_por)
        REFERENCES usuarios (id),
    CONSTRAINT movimientos_inventario_tipo_valores
        CHECK (tipo IN ('entrada', 'salida', 'ajuste', 'devolucion')),
    CONSTRAINT movimientos_inventario_cantidad_no_cero CHECK (cantidad <> 0),
    -- entrada y devolucion siempre suman; salida siempre resta; ajuste va
    -- en cualquier sentido (subir o bajar el stock), por eso no lo acota.
    CONSTRAINT movimientos_inventario_signo CHECK (
        (tipo = 'entrada' AND cantidad > 0)
        OR (tipo = 'salida' AND cantidad < 0)
        OR (tipo = 'devolucion' AND cantidad > 0)
        OR tipo = 'ajuste'
    ),
    CONSTRAINT movimientos_inventario_ajuste_con_motivo CHECK (
        tipo <> 'ajuste' OR length(trim(coalesce(motivo, ''))) >= 5
    ),
    CONSTRAINT movimientos_inventario_entrada_con_costo CHECK (
        tipo <> 'entrada' OR costo_unitario_centavos IS NOT NULL
    ),
    CONSTRAINT movimientos_inventario_costo_no_negativo CHECK (
        costo_unitario_centavos IS NULL OR costo_unitario_centavos >= 0
    ),
    CONSTRAINT movimientos_inventario_proveedor_solo_entrada CHECK (
        tipo = 'entrada' OR (proveedor IS NULL AND factura_proveedor IS NULL)
    ),
    CONSTRAINT movimientos_inventario_turno_solo_salida CHECK (
        turno_id IS NULL OR tipo = 'salida'
    )
);
CREATE INDEX idx_movimientos_inventario_item ON movimientos_inventario (item_id, creado_en);
CREATE INDEX idx_movimientos_inventario_taller ON movimientos_inventario (taller_id, creado_en DESC);
CREATE INDEX idx_movimientos_inventario_turno ON movimientos_inventario (turno_id)
    WHERE turno_id IS NOT NULL;

-- --------------------------------------------------- proteger el stock
-- AFTER INSERT: cuando corre, la fila NEW ya esta en la tabla (Postgres
-- avanza el contador de comandos despues de cada sentencia dentro de la
-- misma transaccion), asi que el SELECT sum() de aca abajo ya la incluye.
--
-- El PERFORM ... FOR UPDATE es la parte que importa: toma un lock de
-- escritura sobre la fila del item. Si dos requests intentan vender el
-- mismo ultimo filtro a la vez, el INSERT de cada una entra sin problema
-- (movimientos_inventario no tiene ninguna restriccion que lo impida), pero
-- el trigger de la segunda se queda esperando en este PERFORM hasta que la
-- primera transaccion termine. Si la primera confirma, la segunda retoma,
-- vuelve a sumar (ya ve el movimiento confirmado de la primera) y ahi si
-- se da cuenta de que no queda stock. Si la primera revierte, su
-- movimiento nunca existio para nadie mas.
CREATE FUNCTION verificar_movimiento_inventario() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    disponible NUMERIC;
BEGIN
    PERFORM 1 FROM items_inventario WHERE id = NEW.item_id FOR UPDATE;

    SELECT coalesce(sum(cantidad), 0) INTO disponible
      FROM movimientos_inventario WHERE item_id = NEW.item_id;
    IF disponible < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente: este movimiento lo dejaria en % unidades', disponible
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.tipo = 'entrada' THEN
        UPDATE items_inventario
           SET costo_centavos = NEW.costo_unitario_centavos, actualizado_en = now()
         WHERE id = NEW.item_id;
    END IF;

    RETURN NEW;
END
$$;
CREATE TRIGGER movimientos_inventario_verificar
    AFTER INSERT ON movimientos_inventario
    FOR EACH ROW EXECUTE FUNCTION verificar_movimiento_inventario();

-- ------------------------------------------------------ permisos y RLS
GRANT SELECT, INSERT, UPDATE ON items_inventario TO turnos_app;
-- Sin UPDATE ni DELETE: un movimiento no se corrige, se contrarresta con
-- otro (un ajuste, una devolucion). Es lo que hace confiable el kardex.
GRANT SELECT, INSERT ON movimientos_inventario TO turnos_app;

-- items_inventario: solo el personal del taller (el cliente no ve
-- catalogo de repuestos). Crear y modificar, solo el admin: el tecnico
-- puede vender o usar repuestos (movimientos), pero no cambia precios ni
-- da de alta codigos nuevos.
ALTER TABLE items_inventario ENABLE ROW LEVEL SECURITY;
CREATE POLICY items_inventario_ver ON items_inventario FOR SELECT
    USING (taller_id = app_taller() AND app_es_personal());
CREATE POLICY items_inventario_crear ON items_inventario FOR INSERT
    WITH CHECK (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'));
CREATE POLICY items_inventario_modificar ON items_inventario FOR UPDATE
    USING (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'))
    WITH CHECK (taller_id = app_taller() AND app_rol() IN ('admin', 'superadmin'));

-- movimientos_inventario: el admin registra cualquier tipo. El tecnico
-- unicamente salidas por uso en UN TURNO SUYO (repuestos que gasto
-- atendiendolo) -- ni compras, ni ajustes, ni ventas de mostrador sueltas.
ALTER TABLE movimientos_inventario ENABLE ROW LEVEL SECURITY;
CREATE POLICY movimientos_inventario_ver ON movimientos_inventario FOR SELECT
    USING (taller_id = app_taller() AND app_es_personal());
CREATE POLICY movimientos_inventario_crear ON movimientos_inventario FOR INSERT
    WITH CHECK (
        taller_id = app_taller() AND app_es_personal()
        AND creado_por = app_usuario()
        AND (
            app_rol() IN ('admin', 'superadmin')
            OR (tipo = 'salida' AND turno_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM turnos t
                             WHERE t.id = turno_id AND t.tecnico_id = app_usuario()))
        )
    );
