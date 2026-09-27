import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Wallet } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EstadoCargando, EstadoError } from '@/components/estados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CLASE_TEXTAREA } from '@/features/perfil/strikes';
import { Aviso, Campo } from '@/features/taller/comunes';
import { CLASE_SELECT, mensajeError } from '@/features/taller/formulario';
import {
  abrirDisputa,
  completarReembolso,
  getPagosTurno,
  registrarPagoPresencial,
  resolverDisputa,
  type ConceptoPago,
  type MedioPresencial,
  type PagoDeTurno,
} from '@/lib/api-client';
import { formatearPesos, pesosACentavos } from '@/lib/dinero';
import { formatearFechaHora } from '@/lib/dates';
import { BotonPagar } from './BotonPagar';
import { ESTADO_PAGO, ESTADO_REEMBOLSO, MOTIVO_REEMBOLSO, nombreMedio } from './pagos';

/**
 * Pagos de un turno en la orden de trabajo (Sprint 24): lo pagado, lo que
 * falta, cada pago con su estado y su devolucion. El admin cobra en el
 * mostrador, registra devoluciones hechas a mano y reversiones o
 * contracargos. El titular ve lo mismo y puede pagar el saldo en linea.
 */
export function PagosOrden({
  turnoId,
  taller,
  esAdmin,
  esTitular,
}: {
  turnoId: string;
  taller?: string;
  esAdmin: boolean;
  esTitular: boolean;
}) {
  const clave = ['pagos-turno', turnoId];
  const datos = useQuery({ queryKey: clave, queryFn: () => getPagosTurno(turnoId, taller) });

  return (
    <Card className="print:shadow-none">
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <Wallet className="size-4 text-muted-foreground" aria-hidden />
          Pagos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {datos.isPending ? (
          <EstadoCargando filas={2} etiqueta="Cargando pagos…" />
        ) : datos.isError ? (
          <EstadoError error={datos.error} onReintentar={datos.refetch} />
        ) : (
          <>
            <Resumen resumen={datos.data.resumen} />
            {datos.data.pagos.length > 0 && (
              <ul className="divide-y text-sm" aria-label="Pagos del turno">
                {datos.data.pagos.map((p) => (
                  <FilaPago key={p.id} pago={p} esAdmin={esAdmin} clave={clave} />
                ))}
              </ul>
            )}
            {esTitular &&
              datos.data.resumen.cobraEnLinea &&
              datos.data.resumen.anticipoEstado !== 'pendiente' &&
              (datos.data.resumen.saldoCentavos ?? 0) > 0 && (
                <div className="print:hidden">
                  <BotonPagar
                    turnoId={turnoId}
                    taller={taller}
                    concepto="saldo"
                    montoCentavos={datos.data.resumen.saldoCentavos}
                  />
                </div>
              )}
            {esAdmin && (
              <CobroMostrador
                turnoId={turnoId}
                anticipoPendiente={datos.data.resumen.anticipoEstado === 'pendiente'}
                clave={clave}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Resumen({ resumen }: { resumen: Awaited<ReturnType<typeof getPagosTurno>>['resumen'] }) {
  const filas: [string, string][] = [];
  if (resumen.totalCentavos !== null) filas.push(['Total', formatearPesos(resumen.totalCentavos)]);
  if (resumen.anticipoCentavos !== null) {
    filas.push([
      'Anticipo',
      `${formatearPesos(resumen.anticipoCentavos)} · ${
        resumen.anticipoEstado === 'pagado'
          ? 'pagado'
          : resumen.anticipoVenceEn
            ? `pendiente, hasta ${formatearFechaHora(resumen.anticipoVenceEn)}`
            : 'pendiente'
      }`,
    ]);
  }
  filas.push(['Pagado', formatearPesos(resumen.pagadoCentavos)]);
  if (resumen.saldoCentavos !== null) filas.push(['Saldo', formatearPesos(resumen.saldoCentavos)]);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
      {filas.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function FilaPago({ pago, esAdmin, clave }: { pago: PagoDeTurno; esAdmin: boolean; clave: unknown[] }) {
  const queryClient = useQueryClient();
  const refrescar = () => void queryClient.invalidateQueries({ queryKey: clave });
  const [accion, setAccion] = useState<'reembolso' | 'disputa' | null>(null);
  const [texto, setTexto] = useState('');
  const [tipo, setTipo] = useState<'reversion' | 'contracargo'>('reversion');
  const completar = useMutation({
    mutationFn: () => completarReembolso(pago.reembolsoId!, texto),
    onSuccess: () => {
      setAccion(null);
      refrescar();
    },
  });
  const disputa = useMutation({
    mutationFn: () => abrirDisputa(pago.id, tipo, texto),
    onSuccess: () => {
      setAccion(null);
      refrescar();
    },
  });
  const resolver = useMutation({
    mutationFn: (r: 'revertido' | 'a_favor') => resolverDisputa(pago.id, r),
    onSuccess: refrescar,
  });
  const estado = ESTADO_PAGO[pago.estado];
  const error = completar.error ?? disputa.error ?? resolver.error;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium tabular-nums">{formatearPesos(pago.montoCentavos)}</span>
          <span className="text-muted-foreground">
            {pago.concepto === 'anticipo' ? 'Anticipo' : 'Saldo'} · {nombreMedio(pago.metodo ?? pago.canal)}
          </span>
          <Badge variant={estado.variante}>{estado.texto}</Badge>
          {pago.duplicado && <Badge variant="outline">Pago de mas</Badge>}
        </div>
        <span className="text-xs text-muted-foreground">
          {formatearFechaHora(pago.aprobadoEn ?? pago.creadoEn)}
        </span>
      </div>
      {pago.comprobante && <p className="text-xs text-muted-foreground">Comprobante: {pago.comprobante}</p>}
      {pago.disputaTipo && (
        <p className="text-xs">
          {pago.disputaTipo === 'reversion' ? 'Reversion del pago' : 'Contracargo'}: {pago.disputaDetalle}
        </p>
      )}
      {pago.reembolsoEstado && (
        <p className="text-xs">
          {ESTADO_REEMBOLSO[pago.reembolsoEstado]}
          {pago.reembolsoMotivo ? ` · ${MOTIVO_REEMBOLSO[pago.reembolsoMotivo] ?? pago.reembolsoMotivo}` : ''}
          {pago.reembolsoNota ? ` · ${pago.reembolsoNota}` : ''}
        </p>
      )}
      {error && <Aviso tipo="error">{mensajeError(error, 'No se pudo guardar.')}</Aviso>}

      {esAdmin && accion === null && (
        <div className="flex flex-wrap gap-2 print:hidden">
          {pago.reembolsoEstado === 'pendiente_manual' && (
            <Button size="sm" variant="outline" onClick={() => setAccion('reembolso')}>
              Registrar devolucion
            </Button>
          )}
          {pago.estado === 'aprobado' && !pago.reembolsoEstado && (
            <Button size="sm" variant="ghost" onClick={() => setAccion('disputa')}>
              Reversion o contracargo
            </Button>
          )}
          {pago.estado === 'en_disputa' && (
            <>
              <Button size="sm" variant="outline" disabled={resolver.isPending} onClick={() => resolver.mutate('a_favor')}>
                Se resolvio a favor del taller
              </Button>
              <Button size="sm" variant="destructive" disabled={resolver.isPending} onClick={() => resolver.mutate('revertido')}>
                Se devolvio al cliente
              </Button>
            </>
          )}
        </div>
      )}
      {esAdmin && accion !== null && (
        <form
          className="space-y-2 print:hidden"
          onSubmit={(e) => {
            e.preventDefault();
            if (accion === 'reembolso') completar.mutate();
            else disputa.mutate();
          }}
        >
          {accion === 'disputa' && (
            <Campo etiqueta="Tipo">
              <select className={CLASE_SELECT} value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
                <option value="reversion">Reversion del pago (Ley 1480, art. 51)</option>
                <option value="contracargo">Contracargo del banco</option>
              </select>
            </Campo>
          )}
          <Campo etiqueta={accion === 'reembolso' ? 'Como se devolvio' : 'Detalle'}>
            <textarea
              className={CLASE_TEXTAREA}
              rows={2}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={accion === 'reembolso' ? 'Transferencia Bancolombia 123456' : 'Aviso del banco del 26/09, radicado 4455'}
            />
          </Campo>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={completar.isPending || disputa.isPending || texto.trim().length < (accion === 'reembolso' ? 5 : 10)}
            >
              Guardar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAccion(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

function CobroMostrador({
  turnoId,
  anticipoPendiente,
  clave,
}: {
  turnoId: string;
  anticipoPendiente: boolean;
  clave: unknown[];
}) {
  const queryClient = useQueryClient();
  const [concepto, setConcepto] = useState<ConceptoPago>(anticipoPendiente ? 'anticipo' : 'saldo');
  const [medio, setMedio] = useState<MedioPresencial>('efectivo');
  const [monto, setMonto] = useState('');
  const [comprobante, setComprobante] = useState('');
  const cobrar = useMutation({
    mutationFn: () =>
      registrarPagoPresencial({
        turnoId,
        concepto,
        medio,
        montoCentavos: monto.trim() ? pesosACentavos(monto) ?? undefined : undefined,
        comprobante: comprobante.trim() || undefined,
      }),
    onSuccess: () => {
      setMonto('');
      setComprobante('');
      for (const k of [clave, ['orden'], ['caja']]) void queryClient.invalidateQueries({ queryKey: k });
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    cobrar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-3 rounded-lg border p-3 print:hidden">
      <p className="text-sm font-semibold">Cobrar en el mostrador</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Concepto">
          <select className={CLASE_SELECT} value={concepto} onChange={(e) => setConcepto(e.target.value as ConceptoPago)}>
            <option value="anticipo">Anticipo</option>
            <option value="saldo">Saldo</option>
          </select>
        </Campo>
        <Campo etiqueta="Medio">
          <select className={CLASE_SELECT} value={medio} onChange={(e) => setMedio(e.target.value as MedioPresencial)}>
            <option value="efectivo">Efectivo</option>
            <option value="datafono">Datafono</option>
            <option value="transferencia">Transferencia</option>
          </select>
        </Campo>
        <Campo etiqueta="Monto (opcional)" ayuda="Vacio: todo lo pendiente del concepto.">
          <Input inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="$ 0" />
        </Campo>
        {medio !== 'efectivo' && (
          <Campo etiqueta="Comprobante" ayuda="Numero del voucher o de la transferencia.">
            <Input value={comprobante} onChange={(e) => setComprobante(e.target.value)} maxLength={80} />
          </Campo>
        )}
      </div>
      {cobrar.isSuccess && (
        <Aviso tipo="exito">Cobro registrado: {formatearPesos(cobrar.data.montoCentavos)}.</Aviso>
      )}
      {cobrar.isError && <Aviso tipo="error">{mensajeError(cobrar.error, 'No se pudo registrar el cobro.')}</Aviso>}
      <Button type="submit" size="sm" disabled={cobrar.isPending}>
        {cobrar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
        Registrar cobro
      </Button>
    </form>
  );
}
