-- 010_turnos_usuario_rango_excl.sql
-- Cierra el ultimo hueco del criterio "cero reservas duplicadas" (SRS 14).
--
-- Desde 001 y 006 la unicidad estaba garantizada por BAHIA y por TECNICO,
-- pero no por CLIENTE: un mismo usuario podia reservarse dos turnos
-- solapados usando bahias y tecnicos distintos. Para el taller no era un
-- double-booking (los dos recursos estaban libres), pero para el cliente si:
-- termina con dos citas que no puede cumplir a la vez, y ambas ocupan
-- capacidad que nadie mas va a usar.
--
-- Decision tomada en Sprint 9 junto con el checklist de QA: se considera
-- duplicado y se bloquea. Si el CDA necesitara atender dos vehiculos del
-- mismo cliente en paralelo, hay que revertir esta constraint -- no es una
-- limitacion tecnica sino una regla de negocio.
--
-- usuario_id es NULLABLE (ver 005): las filas con usuario_id NULL no
-- participan de la constraint, porque en un EXCLUDE los NULL nunca son
-- "iguales" entre si. Es el comportamiento que se quiere: no hay cliente
-- contra el cual chequear.
--
-- Los turnos ya existentes que se solapen harian fallar esta migracion. Es
-- a proposito: mejor que la migracion se detenga y alguien mire esos datos,
-- a agregar la constraint NOT VALID y arrastrar filas que la violan.

ALTER TABLE turnos
    ADD CONSTRAINT turnos_usuario_rango_excl EXCLUDE USING gist (
        usuario_id WITH =,
        rango_tiempo WITH &&
    );

CREATE INDEX idx_turnos_usuario_id ON turnos (usuario_id);
