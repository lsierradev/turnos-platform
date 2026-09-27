import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Plus, Wrench } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EstadoCargando, EstadoError } from '@/components/estados';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Aviso, Campo } from '@/features/taller/comunes';
import { CLASE_SELECT, mensajeError } from '@/features/taller/formulario';
import { getInventarioItems, getRepuestosDeTurno, registrarMovimientoInventario } from '@/lib/api-client';
import { formatearFechaHora } from '@/lib/dates';
import { formatearPesos } from '@/lib/dinero';

/**
 * Repuestos usados en la orden (Sprint 25). Solo para el personal: el
 * cliente no ve el catalogo ni los costos internos, solo lo que se le
 * cobra (eso ya esta en la seccion de Pagos). Cada salida descuenta del
 * inventario del taller al instante (protegido en la base contra
 * ventas simultaneas, migracion 020).
 */
export function RepuestosOrden({ turnoId, puedeAgregar }: { turnoId: string; puedeAgregar: boolean }) {
  const queryClient = useQueryClient();
  const clave = ['repuestos-turno', turnoId];
  const usados = useQuery({ queryKey: clave, queryFn: () => getRepuestosDeTurno(turnoId) });
  const [agregando, setAgregando] = useState(false);

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <Wrench className="size-4 text-muted-foreground" aria-hidden />
          Repuestos usados
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {usados.isPending ? (
          <EstadoCargando filas={1} etiqueta="Cargando repuestos…" />
        ) : usados.isError ? (
          <EstadoError error={usados.error} onReintentar={usados.refetch} />
        ) : usados.data.length === 0 && !agregando ? (
          <p className="text-sm text-muted-foreground">Todavia no se registro ningun repuesto.</p>
        ) : (
          usados.data.length > 0 && (
            <ul className="divide-y text-sm" aria-label="Repuestos usados">
              {usados.data.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {Math.abs(m.cantidad)} {m.itemUnidad} de {m.itemNombre}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {m.creadoPorNombre ?? '—'} · {formatearFechaHora(m.creadoEn)}
                  </span>
                </li>
              ))}
            </ul>
          )
        )}

        {puedeAgregar &&
          (agregando ? (
            <FormularioRepuesto
              turnoId={turnoId}
              onListo={() => {
                setAgregando(false);
                void queryClient.invalidateQueries({ queryKey: clave });
              }}
              onCancelar={() => setAgregando(false)}
            />
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAgregando(true)}>
              <Plus aria-hidden /> Agregar repuesto
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}

function FormularioRepuesto({
  turnoId,
  onListo,
  onCancelar,
}: {
  turnoId: string;
  onListo: () => void;
  onCancelar: () => void;
}) {
  // Solo activos, y solo lo que necesita para elegir: el resto del
  // catalogo (costo, sku) es de Mi taller > Inventario.
  const items = useQuery({ queryKey: ['inventario-items', false], queryFn: () => getInventarioItems('activos') });
  const [itemId, setItemId] = useState('');
  const [cantidad, setCantidad] = useState('1');

  const registrar = useMutation({
    mutationFn: () =>
      registrarMovimientoInventario({ itemId, tipo: 'salida', cantidad: Number(cantidad), turnoId }),
    onSuccess: onListo,
  });

  const item = items.data?.find((i) => i.id === itemId);
  const sinStock = item !== undefined && Number(cantidad) > item.stock;

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (itemId && !sinStock) registrar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-3 rounded-lg border p-3">
      {items.isError ? (
        <EstadoError error={items.error} onReintentar={items.refetch} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
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
          <Campo etiqueta="Cantidad" className="w-28">
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
        </div>
      )}
      {sinStock && item && (
        <Aviso tipo="advertencia">Solo quedan {item.stock} {item.unidad} en el inventario.</Aviso>
      )}
      {registrar.isError && (
        <Aviso tipo="error">{mensajeError(registrar.error, 'No se pudo registrar el repuesto.')}</Aviso>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!itemId || sinStock || registrar.isPending}>
          {registrar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
          Registrar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
