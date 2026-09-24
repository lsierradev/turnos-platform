import { SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EstadoVacio } from '@/components/estados';
import { buttonVariants } from '@/components/ui/button';

/** Cualquier ruta que no existe. Antes quedaba en blanco. */
export function NoEncontradoView() {
  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <EstadoVacio
        icono={SearchX}
        titulo="Esta pagina no existe"
        descripcion="Puede que el enlace este mal escrito o que la seccion se haya movido."
        accion={
          <Link to="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Ir al inicio
          </Link>
        }
      />
    </div>
  );
}
