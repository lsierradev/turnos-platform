import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CorreoService } from './correo.service';

describe('CorreoService sin SendGrid', () => {
  const entornoOriginal = { ...process.env };
  let dir: string;

  beforeEach(() => {
    delete process.env.SENDGRID_API_KEY;
    delete process.env.SENDGRID_FROM_EMAIL;
    dir = mkdtempSync(join(tmpdir(), 'buzon-'));
  });

  afterEach(() => {
    process.env = { ...entornoOriginal };
    rmSync(dir, { recursive: true, force: true });
  });

  it('en desarrollo deja el correo en el buzon local y avisa que no salio', async () => {
    process.env.CORREO_BUZON_DIR = dir;

    const enviado = await new CorreoService().enviar({
      para: 'maria@correo.com',
      asunto: 'Defini tu contrasena',
      texto: 'http://localhost:5173/restablecer?token=abc',
    });

    expect(enviado).toBe(false);
    const [archivo] = readdirSync(dir);
    expect(archivo).toMatch(/maria@correo\.com\.txt$/);
    expect(readFileSync(join(dir, archivo), 'utf8')).toContain(
      'restablecer?token=abc',
    );
  });

  it('en produccion no escribe nada a disco', async () => {
    delete process.env.CORREO_BUZON_DIR;
    process.env.NODE_ENV = 'production';

    await new CorreoService().enviar({
      para: 'x@y.com',
      asunto: 'a',
      texto: 'b',
    });

    expect(readdirSync(dir)).toHaveLength(0);
  });
});
