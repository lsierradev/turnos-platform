-- 011_excl_ignoran_cancelados.sql
-- Un turno CANCELADO deja de ocupar su horario.
--
-- Hasta aca las tres constraints EXCLUDE de turnos (bahia 001/007, tecnico
-- 006/007, cliente 010) comparaban TODAS las filas, cancelados incluidos:
-- si un cliente cancelaba, nadie mas podia reservar esa bahia, ese tecnico
-- ni ese cliente en ese horario (409 para siempre). El panel de carga
-- (Sprint 16) ya mostraba ese horario libre, asi que la inconsistencia se
-- hacia visible. Se recrean las tres como EXCLUDE PARCIALES: solo compiten
-- las filas con estado <> 'cancelado'.
--
-- Consecuencias:
-- - Un turno cancelado se puede reactivar (PATCH estado -> programado)
--   solo si su horario sigue libre. Si otro turno lo tomo, el UPDATE viola
--   la constraint (23P01) y la API responde 409 (AppointmentsService.
--   actualizarEstado).
-- - Los indices GiST de las constraints ahora son parciales: el planner los
--   usa solo en consultas que incluyan "estado <> 'cancelado'" (como la
--   busqueda de sugerencias). Las que muestran cancelados (agenda, detalle
--   de bahia) se apoyan en los btree idx_turnos_tecnico_id /
--   idx_turnos_bahia_id / idx_turnos_usuario_id, filtrando por recurso:
--   pocas filas por recurso y por dia.
--
-- Relajar una constraint no puede dejar filas invalidas: todo lo que hoy
-- cumple la version total cumple la parcial. Corre en la transaccion del
-- runner: si algo falla no queda ninguna de las tres a medio recrear.

ALTER TABLE turnos DROP CONSTRAINT turnos_bahia_rango_excl;
ALTER TABLE turnos
    ADD CONSTRAINT turnos_bahia_rango_excl EXCLUDE USING gist (
        bahia_id WITH =,
        rango_tiempo WITH &&
    ) WHERE (estado <> 'cancelado');

ALTER TABLE turnos DROP CONSTRAINT turnos_tecnico_rango_excl;
ALTER TABLE turnos
    ADD CONSTRAINT turnos_tecnico_rango_excl EXCLUDE USING gist (
        tecnico_id WITH =,
        rango_tiempo WITH &&
    ) WHERE (estado <> 'cancelado');

ALTER TABLE turnos DROP CONSTRAINT turnos_usuario_rango_excl;
ALTER TABLE turnos
    ADD CONSTRAINT turnos_usuario_rango_excl EXCLUDE USING gist (
        usuario_id WITH =,
        rango_tiempo WITH &&
    ) WHERE (estado <> 'cancelado');
