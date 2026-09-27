import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EstadoCargando, EstadoError } from '@/components/estados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/AuthProvider';
import { Aviso, Campo } from '@/features/taller/comunes';
import { CLASE_SELECT, mensajeError } from '@/features/taller/formulario';
import {
  aceptarCotizacionVenta,
  actualizarLineaVenta,
  agregarLineaRepuestoVenta,
  agregarLineaServicioVenta,
  anularVenta,
  borrarLineaVenta,
  borrarVenta,
  confirmarVenta,
  enviarCotizacionVenta,
  getInventarioItems,
  getServicios,
  getVenta,
  marcarPagadaVenta,
  type LineaOrdenVenta,
  type MedioPagoVenta,
  type OrdenVenta,
} from '@/lib/api-client';
import { formatearFechaHora } from '@/lib/dates';
import { formatearPesos } from '@/lib/dinero';
import { actuaComoAdmin } from '@/lib/sesion';
import { ESTADO_VENTA, MEDIO_PAGO_VENTA_LABEL } from './ventas';

/**
 * Orden de venta (Sprint 26): servicios del turno (precio guardado) y
 * repuestos con descuento y tope, IVA por tarifa, anticipo ya pagado
 * descontado del total. borrador -> confirmada -> pagada -> anulada, con
 * cotizacion opcional que el cliente acepta antes de confirmar.
 *
 * Se usa standalone (VentaDetalleView, /ventas/:id) e incrustada en la
 * orden de trabajo del turno (VentaOrden).
 */
export function VentaDetalle({ ordenId }: { ordenId: string }) {
  const { usuario } = useAuth();
  const queryClient = useQueryClient();
  const clave = ['venta', ordenId];
  const venta = useQuery({ queryKey: clave, queryFn: () => getVenta(ordenId) });
  const [aviso, setAviso] = useState<string | null>(null);

  const refrescar = (mensaje?: string) => {
    if (mensaje) setAviso(mensaje);
    void queryClient.invalidateQueries({ queryKey: clave });
    void queryClient.invalidateQueries({ queryKey: ['ventas'] });
  };

  if (venta.isPending) return <EstadoCargando forma="bloque" etiqueta="Cargando la orden de venta…" />;
  if (venta.isError) return <EstadoError error={venta.error} onReintentar={venta.refetch} />;

  const orden = venta.data;
  const esAdmin = actuaComoAdmin(usuario);
  const esTitular = !esAdmin && usuario?.id === orden.usuarioId;

  return (
    <Orden orden={orden} esAdmin={esAdmin} esTitular={esTitular} aviso={aviso} onCambio={refrescar} />
  );
}

function Orden({
  orden,
  esAdmin,
  esTitular,
  aviso,
  onCambio,
}: {
  orden: OrdenVenta;
  esAdmin: boolean;
  esTitular: boolean;
  aviso: string | null;
  onCambio: (mensaje?: string) => void;
}) {
  const estado = ESTADO_VENTA[orden.estado];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Orden de venta N.° {orden.numero}</h1>
          <p className="text-sm text-muted-foreground">
            {orden.clienteNombre ? `${orden.clienteNombre}${orden.clienteEmail ? ` · ${orden.clienteEmail}` : ''}` : 'Venta de mostrador'}
          </p>
        </div>
        <Badge variant={estado.variante}>{estado.texto}</Badge>
      </header>

      {aviso && <Aviso tipo="exito">{aviso}</Aviso>}

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <ShoppingCart className="size-4 text-muted-foreground" aria-hidden />
            Lineas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {orden.lineas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavia no tiene lineas.</p>
          ) : (
            <ul className="divide-y text-sm" aria-label="Lineas de la orden">
              {orden.lineas.map((l) => (
                <FilaLinea key={l.id} orden={orden} linea={l} esAdmin={esAdmin} onCambio={onCambio} />
              ))}
            </ul>
          )}

          {esAdmin && orden.estado === 'borrador' && (
            <AgregarLinea ordenId={orden.id} onCambio={onCambio} />
          )}

          <Totales orden={orden} />
        </CardContent>
      </Card>

      {orden.cotizacionEnviadaEn && (
        <Aviso tipo={orden.cotizacionAceptadaEn ? 'exito' : 'advertencia'}>
          Cotizacion enviada el {formatearFechaHora(orden.cotizacionEnviadaEn)}.{' '}
          {orden.cotizacionAceptadaEn
            ? `Aceptada el ${formatearFechaHora(orden.cotizacionAceptadaEn)}.`
            : 'Esperando que el cliente la acepte.'}
        </Aviso>
      )}

      {esTitular && orden.estado === 'borrador' && orden.cotizacionEnviadaEn && !orden.cotizacionAceptadaEn && (
        <AceptarCotizacion ordenId={orden.id} onCambio={onCambio} />
      )}

      {orden.estado === 'anulada' && (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Anulacion</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>
              Anulada el {formatearFechaHora(orden.anuladaEn!)}
              {orden.anuladaPorNombre && ` por ${orden.anuladaPorNombre}`}.
            </p>
            <p className="text-muted-foreground">{orden.motivoAnulacion}</p>
          </CardContent>
        </Card>
      )}

      {orden.pagadaEn && (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Pago</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>
              Pagada el {formatearFechaHora(orden.pagadaEn)}
              {orden.pagadaPorNombre && ` por ${orden.pagadaPorNombre}`} ·{' '}
              {orden.medioPago && MEDIO_PAGO_VENTA_LABEL[orden.medioPago]}
              {orden.comprobantePago && ` · ${orden.comprobantePago}`}
            </p>
          </CardContent>
        </Card>
      )}

      {esAdmin && <Acciones orden={orden} onCambio={onCambio} />}
    </div>
  );
}

function FilaLinea({
  orden,
  linea,
  esAdmin,
  onCambio,
}: {
  orden: OrdenVenta;
  linea: LineaOrdenVenta;
  esAdmin: boolean;
  onCambio: (mensaje?: string) => void;
}) {
  const editable = esAdmin && orden.estado === 'borrador';
  const [editando, setEditando] = useState(false);
  const [cantidad, setCantidad] = useState(String(linea.cantidad));
  const [descuento, setDescuento] = useState(String(linea.descuentoPorcentaje));

  const actualizar = useMutation({
    mutationFn: () =>
      actualizarLineaVenta(orden.id, linea.id, {
        cantidad: Number(cantidad),
        descuentoPorcentaje: Number(descuento),
      }),
    onSuccess: () => {
      setEditando(false);
      onCambio();
    },
  });
  const borrar = useMutation({
    mutationFn: () => borrarLineaVenta(orden.id, linea.id),
    onSuccess: () => onCambio(),
  });
  const error = actualizar.error ?? borrar.error;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {linea.descripcion}{' '}
            <span className="text-muted-foreground">
              x{linea.cantidad} · {formatearPesos(linea.precioUnitarioCentavos)} c/u
            </span>
          </p>
          {linea.descuentoPorcentaje > 0 && (
            <p className="text-xs text-muted-foreground">
              Descuento {linea.descuentoPorcentaje}% ({formatearPesos(linea.descuentoCentavos)})
              {linea.descuentoAplicadoPorNombre && ` · aplicado por ${linea.descuentoAplicadoPorNombre}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium tabular-nums">{formatearPesos(linea.totalCentavos)}</span>
          {editable && !editando && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditando(true)}>
                Editar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={borrar.isPending}
                onClick={() => borrar.mutate()}
                aria-label={`Quitar ${linea.descripcion}`}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </>
          )}
        </div>
      </div>

      {editable && editando && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            actualizar.mutate();
          }}
        >
          <Campo etiqueta="Cantidad" className="w-24">
            <Input
              type="number"
              min={0.001}
              step="0.001"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
            />
          </Campo>
          {linea.tipo === 'repuesto' && (
            <Campo etiqueta="Descuento %" className="w-24">
              <Input
                type="number"
                min={0}
                max={100}
                value={descuento}
                onChange={(e) => setDescuento(e.target.value)}
              />
            </Campo>
          )}
          <Button type="submit" size="sm" disabled={actualizar.isPending}>
            {actualizar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
            Guardar
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditando(false)}>
            Cancelar
          </Button>
        </form>
      )}
      {error && <Aviso tipo="error">{mensajeError(error, 'No se pudo guardar el cambio.')}</Aviso>}
    </li>
  );
}

function AgregarLinea({ ordenId, onCambio }: { ordenId: string; onCambio: (mensaje?: string) => void }) {
  const [tipo, setTipo] = useState<'servicio' | 'repuesto'>('repuesto');
  const servicios = useQuery({ queryKey: ['servicios'], queryFn: getServicios, enabled: tipo === 'servicio' });
  const items = useQuery({
    queryKey: ['inventario-items', false],
    queryFn: () => getInventarioItems('activos'),
    enabled: tipo === 'repuesto',
  });
  const [servicioId, setServicioId] = useState('');
  const [itemId, setItemId] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [descuento, setDescuento] = useState('0');

  const agregar = useMutation({
    mutationFn: () =>
      tipo === 'servicio'
        ? agregarLineaServicioVenta(ordenId, { servicioId, cantidad: Number(cantidad) })
        : agregarLineaRepuestoVenta(ordenId, {
            itemId,
            cantidad: Number(cantidad),
            descuentoPorcentaje: Number(descuento) || undefined,
          }),
    onSuccess: () => {
      setServicioId('');
      setItemId('');
      setCantidad('1');
      setDescuento('0');
      onCambio();
    },
  });

  const item = items.data?.find((i) => i.id === itemId);
  const sinStock = tipo === 'repuesto' && item !== undefined && Number(cantidad) > item.stock;
  const listo = tipo === 'servicio' ? servicioId !== '' : itemId !== '' && !sinStock;

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (listo) agregar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-3 rounded-lg border p-3">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={tipo === 'repuesto'} onChange={() => setTipo('repuesto')} />
          Repuesto
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={tipo === 'servicio'} onChange={() => setTipo('servicio')} />
          Servicio
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        {tipo === 'servicio' ? (
          <Campo etiqueta="Servicio">
            <select
              required
              value={servicioId}
              onChange={(e) => setServicioId(e.target.value)}
              className={CLASE_SELECT}
              disabled={servicios.isPending}
            >
              <option value="">Elegi un servicio…</option>
              {servicios.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre} · {formatearPesos(s.precio.totalCentavos)}
                </option>
              ))}
            </select>
          </Campo>
        ) : (
          <Campo etiqueta="Repuesto">
            <select
              required
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              className={CLASE_SELECT}
              disabled={items.isPending}
            >
              <option value="">Elegi un repuesto…</option>
              {items.data?.map((i) => (
                <option key={i.id} value={i.id} disabled={i.stock <= 0}>
                  {i.nombre} ({i.stock} {i.unidad} disponibles) · {formatearPesos(i.precio.totalCentavos)}
                </option>
              ))}
            </select>
          </Campo>
        )}
        <Campo etiqueta="Cantidad" className="w-24">
          <Input
            type="number"
            min={0.001}
            step="0.001"
            required
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            aria-invalid={sinStock}
          />
        </Campo>
        {tipo === 'repuesto' && (
          <Campo etiqueta="Descuento %" className="w-24">
            <Input
              type="number"
              min={0}
              max={100}
              value={descuento}
              onChange={(e) => setDescuento(e.target.value)}
            />
          </Campo>
        )}
      </div>
      {sinStock && item && (
        <Aviso tipo="advertencia">Solo quedan {item.stock} {item.unidad} en el inventario.</Aviso>
      )}
      {agregar.isError && (
        <Aviso tipo="error">{mensajeError(agregar.error, 'No se pudo agregar la linea.')}</Aviso>
      )}
      <Button type="submit" size="sm" disabled={!listo || agregar.isPending}>
        {agregar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
        <Plus aria-hidden /> Agregar
      </Button>
    </form>
  );
}

function Totales({ orden }: { orden: OrdenVenta }) {
  const t = orden.totales;
  const filas: [string, string][] = [
    ['Subtotal', formatearPesos(t.subtotalCentavos)],
    ...(t.descuentoCentavos > 0 ? [['Descuento', `- ${formatearPesos(t.descuentoCentavos)}`] as [string, string]] : []),
    ['IVA', formatearPesos(t.ivaCentavos)],
    ['Total', formatearPesos(t.totalCentavos)],
    ...(t.anticipoCentavos > 0
      ? [
          ['Ya pagado (anticipo)', formatearPesos(t.anticipoCentavos)] as [string, string],
          ['Saldo', formatearPesos(t.saldoCentavos)] as [string, string],
        ]
      : []),
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-3 text-sm sm:w-64 sm:justify-self-end">
      {filas.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Acciones({ orden, onCambio }: { orden: OrdenVenta; onCambio: (mensaje?: string) => void }) {
  const confirmar = useMutation({
    mutationFn: () => confirmarVenta(orden.id),
    onSuccess: () => onCambio('Orden confirmada: se desconto el stock de los repuestos.'),
  });
  const cotizar = useMutation({
    mutationFn: () => enviarCotizacionVenta(orden.id),
    onSuccess: (r) =>
      onCambio(r.enviado ? 'Cotizacion enviada por correo.' : 'La orden quedo marcada como cotizada, pero el correo no se pudo enviar.'),
  });
  const borrar = useMutation({
    mutationFn: () => borrarVenta(orden.id),
    onSuccess: () => onCambio('Borrador eliminado.'),
  });

  const noConfirmable = orden.lineas.length === 0 || Boolean(orden.cotizacionEnviadaEn && !orden.cotizacionAceptadaEn);
  const error = confirmar.error ?? cotizar.error ?? borrar.error;

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle as="h2">Acciones</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <Aviso tipo="error">{mensajeError(error, 'No se pudo completar la accion.')}</Aviso>}

        {orden.estado === 'borrador' && (
          <div className="flex flex-wrap gap-2">
            <Button disabled={confirmar.isPending || noConfirmable} onClick={() => confirmar.mutate()}>
              {confirmar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              Confirmar
            </Button>
            {orden.usuarioId && !orden.cotizacionAceptadaEn && (
              <Button
                variant="outline"
                disabled={cotizar.isPending || !orden.clienteEmail}
                onClick={() => cotizar.mutate()}
              >
                Enviar cotizacion
              </Button>
            )}
            <Button variant="ghost" disabled={borrar.isPending} onClick={() => borrar.mutate()}>
              Borrar orden
            </Button>
          </div>
        )}
        {noConfirmable && orden.estado === 'borrador' && orden.lineas.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Se le envio una cotizacion al cliente: hay que esperar a que la acepte antes de confirmar.
          </p>
        )}

        {orden.estado === 'confirmada' && <FormularioPagar ordenId={orden.id} onCambio={onCambio} />}

        {(orden.estado === 'confirmada' || orden.estado === 'pagada') && (
          <FormularioAnular ordenId={orden.id} onCambio={onCambio} />
        )}
      </CardContent>
    </Card>
  );
}

function FormularioPagar({ ordenId, onCambio }: { ordenId: string; onCambio: (mensaje?: string) => void }) {
  const [medioPago, setMedioPago] = useState<MedioPagoVenta>('efectivo');
  const [comprobante, setComprobante] = useState('');
  const pagar = useMutation({
    mutationFn: () => marcarPagadaVenta(ordenId, { medioPago, comprobante: comprobante.trim() || undefined }),
    onSuccess: () => onCambio('Orden marcada como pagada.'),
  });

  return (
    <form
      className="space-y-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        pagar.mutate();
      }}
    >
      <p className="text-sm font-semibold">Marcar como pagada</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Medio de pago">
          <select
            className={CLASE_SELECT}
            value={medioPago}
            onChange={(e) => setMedioPago(e.target.value as MedioPagoVenta)}
          >
            {(Object.keys(MEDIO_PAGO_VENTA_LABEL) as MedioPagoVenta[]).map((m) => (
              <option key={m} value={m}>
                {MEDIO_PAGO_VENTA_LABEL[m]}
              </option>
            ))}
          </select>
        </Campo>
        {medioPago !== 'efectivo' && (
          <Campo etiqueta="Comprobante (opcional)">
            <Input value={comprobante} maxLength={80} onChange={(e) => setComprobante(e.target.value)} />
          </Campo>
        )}
      </div>
      {pagar.isError && <Aviso tipo="error">{mensajeError(pagar.error, 'No se pudo registrar el pago.')}</Aviso>}
      <Button type="submit" size="sm" disabled={pagar.isPending}>
        {pagar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
        Marcar pagada
      </Button>
    </form>
  );
}

function FormularioAnular({ ordenId, onCambio }: { ordenId: string; onCambio: (mensaje?: string) => void }) {
  const [motivo, setMotivo] = useState('');
  const anular = useMutation({
    mutationFn: () => anularVenta(ordenId, motivo.trim()),
    onSuccess: () => onCambio('Orden anulada: se devolvio el stock de los repuestos.'),
  });
  const valido = motivo.trim().length >= 10;

  return (
    <form
      className="space-y-2 border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) anular.mutate();
      }}
    >
      <Campo etiqueta="Anular la orden" ayuda="Obligatorio, minimo 10 caracteres. Devuelve el stock de los repuestos.">
        <Input
          value={motivo}
          maxLength={500}
          aria-invalid={motivo !== '' && !valido}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </Campo>
      {anular.isError && <Aviso tipo="error">{mensajeError(anular.error, 'No se pudo anular la orden.')}</Aviso>}
      <Button type="submit" size="sm" variant="destructive" disabled={!valido || anular.isPending}>
        {anular.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
        Anular
      </Button>
    </form>
  );
}

function AceptarCotizacion({ ordenId, onCambio }: { ordenId: string; onCambio: (mensaje?: string) => void }) {
  const aceptar = useMutation({
    mutationFn: () => aceptarCotizacionVenta(ordenId),
    onSuccess: () => onCambio('Cotizacion aceptada. El taller ya puede empezar el trabajo.'),
  });

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">Revisa la cotizacion arriba. El taller no va a empezar el trabajo hasta que la aceptes.</p>
        <Button disabled={aceptar.isPending} onClick={() => aceptar.mutate()}>
          {aceptar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
          Aceptar cotizacion
        </Button>
        {aceptar.isError && <Aviso tipo="error">{mensajeError(aceptar.error, 'No se pudo aceptar la cotizacion.')}</Aviso>}
      </CardContent>
    </Card>
  );
}
