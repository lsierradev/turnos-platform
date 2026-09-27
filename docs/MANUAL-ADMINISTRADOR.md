# Manual del administrador

Guía de uso de turnos-platform para quien administra el taller.
No hace falta saber de programación para leer esto.

---

## Qué hace la plataforma

turnos-platform organiza los turnos del taller. Se encarga de tres cosas:

1. **Reservar turnos** sin que dos clientes queden en la misma bahía a la
   misma hora, ni un técnico con dos autos al mismo tiempo.
2. **Avisarle al cliente** 24 horas antes de su turno, por correo y por
   WhatsApp.
3. **Mostrarle al administrador** cómo viene el día: cuánta gente asiste y
   cuánto está tardando cada servicio.

## Cómo entrar

Al abrir el panel aparece la pantalla de inicio de sesión. Se entra con el
correo y la contraseña que te dio el equipo técnico.

Cosas que conviene saber:

- **La sesión se cierra al cerrar la pestaña.** Es a propósito: el panel se
  usa en computadoras compartidas del taller, y así el próximo que se siente
  no entra como vos.
- Mientras lo tengas abierto, el panel **renueva la sesión solo**.
- El botón **Salir**, arriba a la derecha, la cierra en el momento.
- Lo que ves depende de tu rol: si no aparece una opción, no es que falte
  algo, es que tu usuario no la tiene.

## Quién puede hacer qué

Hay tres tipos de usuario. Cada persona tiene uno solo.

| Rol | Puede |
|---|---|
| **Administrador** | Todo: ver los indicadores, administrar el catálogo de servicios, ver la agenda de cualquier técnico y cerrar turnos |
| **Técnico** | Ver **su propia** agenda del día y cerrar los turnos que atendió |
| **Cliente** | Reservar un turno |

Un técnico no puede ver la agenda de otro técnico, y un cliente no puede ver
los indicadores del taller. Esto está controlado por el sistema, no por
acuerdo: si alguien intenta, le aparece un aviso de que no tiene permiso.

---

## El tablero de indicadores

Se entra desde la página principal, en **Dashboard de indicadores**.
Arriba se elige el rango de fechas, con botones rápidos para **Hoy**,
**7 días** y **30 días**.

El tablero se actualiza solo cada pocos segundos. No hace falta recargar la
página.

### Los tres números grandes

**Tasa de asistencia** — De los turnos que ya se cerraron, qué porcentaje
vino efectivamente.

> **Importante para no leerlo mal:** las **cancelaciones no cuentan como
> inasistencia**. Si un cliente avisa que no viene, no le baja el número al
> taller: hizo lo correcto. Tampoco entran los turnos que todavía no se
> cerraron. Por eso el número no es "asistentes sobre turnos agendados" sino
> "asistentes sobre turnos que efectivamente se cerraron".

**Tiempo promedio de servicio** — Cuánto tardó en promedio atender un
vehículo, contando desde que se empezó hasta que se terminó.

> Este número **solo toma los turnos donde alguien registró la hora de inicio
> y de fin**. Debajo dice sobre cuántos turnos se calculó. Si ahí aparece,
> por ejemplo, "sobre 3 turnos medidos" y ese día se atendieron 20, el
> promedio no es representativo: significa que casi nadie está registrando
> los horarios reales.

**Turnos en el período** — El total, con el desglose de cuántos siguen sin
cerrar y cuántos se cancelaron.

### Cuando aparece un guion (—)

Un guion **no** quiere decir cero. Quiere decir que todavía no hay datos para
calcular ese número. Por ejemplo, un día donde aún no se cerró ningún turno
muestra guion, no 0 %. Son cosas distintas: 0 % significaría que no vino
nadie.

### Los gráficos

Debajo hay tres gráficos con la evolución día por día. Pasando el mouse por
encima se ve el detalle de cada día.

Si preferís ver los números en vez de los gráficos, el botón **Ver tabla**
muestra lo mismo como planilla.

---

## La agenda del técnico

Muestra los turnos de un técnico en un día, ordenados por hora, con la bahía
y el servicio de cada uno. Los botones **Anterior** y **Siguiente** cambian
de día.

---

## Cerrar un turno: por qué importa

Cuando termina un turno, hay que registrarlo como:

- **Atendido** — el cliente vino y se le hizo el servicio
- **No asistió** — el cliente no vino y no avisó (suma un strike; ver
  "Cancelaciones y strikes")
- **Cancelado** — el turno no se hace. Desde el Sprint 22 el cliente
  cancela solo desde "Mis turnos"; el taller cancela desde la orden de
  trabajo, indicando si lo pidió el cliente o lo decidió el taller

**Si esto no se hace, el tablero queda vacío.** Los indicadores se calculan
exactamente con esta información: un turno que nunca se cierra no cuenta ni
como asistencia ni como inasistencia, simplemente no aparece.

Al marcar un turno como atendido se pueden registrar además **la hora real
en que empezó y terminó** la atención. Es opcional, pero es lo único que
alimenta el indicador de tiempo promedio. Sin esas horas, el turno cuenta
para la asistencia pero no para el tiempo.

---

## Recibir el vehículo y la orden de trabajo

Cada turno tiene su **orden de trabajo**: se abre tocando el turno en la
agenda del técnico o el enlace **Orden** en el panel de la bahía.

1. **Recepción.** Cuando llega el vehículo se registra: el vehículo del
   cliente (si no lo tenía cargado se agrega ahí mismo), el kilometraje, el
   nivel de combustible, el estado en que llega, los objetos que deja
   adentro, observaciones y la fecha probable de entrega. Las fotos son
   opcionales (hasta 6). Al guardarla, la orden recibe su número.
2. **Aceptación.** La recepción es la constancia de entrega para reparación
   (Ley 1480 de 2011). La acepta el cliente: en el mostrador (se registran
   nombre y documento de quien entrega el vehículo) o desde su propia
   cuenta. Al aceptarla le llega por correo. **Una vez aceptada no se puede
   modificar**: revisen bien los datos antes.
3. **Atención.** El técnico marca **Iniciar atención** y **Finalizar
   atención** (así se miden los tiempos reales del tablero) y deja sus
   notas del trabajo.
4. **Cierre.** El técnico cierra sus turnos como **Atendido** o **No
   asistió**. Corregir un cierre, o cancelar, lo hace el administrador.
5. **Garantía.** Cada servicio tiene su término de garantía en días (Mi
   taller → Servicios). Al cerrar como atendido queda impreso en la orden
   hasta qué día cubre. Si el servicio no tiene término cargado, la orden
   indica que rige la garantía legal.

El botón **Imprimir** de la orden saca una versión limpia, sin menús.

---

## Cancelaciones y strikes

La política se configura en **Mi taller → Cancelaciones**:

- El cliente cancela o reprograma **sin costo hasta N horas antes** del
  turno (4 por defecto). Se cuenta con la hora del taller.
- Cancelar o reprogramar después de ese plazo, o **no presentarse**, le
  suma un **strike** en este taller. Los strikes vencen solos (12 meses por
  defecto).
- Con **3 strikes vigentes**, el cliente solo puede reservar en este taller
  pagando el **100% por adelantado**. El sistema lo marca en el turno; el
  cobro en línea llega en una próxima versión.
- **Si el taller cancela o no puede atender, nunca se le suma un strike al
  cliente.** Al cancelar desde la orden se elige: "El taller no puede
  atender" (nunca suma) o "El cliente pidió cancelar" (aplica la política).
- El cliente ve sus strikes en **Mi perfil** y puede reclamar. Los reclamos
  aparecen en Mi taller → Cancelaciones: se aceptan (el strike se anula) o
  se rechazan, siempre con una respuesta que el cliente lee. También se
  puede anular un strike sin reclamo, con justificación.
- Corregir un "No asistió" (por ejemplo, a Atendido) anula solo el strike
  que había sumado.

---

## Documentos legales y datos personales

**Al entrar por primera vez**, y cada vez que TurnoPro publique una versión
nueva, la plataforma muestra "Antes de continuar" con los documentos que
faltan aceptar. Como administrador, aceptás los **Términos y
Condiciones de TurnoPro en nombre del taller** (con que lo haga un
administrador alcanza para todo el taller), la **Política de Tratamiento de
Datos** y la **Autorización**. Queda registrado quién aceptó, qué versión,
cuándo y desde qué dirección.

> Los textos son borradores pendientes de revisión legal. Revisalos con tu
> abogado.

### Condiciones del servicio con tus clientes

En **Mi taller → Condiciones** se escriben las condiciones que tus clientes
aceptan al reservar: precios con IVA, anticipo, ventana de cancelación,
strikes, garantía y retracto.

- La primera vez aparece la **plantilla de TurnoPro**, ya completada con tus
  datos fiscales y tu política de cancelación.
- Lo marcado entre **⟦ ⟧** hay que completarlo o quitarlo: mientras quede
  algo marcado, no se puede publicar. Razón social, NIT y dirección salen de
  **Datos fiscales y pagos**; si faltan ahí, cargalos y volvé a la
  plantilla.
- **Publicar** crea una versión nueva. Las anteriores no se borran: se ven
  en "Versiones publicadas", con cuántos clientes aceptaron cada una.
- Desde que publicás, **cada cliente tiene que aceptar la versión vigente en
  su próxima reserva**. Si reservás vos por él, marcá la casilla "El
  cliente leyó y aceptó en el mostrador".
- Mientras no publiques nada, tus clientes reservan sin aceptar condiciones.

Las condiciones son del taller: el taller responde por lo que dicen.

### Dar de alta a un cliente

Al crear un cliente desde **Reservar → Cliente nuevo** hay que marcar que **el
cliente autorizó el tratamiento de sus datos**. Sin esa casilla la cuenta no
se crea. Queda como constancia a tu nombre; el cliente vuelve a leer y
aceptar la política cuando entra por primera vez.

### Mis datos

Tocando tu correo, arriba a la derecha, cualquier usuario entra a **Mis
datos**: corregir nombre, teléfono y ciudad, descargar todos sus datos,
ver qué documentos aceptó y, si es cliente, suprimir su cuenta. Al suprimir,
el taller sigue viendo los turnos (con sus precios) y las órdenes de
trabajo, pero a nombre de "Titular suprimido".

---

## Pagos

Los pagos en línea se cobran con **la cuenta de Wompi del taller**: el dinero
va directo a esa cuenta. Se configuran en **Mi taller → Datos fiscales y
pagos**; debajo aparece la **URL de eventos**, que hay que pegar en el panel
de Wompi para que cada pago se confirme al instante.

- **Anticipo.** Si el servicio pide anticipo (o el cliente tiene 3 strikes:
  100 %), el turno queda **reservado a la espera del pago**. Si el cliente no
  paga en el plazo (30 minutos por defecto, se cambia en **Cancelaciones**),
  el horario se libera solo. Si el taller no tiene Wompi configurado, el
  anticipo no vence: se cobra en el mostrador.
- **Saldo.** El cliente lo paga en línea desde Mis turnos o desde la orden,
  o lo cobrás en el mostrador.
- **En el mostrador.** En la orden de trabajo, **Pagos → Cobrar en el
  mostrador**: efectivo, datáfono o transferencia (estos dos piden el número
  del comprobante).
- **Devoluciones.** Si el taller cancela, o el cliente cancela a tiempo, el
  anticipo se devuelve completo. Con tarjeta, se devuelve solo. PSE, Nequi,
  Bancolombia y lo cobrado en el mostrador hay que devolverlo a mano y
  registrarlo en **Mi taller → Pagos y caja → Devoluciones pendientes**.
- **Reversiones y contracargos.** Cuando el banco o Wompi te avise, registralo
  en la orden (**Reversión o contracargo**) y después marcá cómo terminó.
- **Alertas.** En **Mi taller → Pagos y caja** aparece lo que hay que mirar:
  devoluciones a mano, pagos que llegaron tarde o de más, reversiones.
- **Cuadre de caja.** En la misma sección, cada día: lo cobrado por medio, el
  efectivo que debería haber, y el cierre con lo que contaste.

TurnoPro nunca ve ni guarda datos de tarjetas: el cliente paga en la página
de Wompi.

---

## Inventario de repuestos

En **Mi taller → Inventario** llevás el catálogo de repuestos con su precio
(con IVA incluido, igual que los servicios), su stock y un mínimo por
debajo del cual aparece una alerta.

- **Repuesto nuevo.** Código, nombre, marca, unidad de medida y precio. El
  código no se puede cambiar después: si lo cargaste mal, dalo de baja y
  creá otro.
- **Movimientos.** Desde cada repuesto: **Entrada** (una compra: costo,
  proveedor y número de factura — el costo del repuesto pasa a ser el de
  esta última compra), **Salida** (una venta de mostrador), **Ajuste** (con
  un motivo obligatorio: se rompió uno, se contó mal, etc.) o **Devolución**
  (el cliente lo trajo de vuelta).
- **Repuestos usados en una orden.** Se cargan desde la propia orden de
  trabajo, no desde Inventario: el técnico agrega ahí lo que gastó
  atendiendo ESE turno, y descuenta del stock al instante.
- **Stock nunca negativo.** Aunque dos personas vendan el mismo repuesto al
  mismo tiempo, el sistema no deja que el stock quede en negativo: la
  segunda venta se rechaza con "stock insuficiente".
- **Kardex.** El historial completo de un repuesto, con el saldo después de
  cada movimiento — la prueba de cómo se llegó al stock actual.
- **Valorización y CSV.** El valor total del inventario (stock × costo de
  cada repuesto) y un botón para exportarlo todo a una planilla.

---

## Los recordatorios automáticos

El sistema le avisa solo al cliente **24 horas antes** de su turno:

- Siempre por **correo electrónico**
- Además por **WhatsApp**, si el cliente tiene teléfono cargado

No hay que hacer nada para que salgan. Si un envío falla, el sistema
reintenta tres veces antes de darlo por perdido, y queda registrado qué pasó
con cada aviso.

Los teléfonos de los clientes se guardan **cifrados**: ni siquiera alguien
con acceso directo a la base de datos puede leerlos.

---

## Qué hacer si algo no funciona

**Si aparece un mensaje de error en pantalla**, anotá o sacá una foto del
mensaje completo. Trae un código tipo `requestId: a1b2c3...`. Ese código le
permite al equipo técnico encontrar exactamente qué pasó, sin tener que
adivinar. Sin ese código el diagnóstico es mucho más lento.

**Si el horario que querés reservar está ocupado**, el sistema no se limita a
rechazarlo: devuelve **las tres alternativas libres más cercanas** para ese
mismo técnico o esa misma bahía.

**Si no te deja reservar**, puede ser por alguno de estos motivos:

- El horario es anterior a este momento (no se puede reservar hacia atrás)
- Está fuera del horario de atención (8:00 a 18:00)
- Ese cliente ya tiene otro turno a esa misma hora
- La bahía o el técnico ya están ocupados

---

## Límites de esta versión

Estas cosas todavía **no** están y conviene saberlo antes de empezar:

- **No hay pantalla para que el cliente reserve.** Hoy la reserva se hace
  desde el sistema, no desde una página web para el público.
- **No hay cobros.** La plataforma no procesa pagos de ningún tipo.
- **El "Panel administrativo v1"** (la vista de carga por bahía) muestra
  **datos de ejemplo**, no datos reales. La propia pantalla lo avisa. El
  tablero que sí tiene información real es el **Dashboard de indicadores**.
- **No hay autogestión de usuarios.** Crear una cuenta, cambiar la
  contraseña o recuperarla tiene que hacerlo el equipo técnico: todavía no
  hay pantallas para eso.

---

## Preguntas frecuentes

**¿Por qué la tasa de asistencia no coincide con mi cuenta a mano?**
Casi siempre es por las cancelaciones: el sistema no las cuenta como
inasistencia. Revisá el desglose debajo del número grande.

**¿Por qué el tiempo promedio parece bajo o raro?**
Fijate el texto "sobre N turnos medidos". Si N es mucho menor que los turnos
atendidos, el promedio se calculó sobre pocos casos porque no se están
registrando las horas reales.

**¿Puedo ver más de tres meses de historia?**
No. El rango máximo es de 92 días, para que la consulta no afecte la
velocidad del sistema de reservas mientras alguien mira el tablero.

**¿El tablero muestra información al instante?**
Casi. El desfase máximo es de unos 4 segundos.

**¿Un mismo cliente puede tener dos turnos a la misma hora?**
No. Aunque sean bahías y técnicos distintos, el sistema lo bloquea: una
persona no puede estar en dos lugares a la vez. Si el taller necesita atender
dos vehículos del mismo cliente en paralelo, avisale al equipo técnico —es
una regla que se puede cambiar.
