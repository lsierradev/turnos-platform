# services

Servicios de backend que implementan la lógica de negocio de la plataforma:
agendamiento atómico de turnos, control de capacidad operativa
(bahías/personal), prevención de double-booking, gestión multi-tenant y
notificaciones omnicanal.

## reservas-service (`:3001`)

NestJS + TypeORM. Turnos, bahías, servicios, disponibilidad, notificaciones
y KPIs.

| Módulo | Qué expone |
|---|---|
| `servicios` | CRUD del catálogo de servicios |
| `appointments` | `POST /appointments` (reserva) y `PATCH /appointments/:id/estado` (cierre) |
| `technicians` | `GET /technicians/:id/agenda` |
| `dashboard` | `GET /dashboard/kpis` |
| `notifications` | Recordatorio 24 h por cron + cola de reintentos (sin endpoint HTTP) |

La prevención de double-booking vive en la base, no en la aplicación: dos
constraints `EXCLUDE USING gist` sobre `turnos` (por bahía y por técnico).

## usuarios-service (`:3002`)

NestJS + TypeORM. Usuarios, tenants y autenticación (`POST /auth/login`,
`POST /auth/refresh`). Emite los JWT que `reservas-service` valida, así que
ambos servicios deben compartir el mismo `JWT_SECRET`.

## Levantar en local

```sh
docker compose up -d
pnpm --filter @turnos-platform/database migrate
pnpm --filter @turnos-platform/reservas-service start:dev
pnpm --filter @turnos-platform/usuarios-service start:dev
```

Ver `.env.example` de cada servicio. El detalle de cada endpoint está en
[`docs/ENDPOINTS.txt`](../docs/ENDPOINTS.txt).
