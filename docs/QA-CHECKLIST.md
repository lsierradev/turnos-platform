# Checklist de QA — Criterios de Aceptación Generales (SRS §14)

Sprint 9 · issue #38 · puerta de entrada al Beta cerrado con un CDA real.

Cada criterio dice **qué exige**, **cómo se verifica** (comando concreto),
**qué evidencia automatizada existe** y **cuál es el estado real**.

## Estado a la fecha

| # | Criterio | Estado | Bloquea el beta |
|---|---|---|---|
| CA-1 | Cero reservas duplicadas | ✅ **Cumple** | No |
| CA-2 | Tiempo de respuesta < 300 ms p95 | ⚠️ **Medible, falta medirlo** | Sí, hasta correrlo |
| CA-3 | 100 % de notificaciones con estado registrado | ✅ **Cumple, con alerta activa** | No |
| CA-4 | SLA 99.9 % | ⚠️ **Prerequisitos listos; no evaluable aún** | No, ver nota |
| CA-5 | Desfase del panel admin < 5 s | ✅ **Cumple (4 s en el peor caso)** | No |

**Nota sobre CA-4:** un SLA de 99.9 % es una medición de disponibilidad
observada en producción durante una ventana de tiempo (≈43 min de caída al
mes). No es algo que se pueda tildar en una checklist antes de tener tráfico
real: no se "aprueba", se empieza a medir. Lo que esta checklist evalúa son
los **prerequisitos**, que ya están salvo el monitoreo (issues #40 y #41).

## Preparación del entorno

```sh
docker compose up -d
pnpm install
pnpm --filter @turnos-platform/database migrate
pnpm build
```

Variables requeridas (las mismas para ambos servicios; `JWT_SECRET` **debe
coincidir**):

```sh
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/turnos_platform
export REDIS_URL=redis://localhost:6379
export JWT_SECRET=...
export JWT_REFRESH_SECRET=...
export ENCRYPTION_KEY=...   # 64 caracteres hex
```

En producción, si falta alguno de los secretos el servicio **no arranca**
(ver hallazgo #2 de la [auditoría](AUDITORIA-ENDPOINTS.md)). Es deliberado.

---

## CA-1 · Cero reservas duplicadas ✅

**Qué exige:** que dos reservas nunca ocupen el mismo recurso en horarios que
se solapan, ni siquiera bajo concurrencia.

**Cómo se verifica:**

```sh
# 1. Invariante a nivel de datos (2 requests en paralelo)
pnpm --filter @turnos-platform/reservas-service test:integration

# 2. Invariante a través de HTTP real (50 requests simultáneos)
node services/reservas-service/load-tests/seed.js > .k6-env.sh && source .k6-env.sh
k6 run -e K6_BASE_URL=http://localhost:3001 \
  services/reservas-service/load-tests/appointments-concurrencia.k6.js
node services/reservas-service/load-tests/cleanup.js

# 3. Recorrido completo de la HU (5 clientes simultáneos + sugerencias reservables)
pnpm --filter @turnos-platform/e2e test:e2e -- hu2
```

**Verificación manual:**

- [ ] Reservar un turno; otro cliente intenta el mismo horario y bahía → 409 con 3 sugerencias.
- [ ] Tomar la primera sugerencia → se reserva sin conflicto.
- [ ] Mismo técnico, **otra** bahía, mismo horario → 409 mencionando al técnico.
- [ ] Mismo cliente, otra bahía **y** otro técnico, horario solapado → 409 ("ya tenés otro turno").

**Por qué se considera cumplido:** la unicidad no depende del código de
aplicación sino de **tres** constraints `EXCLUDE USING gist` en Postgres —
por bahía (001), por técnico (006) y por cliente (010). Un chequeo "leer y
después escribir" en la aplicación se rompe bajo concurrencia; una constraint
de la base, no. El k6 con 50 VUs simultáneos tiene el threshold
`reservas_exitosas: count==1`.

**Decisión de Sprint 9:** la constraint por cliente (migración 010) se agregó
porque un mismo usuario podía reservarse dos turnos solapados en bahías
distintas. Para el taller los recursos estaban libres; para el cliente no. Si
el CDA necesitara atender dos vehículos del mismo cliente en paralelo, hay que
revertir esa constraint — es una regla de negocio, no una limitación técnica.

---

## CA-2 · Tiempo de respuesta < 300 ms p95 ⚠️

**Qué exige:** que el percentil 95 de latencia esté por debajo de 300 ms.

**Lo que se corrigió en Sprint 9.** Había dos consultas que traían el
**histórico completo** a memoria y filtraban en JavaScript:

| Dónde | Qué hacía | Efecto |
|---|---|---|
| `TechniciansService.agendaDelDia` | `find({ where: { tecnicoId } })` con joins y **después** filtraba el día en JS | Traía *todos* los turnos históricos del técnico en cada carga de la agenda |
| `AppointmentsService.buscarSugerencias` | `find({ where: filtro })` sin acotar por fecha | Traía *todos* los turnos de la bahía o el técnico — y está en el camino del 409, o sea en el peor momento |

Ambas filtran ahora por rango en SQL, usando el operador `&&` que resuelven
los índices GiST que ya existían para las constraints `EXCLUDE`: no hizo falta
ningún índice nuevo. Hay un test de regresión que falla si alguien vuelve a
sacar la condición de rango.

**Lo que falta: correr la medición.** Antes no existía ningún threshold de
latencia en el repo (el k6 que había medía corrección, no rendimiento). Ahora
sí:

```sh
node services/reservas-service/load-tests/seed.js > .k6-env.sh && source .k6-env.sh
node services/reservas-service/load-tests/seed-volumen.js        # ~1 año de turnos
k6 run -e K6_BASE_URL=http://localhost:3001 \
  services/reservas-service/load-tests/latencia-lectura.k6.js
node services/reservas-service/load-tests/cleanup.js
```

- [ ] Correr lo de arriba y confirmar que los dos thresholds pasan.

**El paso de `seed-volumen.js` no es opcional.** Contra una base recién
migrada esta medición pasa siempre y no prueba nada: las consultas que
costaban caro lo hacían por recorrer el histórico, y con 20 filas no hay
histórico que recorrer. El script siembra ~5800 turnos y corre `ANALYZE`, para
que el planner elija los planes que va a usar en producción.

Los thresholds están **por endpoint** (`latencia_agenda`, `latencia_kpis`) y
no agregados: la agenda y los KPIs tienen perfiles de costo muy distintos y un
p95 global esconde que uno de los dos se degradó.

- [ ] Pendiente aparte: `EXPLAIN ANALYZE` de la consulta de KPIs con ese
      volumen (issue #35).

---

## CA-3 · 100 % de notificaciones con estado registrado ✅

**Qué exige:** que toda notificación tenga estado persistido y auditable.

La tabla `notificaciones` registra `estado` (`pendiente|enviado|fallido`),
`intentos`, `error` y `enviado_en`. La fila se inserta **antes** de encolar el
job, así que ninguna notificación se intenta sin quedar registrada, y
`UNIQUE (turno_id, tipo, canal)` garantiza que no se mande dos veces. El
manejo de reintentos distingue correctamente un fallo intermedio de uno
definitivo (solo marca `fallido` cuando `attemptsMade >= attempts`).

**Lo que faltaba** eran los dos huecos que la tabla no puede mostrar por sí
sola, y que hasta Sprint 9 solo se detectaban corriendo consultas a mano que
nadie corría:

1. **Turnos que nunca generan fila.** El cron mira una ventana de 30 min
   alrededor de "ahora + 24 h" y corre cada 15, así que las ventanas se
   solapan y un atraso corto se recupera solo. Pero si el proceso estuvo caído
   **más de 30 minutos**, el turno atraviesa la ventana entero y no queda
   constancia: no hay fila que diga "esto no se mandó", simplemente no existe.
2. **Filas `pendiente` viejas.** Si el worker murió entre el INSERT y el
   procesamiento, o Redis perdió la cola, la fila queda en `pendiente` para
   siempre.

**Corregido** con `NotificationsSchedulerService.verificarCobertura()`, un
cron cada 30 min que busca las dos condiciones y las escribe con
`logger.error`. No las arregla: las hace **visibles**, que es lo que faltaba.
Sale a nivel error justamente para que el monitoreo pueda alertar.

**Cómo se verifica:**

```sh
pnpm --filter @turnos-platform/reservas-service test:integration  # notifications.integration-spec.ts
```

- [ ] Configurar una alerta sobre esas dos líneas de log antes de abrir el beta.
- [ ] Verificar que las credenciales de Twilio y SendGrid del sandbox estén
      cargadas (issue #32); sin ellas todo queda en `fallido` tras 3 intentos.
- [ ] Decidir qué cuenta como 100 %: un usuario sin teléfono solo recibe
      email. ¿Es una notificación cumplida o una faltante?

---

## CA-4 · SLA 99.9 % ⚠️

**Qué exige:** 99.9 % de disponibilidad ≈ máximo 43 min de caída al mes.

**Por qué no es un ítem tildable hoy:** es una métrica observada sobre
tráfico real durante una ventana de tiempo. Antes del beta no hay nada que
medir. Lo que sí se puede exigir son los prerequisitos:

- [x] **Health checks reales.** `/reservas/health/ready` comprueba Postgres y
      Redis, `/usuarios/health/ready` comprueba Postgres, y devuelven **503**
      cuando algo falla. Antes devolvían `ok` constante: un pod con la base
      caída se declaraba sano.
- [x] **Liveness separado de readiness.** El liveness no toca las
      dependencias a propósito, para que una caída de Postgres no dispare
      reinicios en cascada de pods que están sanos.
- [x] **Errores 5xx que no son caídas, fuera de la métrica.** El
      `statement_timeout` del dashboard sale como 503 y los uuid mal formados
      como 400, en vez de contar como fallas del servidor.
- [ ] **Configurar los probes en el despliegue** (issue #41): `livenessProbe`
      sobre `/health` y `readinessProbe` sobre `/health/ready`.
- [ ] **Monitoreo y alertas** que produzcan el número de disponibilidad. Sin
      esto el SLA no es verificable ni siquiera después del beta.
- [ ] **Definir el alcance del SLA:** ¿aplica a la API de reservas, al panel,
      a las notificaciones? Un CDA que no puede reservar está caído; uno que
      no ve el dashboard, no. Conviene que el compromiso con el CDA sea
      explícito sobre esto.
- [ ] **Validar el despliegue** (issue #40): réplicas, reinicio automático y
      qué pasa si Redis se cae (hoy el scheduler de notificaciones falla; la
      reserva y el dashboard siguen funcionando — el caché degrada a
      consultar la base).

---

## CA-5 · Desfase del panel admin < 5 s ✅

**Qué exige:** que lo que muestra el panel no esté más de 5 s atrasado
respecto de la realidad.

**Cómo se resolvió.** El `/dashboard` usaba `staleTime: 60_000` sin
`refetchInterval`: con la pestaña abierta no se actualizaba nunca. Cumplirlo
por polling a secas habría chocado de frente con CA-2, porque cada panel
abierto dispara una agregación sobre la tabla caliente de turnos. La solución
tiene dos mitades:

| Pieza | Valor | Dónde |
|---|---|---|
| Intervalo de polling | 2 s | `useKpisQuery.ts` |
| TTL del caché (Redis) | 2 s | `dashboard.service.ts` |

**La aritmética importa:** el desfase que ve el admin es, en el peor caso,
`TTL + intervalo` — un dato puede cambiar justo después de que se llenó el
caché, y encima el panel puede acabar de pedir. Con 2 s y 2 s el peor caso es
**4 s**, con un segundo de margen. Si se toca uno de los dos números hay que
tocar el otro; ambos lo dicen en su comentario.

El caché acota el costo a **una consulta cada 2 s sin importar cuántos paneles
haya abiertos**, que es lo que hace compatible este criterio con CA-2. Un
fallo del caché nunca rompe la lectura: si Redis no responde, se cae a la
consulta real.

**Cómo se verifica:**

```sh
pnpm --filter @turnos-platform/e2e test:e2e -- hu4
```

La spec `hu4` incluye un test que cambia los datos por fuera del navegador y
espera a que el panel lo refleje solo, sin recargar.

- [ ] Verificación manual con 5 paneles abiertos: confirmar que
      `POST /appointments` sigue dentro de CA-2.

**`/admin` queda fuera del alcance del beta.** `PanelAdministrativoView` sigue
alimentándose de datos mock porque no existe endpoint de carga por bahía; la
vista lo avisa en pantalla. No cumple el criterio y no se intentó que lo
cumpliera: la decisión de Sprint 9 fue dejarlo fuera del beta en vez de
construir un endpoint nuevo a último momento. El panel que el CDA va a usar
es `/dashboard`.

---

## Antes de abrir el beta

Bloqueantes:

- [ ] **CA-2:** correr `latencia-lectura.k6.js` con `seed-volumen.js` y
      confirmar los dos thresholds. Es lo único que queda sin verificar.
- [ ] **Suite E2E en verde en CI.** El job `e2e-tests` nunca se ejecutó
      todavía: se escribió sin un entorno con Docker disponible.
- [ ] Confirmar que el deploy define `JWT_SECRET`, `JWT_REFRESH_SECRET` y
      `ENCRYPTION_KEY`, y que el `JWT_SECRET` es el mismo en ambos servicios.
- [ ] Alerta de monitoreo sobre las dos líneas de `verificarCobertura()`.

Decisiones de producto ya tomadas en Sprint 9:

- Un cliente **no** puede tener dos turnos solapados (migración 010).
- **Sin antelación mínima** para reservar; sí se exige horario laboral.
- Matriz de roles: ver la [auditoría](AUDITORIA-ENDPOINTS.md).
- `/admin` fuera del alcance del beta.

Sigue pendiente de decisión:

- [ ] ¿Qué cuenta como notificación cumplida si el usuario no tiene teléfono? (CA-3)
- [ ] ¿Sobre qué servicios aplica el SLA? (CA-4)

Fuera del alcance de este repo: el **Sprint 7 (Pagos) no está implementado**
—4 issues abiertas y ningún código de pagos en el repositorio—, así que
cualquier criterio de aceptación relacionado con cobros no se puede evaluar.
