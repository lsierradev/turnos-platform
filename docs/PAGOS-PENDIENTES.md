# Sprint 24: pagos con Wompi — pendientes fuera del código

El código está hecho: cobro del anticipo, del 100 % por strikes y del saldo;
firma de integridad en el backend; webhook con verificación de firma,
idempotente y tolerante a eventos fuera de orden; conciliación periódica;
devoluciones; reversiones y contracargos; pagos en el mostrador y cuadre de
caja. Lo que sigue no se resuelve programando.

## 1. Prueba básica en el sandbox de Wompi

Lo mínimo para ver un anticipo pagado de punta a punta, **sin dinero real**.

**Qué hace falta conseguir**

- [ ] **Una cuenta de comercio en Wompi** (se crea en comercios.wompi.co). El
      sandbox viene con la cuenta: no hace falta aprobación para probar.
- [ ] **Las cuatro credenciales del ambiente de pruebas**, en el panel de
      Wompi → Desarrolladores:
      - llave pública `pub_test_…`
      - llave privada `prv_test_…`
      - secreto de integridad `test_integrity_…`
      - secreto de eventos `test_events_…`
- [ ] **Una URL pública con HTTPS hacia reservas-service**, para que Wompi
      mande los eventos. En local, un túnel: `ngrok http 3001` o
      `cloudflared tunnel --url http://localhost:3001`. Sin esto la prueba
      igual funciona, pero el pago se confirma solo cuando el cliente vuelve
      a la pantalla de resultado o cuando corre la conciliación (hasta 10
      minutos).

**Configuración**

1. Aplicar la migración 019: `pnpm --filter @turnos-platform/database migrate`.
2. En `services/reservas-service/.env`:
   ```
   WEB_URL=http://localhost:5173
   RESERVAS_URL_PUBLICA=https://<tu-tunel>
   ENCRYPTION_KEY=<la misma de siempre>
   ```
   No poner `VALIDACION_PROVEEDORES=omitir`: así, al guardar las llaves, se
   comprueban contra el sandbox.
3. Como admin del taller: **Mi taller → Datos fiscales y pagos → Wompi**,
   ambiente *Pruebas*, pegar las cuatro credenciales y guardar.
4. Copiar la **URL de eventos** que aparece debajo y pegarla en el panel de
   Wompi → Desarrolladores → URL de eventos (ambiente de pruebas).
5. **Mi taller → Servicios**: marcar un servicio con anticipo (por ejemplo,
   50 %).
6. Opcional: **Mi taller → Condiciones**, publicar condiciones (si hay, el
   cliente las acepta antes de pagar).

**Recorrido**

1. Como cliente, reservar ese servicio. La confirmación dice "Reservado hasta
   las HH:MM" y muestra **Pagar anticipo**.
2. En el checkout de Wompi, pagar con datos de prueba:
   - Tarjeta aprobada `4242 4242 4242 4242`, cualquier fecha futura y CVC de 3
     dígitos (rechazada: `4111 1111 1111 1111`).
   - Nequi aprobado `3991111111` (rechazado: `3992222222`).
   - PSE: elegir "Banco que aprueba" (o "Banco que rechaza").
3. Al volver, la pantalla **Resultado del pago** consulta al servidor y
   muestra "Pago aprobado". En **Mis turnos**: "Anticipo pagado".
4. Cancelar el turno (dentro de la ventana) y ver en **Mi taller → Pagos y
   caja**: con tarjeta, la devolución se pide sola a Wompi; con Nequi o PSE,
   queda "pendiente (a mano)".
5. Para ver el vencimiento: reservar y no pagar. Pasado el plazo (30 minutos
   por defecto, configurable en **Cancelaciones**), el turno aparece como
   "Se liberó: el anticipo no se pagó a tiempo".

Datos de prueba tomados de la documentación de Wompi
([sandbox](https://docs.wompi.co/en/docs/colombia/datos-de-prueba-en-sandbox/)).

## 2. Confirmar con Wompi antes de producción

- [ ] **Anulación por API con tarjeta** (`POST /transactions/:id/void`): hasta
      cuándo se puede anular una transacción aprobada y si aplica a todas
      las franquicias. Si Wompi la rechaza, la devolución queda pendiente a
      mano con una alerta (el sistema ya lo resuelve así), pero conviene
      saber cuánto pasa.
- [ ] **Reembolsos de PSE, Nequi y Bancolombia**: se confirmó que no hay
      devolución por API; definir con Wompi o con el banco el procedimiento
      que sigue el taller (transferencia al cliente, solicitud en el panel de
      Wompi, plazos).
- [ ] **Contracargos y reversiones**: cómo avisa Wompi al comercio (correo,
      panel). Hoy el taller los registra a mano en la orden; si Wompi tiene
      un evento o una API para esto, se puede automatizar.
- [ ] Qué medios tiene habilitados cada comercio (los decide Wompi según el
      contrato del taller): el checkout muestra los que estén activos.
- [ ] Comisiones de Wompi: las paga el taller; decidir si se informan en las
      condiciones.

## 3. Legal (se suma a docs/legal/PENDIENTES.md)

- [ ] Que la plantilla de condiciones refleje lo que hace el sistema: el
      anticipo se devuelve completo si cancela el taller o si el cliente
      cancela dentro de la ventana; fuera de ella lo conserva el taller; un
      turno sin anticipo pago se libera al vencer el plazo.
- [ ] **Reversión del pago** (Ley 1480 de 2011, art. 51, y su
      reglamentación): plazos y procedimiento del taller cuando el banco la
      notifica.
- [ ] Derecho de retracto (ya listado en el Sprint 23): hoy no hay
      devolución automática por retracto.
- [ ] Facturación: el pago no genera factura electrónica. La expide el
      taller en su sistema (Alegra); integrarlo es de un sprint siguiente.

## 4. Operación

- [ ] Cada taller: cargar sus llaves de **producción** cuando Wompi apruebe su
      comercio, y pegar la URL de eventos del ambiente de producción.
- [ ] Explicar a los talleres el cuadre de caja diario y el registro de
      devoluciones a mano.
- [ ] Alertas de monitoreo sobre estas líneas de log:
      `Alerta de pago (` (reversiones, pagos que no cuadran) y
      `Tarea de pagos fallo`.
- [ ] La alerta al taller hoy es dentro del panel (**Mi taller → Pagos y
      caja**). Si se quiere además por correo, es un cambio chico de código.
- [ ] Revisar que el ALB deje pasar `POST /pagos/wompi/eventos/*` sin
      autenticación y que no haya un WAF bloqueando las IP de Wompi.
