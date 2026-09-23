# e2e

Suite end-to-end (Playwright) de las 4 Historias de Usuario del SRS.

| Spec | HU | Cómo se prueba |
|---|---|---|
| `hu1-reservar-turno.spec.ts` | Cliente reserva un turno | API (login real + `POST /appointments`) |
| `hu2-conflicto-y-sugerencias.spec.ts` | Cliente recibe alternativas ante un horario ocupado | API, incluida concurrencia |
| `hu3-agenda-tecnico.spec.ts` | Técnico ve su agenda del día | Navegador (`/agenda/:tecnicoId`) |
| `hu4-dashboard-kpis.spec.ts` | Admin ve los KPIs operativos | Navegador (`/dashboard`) |

## Por qué HU1 y HU2 no se prueban por navegador

`admin-web` no tiene un flujo de reserva: sus rutas son `/`, `/agenda/:id`,
`/admin` y `/dashboard` (ver `apps/admin-web/UX-NOTES.md`, que ya documentaba
ese hueco). No hay pantalla que manejar, así que las dos HU se ejercitan
contra la API real. Siguen siendo end-to-end: dos servicios y una Postgres de
verdad, sin mocks. **Cuando exista la pantalla de reserva, estas dos specs
deberían pasar a navegador** — la cobertura de API queda como red de
seguridad, no como reemplazo.

## Requisitos

La suite levanta los tres procesos por su cuenta (`webServer` en
`playwright.config.ts`), pero necesita Postgres y Redis corriendo y las
migraciones aplicadas:

```sh
docker compose up -d
pnpm --filter @turnos-platform/database migrate
pnpm --filter @turnos-platform/e2e exec playwright install --with-deps chromium
```

Variables de entorno (las mismas que los servicios):

```sh
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/turnos_platform
export REDIS_URL=redis://localhost:6379
export JWT_SECRET=...            # debe ser el MISMO en ambos servicios
export ENCRYPTION_KEY=...        # 64 caracteres hex
```

```sh
pnpm --filter @turnos-platform/e2e test:e2e
```

## Datos de prueba

`fixtures/datos-de-prueba.ts` siembra por SQL directo (no por API) porque
varias precondiciones no tienen endpoint: no hay CRUD de bahías, no hay
registro de usuarios y el estado de un turno no se puede dejar preparado sin
escribir la tabla.

Cada corrida crea, con un sufijo único y los borra al final:

- 2 bahías, 1 servicio
- **5 clientes**, 1 admin, 2 técnicos

Los cinco clientes no son un capricho. Desde la migración 010 un mismo
usuario tampoco puede tener dos turnos solapados, así que probar el conflicto
de *bahía* con el mismo cliente dos veces violaría dos constraints a la vez y
el mensaje del 409 dependería de cuál evalúe Postgres primero. Clientes
distintos peleando por el mismo horario es además lo que pasa en la realidad.
El segundo técnico cumple el mismo papel para aislar el conflicto de un
cliente consigo mismo.

Que cada corrida use sus propias bahías también es deliberado: las
constraints `EXCLUDE` de `turnos` son globales, así que compartirlas entre
corridas las haría fallar entre sí por un conflicto que no es el que se está
probando.

El admin existe porque desde Sprint 9 el dashboard y la agenda exigen ese rol.
Las specs verifican las dos caras: que el rol correcto entra y que un cliente
recibe 403.

`hu4` siembra en días fijos de 2018 en vez de usar el rango por defecto
porque `GET /dashboard/kpis` agrega toda la tabla del período: con datos de
"los últimos 7 días", cualquier turno ajeno movería los porcentajes
esperados.
