import { useMutation, useQuery } from '@tanstack/react-query';
import { LoaderCircle, Plus, ShoppingCart } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Aviso, Campo } from '@/features/taller/comunes';
import { CLASE_SELECT, mensajeError } from '@/features/taller/formulario';
import { crearVenta, getClientes, getVentas, type EstadoOrdenVenta } from '@/lib/api-client';
import { formatearFechaHora } from '@/lib/dates';
import { formatearPesos } from '@/lib/dinero';
import { ESTADO_VENTA } from './ventas';

const ESTADOS: EstadoOrdenVenta[] = ['borrador', 'confirmada', 'pagada', 'anulada'];

/**
 * Ordenes de venta (Sprint 26): servicios y repuestos de un turno, o de
 * mostrador. La ve solo el personal; el cliente entra a la suya desde su
 * turno o desde el enlace de la cotizacion que le llega por correo.
 */
export function VentasListView() {
  const navigate = useNavigate();
  const [estado, setEstado] = useState<EstadoOrdenVenta | ''>('');
  const [creando, setCreando] = useState(false);
  const ventas = useQuery({
    queryKey: ['ventas', estado],
    queryFn: () => getVentas(estado ? { estado } : {}),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Ventas</h1>
          <p className="text-sm text-muted-foreground">Servicios, repuestos y anticipos de cada orden.</p>
        </div>
        <Button onClick={() => setCreando(true)}>
          <Plus aria-hidden /> Nueva venta de mostrador
        </Button>
      </div>

      {creando && (
        <NuevaVentaMostrador
          onCreada={(id) => navigate(`/ventas/${id}`)}
          onCancelar={() => setCreando(false)}
        />
      )}

      <Campo etiqueta="Estado" className="max-w-xs">
        <select
          className={CLASE_SELECT}
          value={estado}
          onChange={(e) => setEstado(e.target.value as EstadoOrdenVenta | '')}
        >
          <option value="">Todas</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>
              {ESTADO_VENTA[e].texto}
            </option>
          ))}
        </select>
      </Campo>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Ordenes</CardTitle>
        </CardHeader>
        <CardContent>
          {ventas.isPending ? (
            <EstadoCargando etiqueta="Cargando ordenes de venta…" />
          ) : ventas.isError ? (
            <EstadoError error={ventas.error} onReintentar={ventas.refetch} />
          ) : ventas.data.length === 0 ? (
            <EstadoVacio icono={ShoppingCart} titulo="Todavia no hay ordenes de venta" />
          ) : (
            <ul className="divide-y" aria-label="Ordenes de venta">
              {ventas.data.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/ventas/${v.id}`)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left hover:bg-muted/50"
                  >
                    <div>
                      <p className="font-medium">
                        Orden N.° {v.numero}
                        {v.clienteNombre && <span className="font-normal text-muted-foreground"> · {v.clienteNombre}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatearFechaHora(v.creadoEn)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {v.totalCentavos !== null && (
                        <span className="tabular-nums">{formatearPesos(v.totalCentavos)}</span>
                      )}
                      <Badge variant={ESTADO_VENTA[v.estado].variante}>{ESTADO_VENTA[v.estado].texto}</Badge>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NuevaVentaMostrador({
  onCreada,
  onCancelar,
}: {
  onCreada: (id: string) => void;
  onCancelar: () => void;
}) {
  const clientes = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const [usuarioId, setUsuarioId] = useState('');

  const crear = useMutation({
    mutationFn: () => crearVenta(usuarioId ? { usuarioId } : {}),
    onSuccess: (orden) => onCreada(orden.id),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    crear.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Venta de mostrador</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={enviar} className="space-y-3">
          <Campo etiqueta="Cliente (opcional)" ayuda="Sin cliente no se le puede mandar una cotizacion por correo.">
            <select
              className={CLASE_SELECT}
              value={usuarioId}
              onChange={(e) => setUsuarioId(e.target.value)}
              disabled={clientes.isPending}
            >
              <option value="">Sin cliente</option>
              {clientes.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} · {c.email}
                </option>
              ))}
            </select>
          </Campo>
          {crear.isError && (
            <Aviso tipo="error">{mensajeError(crear.error, 'No se pudo crear la orden.')}</Aviso>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={crear.isPending}>
              {crear.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              Crear orden
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onCancelar}>
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
