-- 005_alter_turnos_relaciones.sql
-- Agrega las relaciones de turnos hacia bahias/servicios/usuarios, que en
-- 001_init_turnos.sql todavia no existian (esas tablas no se habian creado).

ALTER TABLE turnos
    ADD COLUMN servicio_id UUID,
    ADD COLUMN usuario_id  UUID;

ALTER TABLE turnos
    ADD CONSTRAINT turnos_bahia_id_fkey FOREIGN KEY (bahia_id) REFERENCES bahias (id),
    ADD CONSTRAINT turnos_servicio_id_fkey FOREIGN KEY (servicio_id) REFERENCES servicios (id),
    ADD CONSTRAINT turnos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios (id);
