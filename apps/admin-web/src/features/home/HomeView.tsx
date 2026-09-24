import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { EstadoVacio } from '@/components/estados';
import { itemsPara, ROL_LABEL } from '@/components/layout/navegacion';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthProvider';

const DESCRIPCION: Record<string, string> = {
  Agenda: 'Turnos del dia por tecnico.',
  Panel: 'Carga de trabajo de cada bahia.',
  Dashboard: 'Asistencia y tiempos de servicio.',
};

function Acceso({
  to,
  etiqueta,
  icono: Icono,
}: {
  to: string;
  etiqueta: string;
  icono: LucideIcon;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-primary/60"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground group-hover:bg-primary group-hover:text-primary-foreground">
        <Icono className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-heading text-sm font-semibold">{etiqueta}</span>
        <span className="block text-xs text-muted-foreground">
          {DESCRIPCION[etiqueta]}
        </span>
      </span>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
    </Link>
  );
}

export function HomeView() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const accesos = itemsPara(usuario).filter((i) => i.to !== '/');

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <p className="text-xs font-semibold tracking-wider text-marca-texto uppercase">
          {usuario ? ROL_LABEL[usuario.rol] : ''}
        </p>
        <h1 className="text-2xl font-semibold">Hola{usuario ? `, ${usuario.email.split('@')[0]}` : ''}</h1>
      </div>

      {usuario?.rol === 'tecnico' && (
        // Accion principal del tecnico, grande y arriba: es lo unico que
        // viene a hacer al panel.
        <Button
          size="lg"
          className="w-full sm:w-auto"
          onClick={() => navigate(`/agenda/${usuario.id}`)}
        >
          Ver mi agenda de hoy
        </Button>
      )}

      {usuario?.rol === 'admin' && (
        <div className="grid gap-3 sm:grid-cols-3">
          {accesos.map((item) => (
            <Acceso key={item.to} {...item} />
          ))}
        </div>
      )}

      {usuario?.rol !== 'admin' && usuario?.rol !== 'tecnico' && (
        <EstadoVacio
          titulo="Tu usuario no tiene acceso a ninguna vista de este panel."
          descripcion="El panel es para administradores y tecnicos del taller. Si necesitas acceso, pedilo a un administrador."
        />
      )}
    </div>
  );
}
