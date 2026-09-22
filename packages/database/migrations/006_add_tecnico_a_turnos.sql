-- 006_add_tecnico_a_turnos.sql
-- Agrega el tecnico asignado al turno. Nullable a nivel de DB (igual que
-- servicio_id/usuario_id en 005) para no romper si ya hay filas; lo
-- "obligatorio" lo exige CreateAppointmentDto en la capa de aplicacion.
--
-- La segunda constraint EXCLUDE evita que el mismo tecnico quede asignado a
-- dos turnos con horarios solapados, sin importar la bahia (complementa a
-- turnos_bahia_rango_excl de 001_init_turnos.sql).

ALTER TABLE turnos
    ADD COLUMN tecnico_id UUID;

ALTER TABLE turnos
    ADD CONSTRAINT turnos_tecnico_id_fkey FOREIGN KEY (tecnico_id) REFERENCES usuarios (id);

ALTER TABLE turnos
    ADD CONSTRAINT turnos_tecnico_rango_excl EXCLUDE USING gist (
        tecnico_id WITH =,
        rango_tiempo WITH &&
    );

CREATE INDEX idx_turnos_tecnico_id ON turnos (tecnico_id);
