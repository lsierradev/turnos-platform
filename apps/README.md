# apps

Aplicaciones cliente de la plataforma (frontends): paneles de administración,
portal de agendamiento para clientes/tenants y cualquier interfaz de usuario
que consuma los servicios expuestos en `services/`.

## admin-web

Panel interno (React + Vite + TypeScript + Tailwind v4 + shadcn/ui +
TanStack Query + recharts).

| Ruta | Vista | Backend |
|---|---|---|
| `/` | Selector de técnico | — |
| `/agenda/:tecnicoId` | Agenda diaria del técnico | `GET /technicians/:id/agenda` |
| `/admin` | Panel administrativo v1 (carga por bahía) | ⚠️ datos mock — no existe el endpoint |
| `/dashboard` | KPIs operativos con gráficos y filtro de rango | `GET /dashboard/kpis` |

**Todavía no hay flujo de reserva ni login**: la sesión es un token de
desarrollo inyectado por `VITE_DEV_TOKEN`. Ver
[`UX-NOTES.md`](admin-web/UX-NOTES.md) para los huecos conocidos de UX y
[`docs/QA-CHECKLIST.md`](../docs/QA-CHECKLIST.md) para el estado de `/admin`
frente a los criterios de aceptación.

```sh
cp apps/admin-web/.env.example apps/admin-web/.env.local  # setear VITE_DEV_TOKEN con un accessToken real
pnpm --filter @turnos-platform/admin-web dev
```
