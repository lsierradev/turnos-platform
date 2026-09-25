import { actuaComoAdmin } from '@/lib/sesion';
import { CalendarX2 } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { NavegadorFecha } from '@/components/NavegadorFecha';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  formatearDiaMes,
  formatearDuracion,
  formatearFechaLarga,
  hoyISO,
  inicioDeSemana,
  sumarDiasISO,
} from '@/lib/dates';
import { esUuid } from '@/lib/uuid';
import { AgendaSemanal, LeyendaCategorias } from './AgendaSemanal';
import { bloquesDe, huecosLibres, JORNADA, minutosOcupados } from './linea-tiempo';
import { LineaTiempoDia } from './LineaTiempoDia';
import { SelectorTecnico } from './SelectorTecnico';
import { useAgendaQuery } from './useAgendaQuery';
import { useAgendaSemanaQuery } from './useAgendaSemanaQuery';
import { useTecnicosQuery } from './useTecnicosQuery';

type Vista = 'dia' | 'semana';
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Agenda de un tecnico (Sprint 15): linea de tiempo del dia o resumen de
 * la semana. Vista y fecha viven en la URL (?vista=semana&fecha=...) para
 * que Atras, recargar y compartir el link conserven donde estaba.
 */
export function AgendaTecnicoView() {
  const { tecnicoId } = useParams<{ tecnicoId: string }>();
  const { usuario } = useAuth();
  const [params, setParams] = useSearchParams();

  const vista: Vista = params.get('vista') === 'semana' ? 'semana' : 'dia';
  const fechaParam = params.get('fecha');
  const fecha = fechaParam && FECHA.test(fechaParam) ? fechaParam : hoyISO();
  const lunes = inicioDeSemana(fecha);

  function ir(cambios: { vista?: Vista; fecha?: string }) {
    const siguiente = new URLSearchParams(params);
    const v = cambios.vista ?? vista;
    const f = cambios.fecha ?? fecha;
    if (v === 'semana') siguiente.set('vista', 'semana');
    else siguiente.delete('vista');
    // Hoy es el default: no ensuciar la URL con el.
    if (f === hoyISO()) siguiente.delete('fecha');
    else siguiente.set('fecha', f);
    setParams(siguiente);
  }

  // Hallazgos 1 y 7 de UX-NOTES.md: un id con forma invalida no llega al
  // backend ni deja la query colgada en 'pending'.
  const idValido = esUuid(tecnicoId);
  const dia = useAgendaQuery(idValido && vista === 'dia' ? tecnicoId : undefined, fecha);
  const semana = useAgendaSemanaQuery(
    idValido && vista === 'semana' ? tecnicoId : undefined,
    lunes,
  );

  const esPropia = usuario?.id === tecnicoId;
  const esAdmin = actuaComoAdmin(usuario);
  const tecnicos = useTecnicosQuery(esAdmin && idValido && !esPropia);
  const nombre = tecnicos.data?.find((t) => t.id === tecnicoId)?.nombre;

  const volverAlSelector = esAdmin ? (
    <Link to="/agenda" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      Elegir otro tecnico
    </Link>
  ) : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <CardTitle as="h1">Agenda del tecnico</CardTitle>
              {esAdmin && !esPropia && idValido ? (
                <SelectorTecnico tecnicoId={tecnicoId} nombreActual={nombre} />
              ) : (
                <p className="truncate text-sm text-muted-foreground">
                  {esPropia ? 'Tus turnos' : <span className="font-mono text-xs">{tecnicoId}</span>}
                </p>
              )}
            </div>
            {idValido && (
              <div
                role="group"
                aria-label="Vista"
                className="inline-flex self-start rounded-lg border bg-muted p-0.5"
              >
                {(['dia', 'semana'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={vista === v}
                    onClick={() => ir({ vista: v })}
                    className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                      vista === v
                        ? 'bg-card text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {v === 'dia' ? 'Dia' : 'Semana'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {idValido &&
            (vista === 'dia' ? (
              <NavegadorFecha
                fecha={fecha}
                onCambiar={(f) => ir({ fecha: f })}
                actualizando={dia.isFetching && !dia.isPending}
              />
            ) : (
              <NavegadorFecha
                fecha={lunes}
                paso={7}
                hoy={inicioDeSemana(hoyISO())}
                etiquetaHoy="Esta semana"
                etiqueta={`${formatearDiaMes(lunes)} – ${formatearDiaMes(sumarDiasISO(lunes, 6))}`}
                onCambiar={(f) => ir({ fecha: f })}
                actualizando={semana.isFetching && !semana.isPending}
              />
            ))}
        </CardHeader>

        <CardContent>
          {!idValido ? (
            <EstadoVacio
              icono={CalendarX2}
              titulo="El id del tecnico no es valido"
              descripcion="La direccion no contiene un id de tecnico con el formato correcto."
              accion={volverAlSelector}
            />
          ) : vista === 'dia' ? (
            dia.isPending ? (
              <EstadoCargando forma="bloque" etiqueta="Cargando agenda…" />
            ) : dia.isError ? (
              <EstadoError
                error={dia.error}
                onReintentar={dia.refetch}
                accionAlternativa={volverAlSelector}
              />
            ) : (
              <VistaDia fecha={fecha} turnos={dia.data} atenuada={dia.isFetching} />
            )
          ) : semana.isPending ? (
            <EstadoCargando forma="bloque" etiqueta="Cargando semana…" />
          ) : semana.error ? (
            <EstadoError
              error={semana.error}
              onReintentar={semana.reintentar}
              accionAlternativa={volverAlSelector}
            />
          ) : (
            <div className={semana.isFetching ? 'opacity-60 transition-opacity' : undefined}>
              <AgendaSemanal
                dias={semana.dias}
                onElegirDia={(f) => ir({ vista: 'dia', fecha: f })}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VistaDia({
  fecha,
  turnos,
  atenuada,
}: {
  fecha: string;
  turnos: Parameters<typeof LineaTiempoDia>[0]['turnos'];
  atenuada: boolean;
}) {
  const bloques = bloquesDe(turnos);
  const vigentes = bloques.filter((b) => !b.cancelado).length;
  const ocupados = minutosOcupados(bloques);
  const libres = huecosLibres(bloques).reduce((t, h) => t + h.fin - h.inicio, 0);

  return (
    <div className={`space-y-3 ${atenuada ? 'opacity-60 transition-opacity' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium first-letter:uppercase">{formatearFechaLarga(fecha)}</p>
        <p className="text-sm text-muted-foreground">
          {vigentes === 0
            ? // Texto exacto: lo busca el e2e (hu3).
              'Sin turnos para este dia.'
            : `${vigentes} turno${vigentes === 1 ? '' : 's'} · ${formatearDuracion(
                ocupados,
              )} ocupadas · ${formatearDuracion(libres)} libres`}
        </p>
      </div>
      <LineaTiempoDia turnos={turnos} esHoy={fecha === hoyISO()} />
      <LeyendaCategorias />
      {vigentes === 0 && (
        <p className="sr-only">
          Jornada completa libre, de {JORNADA.inicio / 60}:00 a {JORNADA.fin / 60}:00.
        </p>
      )}
    </div>
  );
}
