# turnos-platform

Engine SaaS multi-inquilino (multi-tenant) de alto rendimiento para la
gestión, agendamiento atómico de turnos y control de capacidad operativa
(bahías/personal) con prevención de double-booking y soporte para
notificaciones omnicanal.

## Estructura

| Carpeta | Contenido |
|---|---|
| [`services/`](services/) | Backends NestJS: `reservas-service`, `usuarios-service` |
| [`apps/`](apps/) | Frontends: `admin-web` |
| [`packages/`](packages/) | Compartido: `auth` (JWT + cifrado), `database` (migraciones SQL) |
| [`e2e/`](e2e/) | Suite end-to-end (Playwright) de las 4 Historias de Usuario |
| [`docs/`](docs/) | Endpoints, checklist de QA, auditoría de seguridad |

## Documentación

- [`docs/ENDPOINTS.txt`](docs/ENDPOINTS.txt) — referencia de la API
- [`docs/QA-CHECKLIST.md`](docs/QA-CHECKLIST.md) — criterios de aceptación y estado
- [`docs/AUDITORIA-ENDPOINTS.md`](docs/AUDITORIA-ENDPOINTS.md) — validación, errores y autorización

## Arranque rápido

```sh
docker compose up -d
pnpm install
pnpm --filter @turnos-platform/database migrate
pnpm build
```

```sh
pnpm test          # unitarios
pnpm lint
pnpm --filter @turnos-platform/reservas-service test:integration   # requiere Postgres
pnpm --filter @turnos-platform/e2e test:e2e                        # requiere todo levantado
```
