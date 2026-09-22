# database

Esquema de PostgreSQL compartido por los servicios de la plataforma.

## Migraciones

Las migraciones en `migrations/` se numeran secuencialmente y se aplican en orden.
La primera (`001_init_turnos.sql`) crea la tabla `turnos` y su constraint
`EXCLUDE USING gist` sobre `(bahia_id, rango_tiempo)`, que impide a nivel de base
de datos que existan dos turnos superpuestos en la misma bahia (prevencion de
double-booking sin depender de locking aplicativo). Requiere las extensiones
`btree_gist` (para el operador de igualdad en `EXCLUDE USING gist`) y `pgcrypto`
(para `gen_random_uuid()`).

Aplicar manualmente contra una base local:

```sh
psql "$DATABASE_URL" -f migrations/001_init_turnos.sql
```

Aun sin herramienta de migraciones (node-pg-migrate / Prisma / etc.) elegida —
pendiente de definir en Sprint 1.
