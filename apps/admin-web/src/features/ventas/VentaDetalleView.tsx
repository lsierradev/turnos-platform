import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { EstadoError } from '@/components/estados';
import { buttonVariants } from '@/components/ui/button';
import { esUuid } from '@/lib/uuid';
import { VentaDetalle } from './VentaDetalle';

/** Pagina standalone de una orden de venta (Sprint 26): /ventas/:id. */
export function VentaDetalleView() {
  const { ordenId } = useParams<{ ordenId: string }>();
  const valido = esUuid(ordenId);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6 print:max-w-none print:p-0">
      <Link to="/ventas" className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} print:hidden`}>
        <ArrowLeft aria-hidden /> Volver
      </Link>
      {!valido ? (
        <EstadoError error={new Error('La direccion no tiene un id de orden valido.')} />
      ) : (
        <VentaDetalle ordenId={ordenId} />
      )}
    </div>
  );
}
