import { useMutation, useQuery } from '@tanstack/react-query';
import { LoaderCircle, ShoppingCart } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Aviso } from '@/features/taller/comunes';
import { mensajeError } from '@/features/taller/formulario';
import { crearVenta, getVentas } from '@/lib/api-client';
import { formatearPesos } from '@/lib/dinero';
import { ESTADO_VENTA } from './ventas';

/**
 * Venta de un turno (Sprint 26), en la orden de trabajo: la ultima orden de
 * venta de este turno con su estado y total, con un enlace a la gestion
 * completa (/ventas/:id) donde se arman las lineas, se confirma, se cobra o
 * se anula. Sin orden todavia, el admin puede crear una.
 */
export function VentaOrden({ turnoId, esAdmin }: { turnoId: string; esAdmin: boolean }) {
  const navigate = useNavigate();
  const ventas = useQuery({
    queryKey: ['ventas', 'turno', turnoId],
    queryFn: () => getVentas({ turnoId }),
  });
  const crear = useMutation({
    mutationFn: () => crearVenta({ turnoId }),
    onSuccess: (orden) => navigate(`/ventas/${orden.id}`),
  });

  // Seccion secundaria de la orden de trabajo: si todavia no cargo o fallo
  // no tapa el resto de la pagina con su propio estado de carga o error.
  if (ventas.isPending || ventas.isError) return null;
  const ultima = ventas.data[0] ?? null;
  if (!ultima && !esAdmin) return null;

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <ShoppingCart className="size-4 text-muted-foreground" aria-hidden />
          Venta
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        {ultima ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              <Badge variant={ESTADO_VENTA[ultima.estado].variante}>{ESTADO_VENTA[ultima.estado].texto}</Badge>
              {ultima.totalCentavos !== null && (
                <span className="font-medium tabular-nums">{formatearPesos(ultima.totalCentavos)}</span>
              )}
            </div>
            <Link to={`/ventas/${ultima.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Ver orden de venta
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Todavia no hay una orden de venta para este turno.</p>
            <Button size="sm" disabled={crear.isPending} onClick={() => crear.mutate()}>
              {crear.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              Crear orden de venta
            </Button>
          </>
        )}
      </CardContent>
      {crear.isError && (
        <CardContent className="pt-0">
          <Aviso tipo="error">{mensajeError(crear.error, 'No se pudo crear la orden.')}</Aviso>
        </CardContent>
      )}
    </Card>
  );
}
