# Notas de UX — Sprint 5

Revisión de `AgendaTecnicoView`, `PanelAdministrativoView` y `api-client.ts`
(único flujo React que existe hoy). No hay un flujo de "reservar un turno"
todavía — varios puntos de acá aplican directamente cuando se construya.
Sin cambios de código, solo hallazgos y recomendaciones.

## Encontrados en el código actual

1. **Bug real: id de técnico inválido cuelga la vista en skeleton para
   siempre.** `useAgendaQuery` usa `enabled: Boolean(tecnicoId)`
   ([useAgendaQuery.ts:19](src/features/agenda/useAgendaQuery.ts#L19)). Con
   `enabled: false` y sin data en cache, TanStack Query v5 deja el query en
   `status: 'pending'` indefinidamente — nunca pasa a error ni a vacío. Si
   alguien llega a `/agenda/` (sin id) o con un id vacío,
   `AgendaTecnicoView` ([AgendaTecnicoView.tsx:73](src/features/agenda/AgendaTecnicoView.tsx#L73))
   muestra el skeleton para siempre, sin ningún mensaje. Fix sugerido:
   agregar una rama explícita `!tecnicoId` antes del `isPending` que muestre
   un mensaje ("Falta el id del técnico") en vez de depender de `isPending`.

2. **Sin botón de reintentar en el estado de error.** Tanto
   `AgendaTecnicoView` ([línea 79-80](src/features/agenda/AgendaTecnicoView.tsx#L79-L80))
   como cualquier vista futura solo muestran `error.message` en rojo. TanStack
   Query expone `refetch()` gratis — un botón "Reintentar" ahí es una mejora
   barata y esperable.

3. **Mensajes de error crudos del backend, sin distinguir por tipo.**
   `api-client.ts` ([líneas 24-29](src/lib/api-client.ts#L24-L29)) propaga
   `body.message` tal cual. Un 401 (token vencido/ausente — hay un solo
   token de desarrollo hardcodeado via `VITE_DEV_TOKEN`, no hay login) se ve
   igual que un 404 o un 500. Como no hay login, cualquiera probando esto va
   a confundirse con un error de "no encontrado" cuando en realidad es un
   token vencido. Vale la pena distinguir `status === 401` explícitamente
   ("tu sesión expiró") apenas exista login.

4. **Sin atajo "Hoy" en la navegación de fecha.** `AgendaTecnicoView` y
   `PanelAdministrativoView` solo tienen "Anterior"/"Siguiente"
   ([AgendaTecnicoView.tsx:50-69](src/features/agenda/AgendaTecnicoView.tsx#L50-L69)).
   Volver a la fecha de hoy requiere contar clicks. Un botón "Hoy" (deshabilitado
   cuando ya estás en hoy) es el patrón esperado en cualquier vista de agenda.

5. **`isFetching` solo atenúa opacidad, sin indicar "cargando".** El patrón
   `opacity-60` durante refetch (para evitar el parpadeo, que es correcto)
   no comunica *por qué* se ve atenuado — parece deshabilitado, no "cargando
   datos nuevos". Un spinner chico junto al badge de fecha sería más claro
   sin reintroducir el parpadeo que `keepPreviousData` ya evita.

6. **Sin navegación de vuelta a `/`.** Una vez en `/agenda/:id` o `/admin` no
   hay ningún link visible de vuelta al selector de técnico — solo el botón
   Atrás del navegador. Para una herramienta interna que se usa
   repetidamente, un header con logo/link a Home ahorra fricción real.

7. **El input de técnico en `HomeView` no valida formato.** Cualquier string
   navega a `/agenda/<lo-que-sea>`; si no es un UUID válido, el backend
   devuelve 400 (`ParseUUIDPipe`) con un mensaje tipo "uuid is expected" que
   no es amigable. Validar el formato antes de navegar (o al menos mostrar
   un mensaje más claro cuando `error.status === 400`) evita ese salto feo.

## Estado de los hallazgos 1–7 (revisado en Sprint 14)

| # | Estado al revisar | Resolución |
|---|---|---|
| 1 | Vigente: `/agenda` sin id no tenía ruta (pantalla en blanco) y el `enabled: Boolean(tecnicoId)` seguía ahí | `/agenda` existe: el admin elige técnico de una lista (por nombre, `GET /usuarios?rol=tecnico`) y el técnico va directo a la suya. `/agenda/<id inválido>` muestra un mensaje sin llamar al backend. Rutas desconocidas → página 404 propia. |
| 2 | Vigente en Agenda y Panel (Dashboard ya lo tenía) | `EstadoError` (`src/components/estados.tsx`) ofrece **Reintentar** en todas las vistas cuando el error es reintentable (red, 5xx, 409). Para 400/403/404 ofrece una acción alternativa ("Elegir otro técnico") en vez de un botón que va a fallar igual. |
| 3 | Parcial: solo 401/403, y solo si el backend no mandaba mensaje (siempre lo manda) | `src/lib/errores.ts` da título y explicación propios para sin conexión, 400, 401, 403, 404, 409 y 5xx; el mensaje del backend queda como detalle chico. Los fallos de red ahora son `ApiError` con status 0 en vez de un `TypeError: Failed to fetch`. |
| 4 | Vigente en Agenda y Panel | `NavegadorFecha`: Anterior / **Hoy** / Siguiente, con Hoy deshabilitado cuando ya se está en hoy. |
| 5 | Vigente en Agenda y Panel | `IndicadorActualizando` (spinner + "Actualizando…", `aria-live`) junto a la fecha y en el Dashboard. Reserva su lugar para que el layout no salte. |
| 6 | Resuelto en Sprint 10 (header con link a Home) | Reemplazado por la barra lateral (escritorio) / barra de pestañas inferior (celular). |
| 7 | Vigente: el input de Home navegaba con cualquier texto | El input vive ahora en `/agenda` ("Ir por id") y valida formato UUID antes de navegar; el caso normal ya no necesita UUID (lista de técnicos). |

## Para cuando exista el flujo de reserva

8. **Las sugerencias de horario del backend ya están listas para usarse.**
   Cuando `POST /appointments` devuelve 409, el body trae
   `{ message, sugerencias: [{inicio, fin}, ...] }` (Sprint 3/4) —
   `ApiError.body` en `api-client.ts` ya lo preserva completo
   ([líneas 1-11](src/lib/api-client.ts#L1-L11)), no hace falta tocar el
   cliente HTTP para usarlo. La UX correcta para el conflicto no es un
   mensaje de error genérico: es mostrar esas 3 sugerencias como botones
   clickeables ("Reservar a las 09:15 en su lugar") que reintentan el submit
   con el horario sugerido. Es la diferencia entre "fallaste, intentá de
   nuevo" y "fallaste, pero acá tenés 3 alternativas a un click".

9. **No recomiendo UI optimista clásica para el submit de la reserva.**
   El patrón típico de `useMutation` (asumir éxito, actualizar la UI antes
   de la respuesta, revertir si falla) funciona bien cuando los fallos son
   raros. Acá no lo son por diseño: HU2 existe justamente porque una
   fracción real de los submits van a chocar contra el `EXCLUDE USING gist`.
   Mejor: deshabilitar el botón + spinner inline apenas se envía, sin
   pintar la reserva como confirmada hasta tener el 201 real. Para que se
   sienta rápido sin mentir sobre el resultado, conviene precargar
   (`prefetchQuery`) los horarios disponibles de la bahía/técnico elegidos
   apenas el usuario los selecciona, así el formulario ya tiene datos
   frescos cuando llega al paso de submit.

10. **Loading state del formulario mismo:** dado que crear un turno depende
    de 3 selects encadenados (bahía → servicio → técnico, con el back
    validando existencia de cada uno), cada cambio de selección debería
    disparar su propio query con `keepPreviousData` (mismo patrón que ya
    usan `AgendaTecnicoView`/`PanelAdministrativoView`) en vez de bloquear
    todo el formulario en cada paso.

## Estado de los puntos 8–10 (Sprint 17)

La pantalla existe: `/reservar` (`src/features/reserva/`), para admin y
cliente. El técnico no la ve: el turno quedaría a su nombre como cliente.

| # | Resolución |
|---|---|
| 8 | El 409 muestra el mensaje del backend y sus sugerencias como botones "Reservar a las 09:30 en su lugar" (o "el vie 26 a las …" si caen otro día). Un click reintenta con ese horario; las alternativas siguen a la vista con spinner en la elegida hasta la respuesta. Tras el 409 la grilla se vuelve a pedir. |
| 9 | Sin UI optimista: botón deshabilitado + spinner "Reservando…", formulario bloqueado (`fieldset disabled`) y confirmación recién con el 201, armada con los datos que devolvió el servidor. Los horarios se precargan apenas bahía+servicio+técnico están elegidos, y el día siguiente queda en caché. |
| 10 | Los tres catálogos (`GET /bahias`, `/servicios`, `/technicians`) se piden en paralelo al abrir, no en cadena; la cadena es solo de habilitación. La grilla usa `keepPreviousData` y deshabilita los horarios mientras muestra datos de la combinación anterior. |

Otros detalles:
- Horarios en la zona del taller (`VITE_TZ_NEGOCIO`). Si el navegador está
  en otra zona se avisa en el subtítulo.
- `<select>` nativos en vez del Select de base-ui: en el celular abren el
  selector del sistema.
- El admin reserva siempre a nombre de un cliente (paso "1. Cliente"): uno
  existente, buscado por nombre, correo o teléfono, o uno nuevo con sus
  datos de perfil: nombre, correo, teléfono (opcional, para el recordatorio)
  y ciudad. Sin contraseña: el admin no la define ni la ve. El cliente se
  registra al confirmar, antes del turno; si el turno después da 409, el
  cliente ya creado queda elegido para el reintento en vez de volver a
  crearse.
- Ese cliente recibe por correo un enlace para definir su contraseña
  (Sprint 18, `/restablecer`); la confirmación de la reserva dice si el
  correo salió.

## Sprint 18: dashboard y vista por rol

- **Dashboard**: cada KPI se compara con el período anterior de igual
  largo, con flecha y texto ("+8 pts vs. los 7 días anteriores (85%)"),
  sin verde/rojo: el cambio se describe, no se juzga, y no depende del
  color. Tooltips con la fecha completa y el contexto del valor ("75% (3
  de 4)"). Un período sin turnos muestra un estado vacío con acción en vez
  de ejes vacíos; cada gráfico sin datos propios dice por qué. Tabla con
  caption, encabezados de fila y columna, totales en `<tfoot>` y scroll
  alcanzable por teclado. Exportación CSV con `;` y BOM (Excel en
  español). Los atajos Hoy / 7 / 30 días salen de `hoyISO()`, el día del
  taller.
- **Por rol**: admin ve el taller y puede filtrar por técnico; el técnico
  ve "Mis indicadores" (el mismo dashboard, forzado a sus turnos por el
  backend) y su inicio suma ese acceso; el cliente tiene "Mis turnos"
  (próximos e historial de 90 días) y su próximo turno en el inicio.
- **Contraseña**: "¿Olvidaste tu contraseña?" en el login y `/restablecer`
  para el enlace del correo. La respuesta de "olvidé" es la misma exista o
  no la cuenta.
