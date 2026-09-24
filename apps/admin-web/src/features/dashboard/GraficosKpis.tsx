import type { ReactNode } from 'react';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { KpiDia } from '@/lib/api-client';
import { formatearDiaMes, formatearFechaLarga } from '@/lib/dates';
import { usePrefiereMenosMovimiento } from '@/lib/movimiento';
import { formatearMinutos, formatearPorcentaje, hayCierres, hayMediciones } from './kpis';

// Tokens del sistema de diseno (Sprint 13), no hex sueltos: cambian solos en
// modo oscuro y son los pasos ya validados para cada superficie. Naranja y
// azul se distinguen tambien con protanopia; los cancelados van en el
// neutro (chart-5), que es lo que son: turnos que no cuentan para la tasa.
const COLOR = {
  atendidos: 'var(--chart-1)',
  noAsistio: 'var(--chart-2)',
  cancelados: 'var(--chart-5)',
  tasa: 'var(--chart-1)',
  minutos: 'var(--chart-2)',
  eje: 'var(--muted-foreground)',
  grilla: 'var(--border)',
} as const;

interface FilaGrafico extends KpiDia {
  etiqueta: string;
  tasaAsistenciaPct: number | null;
}

type Linea = { color: string; etiqueta: string; valor: string };

/**
 * Tooltip propio: fecha completa (no "24/09") y cada valor con su contexto
 * -- "75% (3 de 4 cerrados)" dice mas que "75" suelto. Recibe la fila entera
 * de Recharts y cada grafico decide que lineas mostrar.
 */
function TooltipDia({
  active,
  payload,
  lineas,
}: {
  active?: boolean;
  payload?: Array<{ payload?: FilaGrafico }>;
  lineas: (fila: FilaGrafico) => Linea[];
}) {
  const fila = payload?.[0]?.payload;
  if (!active || !fila) return null;
  return (
    <div className="max-w-64 rounded-md bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10">
      <p className="mb-1 font-medium first-letter:uppercase">{formatearFechaLarga(fila.fecha)}</p>
      {lineas(fila).map((l) => (
        <p key={l.etiqueta} className="flex items-center gap-2">
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
          <span className="text-muted-foreground">{l.etiqueta}:</span>
          <span className="font-medium">{l.valor}</span>
        </p>
      ))}
    </div>
  );
}

function SinDatos({ children }: { children: ReactNode }) {
  return (
    <p className="flex h-40 items-center justify-center rounded-md border border-dashed px-4 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function TarjetaGrafico({
  titulo,
  resumen,
  children,
}: {
  titulo: string;
  /** Lo que el grafico dice, en texto: para lectores de pantalla. */
  resumen: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-base">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        <figure>
          {children}
          <figcaption className="sr-only">{resumen}</figcaption>
        </figure>
      </CardContent>
    </Card>
  );
}

const ejeX = {
  dataKey: 'etiqueta',
  stroke: COLOR.eje,
  tickLine: false,
  axisLine: false,
  fontSize: 12,
  minTickGap: 12,
} as const;

export function GraficosKpis({ serie }: { serie: KpiDia[] }) {
  // Recharts anima en JS: la regla de prefers-reduced-motion del CSS no lo frena.
  const animar = !usePrefiereMenosMovimiento();
  const filas: FilaGrafico[] = serie.map((d) => ({
    ...d,
    etiqueta: formatearDiaMes(d.fecha),
    tasaAsistenciaPct: d.tasaAsistencia === null ? null : d.tasaAsistencia * 100,
  }));
  const cerrados = serie.reduce((n, d) => n + d.atendidos + d.noAsistio + d.cancelados, 0);
  const sinCerrar = serie.reduce((n, d) => n + d.programados, 0);

  return (
    <>
      {/* Un grafico por medida, nunca dos ejes Y en el mismo: un porcentaje
          y minutos no comparten escala, y superponerlos inventa
          correlaciones que los datos no tienen. */}
      <TarjetaGrafico
        titulo="Tasa de asistencia por dia"
        resumen="Porcentaje de turnos cerrados en los que el cliente asistio, por dia. El detalle esta en la tabla."
      >
        {hayCierres(serie) ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={filas} accessibilityLayer>
              <CartesianGrid stroke={COLOR.grilla} strokeDasharray="3 3" vertical={false} />
              <XAxis {...ejeX} />
              <YAxis domain={[0, 100]} unit="%" stroke={COLOR.eje} tickLine={false} axisLine={false} fontSize={12} width={44} />
              <Tooltip
                content={
                  <TooltipDia
                    lineas={(f) => [
                      {
                        color: COLOR.tasa,
                        etiqueta: 'Asistencia',
                        valor:
                          f.tasaAsistencia === null
                            ? 'sin turnos cerrados'
                            : `${formatearPorcentaje(f.tasaAsistencia)} (${f.atendidos} de ${f.atendidos + f.noAsistio})`,
                      },
                    ]}
                  />
                }
              />
              <Line
                isAnimationActive={animar}
                name="Tasa de asistencia"
                type="monotone"
                dataKey="tasaAsistenciaPct"
                stroke={COLOR.tasa}
                strokeWidth={2}
                dot={{ r: 4, strokeWidth: 0, fill: COLOR.tasa }}
                activeDot={{ r: 6 }}
                // Un dia sin turnos cerrados no es 0%: es un hueco.
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <SinDatos>
            Todavia no hay turnos cerrados (atendidos o sin asistencia) en el periodo: la tasa se
            calcula cuando se cierran.
          </SinDatos>
        )}
      </TarjetaGrafico>

      <TarjetaGrafico
        titulo="Tiempo promedio de servicio por dia"
        resumen="Minutos promedio de atencion de los turnos atendidos con horas registradas, por dia."
      >
        {hayMediciones(serie) ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={filas} accessibilityLayer>
              <CartesianGrid stroke={COLOR.grilla} strokeDasharray="3 3" vertical={false} />
              <XAxis {...ejeX} />
              <YAxis unit=" min" stroke={COLOR.eje} tickLine={false} axisLine={false} fontSize={12} width={60} />
              <Tooltip
                content={
                  <TooltipDia
                    lineas={(f) => [
                      {
                        color: COLOR.minutos,
                        etiqueta: 'Promedio',
                        valor:
                          f.minutosPromedioServicio === null
                            ? 'sin turnos medidos'
                            : `${formatearMinutos(f.minutosPromedioServicio)} (${f.turnosMedidos} ${f.turnosMedidos === 1 ? 'turno' : 'turnos'})`,
                      },
                    ]}
                  />
                }
              />
              <Line
                isAnimationActive={animar}
                name="Tiempo prom. servicio"
                type="monotone"
                dataKey="minutosPromedioServicio"
                stroke={COLOR.minutos}
                strokeWidth={2}
                dot={{ r: 4, strokeWidth: 0, fill: COLOR.minutos }}
                activeDot={{ r: 6 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <SinDatos>
            Ningun turno atendido tiene horas de atencion registradas en el periodo.
          </SinDatos>
        )}
      </TarjetaGrafico>

      <TarjetaGrafico
        titulo="Turnos cerrados por dia"
        resumen="Turnos atendidos, sin asistencia y cancelados por dia, apilados."
      >
        {cerrados > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={filas} accessibilityLayer>
              <CartesianGrid stroke={COLOR.grilla} strokeDasharray="3 3" vertical={false} />
              <XAxis {...ejeX} />
              <YAxis allowDecimals={false} stroke={COLOR.eje} tickLine={false} axisLine={false} fontSize={12} width={36} />
              <Tooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                content={
                  <TooltipDia
                    lineas={(f) => [
                      { color: COLOR.atendidos, etiqueta: 'Atendidos', valor: String(f.atendidos) },
                      { color: COLOR.noAsistio, etiqueta: 'No asistio', valor: String(f.noAsistio) },
                      { color: COLOR.cancelados, etiqueta: 'Cancelados', valor: String(f.cancelados) },
                      ...(f.programados > 0
                        ? [{ color: 'transparent', etiqueta: 'Sin cerrar', valor: String(f.programados) }]
                        : []),
                    ]}
                  />
                }
              />
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: 12 }}
                // Recharts pinta el texto con el color de la serie: el naranja
                // de chart-1 como texto sobre la tarjeta no llega a 4.5:1.
                formatter={(valor) => <span className="text-foreground">{valor}</span>}
              />
              {/* El stroke del color de la tarjeta separa los tramos
                  apilados: sin el, dos contiguos se leen como uno. */}
              <Bar isAnimationActive={animar} name="Atendidos" dataKey="atendidos" stackId="t" fill={COLOR.atendidos} stroke="var(--card)" strokeWidth={2} />
              <Bar isAnimationActive={animar} name="No asistio" dataKey="noAsistio" stackId="t" fill={COLOR.noAsistio} stroke="var(--card)" strokeWidth={2} />
              <Bar
                isAnimationActive={animar}
                name="Cancelados"
                dataKey="cancelados"
                stackId="t"
                fill={COLOR.cancelados}
                stroke="var(--card)"
                strokeWidth={2}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <SinDatos>
            Ningun turno cerrado todavia
            {sinCerrar > 0 ? ` (hay ${sinCerrar} sin cerrar)` : ''}.
          </SinDatos>
        )}
      </TarjetaGrafico>
    </>
  );
}
