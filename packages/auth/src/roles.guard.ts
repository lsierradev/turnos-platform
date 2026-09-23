import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload } from './jwt-payload.interface';
import { Rol, ROLES_KEY } from './roles.decorator';

/**
 * Autorizacion por rol. Va SIEMPRE despues de JwtAuthGuard en el mismo
 * @UseGuards(...): depende de que la autenticacion ya haya puesto el payload
 * del token en request.user.
 *
 * Hasta Sprint 9 no existia nada asi: JwtAuthGuard solo verificaba que el
 * token fuera valido, nunca quien era. Cualquier usuario autenticado podia
 * borrar servicios del catalogo o cerrar turnos ajenos (lo que ademas
 * alteraba los KPIs). Ver el hallazgo 1 de docs/AUDITORIA-ENDPOINTS.md.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rolesRequeridos = this.reflector.getAllAndOverride<Rol[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Sin @Roles() la ruta no restringe por rol. Es deliberado: hace que
    // agregar el guard a un controller no cambie el comportamiento de sus
    // rutas hasta que cada una declare que roles acepta.
    if (!rolesRequeridos || rolesRequeridos.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const rol = request.user?.rol;

    if (!rol || !rolesRequeridos.includes(rol as Rol)) {
      // 403 y no 401: el token es valido, lo que falta es permiso. Mezclar
      // los dos haria que el frontend mande a re-loguear a alguien que ya
      // esta logueado y nunca va a poder entrar.
      throw new ForbiddenException(
        'No tenes permiso para esta operacion con tu rol actual.',
      );
    }

    return true;
  }
}
