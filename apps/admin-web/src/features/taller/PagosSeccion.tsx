import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CircleCheck, LoaderCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { NavegadorFecha } from '@/components/NavegadorFecha';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ESTADO_PAGO, ESTADO_REEMBOLSO, MOTIVO_REEMBOLSO, nombreMedio } from '@/features/pagos/pagos';
import {
  atenderAlertaPago,
  cerrarCaja,
  completarReembolso,
  getAlertasPago,
  getCaja,
  getReembolsos,
  type Reembolso,
} from '@/lib/api-client';
import { formatearFechaHora, formatearFechaLarga, formatearHora, hoyISO } from '@/lib/dates';
import { formatearPesos, pesosACentavos } from '@/lib/dinero';
import { Aviso, Campo } from './comunes';
import { mensajeError } from './formulario';

const TIPO_ALERTA: Record<string, string> = {
  reversion: 'Reversion del pago',
  contracargo: 'Contracargo',
  anulacion_externa: 'Anulacion no pedida',
  monto_inconsistente: 'Monto que no cuadra',
  pago_duplicado: 'Pago de mas',
  pago_tardio: 'Pago tardio',
  reembolso_pendiente: 'Devolucion a mano',
  reembolso_fallido: 'Devolucion automatica fallida',
};

/**
 * Pagos y caja (Sprint 24): lo que el taller tiene que atender (alertas y
 * devoluciones a mano) y el cuadre de caja del dia.
 */
export function PagosSeccion() {
  return (
    <div className="space-y-4">
      <Alertas />
      <Reembolsos />
      <CajaDiaria />
    </div>
  );
}

function Alertas() {
  const queryClient = useQueryClient();
  const alertas = useQuery({ queryKey: ['pagos', 'alertas'], queryFn: getAlertasPago });
  const atender = useMutation({
    mutationFn: atenderAlertaPago,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pagos', 'alertas'] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <BellRing className="size-4 text-muted-foreground" aria-hidden />
          Alertas de pagos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {alertas.isPending ? (
          <EstadoCargando filas={2} />
        ) : alertas.isError ? (
          <EstadoError error={alertas.error} onReintentar={alertas.refetch} />
        ) : alertas.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada pendiente.</p>
        ) : (
          <ul className="divide-y text-sm" aria-label="Alertas de pagos">
            {alertas.data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Badge variant={a.tipo === 'reversion' || a.tipo === 'contracargo' ? 'destructive' : 'secondary'}>
                      {TIPO_ALERTA[a.tipo] ?? a.tipo}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatearFechaHora(a.creadaEn)}</span>
                  </p>
                  <p>{a.mensaje}</p>
                </div>
                <div className="flex gap-2">
                  {a.turnoId && (
                    <Link to={`/turnos/${a.turnoId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                      Ver orden
                    </Link>
                  )}
                  <Button size="sm" variant="ghost" disabled={atender.isPending} onClick={() => atender.mutate(a.id)}>
                    Marcar atendida
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Reembolsos() {
  const reembolsos = useQuery({ queryKey: ['pagos', 'reembolsos'], queryFn: () => getReembolsos() });
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Devoluciones pendientes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Con tarjeta, el anticipo se devuelve solo (anulacion en Wompi). PSE, Nequi, Bancolombia y lo
          cobrado en el mostrador no tienen devolucion automatica: devolvelo y registralo aca.
        </p>
        {reembolsos.isPending ? (
          <EstadoCargando filas={2} />
        ) : reembolsos.isError ? (
          <EstadoError error={reembolsos.error} onReintentar={reembolsos.refetch} />
        ) : reembolsos.data.length === 0 ? (
          <p className="text-muted-foreground">No hay devoluciones pendientes.</p>
        ) : (
          <ul className="divide-y" aria-label="Devoluciones pendientes">
            {reembolsos.data.map((r) => (
              <FilaReembolso key={r.id} reembolso={r} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FilaReembolso({ reembolso: r }: { reembolso: Reembolso }) {
  const queryClient = useQueryClient();
  const [nota, setNota] = useState('');
  const [abierto, setAbierto] = useState(false);
  const completar = useMutation({
    mutationFn: () => completarReembolso(r.id, nota),
    onSuccess: () => {
      for (const k of [['pagos'], ['caja']]) void queryClient.invalidateQueries({ queryKey: k });
    },
  });
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium tabular-nums">{formatearPesos(r.montoCentavos)}</span>
          <span className="text-muted-foreground">
            {r.cliente ?? 'Cliente'} · {nombreMedio(r.metodo ?? r.canal)} · {MOTIVO_REEMBOLSO[r.motivo] ?? r.motivo}
          </span>
          <Badge variant="secondary">{ESTADO_REEMBOLSO[r.estado]}</Badge>
        </p>
        <Link to={`/turnos/${r.turnoId}`} className="text-xs font-medium text-marca-texto hover:underline">
          Turno del {formatearFechaHora(r.turnoInicio)}
        </Link>
      </div>
      {r.nota && <p className="text-xs text-muted-foreground">{r.nota}</p>}
      {r.estado === 'pendiente_manual' &&
        (abierto ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              completar.mutate();
            }}
          >
            <Campo etiqueta="Como se devolvio" className="min-w-60 flex-1">
              <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Transferencia Nequi 3001234567" />
            </Campo>
            <Button type="submit" size="sm" disabled={nota.trim().length < 5 || completar.isPending}>
              Registrar devolucion
            </Button>
          </form>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAbierto(true)}>
            Ya lo devolvi
          </Button>
        ))}
      {completar.isError && <Aviso tipo="error">{mensajeError(completar.error, 'No se pudo registrar.')}</Aviso>}
    </li>
  );
}

function CajaDiaria() {
  const queryClient = useQueryClient();
  const hoy = hoyISO();
  const [fecha, setFecha] = useState(hoy);
  const caja = useQuery({ queryKey: ['caja', fecha], queryFn: () => getCaja(fecha) });
  const [contado, setContado] = useState('');
  const [nota, setNota] = useState('');
  const cerrar = useMutation({
    mutationFn: () => cerrarCaja(fecha, pesosACentavos(contado) ?? 0, nota || undefined),
    onSuccess: (nueva) => {
      queryClient.setQueryData(['caja', fecha], nueva);
      setContado('');
      setNota('');
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (pesosACentavos(contado) !== null) cerrar.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Cuadre de caja</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <NavegadorFecha
          fecha={fecha}
          etiqueta={formatearFechaLarga(fecha)}
          onCambiar={setFecha}
          actualizando={caja.isFetching && !caja.isPending}
        />
        {caja.isPending ? (
          <EstadoCargando filas={3} />
        ) : caja.isError ? (
          <EstadoError error={caja.error} onReintentar={caja.refetch} />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Cobrado en el dia</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatearPesos(caja.data.totalCobrado)}</dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Efectivo esperado en caja</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatearPesos(caja.data.efectivoEsperado)}</dd>
              </div>
              {caja.data.cobros.map((c) => (
                <div key={`${c.canal}-${c.metodo}`} className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">
                    {nombreMedio(c.metodo)} ({c.cantidad})
                  </dt>
                  <dd className="font-semibold tabular-nums">{formatearPesos(c.total)}</dd>
                </div>
              ))}
            </dl>
            {caja.data.movimientos.length === 0 ? (
              <EstadoVacio titulo="Sin cobros este dia" />
            ) : (
              <ul className="divide-y" aria-label="Cobros del dia">
                {caja.data.movimientos.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums text-muted-foreground">{formatearHora(m.aprobadoEn)}</span>
                      <span className="font-medium tabular-nums">{formatearPesos(m.montoCentavos)}</span>
                      <span>
                        {nombreMedio(m.metodo)} · {m.concepto === 'anticipo' ? 'Anticipo' : 'Saldo'}
                        {m.cliente ? ` · ${m.cliente}` : ''}
                        {m.comprobante ? ` · ${m.comprobante}` : ''}
                      </span>
                      {m.estado !== 'aprobado' && (
                        <Badge variant={ESTADO_PAGO[m.estado].variante}>{ESTADO_PAGO[m.estado].texto}</Badge>
                      )}
                    </span>
                    {m.registradoPor && <span className="text-xs text-muted-foreground">{m.registradoPor}</span>}
                  </li>
                ))}
              </ul>
            )}
            {caja.data.cierre ? (
              <Aviso tipo={caja.data.cierre.diferenciaCentavos === 0 ? 'exito' : 'advertencia'}>
                <CircleCheck className="mr-1 inline size-4" aria-hidden />
                Caja cerrada por {caja.data.cierre.cerradoPor ?? 'el taller'} el{' '}
                {formatearFechaHora(caja.data.cierre.cerradoEn)}: contado{' '}
                {formatearPesos(caja.data.cierre.contadoCentavos)}, esperado{' '}
                {formatearPesos(caja.data.cierre.esperadoCentavos)}
                {caja.data.cierre.diferenciaCentavos !== 0 &&
                  ` (diferencia ${formatearPesos(caja.data.cierre.diferenciaCentavos)})`}
                .{caja.data.cierre.nota ? ` ${caja.data.cierre.nota}` : ''}
              </Aviso>
            ) : (
              <form onSubmit={enviar} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                <Campo etiqueta="Efectivo contado">
                  <Input inputMode="numeric" value={contado} onChange={(e) => setContado(e.target.value)} placeholder="$ 0" required />
                </Campo>
                <Campo etiqueta="Nota (opcional)">
                  <Input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} />
                </Campo>
                <Button type="submit" disabled={cerrar.isPending || pesosACentavos(contado) === null}>
                  {cerrar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
                  Cerrar caja
                </Button>
                {cerrar.isError && (
                  <div className="sm:col-span-3">
                    <Aviso tipo="error">{mensajeError(cerrar.error, 'No se pudo cerrar la caja.')}</Aviso>
                  </div>
                )}
              </form>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
