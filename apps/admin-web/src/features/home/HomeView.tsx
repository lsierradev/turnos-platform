import { ChevronRight, ListChecks, type LucideIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { itemsPara, ROL_LABEL } from '@/components/layout/navegacion';
import { Button } from '@/components/ui/button';
import { EstadoError } from '@/components/estados';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/AuthProvider';
import { separarTurnos, useMisTurnosQuery } from '@/features/mis-turnos/mis-turnos';
import { TarjetaMiTurno } from '@/features/mis-turnos/MisTurnosView';

const DESCRIPCION: Record<string, string> = {
  Reservar: 'Nuevo turno con bahia, tecnico y horario.',
  Agenda: 'Turnos del dia por tecnico.',
  Panel: 'Carga de trabajo de cada bahia.',
  Dashboard: 'Asistencia y tiempos de servicio.',
  'Mis indicadores': 'Tu asistencia y tiempos de servicio.',
  'Mis turnos': 'Proximos turnos e historial.',
};

/** El proximo turno del cliente, en el inicio (Sprint 18). */
function ProximoTurno() {
  const turnos = useMisTurnosQuery();
  if (turnos.isPending) return <Skeleton className="h-20 w-full" />;
  if (turnos.isError) return <EstadoError error={turnos.error} onReintentar={turnos.refetch} />;
  const [proximo] = separarTurnos(turnos.data).proximos;
  return (
    <section aria-labelledby="proximo-turno" className="space-y-2">
      <h2 id="proximo-turno" className="font-heading text-lg font-semibold">
        Tu proximo turno
      </h2>
      {proximo ? (
        <ul>
          <TarjetaMiTurno turno={proximo} />
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No tenes turnos por delante.</p>
      )}
    </section>
  );
}

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
      // Microinteraccion: sube 2px y gana sombra al pasar el mouse (180ms,
      // ver --default-transition-duration); con movimiento reducido solo
      // cambia el borde, sin desplazamiento.
      className="group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs transition-[border-color,box-shadow,translate] hover:border-primary/60 hover:shadow-md motion-safe:hover:-translate-y-0.5 active:translate-y-0"
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

      {/* La agenda ya es el boton de arriba: aca va el resto (Sprint 18). */}
      {usuario?.rol === 'tecnico' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {accesos
            .filter((item) => !item.to.startsWith('/agenda'))
            .map((item) => (
              <Acceso key={item.to} {...item} />
            ))}
        </div>
      )}

      {usuario?.rol === 'admin' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {accesos.map((item) => (
            <Acceso key={item.to} {...item} />
          ))}
        </div>
      )}

      {/* Cliente: reservar, y de un vistazo que tiene por delante. */}
      {usuario?.rol === 'cliente' && (
        <>
          <Button
            size="lg"
            className="w-full sm:w-auto"
            onClick={() => navigate('/reservar')}
          >
            Reservar un turno
          </Button>
          <ProximoTurno />
          <Acceso to="/mis-turnos" etiqueta="Mis turnos" icono={ListChecks} />
        </>
      )}
    </div>
  );
}
