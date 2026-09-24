import { useState } from 'react';
import { ChartColumn, Download, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import {
  EstadoCargando,
  EstadoError,
  EstadoVacio,
  IndicadorActualizando,
} from '@/components/estados';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTecnicosQuery } from '@/features/agenda/useTecnicosQuery';
import { aCsv, descargarCsv } from '@/lib/csv';
import { formatearDiaMes, hoyISO, sumarDiasISO, ZONA_NEGOCIO } from '@/lib/dates';
import { GraficosKpis } from './GraficosKpis';
import {
  comparar,
  diasDelRango,
  filasCsv,
  formatearMinutos,
  formatearPorcentaje,
  nombrePeriodoAnterior,
  type Comparacion,
} from './kpis';
import { TablaKpis } from './TablaKpis';
import { useKpisQuery } from './useKpisQuery';

// Los atajos se calculan SIEMPRE desde hoyISO(), que es "hoy" en la zona del
// taller (lib/dates.ts), no la del navegador: a las 20:00 en Bogota el
// navegador de alguien en Madrid ya esta en el dia siguiente, y "Hoy" le
// mostraria un dia vacio.
const PRESETS = [
  { label: 'Hoy', dias: 0 },
  { label: '7 dias', dias: 6 },
  { label: '30 dias', dias: 29 },
];

const ICONO = { sube: TrendingUp, baja: TrendingDown, igual: Minus } as const;

// testId: gancho estable para la suite E2E (e2e/tests/hu4-*).
function StatTile({
  titulo,
  valor,
  detalle,
  comparacion,
  destacado,
  testId,
}: {
  titulo: string;
  valor: string;
  detalle: string;
  comparacion?: Comparacion;
  destacado?: boolean;
  testId: string;
}) {
  const Icono = comparacion?.direccion ? ICONO[comparacion.direccion] : null;
  return (
    <Card data-testid={testId}>
      <CardContent>
        <p className="text-sm text-muted-foreground">{titulo}</p>
        <p
          data-testid={`${testId}-valor`}
          className={`font-heading text-3xl font-semibold ${
            // marca-texto y no primary: el #ea580c como texto sobre la
            // tarjeta no llega a 4.5:1.
            destacado ? 'text-marca-texto' : 'text-foreground'
          }`}
        >
          {valor}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{detalle}</p>
        {comparacion && (
          // Flecha + texto, sin verde/rojo: el cambio se describe, no se
          // juzga (ver comparar()), y no depende del color.
          <p data-testid={`${testId}-comparacion`} className="mt-2 flex items-start gap-1 text-xs text-foreground">
            {Icono && <Icono className="mt-px size-3.5 shrink-0" aria-hidden />}
            {comparacion.texto}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Dashboard de indicadores (Sprint 18).
 *
 * - Admin: el taller entero, o un tecnico elegido.
 * - Tecnico: "Mis indicadores", siempre los suyos (lo fuerza el backend).
 * - Cliente: no llega aca (no esta en su navegacion; el backend da 403).
 */
export function DashboardView() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';
  const [from, setFrom] = useState(() => sumarDiasISO(hoyISO(), -6));
  const [to, setTo] = useState(hoyISO);
  const [tecnicoId, setTecnicoId] = useState('');
  const [verTabla, setVerTabla] = useState(false);

  const tecnicos = useTecnicosQuery(esAdmin);
  const { data, isPending, isFetching, isError, error, refetch } = useKpisQuery(
    from,
    to,
    esAdmin && tecnicoId ? tecnicoId : undefined,
  );

  // El backend tambien valida esto (400), pero atajarlo aca evita un viaje
  // garantizado a fallar mientras se escribe la fecha.
  const rangoInvalido = from > to;
  const hoy = hoyISO();

  function aplicarPreset(dias: number) {
    setFrom(sumarDiasISO(hoyISO(), -dias));
    setTo(hoyISO());
  }

  const nombreTecnico = esAdmin
    ? (tecnicos.data?.find((t) => t.id === tecnicoId)?.nombre ?? 'Todo el taller')
    : (usuario?.email ?? '');
  const resumen = data?.resumen;
  const previo = data?.anterior.resumen;
  const periodo = data ? nombrePeriodoAnterior(data.rango.from, data.rango.to, hoy) : '';
  const medicionParcial = resumen !== undefined && resumen.turnosMedidos < resumen.turnosAtendidos;
  const titulo = esAdmin ? 'Dashboard de indicadores' : 'Mis indicadores';
  const tituloTabla = data
    ? `Detalle diario del ${formatearDiaMes(data.rango.from)} al ${formatearDiaMes(data.rango.to)} (${nombreTecnico})`
    : '';

  function exportar() {
    if (!data) return;
    const sufijo = esAdmin && tecnicoId ? `-${nombreTecnico.replace(/\W+/g, '_')}` : '';
    descargarCsv(`kpis_${data.rango.from}_${data.rango.to}${sufijo}.csv`, aCsv(filasCsv(data, nombreTecnico)));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{titulo}</h1>
          <p className="text-sm text-muted-foreground">
            {esAdmin ? 'KPIs operativos del periodo' : 'Tus turnos del periodo'} · dias en hora del
            taller ({ZONA_NEGOCIO})
          </p>
        </div>
        <IndicadorActualizando activo={isFetching && !isPending} />
      </header>

      <Card>
        <CardContent className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Desde
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="sm:w-40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Hasta
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="sm:w-40" />
          </label>
          {esAdmin && (
            <label className="col-span-2 flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-1">
              Tecnico
              <select
                value={tecnicoId}
                onChange={(e) => setTecnicoId(e.target.value)}
                disabled={tecnicos.isPending || tecnicos.isError}
                className="h-8 rounded-lg border border-input bg-card px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 sm:w-48 dark:bg-input/30"
              >
                <option value="">Todo el taller</option>
                {(tecnicos.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div role="group" aria-label="Rangos rapidos" className="col-span-2 flex gap-2">
            {PRESETS.map((preset) => {
              const activo = to === hoy && from === sumarDiasISO(hoy, -preset.dias);
              return (
                <Button
                  key={preset.label}
                  variant={activo ? 'secondary' : 'outline'}
                  size="sm"
                  aria-pressed={activo}
                  onClick={() => aplicarPreset(preset.dias)}
                >
                  {preset.label}
                </Button>
              );
            })}
          </div>
          <div className="col-span-2 flex gap-2 sm:ml-auto">
            <Button variant="ghost" size="sm" onClick={() => setVerTabla((v) => !v)}>
              {verTabla ? 'Ver graficos' : 'Ver tabla'}
            </Button>
            <Button variant="outline" size="sm" onClick={exportar} disabled={!data || rangoInvalido}>
              <Download aria-hidden />
              Exportar CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {rangoInvalido ? (
        <p
          role="alert"
          className="rounded-lg border border-advertencia/40 bg-advertencia-suave p-3 text-sm text-advertencia-texto"
        >
          El rango es invalido: «desde» es posterior a «hasta».
        </p>
      ) : isError ? (
        <EstadoError error={error} onReintentar={refetch} />
      ) : isPending || !resumen || !previo ? (
        <div className="space-y-4">
          <EstadoCargando forma="tarjetas" etiqueta="Cargando indicadores…" />
          <EstadoCargando forma="bloque" etiqueta="" />
        </div>
      ) : (
        <div className={`space-y-4 ${isFetching ? 'opacity-60' : ''}`}>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile
              titulo="Tasa de asistencia"
              testId="kpi-tasa-asistencia"
              valor={formatearPorcentaje(resumen.tasaAsistencia)}
              detalle={`${resumen.turnosAtendidos} atendidos · ${resumen.turnosNoAsistio} no asistio`}
              comparacion={comparar('tasa', resumen.tasaAsistencia, previo.tasaAsistencia, periodo)}
            />
            <StatTile
              titulo="Tiempo prom. servicio"
              testId="kpi-tiempo-promedio"
              valor={formatearMinutos(resumen.minutosPromedioServicio)}
              detalle={`sobre ${resumen.turnosMedidos} turnos medidos`}
              comparacion={comparar('minutos', resumen.minutosPromedioServicio, previo.minutosPromedioServicio, periodo)}
              destacado
            />
            <StatTile
              titulo="Turnos en el periodo"
              testId="kpi-turnos-totales"
              valor={String(resumen.turnosTotales)}
              detalle={`${resumen.turnosProgramados} sin cerrar · ${resumen.turnosCancelados} cancelados`}
              comparacion={comparar('cantidad', resumen.turnosTotales, previo.turnosTotales, periodo)}
            />
          </div>

          {medicionParcial && (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              El tiempo promedio se calculo sobre {resumen.turnosMedidos} de {resumen.turnosAtendidos}{' '}
              turnos atendidos: el resto se cerro sin registrar las horas reales de atencion.
            </p>
          )}

          {resumen.turnosTotales === 0 ? (
            // Antes: tres graficos con los ejes vacios. Un periodo sin
            // turnos se dice, no se dibuja.
            <EstadoVacio
              icono={ChartColumn}
              titulo="Sin turnos en este periodo"
              descripcion={`Entre el ${formatearDiaMes(data.rango.from)} y el ${formatearDiaMes(
                data.rango.to,
              )} no hay turnos ${esAdmin && !tecnicoId ? 'en el taller' : 'asignados'}. Proba con un rango mas amplio.`}
              accion={
                diasDelRango(from, to) < 30 ? (
                  <Button variant="outline" size="sm" onClick={() => aplicarPreset(29)}>
                    Ver los ultimos 30 dias
                  </Button>
                ) : undefined
              }
            />
          ) : verTabla ? (
            <Card>
              <CardHeader>
                <CardTitle className="font-heading text-base">Detalle diario</CardTitle>
              </CardHeader>
              <CardContent>
                <TablaKpis serie={data.serie} resumen={resumen} titulo={tituloTabla} />
              </CardContent>
            </Card>
          ) : (
            <GraficosKpis serie={data.serie} />
          )}
        </div>
      )}
    </div>
  );
}
