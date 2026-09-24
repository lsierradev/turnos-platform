import type { CargaResponse } from '@/lib/api-client';
import { formatearDiaCorto, hoyISO } from '@/lib/dates';
import { NIVEL, porcentaje } from './niveles';

/**
 * Semana: bahias x dias. Cada celda es un boton que abre ese dia. El nivel
 * se lee por tono de fondo + icono (alta / completa) + el porcentaje
 * escrito; nunca solo por color.
 *
 * En celular no entra una tabla de 8 columnas: se muestra una fila por
 * bahia con 7 celdas compactas (dia + %).
 */
export function MatrizSemanal({
  carga,
  onElegirDia,
}: {
  carga: CargaResponse;
  onElegirDia: (fecha: string) => void;
}) {
  const hoy = hoyISO();
  const dias = carga.resumen.map((r) => r.fecha);

  const Celda = ({ fecha, bahia }: { fecha: string; bahia: CargaResponse['bahias'][number] }) => {
    const d = bahia.dias.find((x) => x.fecha === fecha)!;
    const nivel = NIVEL[d.nivel];
    const Icono = nivel.icono;
    const alerta = d.nivel === 'alta' || d.nivel === 'completa';
    return (
      <button
        type="button"
        onClick={() => onElegirDia(fecha)}
        aria-label={`${bahia.nombre}, ${formatearDiaCorto(fecha)}: ${porcentaje(d.ocupacion)}, ${d.turnos} turnos, ${nivel.etiqueta}. Ver el dia`}
        // Celular: icono ARRIBA del numero y texto chico. En linea, a ~48px de
        // ancho por celda, "100%" se comia el icono y la alerta quedaba solo
        // en el color.
        className={`flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-md border text-xs font-medium tabular-nums transition-colors hover:border-primary/60 md:h-11 md:flex-row md:gap-1 md:text-sm ${nivel.suave} ${nivel.borde} ${
          d.nivel === 'libre' ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        {alerta && <Icono className={`size-3.5 shrink-0 ${nivel.texto}`} aria-hidden />}
        {d.nivel === 'libre' ? '—' : porcentaje(d.ocupacion)}
      </button>
    );
  };

  return (
    <>
      {/* Escritorio */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="w-32 text-left text-xs font-medium text-muted-foreground">
                Bahia
              </th>
              {dias.map((f) => (
                <th
                  key={f}
                  scope="col"
                  className={`text-center text-xs font-semibold first-letter:uppercase ${
                    f === hoy ? 'text-marca-texto' : 'text-muted-foreground'
                  }`}
                >
                  {formatearDiaCorto(f)}
                  {f === hoy && <span className="font-normal"> · hoy</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {carga.bahias.map((b) => (
              <tr key={b.bahiaId}>
                <th scope="row" className="truncate text-left text-sm font-medium">
                  {b.nombre}
                </th>
                {dias.map((f) => (
                  <td key={f}>
                    <Celda fecha={f} bahia={b} />
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" className="pt-1 text-left text-xs font-medium text-muted-foreground">
                Taller
              </th>
              {carga.resumen.map((r) => (
                <td
                  key={r.fecha}
                  className="pt-1 text-center text-xs text-muted-foreground tabular-nums"
                >
                  {porcentaje(r.ocupacion)}
                  {r.bahiasEnAlerta > 0 && (
                    <span className="block text-advertencia-texto">
                      {r.bahiasEnAlerta} en alerta
                    </span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Celular */}
      <ul className="space-y-3 md:hidden">
        {carga.bahias.map((b) => (
          <li key={b.bahiaId} className="space-y-1.5">
            <p className="text-sm font-medium">{b.nombre}</p>
            <div className="grid grid-cols-7 gap-1">
              {dias.map((f) => (
                <div key={f} className="space-y-0.5 text-center">
                  <span
                    className={`block text-[10px] first-letter:uppercase ${
                      f === hoy ? 'font-semibold text-marca-texto' : 'text-muted-foreground'
                    }`}
                  >
                    {formatearDiaCorto(f).split(' ')[0]}
                  </span>
                  <Celda fecha={f} bahia={b} />
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
