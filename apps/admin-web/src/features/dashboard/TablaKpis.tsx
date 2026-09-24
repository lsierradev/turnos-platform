import { useId } from 'react';
import type { KpiDia, KpisResumen } from '@/lib/api-client';
import { formatearDiaCorto } from '@/lib/dates';
import { formatearMinutos, formatearPorcentaje } from './kpis';

/** "—" visible y "sin datos" para el lector de pantalla. */
function Valor({ texto }: { texto: string }) {
  if (texto !== '—') return <>{texto}</>;
  return (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">sin datos</span>
    </>
  );
}

const num = 'px-3 py-2 text-right tabular-nums';

/**
 * Tabla accesible (Sprint 18): caption, encabezados de columna Y de fila
 * (el dia), totales en <tfoot> y el contenedor con scroll alcanzable por
 * teclado. Es la alternativa a los graficos, no un adorno: lo que no se
 * puede leer en un SVG tiene que poder leerse aca.
 */
export function TablaKpis({
  serie,
  resumen,
  titulo,
}: {
  serie: KpiDia[];
  resumen: KpisResumen;
  titulo: string;
}) {
  const idCaption = useId();
  return (
    <div
      // Scroll horizontal en el celular: con tabIndex el teclado puede
      // llegar y desplazarlo, y el nombre dice que es.
      className="w-full overflow-x-auto rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      tabIndex={0}
      role="region"
      aria-labelledby={idCaption}
    >
      <table className="w-full min-w-[40rem] text-sm">
        <caption id={idCaption} className="mb-2 text-left text-sm text-muted-foreground">
          {titulo}
        </caption>
        <thead>
          <tr className="border-b text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-left font-medium">Dia</th>
            <th scope="col" className={`${num} font-medium`}>Atendidos</th>
            <th scope="col" className={`${num} font-medium`}>No asistio</th>
            <th scope="col" className={`${num} font-medium`}>Cancelados</th>
            <th scope="col" className={`${num} font-medium`}>Sin cerrar</th>
            <th scope="col" className={`${num} font-medium`}>Asistencia</th>
            <th scope="col" className={`${num} font-medium`}>Tiempo prom.</th>
          </tr>
        </thead>
        <tbody>
          {serie.map((d) => (
            <tr key={d.fecha} className="border-b last:border-0 hover:bg-muted/50">
              <th scope="row" className="px-3 py-2 text-left font-normal">
                <time dateTime={d.fecha} className="font-mono text-xs">{d.fecha}</time>
                <span className="ml-2 text-xs text-muted-foreground">
                  {formatearDiaCorto(d.fecha)}
                </span>
              </th>
              <td className={num}>{d.atendidos}</td>
              <td className={num}>{d.noAsistio}</td>
              <td className={num}>{d.cancelados}</td>
              <td className={num}>{d.programados}</td>
              <td className={num}><Valor texto={formatearPorcentaje(d.tasaAsistencia)} /></td>
              <td className={num}><Valor texto={formatearMinutos(d.minutosPromedioServicio)} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            <th scope="row" className="px-3 py-2 text-left">Total del periodo</th>
            <td className={num}>{resumen.turnosAtendidos}</td>
            <td className={num}>{resumen.turnosNoAsistio}</td>
            <td className={num}>{resumen.turnosCancelados}</td>
            <td className={num}>{resumen.turnosProgramados}</td>
            <td className={num}><Valor texto={formatearPorcentaje(resumen.tasaAsistencia)} /></td>
            <td className={num}><Valor texto={formatearMinutos(resumen.minutosPromedioServicio)} /></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
