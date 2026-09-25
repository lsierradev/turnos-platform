import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { CorreoService } from './correo.service';
import {
  MotivoToken,
  TokenContrasena,
} from './entities/token-contrasena.entity';
import { Usuario } from './entities/usuario.entity';

const SALT_ROUNDS = 10;

// Cuanto vale un enlace. El de alta dura mas: el cliente lo recibe sin
// haberlo pedido y puede tardar en abrir el correo. El de olvido es corto
// porque lo pidio en ese momento, y un enlace vivo es una puerta abierta
// para quien tenga acceso a su casilla.
const VIGENCIA_MS: Record<MotivoToken, number> = {
  alta: 72 * 3_600_000,
  olvido: 60 * 60_000,
};

// Freno a "olvide mi contrasena" repetido: sin esto, cualquiera puede
// llenarle la casilla a otra persona (y gastar cuota de SendGrid) con solo
// saber su correo.
const ESPERA_ENTRE_OLVIDOS_MS = 60_000;

const hashDe = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export interface Emision {
  /** El correo salio (false: SendGrid sin configurar, quedo en el log). */
  enviado: boolean;
}

/**
 * Enlaces para definir o restablecer la contrasena (Sprint 18).
 *
 * El token en claro existe en un solo lugar: el correo. La base guarda su
 * SHA-256 (migracion 013), y un enlace nuevo anula los anteriores del mismo
 * usuario.
 */
@Injectable()
export class ContrasenaService {
  private readonly logger = new Logger(ContrasenaService.name);

  constructor(
    @InjectRepository(TokenContrasena)
    private readonly tokens: Repository<TokenContrasena>,
    private readonly dataSource: DataSource,
    private readonly correo: CorreoService,
  ) {}

  /** Contrasena "por defecto" de una cuenta nueva: al azar y desconocida. */
  static contrasenaInicial(): string {
    return randomBytes(32).toString('hex');
  }

  /** Hash de una contrasena inicial (nadie la conoce: se define por enlace). */
  static hashInicial(): Promise<string> {
    return bcrypt.hash(ContrasenaService.contrasenaInicial(), SALT_ROUNDS);
  }

  async emitir(usuario: Usuario, motivo: MotivoToken): Promise<Emision> {
    const token = randomBytes(32).toString('base64url');
    const ahora = new Date();

    // Anular los enlaces vigentes: si el usuario pidio dos, solo sirve el
    // ultimo que recibio.
    await this.tokens.update(
      { usuarioId: usuario.id, usadoEn: IsNull() },
      { usadoEn: ahora },
    );
    await this.tokens.save(
      this.tokens.create({
        usuarioId: usuario.id,
        tokenHash: hashDe(token),
        motivo,
        expiraEn: new Date(ahora.getTime() + VIGENCIA_MS[motivo]),
        usadoEn: null,
      }),
    );

    const base = (process.env.WEB_URL ?? 'http://localhost:5173').replace(
      /\/$/,
      '',
    );
    const enlace = `${base}/restablecer?token=${token}`;
    const texto =
      motivo === 'alta'
        ? `Hola ${usuario.nombre}:\n\n` +
          `El taller te registro para gestionar tus turnos. Para entrar, ` +
          `defini tu contrasena en este enlace (vale 72 horas):\n\n${enlace}\n\n` +
          `Tu usuario es este correo: ${usuario.email}`
        : `Hola ${usuario.nombre}:\n\n` +
          `Pediste cambiar tu contrasena. Usa este enlace (vale 1 hora):\n\n` +
          `${enlace}\n\nSi no lo pediste, ignora este correo: tu contrasena ` +
          `actual sigue funcionando.`;

    try {
      const enviado = await this.correo.enviar({
        para: usuario.email,
        asunto:
          motivo === 'alta' ? 'Defini tu contrasena' : 'Cambio de contrasena',
        texto,
      });
      return { enviado };
    } catch (error) {
      // Que falle SendGrid no deshace el alta ni revela nada en "olvide":
      // el enlace queda emitido y se puede pedir otro.
      this.logger.error(
        `No se pudo enviar el correo a ${usuario.email}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { enviado: false };
    }
  }

  /**
   * "Olvide mi contrasena". No dice si el correo existe: la respuesta es la
   * misma en los dos casos, para no servir de oraculo de cuentas.
   */
  async solicitarRestablecimiento(email: string): Promise<void> {
    const usuario = await this.dataSource
      .getRepository(Usuario)
      .findOne({ where: { email: email.trim() } });
    // Una cuenta dada de baja (Sprint 21) no recibe enlaces: no podria entrar.
    if (!usuario || usuario.activo === false) return;

    const reciente = await this.tokens.findOne({
      where: {
        usuarioId: usuario.id,
        creadoEn: MoreThan(new Date(Date.now() - ESPERA_ENTRE_OLVIDOS_MS)),
      },
    });
    if (reciente) return;

    await this.emitir(usuario, 'olvido');
  }

  async restablecer(token: string, password: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // FOR UPDATE: dos envios del mismo enlace a la vez no pueden usarlo
      // los dos.
      const fila = await manager
        .getRepository(TokenContrasena)
        .createQueryBuilder('t')
        .setLock('pessimistic_write')
        .where('t.token_hash = :hash', { hash: hashDe(token) })
        .getOne();

      if (!fila || fila.usadoEn || fila.expiraEn.getTime() <= Date.now()) {
        throw new BadRequestException(
          'El enlace no es valido o ya vencio. Pedi uno nuevo desde "Olvide mi contrasena".',
        );
      }

      // sesionesValidasDesde: cierra las sesiones abiertas con la
      // contrasena anterior (ver AuthService.refresh, migracion 014).
      await manager.getRepository(Usuario).update(
        { id: fila.usuarioId },
        {
          passwordHash: await bcrypt.hash(password, SALT_ROUNDS),
          sesionesValidasDesde: new Date(),
        },
      );
      await manager
        .getRepository(TokenContrasena)
        .update({ id: fila.id }, { usadoEn: new Date() });
    });
  }
}
