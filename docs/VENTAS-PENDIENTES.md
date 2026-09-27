# Sprint 26: orden de venta — pendientes fuera del código

El código está hecho: servicios del turno con el precio guardado más
repuestos que descuentan stock al confirmar, venta de mostrador sin turno,
descuentos por línea con tope y quién los aplicó, IVA por tarifa, anticipo
ya pagado descontado del total, el ciclo borrador → confirmada → pagada →
anulada (anular devuelve el stock) y la cotización por correo que el
cliente acepta antes de que se ejecute el trabajo. Lo que sigue no se
resuelve programando.

## 1. El correo de la cotización no tiene reintento ni seguimiento

`enviarCotizacion` llama directo a `EMAIL_PROVIDER` (SendGrid), sin pasar
por la cola de notificaciones del Sprint 8 (`notificaciones`, que exige
`turno_id NOT NULL` y no sirve para una venta de mostrador). Si el envío
falla, la orden queda igual marcada como cotizada (`cotizacion_enviada_en`)
y el error solo queda en el log (`No se pudo enviar la cotizacion de la
orden …`), sin reintento automático ni alerta visible en el panel.

- [ ] Decidir si vale la pena una cola propia para este tipo de correo, o si
      alcanza con que el admin reenvíe a mano si el cliente avisa que no le
      llegó (hoy no hay botón de "reenviar": llamar de nuevo a
      `POST /ventas/:id/cotizacion/enviar` funciona igual, ya que no exige
      que sea la primera vez).
- [ ] Si se agrega seguimiento, sumar una alerta como las de pagos
      (`docs/PAGOS-PENDIENTES.md`, sección de monitoreo).

## 2. "Pagada" no toca la tabla `pagos` del Sprint 24

Marcar una orden de venta como pagada (`POST /ventas/:id/pagar`) es
autónomo: no crea una fila en `pagos` ni actualiza `turnos.anticipo_estado`
para el turno relacionado. El cuadre de caja diario (**Mi taller → Pagos y
caja**) NO incluye lo cobrado por una orden de venta.

- [ ] Definir si el cuadre de caja debe sumar también las órdenes de venta
      pagadas en efectivo/datáfono del día, y cómo evitar contar dos veces
      el anticipo (que sí vino de `pagos`) más el total de la orden.
- [ ] Si se integra, es una migración sobre una tabla base del Sprint 24;
      hacerlo con cuidado y en un sprint aparte (se evaluó y se descartó
      para este sprint por el riesgo de tocar `pagos` bajo presión de
      tiempo).

## 3. El tope de descuento por línea arranca en 0%

`politica_cancelacion.descuento_maximo_porcentaje` default 0: hasta que un
admin lo suba en **Mi taller → Cancelaciones**, nadie puede aplicar
descuentos en una orden de venta (400 "El descuento maximo de este taller
es 0%."). Es intencional (nadie autoriza descuentos por accidente) pero hay
que avisarle a cada taller que lo configure si van a usar descuentos.

- [ ] Sumarlo a la lista de configuración inicial de un taller nuevo
      (onboarding / checklist de alta).

## 4. Legal (se suma a docs/legal/PENDIENTES.md)

- [ ] La cotización por correo no es una factura ni un documento con valor
      fiscal: es un presupuesto informal. Confirmar que el texto del correo
      (`textoCotizacion`, en `orden-venta.util.ts`) es suficientemente claro
      sobre eso para el cliente.
- [ ] La orden de venta tampoco genera factura electrónica al pagarla o
      confirmarla (igual que los pagos del Sprint 24): sigue siendo tarea
      del taller en su sistema de facturación (Alegra).
- [ ] Revisar si aceptar una cotización debería dejar registro como
      aceptación de condiciones comerciales (similar a `aceptaciones_legales`
      del Sprint 23) o si alcanza con `cotizacion_aceptada_en`.

## 5. Operación

- [ ] Explicar a los talleres la diferencia entre "repuestos usados en el
      turno" (Sprint 25, `RepuestosOrden`, no pasa por una orden de venta) y
      "repuestos de una orden de venta" (Sprint 26): son independientes, y
      una orden de venta NO importa lo ya registrado como uso directo del
      turno.
- [ ] Capacitar sobre que anular una orden confirmada/pagada devuelve stock
      con un movimiento nuevo ('devolución'), nunca corrige el original: el
      kardex de un ítem con ventas anuladas va a mostrar salida + devolución,
      no un movimiento neteado.
- [ ] Alertas de monitoreo sobre la línea de log:
      `No se pudo enviar la cotizacion de la orden` (ver punto 1).
