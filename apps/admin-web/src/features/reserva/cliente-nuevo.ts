import type { DatosClienteNuevo } from '@/lib/api-client';

export const CLIENTE_NUEVO_VACIO: DatosClienteNuevo = {
  nombre: '',
  email: '',
  telefono: '',
  ciudad: '',
};

type Errores = Partial<Record<keyof DatosClienteNuevo, string>>;

// Mismos minimos que CrearUsuarioDto de usuarios-service (email valido,
// nombre no vacio, ciudad hasta 80): validar aca evita el viaje para un 400.
export function validarClienteNuevo(d: DatosClienteNuevo): Errores {
  const errores: Errores = {};
  if (d.nombre.trim().length < 2) errores.nombre = 'Ingresa el nombre del cliente.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) {
    errores.email = 'Ingresa un correo valido.';
  }
  const digitos = (d.telefono ?? '').replace(/\D/g, '');
  if (d.telefono?.trim() && (digitos.length < 7 || digitos.length > 15)) {
    errores.telefono = 'El telefono debe tener entre 7 y 15 digitos.';
  }
  const ciudad = d.ciudad.trim();
  if (ciudad.length < 2) errores.ciudad = 'Ingresa la ciudad del cliente.';
  else if (ciudad.length > 80) errores.ciudad = 'Maximo 80 caracteres.';
  return errores;
}
