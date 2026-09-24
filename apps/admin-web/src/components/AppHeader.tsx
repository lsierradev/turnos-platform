import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectorTema } from '@/components/SelectorTema';
import { useAuth } from '@/features/auth/AuthProvider';

const ROL_LABEL: Record<string, string> = {
  admin: 'Administrador',
  tecnico: 'Tecnico',
  cliente: 'Cliente',
};

/**
 * Cabecera comun a las vistas internas: link de vuelta al inicio, quien esta
 * logueado y salir.
 *
 * El link a Home resuelve el hallazgo 6 de UX-NOTES.md: antes, una vez
 * dentro de /agenda o /dashboard no habia ninguna forma visible de volver
 * salvo el boton atras del navegador.
 */
export function AppHeader() {
  const { usuario, cerrarSesion } = useAuth();

  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 p-3">
        <Link to="/" className="font-heading text-sm font-semibold">
          turnos-platform
        </Link>

        <div className="flex items-center gap-3">
          {usuario && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {usuario.email}
            </span>
          )}
          {usuario && (
            <Badge variant="secondary">
              {ROL_LABEL[usuario.rol] ?? usuario.rol}
            </Badge>
          )}
          <SelectorTema />
          <Button variant="outline" size="sm" onClick={cerrarSesion}>
            Salir
          </Button>
        </div>
      </div>
    </header>
  );
}
