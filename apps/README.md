# apps

Aplicaciones cliente de la plataforma (frontends): paneles de administración, portal de agendamiento para clientes/tenants y cualquier interfaz de usuario que consuma los servicios expuestos en `services/`.

## admin-web

Panel interno (React + Vite + TypeScript + Tailwind v4 + shadcn/ui + TanStack Query). Sprint 4: agenda diaria de un técnico (`/agenda/:tecnicoId`, conectada a `GET /technicians/:id/agenda` de `reservas-service`) y panel administrativo v1 (`/admin`, carga por bahía — todavía en datos mock, ver `docs/ENDPOINTS.txt`).

```sh
cp apps/admin-web/.env.example apps/admin-web/.env.local  # setear VITE_DEV_TOKEN con un accessToken real
pnpm --filter @turnos-platform/admin-web dev
```
