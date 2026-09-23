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
| [`infra/`](infra/) | Manifiestos de Kubernetes y scripts de verificación |
| [`docs/`](docs/) | Endpoints, QA, despliegue y manuales |

## Documentación

- [`docs/ENDPOINTS.txt`](docs/ENDPOINTS.txt) — referencia de la API
- [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) — cómo llevarlo a un cluster
- [`docs/MANUAL-ADMINISTRADOR.md`](docs/MANUAL-ADMINISTRADOR.md) — guía de uso, sin tecnicismos
- [`docs/GO-LIVE.md`](docs/GO-LIVE.md) — **qué falta antes de salir a producción**
- [`docs/QA-CHECKLIST.md`](docs/QA-CHECKLIST.md) — criterios de aceptación y estado
- [`docs/AUDITORIA-ENDPOINTS.md`](docs/AUDITORIA-ENDPOINTS.md) — validación, errores y autorización

## Arranque rápido

```sh
docker compose up -d          # solo Postgres y Redis
pnpm install
pnpm --filter @turnos-platform/database migrate
pnpm build
```

Para levantar el stack entero en contenedores, con las mismas imágenes que
van a producción:

```sh
docker compose --profile full up -d --build
./infra/scripts/verificar-salud.sh
```

```sh
pnpm test          # unitarios
pnpm lint
pnpm --filter @turnos-platform/reservas-service test:integration   # requiere Postgres
pnpm --filter @turnos-platform/e2e test:e2e                        # requiere todo levantado
```
