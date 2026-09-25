import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { JwtPayload, Rol } from '@turnos-platform/auth';
import { from, lastValueFrom, Observable } from 'rxjs';
import { ContextoDb, esUuid } from './contexto-db';

export const ENCABEZADO_TALLER = 'x-taller';

/**
 * De que taller es el request.
 *
 * - admin y tecnico: el de su token. El encabezado se ignora: nadie del
 *   personal puede "mirar" otro taller cambiando un header.
 * - cliente y superadmin: el que eligen con `X-Taller`. Sin el, no hay
 *   taller (el cliente igual ve sus propios turnos: "Mis turnos").
 */
export function tallerDelRequest(
  user: JwtPayload,
  encabezado: string | string[] | undefined,
): string | null {
  if (user.rol === Rol.ADMIN || user.rol === Rol.TECNICO) return user.taller ?? null;
  const valor = Array.isArray(encabezado) ? encabezado[0] : encabezado;
  if (valor === undefined || valor === '') return null;
  if (!esUuid(valor)) throw new BadRequestException('X-Taller no es un id valido.');
  return valor;
}

/**
 * Global: todo request autenticado corre dentro de ContextoDb.ejecutarComo
 * (una transaccion con RLS). Los que no tienen usuario (health, login)
 * pasan de largo en modo sistema.
 */
@Injectable()
export class ContextoInterceptor implements NestInterceptor {
  constructor(private readonly db: ContextoDb) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context
      .switchToHttp()
      .getRequest<{ user?: JwtPayload; headers: Record<string, string | string[] | undefined> }>();
    const user = req.user;
    if (!user?.sub) return next.handle();

    const tallerId = tallerDelRequest(user, req.headers[ENCABEZADO_TALLER]);
    // lastValueFrom se suscribe DENTRO de ejecutarComo: el handler corre con
    // el contexto de AsyncLocalStorage ya cargado.
    return from(
      this.db.ejecutarComo({ usuarioId: user.sub, rol: user.rol, tallerId }, () =>
        lastValueFrom(next.handle(), { defaultValue: undefined }),
      ),
    );
  }
}
