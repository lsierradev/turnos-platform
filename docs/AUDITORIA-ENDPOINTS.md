# Auditoría de validación de entrada y manejo de errores

Sprint 9 · issue #37 · revisión de los endpoints HTTP del repo.

Alcance: validación de entrada, manejo de errores y autorización en
`reservas-service` y `usuarios-service`. No cubre infraestructura ni el
frontend.

## Resumen

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| 1 | Ningún endpoint valida el **rol** del usuario | Alta | **Corregido** |
| 2 | `JWT_SECRET` tenía fallback a un secreto público | Alta | **Corregido** |
| 3 | `POST /appointments` aceptaba reservas en el pasado | Media | **Corregido** |
| 4 | `:id` sin `ParseUUIDPipe` en `/servicios` → 500 en vez de 400 | Media | **Corregido** |
| 5 | `CreateServicioDto` aceptaba nombre vacío y precios fuera de rango | Media | **Corregido** |
| 6 | Los health checks no comprobaban sus dependencias | Media | **Corregido** |
| 7 | Sin filtro global de excepciones ni formato de error estándar | Baja | **Corregido** |
| 8 | El `statement_timeout` del dashboard salía como 500 | Baja | **Corregido** |

Los ocho quedaron cerrados. Lo que sigue documenta qué era cada uno y por qué
se resolvió así, porque varias de las decisiones no son evidentes leyendo
solo el código.

## Endpoints

| Endpoint | Body | Params/Query | Errores | Rol exigido |
|---|---|---|---|---|
| `GET /reservas/health` | — | — | — | público (liveness) |
| `GET /reservas/health/ready` | — | — | 503 si degradado | público (readiness) |
| `GET /usuarios/health` | — | — | — | público (liveness) |
| `GET /usuarios/health/ready` | — | — | 503 si degradado | público (readiness) |
| `POST /auth/login` | `LoginDto` ✅ | — | 401 ✅ | público |
| `POST /auth/refresh` | `RefreshTokenDto` ✅ | — | 401 ✅ | público |
| `POST /servicios` | `CreateServicioDto` ✅ | — | ✅ | `admin` |
| `GET /servicios` | — | — | ✅ | autenticado |
| `GET /servicios/:id` | — | ✅ | 404 ✅ | autenticado |
| `PATCH /servicios/:id` | `UpdateServicioDto` ✅ | ✅ | 404 ✅ | `admin` |
| `DELETE /servicios/:id` | — | ✅ | 404 ✅ | `admin` |
| `POST /appointments` | `CreateAppointmentDto` ✅ | — | 400/404/409 ✅ | autenticado |
| `PATCH /appointments/:id/estado` | `ActualizarEstadoDto` ✅ | ✅ | 400/404 ✅ | `admin`, `tecnico` |
| `GET /technicians/:id/agenda` | — | ✅ | 403/404 ✅ | `admin`, o el técnico dueño |
| `GET /dashboard/kpis` | — | `KpisQueryDto` ✅ | 400 ✅ | `admin` |

La base ya era sana antes de esta auditoría: `ValidationPipe` global con
`whitelist: true` en ambos servicios, DTOs con `class-validator` en todos los
bodies, y el conflicto de reservas traducido a 409 en vez de escaparse como
error de driver. Lo que sigue son los huecos que quedaban.

---

## 1. Ningún endpoint validaba el rol del usuario — Alta

`JwtAuthGuard` extendía `AuthGuard('jwt')` y nada más: comprobaba que el
token fuera válido, no **quién** era. El payload traía `rol` pero ningún
guard, decorador ni servicio lo leía.

Consecuencia concreta: cualquier usuario autenticado —incluido un `cliente`
cualquiera— podía crear y **borrar servicios** del catálogo, leer la **agenda
completa de cualquier técnico** pasando su id en la URL, leer el **dashboard**
(cuya HU dice explícitamente "Como Administrador") y **cerrar turnos ajenos**
como `atendido` o `no_asistio`, alterando los KPIs.

**Corregido** con `RolesGuard` + decorador `@Roles()` en
[`@turnos-platform/auth`](../packages/auth/src/roles.guard.ts), aplicados
junto a `JwtAuthGuard`. La matriz es la de la tabla de arriba.

Tres decisiones que conviene conocer:

- **Una ruta sin `@Roles()` no restringe nada.** Es deliberado: agregar el
  guard a un controller no cambia el comportamiento de sus rutas hasta que
  cada una declara qué roles acepta. Así el cambio es incremental y no deja
  usuarios afuera por omisión.
- **`GET /technicians/:id/agenda` no se resuelve solo con el rol.** Con un
  `@Roles(TECNICO)` a secas, cualquier técnico podría leer la agenda de todos
  los demás cambiando el id de la URL. El guard filtra por rol y el
  controller comprueba además la pertenencia (`user.sub === id`). La suite
  E2E cubre las dos mitades.
- **Devuelve 403, no 401.** El token es válido; lo que falta es permiso.
  Mezclarlos haría que el frontend mande a re-loguear a alguien que ya está
  logueado y que nunca va a poder entrar.

## 2. `JWT_SECRET` con fallback a un secreto público — Alta

`jwt.strategy.ts`, `jwt-auth.module.ts` y `auth.service.ts` resolvían el
secreto con `process.env.JWT_SECRET ?? 'dev-secret-change-me'`. Un deploy sin
la variable **arrancaba igual** y firmaba tokens con un secreto que está
escrito en este repositorio: cualquiera podía fabricarse un token con el rol
que quisiera. Y como todo "funcionaba", no había ninguna señal de que
estuviera pasando.

**Corregido** con [`secretoRequerido()`](../packages/auth/src/secretos.util.ts):
en `NODE_ENV=production` no arranca; fuera de producción mantiene el fallback
para no romper el desarrollo local ni los tests. Es el mismo criterio que ya
usaba `getKey()` en `encryption.util.ts` para `ENCRYPTION_KEY`.

**Pendiente de infraestructura:** verificar que el deploy realmente define
`JWT_SECRET`, `JWT_REFRESH_SECRET` y `ENCRYPTION_KEY`, y que los dos servicios
comparten el mismo `JWT_SECRET`. La suite E2E lo detecta indirectamente: si se
desalinean, el login de HU1 pasa pero la reserva devuelve 401.

## 3. `POST /appointments` aceptaba reservas en el pasado — Media

`CreateAppointmentDto.inicio` solo validaba `@IsISO8601()` y el servicio no
comparaba contra el presente: una reserva para `2019-01-01T09:00:00Z` se
aceptaba y se persistía con 201. Tampoco se validaba el horario laboral,
aunque el motor de sugerencias sí lo respeta: se podía reservar a las 03:00
por la puerta de adelante, a un horario que el sistema nunca habría ofrecido.

**Corregido** en `validarHorarioReservable()`: 400 si el inicio es anterior a
ahora, y 400 si el turno no entra completo en la ventana laboral
(08:00-18:00 UTC) — incluido el caso de un servicio que *empieza* dentro pero
*termina* fuera.

**Sin antelación mínima**, por decisión de producto de Sprint 9: se puede
reservar para dentro de cinco minutos, porque "llegué al taller y hay un hueco
libre ahora" es un caso real en un CDA. Si eso cambia, es una constante más en
esa misma función.

La ventana laboral se lee de las constantes de `sugerencias-horarios.util.ts`,
no se redefine: si los dos criterios se separan, el sistema sugeriría horarios
que después rechaza.

## 4. `:id` sin `ParseUUIDPipe` en `/servicios` — Media

`GET/PATCH/DELETE /servicios/:id` tomaban el id como `string` crudo y lo
pasaban a una consulta contra una columna `UUID`. Un id con cualquier otra
forma llegaba a Postgres, que responde `22P02 invalid input syntax for type
uuid`: el cliente recibía un **500 opaco** en vez del 400 que corresponde, y
el error quedaba contabilizado como falla del servicio, lo que además ensucia
la métrica de SLA.

**Corregido** agregando `ParseUUIDPipe`, que es lo que ya hacían
`technicians.controller.ts` y `appointments.controller.ts`.

## 5. `CreateServicioDto` demasiado permisivo — Media

- `nombre` era `@IsString()` a secas: `""` es un string válido, así que se
  podían crear servicios sin nombre, que después aparecen en blanco en la
  agenda del técnico.
- `precio` era `@IsNumber() @Min(0)` sin techo, contra una columna
  `NUMERIC(10,2)`: un valor mayor no daba error de validación sino un
  `numeric field overflow` de Postgres → 500.
- `duracionMinutos` no tenía techo: un servicio más largo que la ventana
  laboral es imposible de agendar, pero se aceptaba igual.

**Corregido** con `@IsNotEmpty()`, `@MaxLength(120)`, `@Max()` en precio y
duración, y `maxDecimalPlaces: 2`.

## 6. Los health checks no comprobaban sus dependencias — Media

`GET /reservas/health` y `GET /usuarios/health` devolvían `{ status: 'ok' }`
constante: no tocaban Postgres ni Redis. Un pod con la base caída respondía
`ok`, así que el balanceador le seguía mandando tráfico y el probe de
Kubernetes nunca lo reiniciaba. Es el peor modo de falla posible para el
criterio de SLA: el sistema está caído y el monitoreo dice que está sano.

**Corregido** separando los dos probes, sin agregar dependencias nuevas:

| Endpoint | Qué comprueba | Respuesta |
|---|---|---|
| `/reservas/health` | solo que el proceso responde | 200 |
| `/reservas/health/ready` | Postgres (`SELECT 1`) + Redis (`PING`) | 200, o **503** |
| `/usuarios/health` | solo que el proceso responde | 200 |
| `/usuarios/health/ready` | Postgres | 200 o **503** |

Tres detalles que importan:

- **El liveness NO toca las dependencias, a propósito.** Si lo hiciera, una
  caída momentánea de Postgres haría que el orquestador matara y reiniciara
  pods sanos, justo lo contrario de lo que conviene durante un incidente de
  base de datos.
- **Cada probe tiene timeout propio (2 s).** Sin él, una dependencia que
  acepta la conexión pero no responde deja al orquestador esperando
  indefinidamente, lo que es tan inútil como devolver `ok` siempre.
- **El readiness devuelve 503**, no 200 con un cuerpo que dice "degradado":
  el balanceador y el orquestador miran el código de estado, no el cuerpo.
  El cuerpo igual informa qué dependencia falló, porque durante un incidente
  hace falta saber cuál de las dos se cayó.

Sigue aplicando la issue #41 para la parte de infraestructura: configurar esos
paths como `livenessProbe` y `readinessProbe` en el despliegue.

## 7. Sin filtro global de excepciones — Baja

Ya estaba documentado como pendiente en [ENDPOINTS.txt](ENDPOINTS.txt).

**Corregido** con `HttpExceptionFilter` en el nuevo paquete
[`@turnos-platform/http`](../packages/http/src/http-exception.filter.ts),
registrado globalmente en ambos servicios. Toda respuesta de error lleva ahora
`statusCode`, `error`, `message`, `timestamp`, `path` y un **`requestId`** que
además se escribe en el log del 5xx: durante el beta, "me dio error" del lado
del CDA deja de ser imposible de cruzar con una línea concreta.

Lo que el filtro **no** hace es aplanar los cuerpos de error que ya son
estructurados. El 409 de double-booking responde `{ message, sugerencias }` y
esas sugerencias son parte del contrato de HU2 (el frontend las ofrece como
botones): se preservan tal cual y solo se les agregan los campos comunes. Lo
mismo con el array de errores del `ValidationPipe`.

Solo los 5xx se loguean con stack. Un 404 o un 409 son respuestas esperadas
del negocio, no incidentes, y llenar el log con ellas esconde los errores de
verdad.

## 8. El `statement_timeout` del dashboard salía como 500 — Baja

`DashboardService` acota su consulta con un `statement_timeout` de 5 s a
propósito, para no retener una conexión del pool que comparte con el motor de
reservas. Cuando ese timeout disparaba, Postgres cortaba con `57014` y el
error subía sin traducir: el cliente veía un 500 genérico y la métrica de 5xx
—la que alimenta el SLA— contaba como incidente algo que es una salvaguarda
funcionando bien.

**Corregido** en el mismo `HttpExceptionFilter`, que traduce los códigos de
Postgres que no son bugs:

| Código | Significado | Se responde |
|---|---|---|
| `57014` | query_canceled (statement_timeout) | 503 |
| `22P02` | uuid o número mal formado que esquivó un pipe | 400 |
| `23505` | unique_violation | 409 |
| `23503` | foreign_key_violation | 409 |

Cualquier otro error se responde como 500 sin filtrar nada del original al
cliente: solo el `requestId` con el que buscarlo en el log.
