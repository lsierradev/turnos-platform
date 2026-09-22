# database

Esquema de PostgreSQL compartido por los servicios de la plataforma.

## Migraciones

Las migraciones en `migrations/` se numeran secuencialmente y se aplican en orden.
La primera (`001_init_turnos.sql`) crea la tabla `turnos` y su constraint
`EXCLUDE USING gist` sobre `(bahia_id, rango_tiempo)`, que impide a nivel de base
de datos que existan dos turnos superpuestos en la misma bahia (prevencion de
double-booking sin depender de locking aplicativo). Requiere las extensiones
`btree_gist` (para el operador de igualdad en `EXCLUDE USING gist`) y `pgcrypto`
(para `gen_random_uuid()`). Las siguientes (`002`-`005`) agregan `usuarios`,
`bahias`, `servicios` y las FKs de `turnos` hacia esas tablas.

### Aplicarlas

Con Node (recomendado — no depende de tener `psql` instalado, por ejemplo en Windows):

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/turnos_platform \
  pnpm --filter @turnos-platform/database migrate
```

Es idempotente: lleva un registro de los archivos ya aplicados en la tabla
`schema_migrations`, asi que correrlo de nuevo solo aplica lo nuevo.

Con `psql`, si lo tenes instalado:

```sh
psql "$DATABASE_URL" -f migrations/001_init_turnos.sql
# ...y asi con cada archivo, en orden.
```

### Postgres local

`docker-compose.yml` en la raiz del repo levanta una Postgres local en el
puerto 5432 (`turnos_platform` / `postgres` / `postgres`):

```sh
docker compose up -d
pnpm --filter @turnos-platform/database migrate
```

Aun sin herramienta de migraciones (node-pg-migrate / Prisma / etc.) elegida —
el script de `scripts/migrate.js` es deliberadamente minimo (SQL crudo, sin
rollback automatico de migraciones ya aplicadas) hasta que el equipo decida
si hace falta algo mas sofisticado.
