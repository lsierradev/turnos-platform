import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { useTituloPagina } from '@/lib/titulo';
import { useAuth } from './AuthProvider';

export function LoginView() {
  const { iniciarSesion } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  useTituloPagina('Ingresar');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // A dónde volver después de entrar. RutaProtegida deja acá la ruta que el
  // usuario quiso abrir, para no mandarlo siempre al inicio: si alguien
  // guardó el link del dashboard, después de loguearse tiene que caer ahí.
  const destino =
    (location.state as { desde?: string } | null)?.desde ?? '/';

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);

    try {
      await iniciarSesion(email, password);
      // replace: el login no queda en el historial, así el botón "atrás"
      // desde una vista interna no devuelve a una pantalla de login vacía.
      navigate(destino, { replace: true });
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : 'No se pudo conectar con el servidor. Revisá tu conexión.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle as="h1" className="font-heading text-xl">
            turnos-platform
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Ingresá con tu usuario para continuar.
          </p>
        </CardHeader>
        <CardContent>
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

            <label className="block space-y-1">
              <span className="text-sm">Contraseña</span>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={enviando || !email || !password}
            >
              {enviando ? 'Ingresando…' : 'Ingresar'}
            </Button>
            <Link
              to="/olvide"
              className="block text-center text-sm text-muted-foreground hover:text-foreground"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
