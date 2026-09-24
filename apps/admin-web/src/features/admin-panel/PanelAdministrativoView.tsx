import { AlertTriangle, OctagonAlert, Warehouse } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { NavegadorFecha } from '@/components/NavegadorFecha';
import { Card, CardContent } from '@/components/ui/card';
import type { CargaResponse } from '@/lib/api-client';
import {
  formatearDiaMes,
  formatearDuracion,
  hoyISO,
  inicioDeSemana,
  sumarDiasISO,
} from '@/lib/dates';
import { MatrizSemanal } from './MatrizSemanal';
import { porcentaje } from './niveles';
import { TarjetaBahia } from './TarjetaBahia';
import { useCargaQuery } from './useCargaQuery';

type Vista = 'dia' | 'semana';
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Panel del taller (Sprint 16): carga por bahia con datos reales de
 * GET /bahias/carga. Vista y fecha en la URL, como la agenda.
 */
export function PanelAdministrativoView() {
  const [params, setParams] = useSearchParams();
  const vista: Vista = params.get('vista') === 'semana' ? 'semana' : 'dia';
  const fechaParam = params.get('fecha');
  const fecha = fechaParam && FECHA.test(fechaParam) ? fechaParam : hoyISO();
  const lunes = inicioDeSemana(fecha);
  const [desde, hasta] =
    vista === 'semana' ? [lunes, sumarDiasISO(lunes, 6)] : [fecha, fecha];

  const carga = useCargaQuery(desde, hasta);

  function ir(cambios: { vista?: Vista; fecha?: string }) {
    const siguiente = new URLSearchParams(params);
    const v = cambios.vista ?? vista;
    const f = cambios.fecha ?? fecha;
    if (v === 'semana') siguiente.set('vista', 'semana');
    else siguiente.delete('vista');
    if (f === hoyISO()) siguiente.delete('fecha');
    else siguiente.set('fecha', f);
    setParams(siguiente);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Panel del taller</h1>
          <p className="text-sm text-muted-foreground">
            Carga de trabajo por bahia
            {carga.data && ` · jornada ${carga.data.jornada.apertura}–${carga.data.jornada.cierre}`}
          </p>
        </div>
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
      </div>

      {vista === 'dia' ? (
        <NavegadorFecha
          fecha={fecha}
          onCambiar={(f) => ir({ fecha: f })}
          actualizando={carga.isFetching && !carga.isPending}
        />
      ) : (
        <NavegadorFecha
          fecha={lunes}
          paso={7}
          hoy={inicioDeSemana(hoyISO())}
          etiquetaHoy="Esta semana"
          etiqueta={`${formatearDiaMes(lunes)} – ${formatearDiaMes(sumarDiasISO(lunes, 6))}`}
          onCambiar={(f) => ir({ fecha: f })}
          actualizando={carga.isFetching && !carga.isPending}
        />
      )}

      {carga.isPending ? (
        <EstadoCargando forma="tarjetas" etiqueta="Cargando ocupacion de las bahias…" />
      ) : carga.isError ? (
        <EstadoError error={carga.error} onReintentar={carga.refetch} />
      ) : carga.data.bahias.length === 0 ? (
        <EstadoVacio
          icono={Warehouse}
          titulo="No hay bahias activas"
          descripcion="Cuando se de de alta una bahia va a aparecer aca con su ocupacion."
        />
      ) : (
        <div className={carga.isFetching ? 'opacity-60 transition-opacity' : undefined}>
          {vista === 'dia' ? (
            <VistaDia carga={carga.data} fecha={fecha} />
          ) : (
            <Card>
              <CardContent>
                <MatrizSemanal
                  carga={carga.data}
                  onElegirDia={(f) => ir({ vista: 'dia', fecha: f })}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function VistaDia({ carga, fecha }: { carga: CargaResponse; fecha: string }) {
  const resumen = carga.resumen.find((r) => r.fecha === fecha) ?? carga.resumen[0];
  const capacidad = carga.jornada.minutos * carga.bahias.length;
  const enAlerta = carga.bahias
    .map((b) => ({ b, d: b.dias.find((x) => x.fecha === fecha)! }))
    .filter(({ d }) => d.nivel === 'alta' || d.nivel === 'completa');
  const hayCompleta = enAlerta.some(({ d }) => d.nivel === 'completa');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Dato titulo="Ocupacion del taller" valor={porcentaje(resumen.ocupacion)} testId="panel-ocupacion" />
        <Dato titulo="Turnos" valor={String(resumen.turnos)} testId="panel-turnos" />
        <Dato
          titulo="Bahias en alerta"
          valor={`${resumen.bahiasEnAlerta} de ${carga.bahias.length}`}
          testId="panel-alertas"
          alerta={resumen.bahiasEnAlerta > 0}
        />
        <Dato
          titulo="Tiempo libre"
          valor={formatearDuracion(Math.max(capacidad - resumen.minutosOcupados, 0))}
          testId="panel-libre"
        />
      </div>

      {enAlerta.length > 0 && (
        <div
          role="status"
          className={`flex gap-3 rounded-lg border p-3 ${
            hayCompleta ? 'border-error/40 bg-error-suave' : 'border-advertencia/40 bg-advertencia-suave'
          }`}
        >
          {hayCompleta ? (
            <OctagonAlert className="mt-0.5 size-5 shrink-0 text-error" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-advertencia" aria-hidden />
          )}
          <div className="space-y-0.5 text-sm">
            <p className={`font-semibold ${hayCompleta ? 'text-error-texto' : 'text-advertencia-texto'}`}>
              {enAlerta.length === 1
                ? '1 bahia con ocupacion alta'
                : `${enAlerta.length} bahias con ocupacion alta`}
            </p>
            <p className="text-foreground">
              {enAlerta.map(({ b, d }) => `${b.nombre} (${porcentaje(d.ocupacion)})`).join(' · ')}
              . Desde {porcentaje(carga.umbrales.alta)} de la jornada ya no entra un servicio largo y
              cualquier demora afecta el resto del dia.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {carga.bahias.map((b) => (
          <TarjetaBahia
            key={b.bahiaId}
            bahia={b}
            fecha={fecha}
            jornada={carga.jornada}
            umbrales={carga.umbrales}
          />
        ))}
      </div>
    </div>
  );
}

function Dato({
  titulo,
  valor,
  testId,
  alerta = false,
}: {
  titulo: string;
  valor: string;
  testId: string;
  alerta?: boolean;
}) {
  return (
    <Card size="sm" data-testid={testId}>
      <CardContent>
        <p className="text-xs text-muted-foreground">{titulo}</p>
        <p
          data-testid={`${testId}-valor`}
          className={`flex items-center gap-1.5 font-heading text-2xl font-semibold tabular-nums ${
            alerta ? 'text-advertencia-texto' : 'text-foreground'
          }`}
        >
          {alerta && <AlertTriangle className="size-5 text-advertencia" aria-hidden />}
          {valor}
        </p>
      </CardContent>
    </Card>
  );
}
