import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Check, Search, UserRound } from 'lucide-react';
import { EstadoVacio } from '@/components/estados';
import type { Tecnico } from '@/lib/api-client';

// "Jose" encuentra a "José", "MARIA" a "María": en un taller nadie tipea
// tildes buscando rapido.
const normalizar = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * Lista de tecnicos con busqueda por nombre o email (patron combobox:
 * el foco queda en el input y las flechas mueven la opcion activa, que se
 * anuncia con aria-activedescendant).
 */
export function BuscadorTecnicos({
  tecnicos,
  onElegir,
  seleccionadoId,
  autoFocus = false,
  alto = 'max-h-80',
}: {
  tecnicos: Tecnico[];
  onElegir: (tecnico: Tecnico) => void;
  seleccionadoId?: string;
  autoFocus?: boolean;
  alto?: string;
}) {
  const [texto, setTexto] = useState('');
  const [activo, setActivo] = useState(0);
  const idLista = useId();

  const filtrados = useMemo(() => {
    const q = normalizar(texto.trim());
    const ordenados = [...tecnicos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    if (!q) return ordenados;
    return ordenados.filter(
      (t) => normalizar(t.nombre).includes(q) || normalizar(t.email).includes(q),
    );
  }, [tecnicos, texto]);

  const indice = Math.min(activo, Math.max(filtrados.length - 1, 0));
  const idOpcion = (i: number) => `${idLista}-${i}`;

  function alTeclear(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActivo((i) => Math.min(i + 1, filtrados.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActivo((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtrados[indice]) {
      e.preventDefault();
      onElegir(filtrados[indice]);
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={idLista}
          aria-activedescendant={filtrados.length ? idOpcion(indice) : undefined}
          aria-autocomplete="list"
          aria-label="Buscar tecnico por nombre o email"
          placeholder="Buscar por nombre o email…"
          autoFocus={autoFocus}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setActivo(0);
          }}
          onKeyDown={alTeclear}
          className="h-9 w-full rounded-lg border border-input bg-transparent pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      {filtrados.length === 0 ? (
        <EstadoVacio
          icono={Search}
          titulo={`Ningun tecnico coincide con “${texto}”`}
          descripcion="Proba con otra parte del nombre o del email."
        />
      ) : (
        <ul
          id={idLista}
          role="listbox"
          aria-label="Tecnicos"
          className={`${alto} divide-y overflow-y-auto rounded-lg border`}
        >
          {filtrados.map((t, i) => {
            const elegido = t.id === seleccionadoId;
            return (
              <li
                key={t.id}
                id={idOpcion(i)}
                role="option"
                aria-selected={elegido}
                onMouseEnter={() => setActivo(i)}
                onClick={() => onElegir(t)}
                className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 ${
                  i === indice ? 'bg-muted' : ''
                }`}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <UserRound className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.nombre}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t.email}
                  </span>
                </span>
                {elegido && <Check className="size-4 text-marca-texto" aria-hidden />}
              </li>
            );
          })}
        </ul>
      )}
      <p className="sr-only" aria-live="polite">
        {filtrados.length} tecnico{filtrados.length === 1 ? '' : 's'}
      </p>
    </div>
  );
}
