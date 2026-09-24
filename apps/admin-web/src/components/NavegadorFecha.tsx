import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IndicadorActualizando } from '@/components/estados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { hoyISO, sumarDiasISO } from '@/lib/dates';

/**
 * Anterior / Hoy / Siguiente + la fecha visible (hallazgo 4 de
 * UX-NOTES.md). "Hoy" se deshabilita cuando ya se esta en hoy: sigue en el
 * mismo lugar para que la fila no cambie de ancho, pero deja claro que no
 * hace nada. Comun a la agenda y al panel de carga.
 */
export function NavegadorFecha({
  fecha,
  onCambiar,
  actualizando = false,
}: {
  fecha: string;
  onCambiar: (fecha: string) => void;
  actualizando?: boolean;
}) {
  const hoy = hoyISO();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCambiar(sumarDiasISO(fecha, -1))}
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
          Hoy
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCambiar(sumarDiasISO(fecha, 1))}
        >
          Siguiente
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <Badge variant="secondary" className="font-mono">
        {fecha}
      </Badge>
      <IndicadorActualizando activo={actualizando} />
    </div>
  );
}
