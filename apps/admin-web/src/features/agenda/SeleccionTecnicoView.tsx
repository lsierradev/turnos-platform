import { useState, type FormEvent } from 'react';
import { ChevronRight, UserRound, Users } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/AuthProvider';
import { esUuid } from '@/lib/uuid';
import { useTecnicosQuery } from './useTecnicosQuery';

/**
 * /agenda sin id (hallazgo 1 de UX-NOTES.md). Antes esta ruta no existia:
 * /agenda quedaba en blanco y /agenda/<vacio> colgaba en skeleton. Ahora:
 *   - el tecnico va directo a su agenda;
 *   - el admin elige de la lista de tecnicos, por nombre, en vez de pegar
 *     un UUID (que igual se puede, validado: hallazgo 7).
 */
export function SeleccionTecnicoView() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';
  const tecnicos = useTecnicosQuery(esAdmin);
  const navigate = useNavigate();
  const [idManual, setIdManual] = useState('');
  const [errorId, setErrorId] = useState<string | null>(null);

  if (usuario?.rol === 'tecnico') {
    return <Navigate to={`/agenda/${usuario.id}`} replace />;
  }

  function irPorId(e: FormEvent) {
    e.preventDefault();
    if (!esUuid(idManual)) {
      setErrorId(
        'Eso no es un id de tecnico valido (formato 8-4-4-4-12, p. ej. 3f2a…-…).',
      );
      return;
    }
    navigate(`/agenda/${idManual.trim()}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <p className="text-sm text-muted-foreground">
          Elegi un tecnico para ver sus turnos del dia.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tecnicos</CardTitle>
        </CardHeader>
        <CardContent>
          {tecnicos.isPending ? (
            <EstadoCargando etiqueta="Cargando tecnicos…" />
          ) : tecnicos.isError ? (
            <EstadoError error={tecnicos.error} onReintentar={tecnicos.refetch} />
          ) : tecnicos.data.length === 0 ? (
            <EstadoVacio
              icono={Users}
              titulo="Todavia no hay tecnicos"
              descripcion="Cuando se de de alta un usuario con rol tecnico va a aparecer aca."
            />
          ) : (
            <ul className="divide-y rounded-lg border">
              {tecnicos.data.map((t) => (
                <li key={t.id}>
                  <Link
                    to={`/agenda/${t.id}`}
                    className="flex items-center gap-3 px-3 py-3 hover:bg-muted"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                      <UserRound className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {t.nombre}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {t.email}
                      </span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Ir por id</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={irPorId} className="space-y-2" noValidate>
            <label htmlFor="id-tecnico" className="text-xs text-muted-foreground">
              Id del tecnico (UUID)
            </label>
            <div className="flex gap-2">
              <Input
                id="id-tecnico"
                placeholder="00000000-0000-0000-0000-000000000000"
                value={idManual}
                aria-invalid={errorId !== null}
                aria-describedby={errorId ? 'id-tecnico-error' : undefined}
                onChange={(e) => {
                  setIdManual(e.target.value);
                  setErrorId(null);
                }}
                className="font-mono"
              />
              <Button type="submit" variant="outline" disabled={!idManual.trim()}>
                Ver agenda
              </Button>
            </div>
            {errorId && (
              <p id="id-tecnico-error" className="text-xs text-destructive">
                {errorId}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
