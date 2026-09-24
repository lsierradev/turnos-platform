import { useState, type FormEvent, type ReactNode } from 'react';
import { CircleCheck, LoaderCircle, MailCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useTituloPagina } from '@/lib/titulo';
import {
  ApiError,
  restablecerContrasena,
  solicitarRestablecimiento,
} from '@/lib/api-client';

/*
 * Pantallas publicas de contrasena (Sprint 18), fuera de RutaProtegida:
 * quien las usa todavia no puede iniciar sesion.
 *
 * - /olvide: pide el enlace por correo.
 * - /restablecer?token=...: el enlace del correo. Sirve tanto para el
 *   cliente que dio de alta un admin (define su primera contrasena) como
 *   para quien la olvido.
 */

function Marco({ titulo, descripcion, children }: { titulo: string; descripcion: string; children: ReactNode }) {
  useTituloPagina(titulo);
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle as="h1" className="font-heading text-xl">{titulo}</CardTitle>
          <p className="text-sm text-muted-foreground">{descripcion}</p>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}

function mensaje(e: unknown): string {
  return e instanceof ApiError ? e.message : 'No se pudo conectar con el servidor.';
}

export function OlvideView() {
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await solicitarRestablecimiento(email.trim());
      setListo(true);
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <Marco titulo="Revisa tu correo" descripcion="">
        <div role="status" className="space-y-4">
          <div className="flex gap-3">
            <MailCheck className="mt-0.5 size-5 shrink-0 text-exito-texto" aria-hidden />
            {/* El mismo texto exista o no la cuenta: la pantalla no puede
                servir para averiguar que correos estan registrados. */}
            <p className="text-sm">
              Si <strong>{email.trim()}</strong> esta registrado, te enviamos un enlace para
              cambiar la contraseña. Vale 1 hora.
            </p>
          </div>
          <Link to="/login" className="text-sm font-medium text-marca-texto underline-offset-4 hover:underline">
            Volver a ingresar
          </Link>
        </div>
      </Marco>
    );
  }

  return (
    <Marco
      titulo="Olvide mi contraseña"
      descripcion="Te mandamos por correo un enlace para definir una nueva."
    >
      <form onSubmit={enviar} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm">Correo</span>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={enviando || !email}>
          {enviando && <LoaderCircle className="animate-spin" aria-hidden />}
          {enviando ? 'Enviando…' : 'Enviar enlace'}
        </Button>
        <Link to="/login" className="block text-center text-sm text-muted-foreground hover:text-foreground">
          Volver a ingresar
        </Link>
      </form>
    </Marco>
  );
}

const MINIMO = 8;

export function RestablecerView() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [intento, setIntento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const corta = password.length < MINIMO;
  const distinta = repetida !== password;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setIntento(true);
    if (corta || distinta) return;
    setError(null);
    setEnviando(true);
    try {
      await restablecerContrasena(token, password);
      setListo(true);
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setEnviando(false);
    }
  }

  if (!token) {
    return (
      <Marco titulo="Enlace incompleto" descripcion="Abri el enlace tal como llego en el correo.">
        <Link to="/olvide" className="text-sm font-medium text-marca-texto hover:underline">
          Pedir un enlace nuevo
        </Link>
      </Marco>
    );
  }

  if (listo) {
    return (
      <Marco titulo="Contraseña guardada" descripcion="">
        <div role="status" className="space-y-4">
          <p className="flex gap-3 text-sm">
            <CircleCheck className="mt-0.5 size-5 shrink-0 text-exito-texto" aria-hidden />
            Ya podes ingresar con tu correo y la contraseña nueva.
          </p>
          <Button className="w-full" render={<Link to="/login" />} nativeButton={false}>
            Ingresar
          </Button>
        </div>
      </Marco>
    );
  }

  return (
    <Marco titulo="Defini tu contraseña" descripcion={`Minimo ${MINIMO} caracteres.`}>
      <form onSubmit={enviar} className="space-y-4" noValidate>
        <label className="block space-y-1">
          <span className="text-sm">Contraseña nueva</span>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            aria-invalid={intento && corta}
            autoFocus
          />
          {intento && corta && (
            <span className="block text-xs text-destructive">Minimo {MINIMO} caracteres.</span>
          )}
        </label>
        <label className="block space-y-1">
          <span className="text-sm">Repetir contraseña</span>
          <Input
            type="password"
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            autoComplete="new-password"
            aria-invalid={intento && distinta}
          />
          {intento && distinta && (
            <span className="block text-xs text-destructive">Las contraseñas no coinciden.</span>
          )}
        </label>
        {error && (
          <div role="alert" className="space-y-1 text-sm">
            <p className="text-destructive">{error}</p>
            <Link to="/olvide" className="font-medium text-marca-texto hover:underline">
              Pedir un enlace nuevo
            </Link>
          </div>
        )}
        <Button type="submit" className="w-full" disabled={enviando}>
          {enviando && <LoaderCircle className="animate-spin" aria-hidden />}
          {enviando ? 'Guardando…' : 'Guardar contraseña'}
        </Button>
      </form>
    </Marco>
  );
}
