import { createHash } from 'crypto';
import {
  aplicaTransicion,
  eventoAutentico,
  EventoWompi,
  firmaIntegridad,
  urlCheckout,
} from './wompi.util';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

describe('firmaIntegridad', () => {
  it('es el SHA-256 de referencia + monto + moneda + secreto (ejemplo de la documentacion)', () => {
    expect(
      firmaIntegridad({
        referencia: 'sk8-438k4-xmxm392-sn2m',
        montoCentavos: 2490000,
        moneda: 'COP',
        secreto: 'prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6',
      }),
    ).toBe(
      sha(
        'sk8-438k4-xmxm392-sn2m2490000COPprod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6',
      ),
    );
  });

  it('incluye la expiracion antes del secreto', () => {
    expect(
      firmaIntegridad({
        referencia: 'r1',
        montoCentavos: 100,
        moneda: 'COP',
        expiracion: '2026-09-26T15:00:00.000Z',
        secreto: 's',
      }),
    ).toBe(sha('r1100COP2026-09-26T15:00:00.000Zs'));
  });

  it('rechaza montos no enteros o no positivos', () => {
    for (const monto of [0, -5, 10.5]) {
      expect(() =>
        firmaIntegridad({
          referencia: 'r',
          montoCentavos: monto,
          moneda: 'COP',
          secreto: 's',
        }),
      ).toThrow();
    }
  });
});

describe('urlCheckout', () => {
  it('lleva la firma y el monto calculados en el servidor', () => {
    const url = new URL(
      urlCheckout({
        llavePublica: 'pub_test_x',
        referencia: 'tp_1',
        montoCentavos: 5000000,
        firma: 'abc',
        redireccion: 'https://turnos.dev/pagos/resultado',
        expiracion: '2026-09-26T15:00:00.000Z',
      }),
    );
    expect(url.searchParams.get('amount-in-cents')).toBe('5000000');
    expect(url.searchParams.get('signature:integrity')).toBe('abc');
    expect(url.searchParams.get('currency')).toBe('COP');
    expect(url.searchParams.get('expiration-time')).toBe(
      '2026-09-26T15:00:00.000Z',
    );
  });
});

describe('eventoAutentico', () => {
  const secreto = 'test_events_secreto';
  const evento = (): EventoWompi => {
    const e: EventoWompi = {
      event: 'transaction.updated',
      data: {
        transaction: {
          id: '1234-1610641025-49201',
          reference: 'tp_abc',
          amount_in_cents: 4490000,
          currency: 'COP',
          status: 'APPROVED',
          payment_method_type: 'CARD',
        },
      },
      environment: 'test',
      signature: {
        properties: [
          'transaction.id',
          'transaction.status',
          'transaction.amount_in_cents',
        ],
        checksum: '',
      },
      timestamp: 1530291411,
    };
    e.signature!.checksum = sha(
      `1234-1610641025-49201APPROVED44900001530291411${secreto}`,
    );
    return e;
  };

  it('acepta el checksum correcto', () => {
    expect(eventoAutentico(evento(), secreto)).toBe(true);
    expect(
      eventoAutentico(evento(), secreto, evento().signature!.checksum),
    ).toBe(true);
  });

  it('rechaza un evento alterado (otro monto)', () => {
    const e = evento();
    e.data.transaction!.amount_in_cents = 1;
    expect(eventoAutentico(e, secreto)).toBe(false);
  });

  it('rechaza otro secreto, otro timestamp o un encabezado distinto', () => {
    expect(eventoAutentico(evento(), 'otro')).toBe(false);
    const e = evento();
    e.timestamp = 1;
    expect(eventoAutentico(e, secreto)).toBe(false);
    expect(eventoAutentico(evento(), secreto, 'f'.repeat(64))).toBe(false);
  });

  it('rechaza un evento sin firma', () => {
    const e = evento();
    delete e.signature;
    expect(eventoAutentico(e, secreto)).toBe(false);
  });
});

describe('aplicaTransicion (eventos fuera de orden)', () => {
  it('avanza de pendiente a un estado final', () => {
    expect(aplicaTransicion({ actual: 'creado', nuevo: 'pendiente' })).toBe(
      true,
    );
    expect(aplicaTransicion({ actual: 'pendiente', nuevo: 'aprobado' })).toBe(
      true,
    );
    expect(aplicaTransicion({ actual: 'aprobado', nuevo: 'anulado' })).toBe(
      true,
    );
  });

  it('un PENDING atrasado no deshace un APPROVED', () => {
    expect(aplicaTransicion({ actual: 'aprobado', nuevo: 'pendiente' })).toBe(
      false,
    );
    expect(aplicaTransicion({ actual: 'aprobado', nuevo: 'rechazado' })).toBe(
      false,
    );
  });

  it('el mismo estado dos veces no es una transicion (idempotente)', () => {
    expect(aplicaTransicion({ actual: 'aprobado', nuevo: 'aprobado' })).toBe(
      false,
    );
  });

  it('entre rechazado y error gana el evento mas nuevo', () => {
    const viejo = new Date('2026-09-26T10:00:00Z');
    const nuevo = new Date('2026-09-26T10:05:00Z');
    expect(
      aplicaTransicion({
        actual: 'rechazado',
        nuevo: 'error',
        eventoEn: nuevo,
        ultimoEventoEn: viejo,
      }),
    ).toBe(true);
    expect(
      aplicaTransicion({
        actual: 'error',
        nuevo: 'rechazado',
        eventoEn: viejo,
        ultimoEventoEn: nuevo,
      }),
    ).toBe(false);
  });

  it('Wompi no mueve una disputa, salvo que anule la transaccion', () => {
    expect(aplicaTransicion({ actual: 'en_disputa', nuevo: 'aprobado' })).toBe(
      false,
    );
    expect(aplicaTransicion({ actual: 'en_disputa', nuevo: 'anulado' })).toBe(
      true,
    );
    expect(aplicaTransicion({ actual: 'revertido', nuevo: 'anulado' })).toBe(
      false,
    );
  });
});
