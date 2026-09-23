# Imagen de usuarios-service.
#
# El contexto de build es la RAIZ del monorepo, no esta carpeta: el servicio
# depende de @turnos-platform/auth y @turnos-platform/http, que viven en
# packages/. Desde infra/ y docker-compose eso se resuelve con
# `context: .` + `dockerfile: services/usuarios-service/Dockerfile`.

FROM node:20-alpine AS base
# corepack fija la MISMA version de pnpm que declara el package.json raiz
# ("packageManager"). Sin esto, la imagen podria resolver el lockfile con
# otra version de pnpm y traer un arbol de dependencias distinto al que se
# probo en CI.
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# deps: solo los manifiestos, para que esta capa (la cara) se reuse mientras
# no cambien las dependencias. Si se copiara todo el repo antes del install,
# cualquier cambio de codigo invalidaria la instalacion entera.
#
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
# TODOS los manifiestos del workspace, no solo los de este servicio:
# pnpm-workspace.yaml globa packages/*, services/*, apps/* y e2e, y
# --frozen-lockfile compara el lockfile contra el workspace COMPLETO. Si
# falta un manifiesto, pnpm corta con "lockfile is not up to date" aunque
# ese paquete no tenga nada que ver con esta imagen.
COPY packages/auth/package.json packages/auth/
COPY packages/http/package.json packages/http/
COPY packages/database/package.json packages/database/
COPY services/reservas-service/package.json services/reservas-service/
COPY services/usuarios-service/package.json services/usuarios-service/
COPY apps/admin-web/package.json apps/admin-web/
COPY e2e/package.json e2e/
# --filter "<pkg>..." instala este servicio y sus dependencias del workspace,
# sin arrastrar admin-web ni reservas-service.
RUN pnpm install --frozen-lockfile --filter "@turnos-platform/usuarios-service..."

FROM deps AS build
COPY packages/ packages/
COPY services/usuarios-service/ services/usuarios-service/
RUN pnpm --filter "@turnos-platform/usuarios-service..." build

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

# NODE_ENV=production hace que secretoRequerido() NO arranque si falta
# JWT_SECRET (ver packages/auth/src/secretos.util.ts). Es deliberado: un
# deploy sin secreto firmaria tokens con el valor de desarrollo, que esta
# publicado en el repositorio. Si el contenedor sale con ese error, faltan
# variables -- no es un bug de la imagen.

COPY --from=build /app /app

# Nunca root: si alguien logra ejecutar codigo dentro del contenedor, que no
# sea con permisos para escribir la imagen. `node` ya existe en node:alpine.
USER node

EXPOSE 3002

# Los probes de Kubernetes usan /usuarios/health (liveness) y
# /usuarios/health/ready (readiness). Ver infra/k8s/.
CMD ["node", "services/usuarios-service/dist/main.js"]
