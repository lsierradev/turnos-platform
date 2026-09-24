import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTema, type PreferenciaTema } from '@/lib/tema';

const SIGUIENTE: Record<PreferenciaTema, PreferenciaTema> = {
  claro: 'oscuro',
  oscuro: 'sistema',
  sistema: 'claro',
};

const ETIQUETA: Record<PreferenciaTema, string> = {
  claro: 'Tema claro',
  oscuro: 'Tema oscuro',
  sistema: 'Tema del sistema',
};

const ICONO = { claro: Sun, oscuro: Moon, sistema: Monitor };

/** Un boton que rota claro -> oscuro -> sistema. */
export function SelectorTema() {
  const { preferencia, setPreferencia } = useTema();
  const Icono = ICONO[preferencia];
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setPreferencia(SIGUIENTE[preferencia])}
      aria-label={`${ETIQUETA[preferencia]} (cambiar a ${ETIQUETA[SIGUIENTE[preferencia]].toLowerCase()})`}
      title={ETIQUETA[preferencia]}
    >
      <Icono />
    </Button>
  );
}
