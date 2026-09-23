# apps

Aplicaciones cliente de la plataforma (frontends): paneles de administración,
portal de agendamiento para clientes/tenants y cualquier interfaz de usuario
que consuma los servicios expuestos en `services/`.

## admin-web

Panel interno (React + Vite + TypeScript + Tailwind v4 + shadcn/ui +
TanStack Query + recharts).

| Ruta | Vista | Backend |
|---|---|---|
| `/login` | Inicio de sesión | `POST /auth/login` |
| `/` | Inicio, con las opciones que permita tu rol | — |
| `/agenda/:tecnicoId` | Agenda diaria del técnico | `GET /technicians/:id/agenda` |
| `/admin` | Panel administrativo v1 (carga por bahía) | ⚠️ datos mock — no existe el endpoint |
| `/dashboard` | KPIs operativos con gráficos y filtro de rango | `GET /dashboard/kpis` |

Desde Sprint 10 tiene **login propio** contra `usuarios-service`, con guardas
de ruta, renovación automática del token y cierre de sesión. **Todavía no hay
flujo de reserva**: reservar es una llamada a la API, no una pantalla. Ver
[`UX-NOTES.md`](admin-web/UX-NOTES.md) para los huecos conocidos de UX y
[`docs/QA-CHECKLIST.md`](../docs/QA-CHECKLIST.md) para el estado de `/admin`
frente a los criterios de aceptación.

```sh
cp apps/admin-web/.env.example apps/admin-web/.env.local  # setear VITE_DEV_TOKEN con un accessToken real
pnpm --filter @turnos-platform/admin-web dev
```
