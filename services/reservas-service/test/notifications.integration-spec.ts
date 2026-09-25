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
//
// AISLAMIENTO: jest-integration.json fija maxWorkers en 1 por culpa de este
// archivo. Las tres suites de integracion levantan AppModule, y cada
// AppModule arranca un worker de Bull sobre la MISMA cola de Redis. En
// paralelo, el job que encola este test lo puede tomar el worker de otra
// suite -- que usa el provider real, no el simulado de aca -- y entonces
// providerEmail.llamadas se queda en 0 mientras la fila avanza sola. Peor:
// al cerrar esa otra suite su app, el reintento en vuelo escribe sobre una
// conexion cerrada y la tumba con "Driver not Connected".
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
    // Cola propia de esta corrida (ver BULL_PREFIX en app.module.ts): un
    // reservas-service de dev escuchando el mismo Redis no puede tomar
    // estos jobs. obliterate() en afterAll borra estas claves.
    process.env.BULL_PREFIX = `bull-test-${process.pid}-${Date.now()}`;

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
      "INSERT INTO bahias (nombre, taller_id) VALUES ('Bahia notif test', '00000000-0000-4000-8000-000000000001') RETURNING id",
    );
    bahiaId = bahia[0].id;

    const servicio = await dataSource.query(
      `INSERT INTO servicios (nombre, categoria, duracion_minutos, precio_base_centavos, taller_id)
       VALUES ('Servicio notif test', 'mecanica', 30, 10000, '00000000-0000-4000-8000-000000000001')
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
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ('notif-tecnico@turnos.dev', 'hash', 'Notif Tecnico', 'tecnico', '00000000-0000-4000-8000-000000000001')
       RETURNING id`,
    );
    tecnicoId = tecnico[0].id;

    // Turno exactamente a 24h: cae dentro de la ventana del scheduler.
    const inicio = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const fin = new Date(inicio.getTime() + 30 * 60 * 1000);
    const turno = await dataSource.query(
      `INSERT INTO turnos (taller_id, bahia_id, servicio_id, usuario_id, tecnico_id, rango_tiempo)
       VALUES ('00000000-0000-4000-8000-000000000001', $1, $2, $3, $4, tstzrange($5, $6, '[)'))
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
    // obliterate y no empty(): empty() solo saca los jobs en espera y deja
    // vivos los retrasados y los activos, que despues se despiertan contra
    // una app ya cerrada. close() ademas detiene el worker ANTES de que
    // app.close() cierre la conexion de TypeORM.
    if (cola) {
      await cola.obliterate({ force: true }).catch(() => undefined);
      await cola.close();
    }
    await app?.close();
    delete process.env.BULL_PREFIX;
  });

  it('reintenta el envio cuando el proveedor se cae y termina marcandolo enviado', async () => {
    await scheduler.programarRecordatorios();

    // El scheduler tiene que haber dejado la fila ANTES de encolar nada. Se
    // comprueba aparte para que, si falla, se sepa si el problema fue no
    // encontrar el turno (scheduler) o no procesar el job (cola).
    const [creada]: Notificacion[] = await dataSource.query(
      `SELECT id, estado, intentos FROM notificaciones
       WHERE turno_id = $1 AND canal = 'email'`,
      [turnoId],
    );
    if (!creada) {
      throw new Error(
        'El scheduler no registro ninguna notificacion para el turno: o no ' +
          'lo encontro en su ventana de 24h, o el INSERT no se hizo. El ' +
          'fallo no esta en la cola.',
      );
    }

    const notificacion = await esperarA(
      async () => {
        const filas: Notificacion[] = await dataSource.query(
          `SELECT id, estado, intentos FROM notificaciones
           WHERE turno_id = $1 AND canal = 'email'`,
          [turnoId],
        );
        const fila = filas[0];
        return fila && fila.estado === EstadoNotificacion.ENVIADO ? fila : null;
      },
      // Si se agota, el mensaje trae el estado real de la fila y cuantas
      // veces llamo el provider. Un timeout pelado no distingue "la cola
      // nunca proceso el job" de "lo proceso y quedo fallido".
      async () => {
        const filas: Notificacion[] = await dataSource.query(
          `SELECT estado, intentos, error FROM notificaciones
           WHERE turno_id = $1 AND canal = 'email'`,
          [turnoId],
        );
        return (
          `fila=${JSON.stringify(filas[0])} ` +
          `llamadasAlProvider=${providerEmail.llamadas} ` +
          `jobsEnCola=${JSON.stringify(await cola.getJobCounts())}`
        );
      },
    );

    // El provider fallo 2 veces antes de responder OK: si Bull no
    // reintentara, la notificacion habria quedado en 'fallido'.
    expect(providerEmail.llamadas).toBe(3);
    expect(notificacion.estado).toBe(EstadoNotificacion.ENVIADO);
  });
});

/**
 * Reintenta `fn` hasta que devuelva algo distinto de null o se agote el
 * tiempo. `diagnostico` se invoca solo al agotarse, para que el mensaje de
 * error diga en que estado quedo todo en vez de un "Timeout" pelado.
 */
async function esperarA<T>(
  fn: () => Promise<T | null>,
  diagnostico?: () => Promise<string>,
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
      const detalle = diagnostico ? await diagnostico() : '';
      throw new Error(`Timeout esperando la condicion. ${detalle}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervaloMs));
  }
}
