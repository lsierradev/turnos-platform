-- 012_usuarios_ciudad.sql
-- Ciudad del usuario (Sprint 17). La pide el formulario de reserva cuando un
-- admin da de alta a un cliente nuevo.
--
-- Nullable: los usuarios que ya existen no la tienen, y un admin o un
-- tecnico tampoco la necesita. Texto libre y sin cifrar: a diferencia del
-- telefono no identifica a nadie por si sola.
ALTER TABLE usuarios ADD COLUMN ciudad TEXT;
