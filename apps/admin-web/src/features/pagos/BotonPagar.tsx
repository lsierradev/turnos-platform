import { useMutation } from '@tanstack/react-query';
import { CreditCard, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Aviso } from '@/features/taller/comunes';
import { mensajeError } from '@/features/taller/formulario';
import { aceptarDocumento, ApiError, crearCheckout, type ConceptoPago } from '@/lib/api-client';
import { formatearPesos } from '@/lib/dinero';

/**
 * Pagar en linea con Wompi (Sprint 24). El boton no manda montos: pide el
 * checkout al backend, que calcula y firma, y lleva al cliente a Wompi.
 *
 * Si el taller publico condiciones nuevas desde que reservo, el backend
 * responde CONDICIONES_PENDIENTES: se aceptan aca (la version que dijo el
 * backend) antes de pagar, porque dicen cuando se devuelve el anticipo.
 */
export function BotonPagar({
  turnoId,
  taller,
  concepto,
  montoCentavos,
}: {
  turnoId: string;
  /** El taller del turno (X-Taller): puede no ser el elegido. */
  taller?: string;
  concepto: ConceptoPago;
  /** Solo para el texto del boton; el monto real lo decide el servidor. */
  montoCentavos: number | null;
}) {
  const [condiciones, setCondiciones] = useState<number | null>(null);
  const [acepta, setAcepta] = useState(false);
  const pagar = useMutation({
    mutationFn: async () => {
      if (condiciones !== null) await aceptarDocumento('condiciones_taller', condiciones, taller);
      return crearCheckout(turnoId, concepto, taller);
    },
    onSuccess: (checkout) => {
      // Fuera del panel: al checkout de Wompi. Vuelve a /pagos/resultado.
      window.location.assign(checkout.url);
    },
    onError: (error) => {
      const cuerpo = error instanceof ApiError ? (error.body as { codigo?: string; version?: number }) : null;
      if (cuerpo?.codigo === 'CONDICIONES_PENDIENTES' && cuerpo.version) {
        setCondiciones(cuerpo.version);
        setAcepta(false);
      }
    },
  });
  const texto = `${concepto === 'anticipo' ? 'Pagar anticipo' : 'Pagar saldo'}${
    montoCentavos ? ` · ${formatearPesos(montoCentavos)}` : ''
  }`;
  const faltaAceptar = condiciones !== null && !acepta;
  const esDeCondiciones =
    pagar.error instanceof ApiError &&
    (pagar.error.body as { codigo?: string } | undefined)?.codigo === 'CONDICIONES_PENDIENTES';

  return (
    <div className="space-y-2">
      {condiciones !== null && taller && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={acepta}
            onChange={(e) => setAcepta(e.target.checked)}
          />
          <span>
            El taller actualizo sus condiciones. Leí y acepto las{' '}
            <a
              href={`/legal/talleres/${taller}/condiciones?version=${condiciones}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-marca-texto underline-offset-4 hover:underline"
            >
              condiciones del servicio
            </a>{' '}
            (cuando se devuelve el anticipo).
          </span>
        </label>
      )}
      {pagar.isError && !esDeCondiciones && (
        <Aviso tipo="error">{mensajeError(pagar.error, 'No se pudo iniciar el pago.')}</Aviso>
      )}
      <Button size="sm" onClick={() => pagar.mutate()} disabled={pagar.isPending || faltaAceptar}>
        {pagar.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <CreditCard aria-hidden />}
        {texto}
      </Button>
      <p className="text-xs text-muted-foreground">
        Pagás en Wompi con tarjeta, PSE, Nequi o Bancolombia. TurnoPro no ve ni guarda los datos de tu
        medio de pago.
      </p>
    </div>
  );
}
