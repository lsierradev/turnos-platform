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

## Sprint 19: auditoría de accesibilidad y calidad visual

Auditoría automatizada con Edge sobre las 19 pantallas por rol (admin,
técnico, cliente, públicas), en 1366 px claro y 390 px oscuro: axe
(WCAG 2.0/2.1/2.2 A y AA + buenas prácticas), recorrido completo con Tab,
contraste del indicador de foco, foco tapado por elementos fijos y
movimiento con `prefers-reduced-motion`.

| # | Hallazgo | Estado |
|---|---|---|
| 1 | Indicador de foco `ring-ring/50`: 1,9:1 en claro y 2,4:1 en oscuro (WCAG 1.4.11 pide 3:1) | Arreglado: contorno sólido de 2px en `--ring` por `:focus-visible` (index.css, fuera de `@layer`). `verificar-contraste.mjs` controla ring sobre card, fondo y barra lateral. |
| 2 | En celular, "Ver turnos" del panel quedaba debajo de la barra de pestañas al recibir foco (WCAG 2.4.11) | Arreglado: `scroll-padding-top/bottom` en `html` del alto del header y de la barra. |
| 3 | `prefers-reduced-motion` no se respetaba: todas las transiciones y la animación de los gráficos seguían | Arreglado: regla global que las anula (salvo los spinners, que comunican estado) e `isAnimationActive` de Recharts atado a la preferencia (`lib/movimiento.ts`). |
| 4 | Login, "olvidé" y "definir contraseña" sin `<main>` ni `<h1>`; agenda y 404 sin `<h1>` | Arreglado: `CardTitle as="h1"` y `<main>` en las públicas; `<h1>` (sr-only) en la 404. |
| 5 | Mismo título de pestaña en todas las pantallas (WCAG 2.4.2) | Arreglado: `useTituloPagina` / `tituloDeRuta` ("Panel del taller · TurnosPro"). |
| 6 | Al navegar, el foco quedaba en el link del menú y el lector no anunciaba la pantalla nueva | Arreglado: foco al `<h1>` de la pantalla nueva (espera la carga diferida) y scroll arriba. No pisa un `autoFocus` de la pantalla. |
| 7 | Bundle: un único JS de 992 kB (304 kB gzip), con Recharts en la carga inicial | Arreglado: carga diferida por pantalla y `vendor` aparte. Inicial ≈ 131 kB gzip (−57%); el dashboard baja Recharts (120 kB gzip) al abrirse. |
| 8 | Microinteracciones con 150ms y curva por defecto | 180ms con salida suave (`--default-transition-duration`), entrada de 180ms al cambiar de pantalla y tarjetas de acceso que suben 2px al pasar el mouse (solo con movimiento permitido). |
| 9 | `shadcn` (CLI) en dependencias de producción | Movido a devDependencies. |
| — | Recorrido con Tab | Sin problemas: todo lo interactivo es alcanzable y en orden; el patrón combobox (opciones con flechas) es correcto. |
| — | Fuentes: se generan todos los subsets (cirílico, griego, vietnamita) | Sin cambio: el navegador baja solo los que usa la página (`unicode-range`); solo ocupan lugar en `dist/`. |

**Regresión visual**: `e2e/visual/` (Edge, sin backend: API simulada y
reloj fijo en el jueves 24/09/2026 14:30 del taller). 20 pantallas × 4
(escritorio/celular × claro/oscuro) = 80 capturas (la 20 es la de talleres,
Sprint 20). Tolerancia: 50 píxeles distintos por captura (`maxDiffPixels`);
la anterior, 0,2 % del área, dejaba pasar un texto nuevo en el encabezado.
`pnpm --filter @turnos-platform/e2e test:visual` compara y
`test:visual:actualizar` regenera tras un cambio intencional. No corre en
CI: las referencias son de Windows y el renderizado de fuentes cambia en
Linux.

## Sprint 20: multi-taller

- **En qué taller estoy.** El encabezado muestra siempre el nombre del
  taller activo. El admin y el técnico no pueden cambiarlo (es el de su
  cuenta). El superadmin de TurnoPro lo elige en un `<select>` del
  encabezado ("Taller en el que operas").
- **Cambiar de taller descarta todo lo cargado.** Se invalidan todas las
  consultas menos la lista de talleres. En la reserva, el formulario se
  remonta (`key={tallerId}`): una bahía o un técnico elegidos en un taller no
  pueden quedar seleccionados en otro.
- **Cliente con varios talleres.** Si hay un solo taller activo, se elige
  solo. Con más de uno, la reserva arranca con un selector "Taller", y sin
  elegir muestra un estado vacío en lugar de catálogos mezclados. "Mis
  turnos" junta los de todos los talleres y cada turno dice de cuál es.
- **Talleres (`/talleres`, solo superadmin).** La pantalla lista, da de alta
  con el admin del taller (le llega el correo para elegir contraseña), da de
  baja o reactiva, y tiene "Operar acá". Dar de baja no borra nada y se
  revierte con "Reactivar". Mientras está de baja, el personal de ese
  taller no puede iniciar sesión.
- **Regresión visual.** La vista de superadmin suma la pantalla de talleres.
  Las capturas existentes cambiaron solo por el nombre del taller en el
  encabezado.
