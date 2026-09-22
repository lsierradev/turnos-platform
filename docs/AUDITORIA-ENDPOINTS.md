# Auditoría de validación de entrada y manejo de errores

Sprint 9 · issue #37 · revisión de los 11 endpoints HTTP del repo.

Alcance: validación de entrada, manejo de errores y autorización en
`reservas-service` y `usuarios-service`. No cubre infraestructura ni el
frontend.

## Resumen

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| 1 | Ningún endpoint valida el **rol** del usuario | Alta | Abierto |
| 2 | `JWT_SECRET` tenía fallback a un secreto público | Alta | **Corregido** |
| 3 | `POST /appointments` acepta reservas en el pasado | Media | Abierto |
| 4 | `:id` sin `ParseUUIDPipe` en `/servicios` → 500 en vez de 400 | Media | **Corregido** |
| 5 | `CreateServicioDto` aceptaba nombre vacío y precios fuera de rango | Media | **Corregido** |
| 6 | Los health checks no comprueban sus dependencias | Media | Abierto |
| 7 | Sin filtro global de excepciones ni formato de error estándar | Baja | Abierto |
| 8 | El `statement_timeout` del dashboard sale como 500 | Baja | Abierto |

## Endpoints revisados

| Endpoint | Body | Params/Query | Errores | Authz |
|---|---|---|---|---|
| `GET /reservas/health` | — | — | — | público (ver #6) |
| `GET /usuarios/health` | — | — | — | público (ver #6) |
| `POST /auth/login` | `LoginDto` ✅ | — | 401 ✅ | público (correcto) |
| `POST /auth/refresh` | `RefreshTokenDto` ✅ | — | 401 ✅ | público (correcto) |
| `POST /servicios` | `CreateServicioDto` ✅ | — | ✅ | ⚠️ #1 |
| `GET /servicios` | — | — | ✅ | ⚠️ #1 |
| `GET /servicios/:id` | — | ✅ (corregido #4) | 404 ✅ | ⚠️ #1 |
| `PATCH /servicios/:id` | `UpdateServicioDto` ✅ | ✅ (corregido #4) | 404 ✅ | ⚠️ #1 |
| `DELETE /servicios/:id` | — | ✅ (corregido #4) | 404 ✅ | ⚠️ #1 |
| `POST /appointments` | `CreateAppointmentDto` ⚠️ #3 | — | 404/409 ✅ | ⚠️ #1 |
| `PATCH /appointments/:id/estado` | `ActualizarEstadoDto` ✅ | ✅ | 400/404 ✅ | ⚠️ #1 |
| `GET /technicians/:id/agenda` | — | ✅ | 404 ✅ | ⚠️ #1 |
| `GET /dashboard/kpis` | — | `KpisQueryDto` ✅ | 400 ✅ | ⚠️ #1 |

La base está sana: `ValidationPipe` global con `whitelist: true` en ambos
servicios, DTOs con `class-validator` en todos los bodies, y el conflicto de
reservas traducido a 409 en vez de escaparse como error de driver. Lo que
sigue son los huecos.

---

## 1. Ningún endpoint valida el rol del usuario — Alta, abierto

`JwtAuthGuard` extiende `AuthGuard('jwt')` y nada más
([jwt-auth.guard.ts](../packages/auth/src/jwt-auth.guard.ts)): comprueba que
el token sea válido, no **quién** es. El payload trae `rol`
([jwt-payload.interface.ts](../packages/auth/src/jwt-payload.interface.ts))
pero ningún guard, decorador ni servicio lo lee.

Consecuencia concreta: cualquier usuario autenticado —incluido un `cliente`
recién registrado— puede hoy:

- crear, modificar y **borrar servicios** del catálogo (`/servicios`);
- leer la **agenda completa de cualquier técnico**, por id
  (`GET /technicians/:id/agenda`): nombre del cliente no, pero sí la carga de
  trabajo, bahías y servicios de todo el taller;
- leer el **dashboard de KPIs**, cuya HU dice explícitamente "Como
  Administrador";
- cerrar turnos ajenos como `atendido` o `no_asistio`
  (`PATCH /appointments/:id/estado`), lo que además **altera los KPIs**.

No es un problema de validación de entrada sino de autorización, pero apareció
al revisar endpoint por endpoint y es el riesgo más grande de cara a un beta
con un CDA real y usuarios que no son del equipo.

No se corrigió en este sprint porque define política de producto: hay que
decidir qué rol puede qué. Propuesta mínima para discutir:

| Endpoint | Rol |
|---|---|
| `POST/PATCH/DELETE /servicios` | `admin` |
| `GET /dashboard/kpis` | `admin` |
| `PATCH /appointments/:id/estado` | `admin`, `tecnico` |
| `GET /technicians/:id/agenda` | `admin`, o el `tecnico` dueño de esa agenda |
| `POST /appointments` | cualquier autenticado (correcto hoy) |

Implementación sugerida: un `RolesGuard` + decorador `@Roles()` en
`@turnos-platform/auth`, aplicado junto a `JwtAuthGuard`.

## 2. `JWT_SECRET` con fallback a un secreto público — Alta, **corregido**

`jwt.strategy.ts`, `jwt-auth.module.ts` y `auth.service.ts` resolvían el
secreto con `process.env.JWT_SECRET ?? 'dev-secret-change-me'`. Un deploy sin
la variable **arrancaba igual** y firmaba tokens con un secreto que está
escrito en este repositorio: cualquiera podía fabricarse un token con el rol
que quisiera. Y como todo "funcionaba", no había ninguna señal de que
estuviera pasando.

Corregido con `secretoRequerido()`
([secretos.util.ts](../packages/auth/src/secretos.util.ts)): en
`NODE_ENV=production` no arranca; fuera de producción mantiene el fallback
para no romper el desarrollo local ni los tests. Es el mismo criterio que ya
usaba `getKey()` en `encryption.util.ts` para `ENCRYPTION_KEY`.

**Pendiente de infraestructura:** verificar que el deploy realmente define
`JWT_SECRET`, `JWT_REFRESH_SECRET` y `ENCRYPTION_KEY`, y que
`reservas-service` y `usuarios-service` comparten el mismo `JWT_SECRET`. La
suite E2E lo detecta indirectamente: si se desalinean, el login de HU1 pasa
pero la reserva devuelve 401.

## 3. `POST /appointments` acepta reservas en el pasado — Media, abierto

`CreateAppointmentDto.inicio` solo valida `@IsISO8601()`, y
`AppointmentsService.create()` no compara contra el presente: una reserva
para `2019-01-01T09:00:00Z` se acepta y se persiste con 201.

Tampoco se valida que el turno caiga dentro del horario laboral (08:00-18:00
UTC), aunque el motor de sugerencias sí respeta esa ventana: se puede reservar
a las 03:00 por la puerta de adelante, pero el sistema nunca sugeriría ese
horario.

No se corrigió porque el arreglo necesita una decisión de producto: ¿cuál es
la antelación mínima? ¿Se puede reservar para dentro de 5 minutos? ¿El horario
laboral es global o por bahía? Una vez definido, son dos validaciones en el
DTO/servicio.

## 4. `:id` sin `ParseUUIDPipe` en `/servicios` — Media, **corregido**

`GET/PATCH/DELETE /servicios/:id` tomaban el id como `string` crudo y lo
pasaban a una consulta contra una columna `UUID`. Un id con cualquier otra
forma llegaba a Postgres, que responde `22P02 invalid input syntax for type
uuid`: el cliente recibía un **500 opaco** en vez del 400 que corresponde, y
el error quedaba contabilizado como falla del servicio (lo que también ensucia
la métrica de SLA).

Corregido agregando `ParseUUIDPipe`, que es lo que ya hacían
`technicians.controller.ts` y `appointments.controller.ts`.

## 5. `CreateServicioDto` demasiado permisivo — Media, **corregido**

- `nombre` era `@IsString()` a secas: `""` es un string válido, así que se
  podían crear servicios sin nombre, que después aparecen en blanco en la
  agenda del técnico.
- `precio` era `@IsNumber() @Min(0)` sin techo, contra una columna
  `NUMERIC(10,2)`: un valor mayor no daba error de validación sino un
  `numeric field overflow` de Postgres → 500.
- `duracionMinutos` no tenía techo: un servicio más largo que la ventana
  laboral es imposible de agendar, pero se aceptaba igual.

Corregido con `@IsNotEmpty()`, `@MaxLength(120)`, `@Max()` en precio y
duración, y `maxDecimalPlaces: 2`.

## 6. Los health checks no comprueban sus dependencias — Media, abierto

`GET /reservas/health` y `GET /usuarios/health` devuelven
`{ status: 'ok' }` constante ([reservas.service.ts](../services/reservas-service/src/modules/reservas/reservas.service.ts)):
no tocan Postgres ni Redis.

Un pod con la base caída responde `ok`, así que el balanceador le sigue
mandando tráfico y el probe de Kubernetes nunca lo reinicia. Es el peor modo
de falla posible para el criterio de SLA: el sistema está caído y el
monitoreo dice que está sano.

Tiene issue propia (#41, Sprint 10). Sugerencia: `@nestjs/terminus` con un
check de Postgres y otro de Redis, y separar `/health/live` (el proceso
responde) de `/health/ready` (además sus dependencias responden).

## 7. Sin filtro global de excepciones — Baja, abierto

Ya estaba documentado como pendiente en
[ENDPOINTS.txt](ENDPOINTS.txt) ("Formato de error estandar — pendiente de
definir"). Hoy los errores son los de Nest por defecto, que no filtran
información sensible pero tampoco traen un id de correlación ni un formato
uniforme, lo que complica el triage durante el beta.

## 8. El `statement_timeout` del dashboard sale como 500 — Baja, abierto

`DashboardService` acota su consulta con un `statement_timeout` de 5s
a propósito (para no retener una conexión del pool que comparte con el motor
de reservas). Cuando ese timeout dispara, Postgres corta con `57014` y el
error sube sin traducir: el cliente ve un 500 genérico.

Semánticamente es un 503/504 —el servicio está degradado, la petición no es
inválida— y conviene distinguirlo para que no contamine la métrica de errores
5xx reales.
