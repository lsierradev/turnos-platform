import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IndicadorActualizando } from '@/components/estados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { hoyISO, sumarDiasISO } from '@/lib/dates';

/**
 * Anterior / Hoy / Siguiente + la fecha visible (hallazgo 4 de
 * UX-NOTES.md). "Hoy" se deshabilita cuando ya se esta en hoy: sigue en el
 * mismo lugar para que la fila no cambie de ancho, pero deja claro que no
 * hace nada. Comun a la agenda (dia y semana) y al panel de carga.
 *
 * Para la semana: `paso` 7, `hoy` = lunes de esta semana y `etiquetaHoy`
 * "Esta semana".
 *
 * `minimo`: primer dia navegable (la reserva no va hacia el pasado).
 */
export function NavegadorFecha({
  fecha,
  onCambiar,
  actualizando = false,
  paso = 1,
  hoy = hoyISO(),
  etiquetaHoy = 'Hoy',
  etiqueta = fecha,
  minimo,
}: {
  fecha: string;
  onCambiar: (fecha: string) => void;
  actualizando?: boolean;
  paso?: number;
  hoy?: string;
  etiquetaHoy?: string;
  etiqueta?: string;
  minimo?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={minimo !== undefined && sumarDiasISO(fecha, -paso) < minimo}
          onClick={() => onCambiar(sumarDiasISO(fecha, -paso))}
        >
          <ChevronLeft aria-hidden />
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={fecha === hoy}
          onClick={() => onCambiar(hoy)}
        >
          {etiquetaHoy}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCambiar(sumarDiasISO(fecha, paso))}
        >
          Siguiente
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <Badge variant="secondary" className="font-mono">
        {etiqueta}
      </Badge>
      <IndicadorActualizando activo={actualizando} />
    </div>
  );
}
