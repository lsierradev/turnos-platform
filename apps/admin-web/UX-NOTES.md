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
