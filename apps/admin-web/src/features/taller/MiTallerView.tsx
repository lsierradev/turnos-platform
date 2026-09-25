import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTaller } from '@/lib/taller';
import { BahiasSeccion } from './BahiasSeccion';
import { FiscalSeccion } from './FiscalSeccion';
import { HorarioSeccion } from './HorarioSeccion';
import { ServiciosSeccion } from './ServiciosSeccion';
import { TecnicosSeccion } from './TecnicosSeccion';

const SECCIONES = [
  { id: 'servicios', titulo: 'Servicios y precios' },
  { id: 'bahias', titulo: 'Bahias' },
  { id: 'tecnicos', titulo: 'Tecnicos' },
  { id: 'horario', titulo: 'Horario y festivos' },
  { id: 'fiscal', titulo: 'Datos fiscales y pagos' },
] as const;

type Seccion = (typeof SECCIONES)[number]['id'];

/**
 * Mi taller (Sprint 21, admin): catalogo, horario y configuracion fiscal.
 * La seccion va en la URL (?seccion=), como la vista del panel, para que
 * se pueda volver o compartir el enlace. Son enlaces con aria-current, no
 * pestanas ARIA: cada una es una "pagina" dentro de Mi taller.
 */
export function MiTallerView() {
  const [params] = useSearchParams();
  const { taller } = useTaller();
  const pedida = params.get('seccion');
  const seccion: Seccion = SECCIONES.some((s) => s.id === pedida) ? (pedida as Seccion) : 'servicios';
  // En celular la barra de secciones se desplaza: la activa tiene que quedar a la vista.
  const activa = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const mostrar = () =>
      activa.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    mostrar();
    // Otra vez con la fuente web cargada: cambia el ancho de cada enlace y,
    // con eso, cuanto hay que desplazar.
    void document.fonts?.ready.then(mostrar);
  }, [seccion]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Mi taller</h1>
        <p className="text-sm text-muted-foreground">
          {taller ? `${taller.nombre} · ` : ''}Catalogo, horario y configuracion fiscal.
        </p>
      </div>

      <nav aria-label="Secciones de Mi taller" className="-mx-1 overflow-x-auto">
        <ul className="flex gap-1 px-1 pb-1">
          {SECCIONES.map((s) => (
            <li key={s.id}>
              <Link
                to={s.id === 'servicios' ? '/taller' : `/taller?seccion=${s.id}`}
                ref={seccion === s.id ? activa : undefined}
                aria-current={seccion === s.id ? 'page' : undefined}
                className={`block rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  seccion === s.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {s.titulo}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {seccion === 'servicios' && <ServiciosSeccion />}
      {seccion === 'bahias' && <BahiasSeccion />}
      {seccion === 'tecnicos' && <TecnicosSeccion />}
      {seccion === 'horario' && <HorarioSeccion />}
      {seccion === 'fiscal' && <FiscalSeccion />}
    </div>
  );
}
