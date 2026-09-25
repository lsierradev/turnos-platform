import { actuaComoAdmin } from '@/lib/sesion';
import { Users } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/features/auth/AuthProvider';
import { BuscadorPersonas } from '@/components/BuscadorPersonas';
import { useTecnicosQuery } from './useTecnicosQuery';

/**
 * /agenda sin id. El tecnico va directo a su agenda; el admin busca y elige
 * de la lista (GET /usuarios?rol=tecnico, solo admin). Desde Sprint 15 ya
 * no hay entrada manual de UUID: el id solo aparece en la URL.
 */
export function SeleccionTecnicoView() {
  const { usuario } = useAuth();
  const esAdmin = actuaComoAdmin(usuario);
  const tecnicos = useTecnicosQuery(esAdmin);
  const navigate = useNavigate();

  if (usuario?.rol === 'tecnico') {
    return <Navigate to={`/agenda/${usuario.id}`} replace />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <p className="text-sm text-muted-foreground">
          Busca un tecnico para ver su agenda.
        </p>
      </div>

      <Card>
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
            <BuscadorPersonas
              personas={tecnicos.data}
              onElegir={(t) => navigate(`/agenda/${t.id}`)}
              autoFocus
              alto="max-h-[28rem]"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
