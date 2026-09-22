# load-tests

Test de carga de HU2/RF-02 (Sprint 3): 50 `POST /appointments` concurrentes
sobre la misma bahía + técnico + horario, verificando que **exactamente uno**
se confirme (201) y el resto reciba conflicto (409). No corre en CI todavía
(necesita k6 instalado además de una Postgres real) — es una herramienta para
correr manualmente antes de un release o cuando se toque el motor de
reservas.

## Requisitos

- [k6](https://k6.io/docs/get-started/installation/) instalado.
- `reservas-service` corriendo contra una Postgres real con las migraciones
  aplicadas (ver `packages/database/README.md` — `docker compose up -d` +
  `pnpm --filter @turnos-platform/database migrate`).
- `JWT_SECRET` del proceso de `reservas-service` conocido (default
  `dev-secret-change-me` si no se seteó nada distinto).

## Uso

```sh
# 1. Sembrar bahia/servicio/tecnico/usuario y obtener un token valido
DATABASE_URL=postgres://postgres:postgres@localhost:5432/turnos_platform \
  node load-tests/seed.js > .k6-env.sh
source .k6-env.sh

# 2. Correr el test de carga
k6 run -e K6_BASE_URL=http://localhost:3001 load-tests/appointments-concurrencia.k6.js

# 3. Limpiar los datos sembrados
DATABASE_URL=postgres://postgres:postgres@localhost:5432/turnos_platform \
  node load-tests/cleanup.js
```

k6 termina con exit code distinto de cero si el threshold `reservas_exitosas:
count==1` no se cumple — o sea, si dos o más reservas lograron confirmarse
sobre el mismo horario, o si ninguna lo hizo.

`.k6-env.sh` y `.k6-seed.json` quedan gitignorados (contienen un token y son
específicos de una corrida local).
