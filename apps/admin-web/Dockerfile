# Imagen de admin-web: build con vite, servido por nginx como estaticos.
#
# Contexto de build: la RAIZ del monorepo.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
# Todos los manifiestos: --frozen-lockfile compara contra el workspace
# completo (ver el Dockerfile de reservas-service).
COPY packages/auth/package.json packages/auth/
COPY packages/http/package.json packages/http/
COPY packages/database/package.json packages/database/
COPY services/reservas-service/package.json services/reservas-service/
COPY services/usuarios-service/package.json services/usuarios-service/
COPY apps/admin-web/package.json apps/admin-web/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter "@turnos-platform/admin-web..."

FROM deps AS build
COPY apps/admin-web/ apps/admin-web/

# ATENCION - esto se hornea en el bundle, no se lee en runtime.
#
# Vite resuelve import.meta.env.VITE_* en tiempo de BUILD y escribe el valor
# literal en el JavaScript que baja el navegador. Consecuencias:
#
#   1. Hace falta UNA IMAGEN POR ENTORNO: la de staging no sirve para
#      produccion si cambia la URL de la API.
#   2. Nada que se pase por aca es secreto. Cualquiera que abra las
#      devtools lo ve.
#
# Por eso VITE_DEV_TOKEN NO se acepta como build-arg: es un JWT y hornearlo
# en un bundle publico seria repartir ese token a cualquiera que abra la
# pagina. Ver docs/GO-LIVE.md -- admin-web todavia no tiene login, y eso es
# un bloqueante de Go-Live, no algo que la imagen pueda resolver.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN test -n "$VITE_API_URL" || (echo "ERROR: falta --build-arg VITE_API_URL" && exit 1)

RUN pnpm --filter @turnos-platform/admin-web build

# nginx-unprivileged y no la imagen oficial de nginx: la oficial arranca su
# proceso maestro como root y necesita escribir en /var/cache/nginx y
# /var/run, asi que no funciona con runAsNonRoot en Kubernetes. Esta variante
# ya viene preparada para correr como uid 101 y escuchar en 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY apps/admin-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin-web/dist /usr/share/nginx/html

EXPOSE 8080
