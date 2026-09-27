import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EstadoError } from '@/components/estados';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getPagoPorReferencia } from '@/lib/api-client';
import { formatearPesos } from '@/lib/dinero';
import { nombreMedio } from './pagos';

/** Hasta cuanto se sigue preguntando antes de decir "te avisamos". */
const INTENTOS = 20;

/**
 * Vuelta del checkout de Wompi (Sprint 24): /pagos/resultado?referencia=.
 *
 * Lo que diga la URL de la redireccion (Wompi agrega el id de la
 * transaccion) NO se usa: el estado se le pide al backend, que lo sabe por
 * el evento firmado o preguntandole a Wompi con la llave privada. Se
 * consulta cada 3 s mientras el pago siga en proceso (PSE y Nequi tardan).
 */
export function ResultadoPagoView() {
  const [params] = useSearchParams();
  const referencia = params.get('referencia') ?? '';
  const [desde] = useState(() => Date.now());
  const pago = useQuery({
    queryKey: ['pago', referencia],
    queryFn: () => getPagoPorReferencia(referencia),
    enabled: /^tp_[0-9a-f]{32}$/.test(referencia),
    refetchInterval: (q) => {
      const estado = q.state.data?.estado;
      const enProceso = !estado || estado === 'creado' || estado === 'pendiente';
      return enProceso && q.state.dataUpdateCount < INTENTOS ? 3_000 : false;
    },
  });

  const estado = pago.data?.estado;
  const aprobado = estado === 'aprobado';
  const fallido = estado === 'rechazado' || estado === 'error' || estado === 'anulado';

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 md:p-6">
      <h1 className="font-heading text-2xl font-semibold">Resultado del pago</h1>
      {pago.isError ? (
        <EstadoError error={pago.error} onReintentar={pago.refetch} />
      ) : (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div role="status" className="flex items-start gap-3">
              {aprobado ? (
                <CircleCheck className="size-6 shrink-0 text-exito-texto" aria-hidden />
              ) : fallido ? (
                <CircleX className="size-6 shrink-0 text-error-texto" aria-hidden />
              ) : (
                <LoaderCircle className="size-6 shrink-0 animate-spin text-muted-foreground" aria-hidden />
              )}
              <div className="space-y-1 text-sm">
                <p className="text-base font-semibold">
                  {aprobado
                    ? 'Pago aprobado'
                    : fallido
                      ? 'El pago no se completo'
                      : 'Estamos confirmando tu pago'}
                </p>
                {pago.data && (
                  <p className="text-muted-foreground">
                    {pago.data.concepto === 'anticipo' ? 'Anticipo' : 'Saldo'} ·{' '}
                    {formatearPesos(pago.data.montoCentavos)}
                    {pago.data.metodo ? ` · ${nombreMedio(pago.data.metodo)}` : ''}
                  </p>
                )}
                <p>
                  {aprobado
                    ? pago.data?.concepto === 'anticipo'
                      ? 'Tu turno quedo confirmado.'
                      : 'Gracias: la orden quedo paga.'
                    : fallido
                      ? 'No se cobro nada. Podes intentarlo de nuevo desde Mis turnos.'
                      : pago.data && pago.dataUpdatedAt - desde >= (INTENTOS - 1) * 3_000
                        ? 'Wompi todavia no confirma el pago. Apenas lo haga lo vas a ver en Mis turnos.'
                        : 'Puede tardar unos segundos (con PSE o Nequi, un poco mas).'}
                </p>
              </div>
            </div>
            <Link to="/mis-turnos" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Ir a Mis turnos
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
