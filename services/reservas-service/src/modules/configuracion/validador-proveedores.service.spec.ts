import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ValidadorProveedores } from './validador-proveedores.service';

const WOMPI_PRUEBAS = {
  ambiente: 'pruebas' as const,
  llavePublica: 'pub_test_abc123',
  llavePrivada: 'prv_test_abc123',
  secretoIntegridad: 'test_integrity_abc123',
  secretoEventos: 'test_events_abc123',
};

function respuesta(status: number): Response {
  return { status, ok: status >= 200 && status < 300 } as Response;
}

describe('ValidadorProveedores', () => {
  const validador = new ValidadorProveedores();
  const fetchOriginal = global.fetch;
  const entornoOriginal = { ...process.env };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    delete process.env.VALIDACION_PROVEEDORES;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
    process.env = { ...entornoOriginal };
  });

  describe('Alegra', () => {
    it('valido: llama a /company con Basic usuario:token', async () => {
      fetchMock.mockResolvedValue(respuesta(200));
      await expect(
        validador.validarAlegra('taller@correo.co', 'tok-123'),
      ).resolves.toBe(true);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.alegra.com/api/v1/company');
      expect(init.headers.Authorization).toBe(
        `Basic ${Buffer.from('taller@correo.co:tok-123').toString('base64')}`,
      );
    });

    it('401: token rechazado es un 400 con mensaje para el admin', async () => {
      fetchMock.mockResolvedValue(respuesta(401));
      await expect(validador.validarAlegra('u', 't')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('caido o sin red: 502, no se guarda', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(validador.validarAlegra('u', 't')).rejects.toThrow(
        BadGatewayException,
      );
      fetchMock.mockResolvedValue(respuesta(503));
      await expect(validador.validarAlegra('u', 't')).rejects.toThrow(
        BadGatewayException,
      );
    });
  });

  describe('Wompi', () => {
    it('valida comercio (llave publica) y llave privada en el sandbox', async () => {
      fetchMock.mockResolvedValue(respuesta(200));
      await expect(validador.validarWompi(WOMPI_PRUEBAS)).resolves.toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://sandbox.wompi.co/v1/merchants/pub_test_abc123',
      );
      expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
        'Bearer prv_test_abc123',
      );
    });

    it('una llave de pruebas no se acepta como produccion (sin llamar a nadie)', async () => {
      await expect(
        validador.validarWompi({ ...WOMPI_PRUEBAS, ambiente: 'produccion' }),
      ).rejects.toThrow(/ambiente de produccion/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('llave publica desconocida o privada rechazada: 400', async () => {
      fetchMock.mockResolvedValueOnce(respuesta(404));
      await expect(validador.validarWompi(WOMPI_PRUEBAS)).rejects.toThrow(
        /llave publica/,
      );
      fetchMock
        .mockResolvedValueOnce(respuesta(200))
        .mockResolvedValueOnce(respuesta(401));
      await expect(validador.validarWompi(WOMPI_PRUEBAS)).rejects.toThrow(
        /llave privada/,
      );
    });
  });

  it('VALIDACION_PROVEEDORES=omitir saltea la red fuera de produccion', async () => {
    process.env.VALIDACION_PROVEEDORES = 'omitir';
    await expect(validador.validarAlegra('u', 't')).resolves.toBe(false);
    await expect(validador.validarWompi(WOMPI_PRUEBAS)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('en produccion no se puede omitir', async () => {
    process.env.VALIDACION_PROVEEDORES = 'omitir';
    process.env.NODE_ENV = 'production';
    fetchMock.mockResolvedValue(respuesta(200));
    await expect(validador.validarAlegra('u', 't')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });
});
