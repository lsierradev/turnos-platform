import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { KpiDia, KpisResumen } from '@/lib/api-client';
import { formatearDiaMes, hoyISO, sumarDiasISO } from '@/lib/dates';
import { useKpisQuery } from './useKpisQuery';

// Los colores de serie salen de los tokens del tema (index.css), no de hex
// sueltos aca: son los pasos ya validados para cada superficie, y asi el
// modo oscuro cambia solo. SVG acepta var() en fill/stroke.
const COLOR_ATENDIDOS = 'var(--chart-1)';
const COLOR_NO_ASISTIO = 'var(--chart-2)';
const COLOR_EJE = 'var(--muted-foreground)';
const COLOR_GRILLA = 'var(--border)';

const PRESETS = [
  { label: 'Hoy', dias: 0 },
  { label: '7 dias', dias: 6 },
  { label: '30 dias', dias: 29 },
];

function formatearPorcentaje(valor: number | null): string {
  return valor === null ? '—' : `${Math.round(valor * 100)}%`;
}

// El grafico de tasa trabaja en 0-100 (ver tasaAsistenciaPct), asi que su
// tooltip necesita su propio formateador: pasarle formatearPorcentaje, que
// espera 0-1, mostraria 8000% en vez de 80%.
function formatearPorcentajeDesde100(valor: number | null): string {
  return valor === null ? '—' : `${Math.round(valor)}%`;
}

function formatearMinutos(valor: number | null): string {
  return valor === null ? '—' : `${valor} min`;
}

interface FilaGrafico extends KpiDia {
  etiqueta: string;
  tasaAsistenciaPct: number | null;
}

function TooltipKpi({
  active,
  payload,
  label,
  formatear,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | null; color?: string }>;
  label?: string;
  formatear: (valor: number | null) => string;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-md bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10">
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((serie) => (
        <p key={serie.name} className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ backgroundColor: serie.color }}
          />
          <span className="text-muted-foreground">{serie.name}:</span>
          <span className="font-medium">
            {formatear(serie.value ?? null)}
          </span>
        </p>
      ))}
    </div>
  );
}

// testId: gancho estable para la suite E2E (e2e/tests/hu4-*). Sin el, los
// tests tendrian que localizar los KPIs por su texto visible, y cualquier
// retoque de copy los romperia sin que nada haya dejado de funcionar.
function StatTile({
  titulo,
  valor,
  detalle,
  destacado,
  testId,
}: {
  titulo: string;
  valor: string;
  detalle: string;
  destacado?: boolean;
  testId: string;
}) {
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
      </CardContent>
    </Card>
  );
}

function TablaKpis({ serie }: { serie: FilaGrafico[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Dia</TableHead>
          <TableHead className="text-right">Atendidos</TableHead>
          <TableHead className="text-right">No asistio</TableHead>
          <TableHead className="text-right">Tasa</TableHead>
          <TableHead className="text-right">Tiempo prom.</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {serie.map((dia) => (
          <TableRow key={dia.fecha}>
            <TableCell className="font-mono text-xs">{dia.fecha}</TableCell>
            <TableCell className="text-right">{dia.atendidos}</TableCell>
            <TableCell className="text-right">{dia.noAsistio}</TableCell>
            <TableCell className="text-right">
              {formatearPorcentaje(dia.tasaAsistencia)}
            </TableCell>
            <TableCell className="text-right">
              {formatearMinutos(dia.minutosPromedioServicio)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function DashboardView() {
  const [from, setFrom] = useState(() => sumarDiasISO(hoyISO(), -6));
  const [to, setTo] = useState(hoyISO);
  const [verTabla, setVerTabla] = useState(false);

  const { data, isPending, isFetching, isError, error, refetch } = useKpisQuery(
    from,
    to,
  );

  // El backend tambien valida esto (400), pero atajarlo aca evita un viaje
  // garantizado a fallar cada vez que el admin escribe la fecha "desde"
  // pasando por un valor mayor que "hasta".
  const rangoInvalido = from > to;

  function aplicarPreset(dias: number) {
    const hoy = hoyISO();
    setFrom(sumarDiasISO(hoy, -dias));
    setTo(hoy);
  }

  const serie: FilaGrafico[] = (data?.serie ?? []).map((dia) => ({
    ...dia,
    etiqueta: formatearDiaMes(dia.fecha),
    // Recharts dibuja el eje en la unidad que recibe: se pasa a 0-100 aca
    // para no tener que formatear el eje, el tooltip y la grilla por
    // separado. null se mantiene null -- ver connectNulls abajo.
    tasaAsistenciaPct:
      dia.tasaAsistencia === null ? null : dia.tasaAsistencia * 100,
  }));

  const resumen: KpisResumen | undefined = data?.resumen;
  const medicionParcial =
    resumen !== undefined && resumen.turnosMedidos < resumen.turnosAtendidos;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">
            Dashboard de indicadores
          </h1>
          <p className="text-sm text-muted-foreground">
            KPIs operativos del periodo seleccionado
          </p>
        </div>
        {isFetching && !isPending && (
          <Badge variant="secondary">Actualizando…</Badge>
        )}
      </header>

      {/* Filtros en una sola fila arriba de los graficos. */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Desde
            <Input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="w-40"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Hasta
            <Input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="w-40"
            />
          </label>
          <div className="flex gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="outline"
                size="sm"
                onClick={() => aplicarPreset(preset.dias)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setVerTabla((v) => !v)}
          >
            {verTabla ? 'Ver graficos' : 'Ver tabla'}
          </Button>
        </CardContent>
      </Card>

      {rangoInvalido ? (
        <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          El rango es invalido: «desde» es posterior a «hasta».
        </p>
      ) : isError ? (
        <div className="space-y-2 rounded-md border border-destructive/40 p-3">
          <p className="text-sm text-destructive">{error.message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Reintentar
          </Button>
        </div>
      ) : isPending ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <div className={`space-y-4 ${isFetching ? 'opacity-60' : ''}`}>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile
              titulo="Tasa de asistencia"
              testId="kpi-tasa-asistencia"
              valor={formatearPorcentaje(resumen?.tasaAsistencia ?? null)}
              detalle={`${resumen?.turnosAtendidos ?? 0} atendidos · ${
                resumen?.turnosNoAsistio ?? 0
              } no asistio`}
            />
            <StatTile
              titulo="Tiempo prom. servicio"
              testId="kpi-tiempo-promedio"
              valor={formatearMinutos(
                resumen?.minutosPromedioServicio ?? null,
              )}
              detalle={`sobre ${resumen?.turnosMedidos ?? 0} turnos medidos`}
              destacado
            />
            <StatTile
              titulo="Turnos en el periodo"
              testId="kpi-turnos-totales"
              valor={String(resumen?.turnosTotales ?? 0)}
              detalle={`${resumen?.turnosProgramados ?? 0} sin cerrar · ${
                resumen?.turnosCancelados ?? 0
              } cancelados`}
            />
          </div>

          {medicionParcial && (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              El tiempo promedio se calculo sobre {resumen?.turnosMedidos} de{' '}
              {resumen?.turnosAtendidos} turnos atendidos: el resto se cerro
              sin registrar las horas reales de atencion.
            </p>
          )}

          {verTabla ? (
            <Card>
              <CardHeader>
                <CardTitle className="font-heading text-base">
                  Detalle diario
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TablaKpis serie={serie} />
              </CardContent>
            </Card>
          ) : (
            <>
              {/*
                Un grafico por medida y nunca dos ejes Y en el mismo: un
                porcentaje y una cantidad de minutos no comparten escala, y
                superponerlos deja que la elección de escalas invente
                correlaciones que los datos no tienen.
              */}
              <Card>
                <CardHeader>
                  <CardTitle className="font-heading text-base">
                    Tasa de asistencia por dia
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={serie} accessibilityLayer>
                      <CartesianGrid
                        stroke={COLOR_GRILLA}
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="etiqueta"
                        stroke={COLOR_EJE}
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                      />
                      <YAxis
                        domain={[0, 100]}
                        unit="%"
                        stroke={COLOR_EJE}
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                        width={44}
                      />
                      <Tooltip
                        content={
                          <TooltipKpi formatear={formatearPorcentajeDesde100} />
                        }
                      />
                      <Line
                        name="Tasa de asistencia"
                        type="monotone"
                        dataKey="tasaAsistenciaPct"
                        stroke={COLOR_ATENDIDOS}
                        strokeWidth={2}
                        dot={{ r: 4, strokeWidth: 0, fill: COLOR_ATENDIDOS }}
                        activeDot={{ r: 6 }}
                        // Un dia sin turnos cerrados no es 0%: es un hueco.
                        // Unir la linea por encima dibujaria una asistencia
                        // que nunca se midio.
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="font-heading text-base">
                    Tiempo promedio de servicio por dia
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={serie} accessibilityLayer>
                      <CartesianGrid
                        stroke={COLOR_GRILLA}
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="etiqueta"
                        stroke={COLOR_EJE}
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                      />
                      <YAxis
                        unit=" min"
                        stroke={COLOR_EJE}
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                        width={60}
                      />
                      <Tooltip
                        content={<TooltipKpi formatear={formatearMinutos} />}
                      />
                      <Line
                        name="Tiempo prom. servicio"
                        type="monotone"
                        dataKey="minutosPromedioServicio"
                        stroke={COLOR_NO_ASISTIO}
                        strokeWidth={2}
                        dot={{ r: 4, strokeWidth: 0, fill: COLOR_NO_ASISTIO }}
                        activeDot={{ r: 6 }}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="font-heading text-base">
                    Turnos cerrados por dia
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={serie} accessibilityLayer>
                      <CartesianGrid
                        stroke={COLOR_GRILLA}
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="etiqueta"
                        stroke={COLOR_EJE}
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                      />
                      <YAxis
                        allowDecimals={false}
                        stroke={COLOR_EJE}
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                        width={36}
                      />
                      <Tooltip
                        cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                        content={<TooltipKpi formatear={String} />}
                      />
                      <Legend
                        iconType="circle"
                        wrapperStyle={{ fontSize: 12 }}
                        // Recharts pinta el texto con el color de la serie:
                        // el naranja de chart-1 como texto sobre la tarjeta
                        // no llega a 4.5:1. El punto ya identifica la serie.
                        formatter={(valor) => (
                          <span className="text-foreground">{valor}</span>
                        )}
                      />
                      {/*
                        El stroke del color de la tarjeta es el separador de
                        2px entre segmentos apilados: sin el, dos tramos
                        contiguos se leen como un solo bloque.
                      */}
                      <Bar
                        name="Atendidos"
                        dataKey="atendidos"
                        stackId="turnos"
                        fill={COLOR_ATENDIDOS}
                        stroke="var(--card)"
                        strokeWidth={2}
                      />
                      <Bar
                        name="No asistio"
                        dataKey="noAsistio"
                        stackId="turnos"
                        fill={COLOR_NO_ASISTIO}
                        stroke="var(--card)"
                        strokeWidth={2}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
