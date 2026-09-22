import { getQueueToken } from '@nestjs/bull';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bull';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import {
  EstadoNotificacion,
  Notificacion,
} from '../src/modules/notifications/entities/notificacion.entity';
import { NOMBRE_COLA_NOTIFICACIONES } from '../src/modules/notifications/notifications.constants';
import { NotificationsSchedulerService } from '../src/modules/notifications/notifications-scheduler.service';
import { NotificationProvider } from '../src/modules/notifications/providers/notification-provider.interface';
import { EMAIL_PROVIDER } from '../src/modules/notifications/providers/provider.tokens';

// Este test necesita Postgres Y Redis reales: es el unico que ejercita el
// reintento de Bull de verdad (con su backoff y su re-encolado), cosa que
// los unit tests del processor no pueden cubrir porque ahi Bull no existe.
// Se salta limpio si falta cualquiera de los dos, igual que
// appointments.integration-spec.ts.
const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const describirSiHayInfra =
  DATABASE_URL && REDIS_URL ? describe : describe.skip;

if (!DATABASE_URL || !REDIS_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    'Falta DATABASE_URL y/o REDIS_URL: se omite notifications.integration-spec.ts. ' +
      'Ver packages/database/README.md y docker-compose.yml.',
  );
}

/** Falla las primeras `fallosPrevios` veces y despues responde OK. */
class ProviderQueSeCae implements NotificationProvider {
  llamadas = 0;

  constructor(private readonly fallosPrevios: number) {}

  async enviar(): Promise<void> {
    this.llamadas += 1;
    if (this.llamadas <= this.fallosPrevios) {
      throw new Error(`caida simulada #${this.llamadas}`);
    }
  }
}

describirSiHayInfra('Notificaciones (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let cola: Queue;
  let scheduler: NotificationsSchedulerService;
  let providerEmail: ProviderQueSeCae;

  let bahiaId: string;
  let servicioId: string;
  let usuarioId: string;
  let tecnicoId: string;
  let turnoId: string;

  beforeAll(async () => {
    // Backoff en milisegundos en vez de la curva exponencial real de 5s:
    // sin esto el test tardaria ~20s solo esperando reintentos.
    process.env.NOTIFICACIONES_BACKOFF_MS = '50';
    process.env.NOTIFICACIONES_INTENTOS = '3';

    providerEmail = new ProviderQueSeCae(2);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(providerEmail)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = moduleRef.get(DataSource);
    cola = moduleRef.get(getQueueToken(NOMBRE_COLA_NOTIFICACIONES));
    scheduler = moduleRef.get(NotificationsSchedulerService);

    const bahia = await dataSource.query(
      "INSERT INTO bahias (nombre) VALUES ('Bahia notif test') RETURNING id",
    );
    bahiaId = bahia[0].id;

    const servicio = await dataSource.query(
      `INSERT INTO servicios (nombre, categoria, duracion_minutos, precio)
       VALUES ('Servicio notif test', 'mecanica', 30, 10000)
       RETURNING id`,
    );
    servicioId = servicio[0].id;

    const usuario = await dataSource.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ('notif-cliente@turnos.dev', 'hash', 'Notif Cliente', 'cliente')
       RETURNING id`,
    );
    usuarioId = usuario[0].id;

    const tecnico = await dataSource.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ('notif-tecnico@turnos.dev', 'hash', 'Notif Tecnico', 'tecnico')
       RETURNING id`,
    );
    tecnicoId = tecnico[0].id;

    // Turno exactamente a 24h: cae dentro de la ventana del scheduler.
    const inicio = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const fin = new Date(inicio.getTime() + 30 * 60 * 1000);
    const turno = await dataSource.query(
      `INSERT INTO turnos (bahia_id, servicio_id, usuario_id, tecnico_id, rango_tiempo)
       VALUES ($1, $2, $3, $4, tstzrange($5, $6, '[)'))
       RETURNING id`,
      [bahiaId, servicioId, usuarioId, tecnicoId, inicio, fin],
    );
    turnoId = turno[0].id;
  });

  afterAll(async () => {
    if (dataSource) {
      await dataSource.query('DELETE FROM notificaciones WHERE turno_id = $1', [
        turnoId,
      ]);
      await dataSource.query('DELETE FROM turnos WHERE id = $1', [turnoId]);
      await dataSource.query('DELETE FROM servicios WHERE id = $1', [
        servicioId,
      ]);
      await dataSource.query('DELETE FROM bahias WHERE id = $1', [bahiaId]);
      await dataSource.query('DELETE FROM usuarios WHERE id = $1 OR id = $2', [
        usuarioId,
        tecnicoId,
      ]);
    }
    await cola?.empty();
    await app?.close();
  });

  it('reintenta el envio cuando el proveedor se cae y termina marcandolo enviado', async () => {
    await scheduler.programarRecordatorios();

    const notificacion = await esperarA(async () => {
      const filas: Notificacion[] = await dataSource.query(
        `SELECT id, estado, intentos FROM notificaciones
         WHERE turno_id = $1 AND canal = 'email'`,
        [turnoId],
      );
      const fila = filas[0];
      return fila && fila.estado === EstadoNotificacion.ENVIADO ? fila : null;
    });

    // El provider fallo 2 veces antes de responder OK: si Bull no
    // reintentara, la notificacion habria quedado en 'fallido'.
    expect(providerEmail.llamadas).toBe(3);
    expect(notificacion.estado).toBe(EstadoNotificacion.ENVIADO);
  });
});

/** Reintenta `fn` hasta que devuelva algo distinto de null o se agote el tiempo. */
async function esperarA<T>(
  fn: () => Promise<T | null>,
  timeoutMs = 15_000,
  intervaloMs = 100,
): Promise<T> {
  const limite = Date.now() + timeoutMs;
  for (;;) {
    const resultado = await fn();
    if (resultado) {
      return resultado;
    }
    if (Date.now() > limite) {
      throw new Error('Timeout esperando la condicion');
    }
    await new Promise((resolve) => setTimeout(resolve, intervaloMs));
  }
}
