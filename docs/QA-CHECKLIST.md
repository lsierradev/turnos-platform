# Checklist de QA — Criterios de Aceptación Generales (SRS §14)

Sprint 9 · issue #38 · puerta de entrada al Beta cerrado con un CDA real.

Cada criterio dice **qué exige**, **cómo se verifica** (comando concreto),
**qué evidencia automatizada existe hoy** y **cuál es el estado real**.

## Estado a la fecha

| # | Criterio | Estado | Bloquea el beta |
|---|---|---|---|
| CA-1 | Cero reservas duplicadas | ✅ **Cumple** | No |
| CA-2 | Tiempo de respuesta < 300 ms p95 | ❌ **Sin medir, y hay dos consultas que no escalan** | Sí |
| CA-3 | 100 % de notificaciones con estado registrado | ⚠️ **Parcial** | No, con vigilancia |
| CA-4 | SLA 99.9 % | ⛔ **No evaluable todavía** (ver nota) | Sí, los prerequisitos |
| CA-5 | Desfase del panel admin < 5 s | ❌ **No cumple** | Sí |

**Nota sobre CA-4:** un SLA de 99.9 % es una medición de disponibilidad
observada en producción durante una ventana de tiempo (≈43 min de caída al
mes). No es algo que se pueda tildar en una checklist antes de tener tráfico
real: no se "aprueba", se empieza a medir. Lo que esta checklist sí evalúa
son los **prerequisitos** sin los cuales el número nunca va a ser confiable.

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

# 3. Recorrido completo de la HU (5 simultáneos + sugerencias reservables)
pnpm --filter @turnos-platform/e2e test:e2e -- hu2
```

**Verificación manual:**

- [ ] Reservar un turno; intentar el mismo horario y bahía → 409 con 3 sugerencias.
- [ ] Tomar la primera sugerencia → se reserva sin conflicto.
- [ ] Mismo técnico, **otra** bahía, mismo horario → 409 mencionando al técnico.
- [ ] Confirmar en la base: `SELECT count(*) FROM turnos WHERE bahia_id = ... AND rango_tiempo && tstzrange(...)` → 1.

**Por qué se considera cumplido:** la unicidad no depende del código de
aplicación sino de dos constraints `EXCLUDE USING gist` en Postgres
(`turnos_bahia_rango_excl` y `turnos_tecnico_rango_excl`). Un chequeo
"leer y después escribir" en la aplicación se rompe bajo concurrencia; una
constraint de la base, no. El k6 con 50 VUs simultáneos tiene el threshold
`reservas_exitosas: count==1`.

**Salvedad conocida — decidir antes del beta:** la unicidad es por **bahía** y
por **técnico**, no por **cliente**. No existe constraint sobre `usuario_id`,
así que un mismo cliente puede reservarse dos turnos solapados en bahías
distintas con técnicos distintos. Si el CDA considera que eso es una "reserva
duplicada", falta una tercera constraint `EXCLUDE (usuario_id WITH =,
rango_tiempo WITH &&)`.

---

## CA-2 · Tiempo de respuesta < 300 ms p95 ❌

**Qué exige:** que el percentil 95 de latencia esté por debajo de 300 ms.

**Estado: no se mide en ninguna parte, y hay dos consultas que no escalan.**

El k6 que existe es un test de **corrección**, no de rendimiento: 50 VUs con
una iteración cada uno y thresholds sobre contadores de negocio. No hay
ningún threshold `http_req_duration` en el repo, ni un escenario de carga
sostenida que produzca un p95 con sentido estadístico.

Peor: hay dos consultas que traen el **histórico completo** a memoria y
filtran en JavaScript. Con datos de demo no se nota; con un técnico que lleva
un año de turnos, sí.

| Dónde | Qué hace | Efecto |
|---|---|---|
| [`TechniciansService.agendaDelDia`](../services/reservas-service/src/modules/technicians/technicians.service.ts) | `find({ where: { tecnicoId } })` con `relations: ['bahia','servicio']` y **después** filtra el día en JS | Trae *todos* los turnos históricos del técnico, con sus joins, en cada carga de la agenda |
| [`AppointmentsService.buscarSugerencias`](../services/reservas-service/src/modules/appointments/appointments.service.ts) | `find({ where: filtro })` sin acotar por fecha | Trae *todos* los turnos históricos de la bahía o el técnico — y está en el camino del 409, o sea en el peor momento |

Ambas tienen arreglo directo: filtrar por rango en SQL (igual que hace
`DashboardService`) y apoyarse en `idx_turnos_kpi_inicio`, que ya existe.

**Cómo se verificará una vez corregido:**

- [ ] Agregar un escenario de carga sostenida con
      `thresholds: { http_req_duration: ['p(95)<300'] }`.
- [ ] Medir **por endpoint**, no agregado: `POST /appointments`,
      `GET /technicians/:id/agenda` y `GET /dashboard/kpis` tienen perfiles
      muy distintos y un promedio los esconde.
- [ ] Medir con volumen realista, no con la base vacía: sembrar al menos un
      año de turnos antes de medir. Con 20 filas, las dos consultas de arriba
      pasan holgadas y el test no detecta nada.
- [ ] `EXPLAIN ANALYZE` de la consulta de KPIs con ese volumen (issue #35).

---

## CA-3 · 100 % de notificaciones con estado registrado ⚠️

**Qué exige:** que toda notificación tenga estado persistido y auditable.

**Lo que sí está resuelto:** la tabla `notificaciones` registra
`estado` (`pendiente|enviado|fallido`), `intentos`, `error` y `enviado_en`. La
fila se inserta **antes** de encolar el job, así que ninguna notificación se
intenta sin quedar registrada, y `UNIQUE (turno_id, tipo, canal)` garantiza
que no se mande dos veces. El manejo de reintentos distingue correctamente un
fallo intermedio de uno definitivo (solo marca `fallido` cuando
`attemptsMade >= attempts`).

**Cómo se verifica:**

```sh
pnpm --filter @turnos-platform/reservas-service test:integration  # notifications.integration-spec.ts
```

```sql
-- No debería devolver filas: pendientes viejas = jobs perdidos
SELECT id, turno_id, canal, intentos, creado_en
FROM notificaciones
WHERE estado = 'pendiente' AND creado_en < now() - interval '1 hour';

-- Tampoco: turnos inminentes sin ninguna notificación registrada
SELECT t.id, lower(t.rango_tiempo) AS inicio
FROM turnos t
LEFT JOIN notificaciones n ON n.turno_id = t.id
WHERE lower(t.rango_tiempo) BETWEEN now() AND now() + interval '24 hours'
  AND t.estado = 'programado'
  AND n.id IS NULL;
```

**Los dos huecos:**

1. **Turnos que nunca generan fila.** El cron corre cada 15 min sobre una
   ventana de 30 min alrededor de "ahora + 24 h". Las ventanas se solapan a
   propósito, así que un atraso corto se recupera solo — pero si el proceso
   está caído **más de 30 minutos**, el turno atraviesa la ventana entero y
   no se registra nada. No hay fila que diga "esta notificación no se mandó":
   simplemente no existe. La segunda consulta de arriba es la que lo detecta;
   hoy nadie la corre automáticamente.
2. **`pendiente` sin reconciliación.** Si el worker muere entre el INSERT y
   el procesamiento, o Redis pierde la cola, la fila queda en `pendiente`
   para siempre. No hay proceso que las recupere.

**Para el beta:**

- [ ] Correr las dos consultas a diario y revisar que den cero.
- [ ] Definir qué cuenta como 100 %: un usuario sin teléfono solo recibe
      email. ¿Es una notificación cumplida o una faltante?
- [ ] Verificar que las credenciales de Twilio y SendGrid del sandbox estén
      cargadas (issue #32); sin ellas todo queda en `fallido` tras 3 intentos.

---

## CA-4 · SLA 99.9 % ⛔

**Qué exige:** 99.9 % de disponibilidad ≈ máximo 43 min de caída al mes.

**Por qué no es un ítem tildable hoy:** es una métrica observada sobre
tráfico real durante una ventana de tiempo. Antes del beta no hay nada que
medir. Lo que sí se puede exigir ahora son los prerequisitos, y **ninguno
está**:

- [ ] **Health checks reales.** Hoy `/reservas/health` y `/usuarios/health`
      devuelven `{status:'ok'}` constante sin tocar Postgres ni Redis
      (hallazgo #6 de la [auditoría](AUDITORIA-ENDPOINTS.md)). Un pod con la
      base caída se declara sano: el balanceador le sigue mandando tráfico y
      Kubernetes nunca lo reinicia. Es el peor modo de falla posible para un
      SLA — el sistema está caído y el monitoreo dice que está bien.
      *(issue #41)*
- [ ] **Separar liveness de readiness.** Hoy hay un solo endpoint.
- [ ] **Monitoreo y alertas** que produzcan el número de disponibilidad.
      Sin esto el SLA no es verificable ni siquiera después del beta.
- [ ] **Definir el alcance del SLA:** ¿aplica a la API de reservas, al panel,
      a las notificaciones? Un CDA que no puede reservar está caído; uno que
      no ve el dashboard, no. Conviene que el compromiso con el CDA sea
      explícito sobre esto.
- [ ] **Validar el despliegue** (issue #40) — réplicas, reinicio automático y
      qué pasa si Redis se cae (hoy el scheduler de notificaciones falla, la
      reserva no).

**Errores 5xx que no son caídas:** los hallazgos #4 y #8 de la auditoría
generaban 500 por entradas inválidas o por un timeout deliberado. Cuentan
como error del servidor y ensucian la métrica. #4 ya está corregido; #8 sigue
abierto.

---

## CA-5 · Desfase del panel admin < 5 s ❌

**Qué exige:** que lo que muestra el panel no esté más de 5 s atrasado
respecto de la realidad.

**Estado: no cumple, por dos motivos distintos.**

1. **`/admin` muestra datos mock.** `PanelAdministrativoView` sigue
   alimentándose de `fetchCargaDiariaMock()`: no existe endpoint de carga por
   bahía. El desfase no es de 5 s, es infinito — la vista nunca refleja la
   realidad. La propia vista lo avisa en pantalla, pero como criterio de
   aceptación, no cumple.
2. **`/dashboard` no se refresca solo.** `useKpisQuery` usa
   `staleTime: 60_000` y no define `refetchInterval`: mientras la pestaña
   está abierta, los datos **no se actualizan nunca** salvo que el usuario
   cambie el filtro o recargue. Lo mismo aplica a `useAgendaQuery`
   (`staleTime: 30_000`).

**Tensión de diseño a resolver antes de implementar:** cumplir < 5 s por
polling significa que cada panel abierto dispara una agregación sobre la
tabla caliente de turnos cada 5 segundos. Eso choca de frente con CA-2 y con
la restricción explícita de RF-04 de no impactar el motor de reservas. Con
N paneles abiertos, son N×12 agregaciones por minuto. Opciones, de menor a
mayor costo:

| Opción | Cumple < 5 s | Costo sobre el motor de reservas |
|---|---|---|
| `refetchInterval: 5000` | Sí | Alto y lineal en la cantidad de paneles abiertos |
| Polling + cache de 5 s en el backend (Redis) | Sí | Bajo: una consulta cada 5 s sin importar cuántos paneles haya |
| SSE / WebSocket con push al cerrar un turno | Sí, y con menos latencia | Bajo, pero es trabajo nuevo |

Recomendación: **polling + cache de 5 s en el backend**. Cumple el criterio,
acota el costo a una consulta cada 5 s, y reutiliza la vista tal como está.

**Verificación una vez implementado:**

- [ ] Abrir `/dashboard`, cerrar un turno con
      `PATCH /appointments/:id/estado`, cronometrar hasta que el KPI cambie
      → < 5 s.
- [ ] Repetir con 5 paneles abiertos y confirmar que `POST /appointments`
      sigue dentro de CA-2.
- [ ] Conectar `/admin` a un endpoint real o retirarlo del alcance del beta.

---

## Antes de abrir el beta

Bloqueantes:

- [ ] **CA-2:** corregir las dos consultas que traen el histórico completo y
      medir p95 con volumen realista.
- [ ] **CA-5:** decidir la estrategia de refresco e implementarla; resolver
      qué pasa con `/admin` y sus datos mock.
- [ ] **CA-4:** health checks que comprueben dependencias (issue #41).
- [ ] **Autorización por rol** (hallazgo #1 de la auditoría): hoy cualquier
      usuario autenticado puede borrar servicios del catálogo y cerrar turnos
      ajenos. Con usuarios reales de un CDA esto deja de ser teórico.
- [ ] Confirmar que el deploy define `JWT_SECRET`, `JWT_REFRESH_SECRET` y
      `ENCRYPTION_KEY`, y que el `JWT_SECRET` es el mismo en ambos servicios.

Decisiones de producto pendientes:

- [ ] ¿Un cliente puede tener dos turnos solapados? (CA-1, salvedad)
- [ ] ¿Cuál es la antelación mínima para reservar? (hallazgo #3)
- [ ] ¿Qué cuenta como notificación cumplida si el usuario no tiene teléfono? (CA-3)
- [ ] ¿Sobre qué servicios aplica el SLA? (CA-4)

Fuera del alcance de este repo: el **Sprint 7 (Pagos) no está implementado**
—4 issues abiertas y ningún código de pagos en el repositorio—, así que
cualquier criterio de aceptación relacionado con cobros no se puede evaluar.
