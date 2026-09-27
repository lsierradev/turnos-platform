import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Boxes, Download, LoaderCircle, Plus, TriangleAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { aCsv, descargarCsv, type Celda } from '@/lib/csv';
import { formatearFechaHora, hoyISO } from '@/lib/dates';
import { calcularPrecio, formatearPesos, pesosACentavos, textoDesglose, textoPrecioFinal } from '@/lib/dinero';
import {
  actualizarItemInventario,
  crearItemInventario,
  getAlertasStockBajo,
  getConfiguracionFiscal,
  getInventarioItems,
  getKardex,
  getValorizacionInventario,
  registrarMovimientoInventario,
  type DatosItemInventario,
  type ItemInventario,
  type TarifaIva,
  type TipoMovimientoInventario,
} from '@/lib/api-client';
import { Aviso, Campo } from './comunes';
import { CLASE_SELECT, mensajeError } from './formulario';

const TIPO_LABEL: Record<TipoMovimientoInventario, string> = {
  entrada: 'Entrada (compra)',
  salida: 'Salida',
  ajuste: 'Ajuste',
  devolucion: 'Devolucion',
};

type Vista =
  | { tipo: 'lista' }
  | { tipo: 'nuevo' }
  | { tipo: 'editar'; item: ItemInventario }
  | { tipo: 'movimiento'; item: ItemInventario }
  | { tipo: 'kardex'; item: ItemInventario };

/**
 * Inventario de repuestos (Sprint 25): catalogo con precio (IVA incluido,
 * igual que servicios), movimientos de kardex, valorizacion, alerta de
 * stock bajo y exportacion CSV. Los repuestos que se usan en una orden se
 * registran desde la orden de trabajo, no desde aca (ver RepuestosOrden).
 */
export function InventarioSeccion() {
  const queryClient = useQueryClient();
  const [vista, setVista] = useState<Vista>({ tipo: 'lista' });
  const [aviso, setAviso] = useState<string | null>(null);
  const [verInactivos, setVerInactivos] = useState(false);

  const items = useQuery({
    queryKey: ['inventario-items', verInactivos],
    queryFn: () => getInventarioItems(verInactivos ? 'todos' : 'activos'),
  });
  const alertas = useQuery({ queryKey: ['inventario-alertas'], queryFn: getAlertasStockBajo });
  const valorizacion = useQuery({
    queryKey: ['inventario-valorizacion'],
    queryFn: getValorizacionInventario,
  });

  const invalidar = () => {
    for (const clave of ['inventario-items', 'inventario-alertas', 'inventario-valorizacion']) {
      void queryClient.invalidateQueries({ queryKey: [clave] });
    }
  };

  const activar = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) =>
      actualizarItemInventario(id, { activo }),
    onSuccess: invalidar,
  });

  function exportarCsv() {
    if (!valorizacion.data) return;
    const filas: Celda[][] = [
      ['SKU', 'Nombre', 'Marca', 'Unidad', 'Stock', 'Costo unitario', 'Precio con IVA', 'Valorizado'],
      ...valorizacion.data.items.map((i) => [
        i.sku,
        i.nombre,
        i.marca ?? '',
        i.unidad,
        i.stock,
        i.costoCentavos / 100,
        i.precio.totalCentavos / 100,
        i.valorCentavos / 100,
      ]),
      ['', '', '', '', '', '', 'Total', valorizacion.data.totalCentavos / 100],
    ];
    descargarCsv(`inventario_${hoyISO()}.csv`, aCsv(filas));
  }

  if (vista.tipo === 'nuevo' || vista.tipo === 'editar') {
    return (
      <FormularioItem
        item={vista.tipo === 'editar' ? vista.item : null}
        onListo={(mensaje) => {
          setVista({ tipo: 'lista' });
          setAviso(mensaje);
          invalidar();
        }}
        onCancelar={() => setVista({ tipo: 'lista' })}
      />
    );
  }
  if (vista.tipo === 'movimiento') {
    return (
      <FormularioMovimiento
        item={vista.item}
        onListo={(mensaje) => {
          setVista({ tipo: 'lista' });
          setAviso(mensaje);
          invalidar();
        }}
        onCancelar={() => setVista({ tipo: 'lista' })}
      />
    );
  }
  if (vista.tipo === 'kardex') {
    return <KardexItem item={vista.item} onVolver={() => setVista({ tipo: 'lista' })} />;
  }

  return (
    <div className="space-y-4">
      {alertas.data && alertas.data.length > 0 && (
        <Aviso tipo="advertencia">
          <TriangleAlert className="mr-1 inline size-4" aria-hidden />
          {alertas.data.length === 1
            ? `${alertas.data[0].nombre} esta en o por debajo del stock minimo (${alertas.data[0].stock} ${alertas.data[0].unidad}).`
            : `${alertas.data.length} repuestos estan en o por debajo del stock minimo: ${alertas.data
                .map((i) => i.nombre)
                .join(', ')}.`}
        </Aviso>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button onClick={() => setVista({ tipo: 'nuevo' })}>
          <Plus aria-hidden /> Nuevo repuesto
        </Button>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {valorizacion.data && (
            <span className="text-muted-foreground">
              Valorizado: <strong className="tabular-nums text-foreground">{formatearPesos(valorizacion.data.totalCentavos)}</strong>
            </span>
          )}
          <Button variant="outline" size="sm" onClick={exportarCsv} disabled={!valorizacion.data}>
            <Download aria-hidden /> Exportar CSV
          </Button>
          <label className="flex items-center gap-2 text-muted-foreground">
            <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />
            Ver de baja tambien
          </label>
        </div>
      </div>

      {aviso && <Aviso tipo="exito">{aviso}</Aviso>}
      {activar.isError && <Aviso tipo="error">{mensajeError(activar.error, 'No se pudo guardar el cambio.')}</Aviso>}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Repuestos</CardTitle>
        </CardHeader>
        <CardContent>
          {items.isPending ? (
            <EstadoCargando etiqueta="Cargando repuestos…" />
          ) : items.isError ? (
            <EstadoError error={items.error} onReintentar={items.refetch} />
          ) : items.data.length === 0 ? (
            <EstadoVacio icono={Boxes} titulo="Todavia no hay repuestos cargados" />
          ) : (
            <ul className="divide-y" aria-label="Repuestos">
              {items.data.map((i) => {
                const bajo = i.stock <= i.stockMinimo;
                return (
                  <li key={i.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
                    <div className="min-w-0 sm:flex-1">
                      <p className="font-medium">
                        {i.nombre}
                        {!i.activo && (
                          <Badge variant="secondary" className="ml-2">
                            De baja
                          </Badge>
                        )}
                        {i.activo && bajo && (
                          <Badge variant="destructive" className="ml-2">
                            Stock bajo
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {i.sku}
                        {i.marca && ` · ${i.marca}`} · {i.unidad}
                      </p>
                    </div>
                    <div className="text-sm sm:text-right">
                      <p className="tabular-nums">
                        Stock <strong className={bajo ? 'text-error-texto' : undefined}>{i.stock}</strong>
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">{textoPrecioFinal(i.precio)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => setVista({ tipo: 'movimiento', item: i })}>
                        Movimiento
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setVista({ tipo: 'kardex', item: i })}>
                        Kardex
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setVista({ tipo: 'editar', item: i })}>
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={activar.isPending}
                        onClick={() => activar.mutate({ id: i.id, activo: !i.activo })}
                      >
                        {i.activo ? 'Dar de baja' : 'Reactivar'}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FormularioItem({
  item,
  onListo,
  onCancelar,
}: {
  item: ItemInventario | null;
  onListo: (mensaje: string) => void;
  onCancelar: () => void;
}) {
  const fiscal = useQuery({ queryKey: ['configuracion-fiscal'], queryFn: getConfiguracionFiscal });
  const responsable = fiscal.data?.responsableIva ?? false;
  const [sku, setSku] = useState(item?.sku ?? '');
  const [nombre, setNombre] = useState(item?.nombre ?? '');
  const [marca, setMarca] = useState(item?.marca ?? '');
  const [unidad, setUnidad] = useState(item?.unidad ?? 'unidad');
  const [tarifa, setTarifa] = useState<TarifaIva>(item?.tarifaIva ?? 19);
  const [modo, setModo] = useState<'base' | 'final'>('base');
  const [monto, setMonto] = useState(item ? String(item.precioBaseCentavos / 100).replace('.', ',') : '');
  const [stockMinimo, setStockMinimo] = useState(String(item?.stockMinimo ?? 0));

  const centavos = pesosACentavos(monto);
  const base =
    centavos === null
      ? null
      : modo === 'final' && responsable
        ? Math.round((centavos * 100) / (100 + tarifa))
        : centavos;
  const vista = base === null ? null : calcularPrecio(base, tarifa, responsable);

  const guardar = useMutation({
    mutationFn: (datos: DatosItemInventario) =>
      item ? actualizarItemInventario(item.id, datos) : crearItemInventario(datos),
    onSuccess: (i) => onListo(item ? `Repuesto ${i.nombre} actualizado.` : `Repuesto ${i.nombre} creado.`),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (base === null) return;
    guardar.mutate({
      sku: sku.trim(),
      nombre: nombre.trim(),
      marca: marca.trim() || undefined,
      unidad: unidad.trim() || 'unidad',
      precioBaseCentavos: base,
      tarifaIva: tarifa,
      stockMinimo: Number(stockMinimo),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{item ? `Editar ${item.nombre}` : 'Nuevo repuesto'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={enviar} className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Codigo (SKU)" ayuda={item ? 'No se puede cambiar despues de creado.' : undefined}>
            <Input
              value={sku}
              required
              maxLength={40}
              disabled={item !== null}
              placeholder="FIL-0234"
              onChange={(e) => setSku(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Nombre">
            <Input value={nombre} required maxLength={120} onChange={(e) => setNombre(e.target.value)} />
          </Campo>
          <Campo etiqueta="Marca (opcional)">
            <Input value={marca} maxLength={60} onChange={(e) => setMarca(e.target.value)} />
          </Campo>
          <Campo etiqueta="Unidad de medida" ayuda="Unidad, litro, juego, metro…">
            <Input value={unidad} required maxLength={20} onChange={(e) => setUnidad(e.target.value)} />
          </Campo>
          <Campo etiqueta="Tarifa de IVA" ayuda={responsable ? undefined : 'Aplica cuando el taller sea responsable de IVA.'}>
            <select value={tarifa} onChange={(e) => setTarifa(Number(e.target.value) as TarifaIva)} className={CLASE_SELECT}>
              <option value={19}>19% (general)</option>
              <option value={5}>5% (reducida)</option>
              <option value={0}>0% (exento o excluido)</option>
            </select>
          </Campo>
          <Campo etiqueta="Stock minimo" ayuda="Por debajo de esto aparece la alerta de stock bajo.">
            <Input
              type="number"
              min={0}
              step="0.001"
              value={stockMinimo}
              onChange={(e) => setStockMinimo(e.target.value)}
            />
          </Campo>

          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="text-sm font-medium">Precio</legend>
            {responsable && (
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={modo === 'base'} onChange={() => setModo('base')} />
                  Cargo el valor base (sin IVA)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={modo === 'final'} onChange={() => setModo('final')} />
                  Cargo el precio final (con IVA)
                </label>
              </div>
            )}
            <div className="max-w-xs">
              <Input
                inputMode="decimal"
                required
                placeholder="25.000"
                aria-invalid={monto !== '' && centavos === null}
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                aria-label={modo === 'final' && responsable ? 'Precio final con IVA' : 'Valor base'}
              />
            </div>
            {vista && (
              <p className="text-sm">
                El cliente ve <strong className="tabular-nums">{textoPrecioFinal(vista)}</strong>
                {textoDesglose(vista) && (
                  <span className="text-muted-foreground tabular-nums"> · {textoDesglose(vista)}</span>
                )}
              </p>
            )}
          </fieldset>

          {item && (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Costo actual (de la ultima compra): <strong>{formatearPesos(item.costoCentavos)}</strong>. Se
              actualiza solo con las entradas por compra.
            </p>
          )}

          {guardar.isError && (
            <div className="sm:col-span-2">
              <Aviso tipo="error">{mensajeError(guardar.error, 'No se pudo guardar el repuesto.')}</Aviso>
            </div>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={guardar.isPending || base === null}>
              {guardar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              {item ? 'Guardar cambios' : 'Crear repuesto'}
            </Button>
            <Button type="button" variant="outline" onClick={onCancelar}>
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Registrar un movimiento de mostrador: entrada por compra, ajuste,
 * devolucion o una venta directa (salida sin turno). Los repuestos usados
 * en una orden se registran desde la orden de trabajo, no desde aca.
 */
function FormularioMovimiento({
  item,
  onListo,
  onCancelar,
}: {
  item: ItemInventario;
  onListo: (mensaje: string) => void;
  onCancelar: () => void;
}) {
  const [tipo, setTipo] = useState<TipoMovimientoInventario>('entrada');
  const [cantidad, setCantidad] = useState('1');
  const [sentido, setSentido] = useState<'incremento' | 'decremento'>('decremento');
  const [costo, setCosto] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [factura, setFactura] = useState('');
  const [motivo, setMotivo] = useState('');

  const registrar = useMutation({
    mutationFn: () => {
      const costoCentavos = pesosACentavos(costo);
      return registrarMovimientoInventario({
        itemId: item.id,
        tipo,
        cantidad: Number(cantidad),
        sentido: tipo === 'ajuste' ? sentido : undefined,
        costoUnitarioCentavos: tipo === 'entrada' && costoCentavos !== null ? costoCentavos : undefined,
        proveedor: tipo === 'entrada' ? proveedor.trim() : undefined,
        facturaProveedor: tipo === 'entrada' ? factura.trim() : undefined,
        motivo: motivo.trim() || undefined,
      });
    },
    onSuccess: (r) =>
      onListo(`Movimiento registrado. Stock de ${item.nombre}: ${r.item.stock} ${item.unidad}.`),
  });

  const motivoValido = tipo !== 'ajuste' || motivo.trim().length >= 5;

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (motivoValido) registrar.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Movimiento de {item.nombre}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Stock actual: <strong className="text-foreground">{item.stock}</strong> {item.unidad}.
        </p>
        <form onSubmit={enviar} className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Tipo">
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoMovimientoInventario)}
              className={CLASE_SELECT}
            >
              {(Object.keys(TIPO_LABEL) as TipoMovimientoInventario[]).map((t) => (
                <option key={t} value={t}>
                  {TIPO_LABEL[t]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Cantidad">
            <Input
              type="number"
              min={0.001}
              step="0.001"
              required
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
            />
          </Campo>

          {tipo === 'ajuste' && (
            <Campo etiqueta="Sentido" className="sm:col-span-2">
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={sentido === 'incremento'}
                    onChange={() => setSentido('incremento')}
                  />
                  Sube el stock
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={sentido === 'decremento'}
                    onChange={() => setSentido('decremento')}
                  />
                  Baja el stock
                </label>
              </div>
            </Campo>
          )}

          {tipo === 'entrada' && (
            <>
              <Campo etiqueta="Costo unitario">
                <Input
                  inputMode="decimal"
                  required
                  placeholder="15.000"
                  value={costo}
                  onChange={(e) => setCosto(e.target.value)}
                />
              </Campo>
              <Campo etiqueta="Proveedor">
                <Input required maxLength={120} value={proveedor} onChange={(e) => setProveedor(e.target.value)} />
              </Campo>
              <Campo etiqueta="N.° de factura del proveedor">
                <Input required maxLength={60} value={factura} onChange={(e) => setFactura(e.target.value)} />
              </Campo>
            </>
          )}

          <Campo
            etiqueta={tipo === 'ajuste' ? 'Motivo del ajuste' : 'Nota (opcional)'}
            ayuda={tipo === 'ajuste' ? 'Obligatorio, minimo 5 caracteres.' : undefined}
            className="sm:col-span-2"
          >
            <Input
              value={motivo}
              maxLength={300}
              required={tipo === 'ajuste'}
              aria-invalid={tipo === 'ajuste' && !motivoValido && motivo !== ''}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </Campo>

          {registrar.isError && (
            <div className="sm:col-span-2">
              <Aviso tipo="error">{mensajeError(registrar.error, 'No se pudo registrar el movimiento.')}</Aviso>
            </div>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={registrar.isPending || !motivoValido}>
              {registrar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              Registrar
            </Button>
            <Button type="button" variant="outline" onClick={onCancelar}>
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function KardexItem({ item, onVolver }: { item: ItemInventario; onVolver: () => void }) {
  const kardex = useQuery({ queryKey: ['inventario-kardex', item.id], queryFn: () => getKardex(item.id) });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onVolver}>
            <ArrowLeft aria-hidden /> Volver
          </Button>
        </div>
        <CardTitle as="h2">Kardex de {item.nombre}</CardTitle>
      </CardHeader>
      <CardContent>
        {kardex.isPending ? (
          <EstadoCargando etiqueta="Cargando kardex…" />
        ) : kardex.isError ? (
          <EstadoError error={kardex.error} onReintentar={kardex.refetch} />
        ) : kardex.data.length === 0 ? (
          <EstadoVacio titulo="Todavia no tiene movimientos" />
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="px-2 py-2 text-left font-medium">Fecha</th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">Tipo</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Cantidad</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Saldo</th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">Detalle</th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">Quien</th>
                </tr>
              </thead>
              <tbody>
                {kardex.data.map((m) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="px-2 py-2 whitespace-nowrap tabular-nums">{formatearFechaHora(m.creadoEn)}</td>
                    <td className="px-2 py-2">{TIPO_LABEL[m.tipo]}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${m.cantidad < 0 ? 'text-error-texto' : ''}`}>
                      {m.cantidad > 0 ? '+' : ''}
                      {m.cantidad}
                    </td>
                    <td className="px-2 py-2 text-right font-medium tabular-nums">{m.saldo}</td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {m.tipo === 'entrada'
                        ? `${m.proveedor ?? ''} · fact. ${m.facturaProveedor ?? ''} · ${formatearPesos(m.costoUnitarioCentavos ?? 0)} c/u`
                        : (m.motivo ?? '—')}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{m.creadoPorNombre ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
