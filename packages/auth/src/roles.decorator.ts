import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Roles del sistema. Espeja el enum `rol_usuario` de la DB
 * (002_create_usuarios.sql) y el `RolUsuario` de usuarios-service. Vive aca
 * porque el guard corre en ambos servicios y reservas-service no importa
 * entidades de usuarios-service (ver tecnicos.util.ts).
 */
export enum Rol {
  ADMIN = 'admin',
  CLIENTE = 'cliente',
  TECNICO = 'tecnico',
  /**
   * Personal de TurnoPro (Sprint 20): da de alta talleres y puede operar
   * como admin DENTRO del taller que elige (ver RolesGuard). No tiene
   * taller propio.
   */
  SUPERADMIN = 'superadmin',
}

/**
 * Restringe una ruta (o un controller entero) a ciertos roles.
 *
 * Solo tiene efecto junto a RolesGuard: el decorador nada mas deja metadata.
 * Una ruta SIN @Roles() queda abierta a cualquier usuario autenticado, que
 * es el comportamiento que tenia todo el sistema hasta Sprint 9.
 */
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES_KEY, roles);
