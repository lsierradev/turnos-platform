import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Plus, Wrench } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CATEGORIA_LABEL } from '@/features/agenda/linea-tiempo';
import {
  actualizarServicio,
  borrarServicio,
  crearServicio,
  getConfiguracionFiscal,
  getServicios,
  type DatosServicio,
  type Servicio,
  type TarifaIva,
} from '@/lib/api-client';
import { formatearDuracion } from '@/lib/dates';
import {
  baseDesdeTotal,
  calcularPrecio,
  formatearPesos,
  pesosACentavos,
  textoDesglose,
  textoPrecioFinal,
} from '@/lib/dinero';
import { Aviso, Campo } from './comunes';
import { CLASE_SELECT, mensajeError } from './formulario';

const CATEGORIAS = ['mecanica', 'electrica', 'latoneria'] as const;

/**
 * Servicios con precio (Sprint 21). El admin carga el valor BASE; el
 * sistema suma el IVA si el taller es responsable. Tambien se puede cargar
 * el precio final "como lo cobra" y el sistema despeja la base.
 */
export function ServiciosSeccion() {
  const queryClient = useQueryClient();
  const servicios = useQuery({ queryKey: ['servicios'], queryFn: getServicios });
  const fiscal = useQuery({ queryKey: ['configuracion-fiscal'], queryFn: getConfiguracionFiscal });
  const [editando, setEditando] = useState<Servicio | 'nuevo' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cambio = useMutation({
    mutationFn: ({ id, cambios }: { id: string; cambios: Partial<DatosServicio> }) =>
      actualizarServicio(id, cambios),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['servicios'] }).then(() => queryClient.invalidateQueries({ queryKey: ['reserva'] })),
  });
  const borrado = useMutation({
    mutationFn: borrarServicio,
    onSuccess: () => {
      setAviso('Servicio borrado.');
      void queryClient.invalidateQueries({ queryKey: ['servicios'] }).then(() => queryClient.invalidateQueries({ queryKey: ['reserva'] }));
    },
  });

  const responsable = fiscal.data?.responsableIva ?? false;

  return (
    <div className="space-y-4">
      {fiscal.data && (
        <p className="text-sm text-muted-foreground">
          {responsable
            ? 'Tu taller es responsable de IVA: el cliente ve cada precio con el IVA incluido.'
            : 'Tu taller figura como No responsable de IVA: el precio cargado es el que ve el cliente.'}{' '}
          Se cambia en Datos fiscales.
        </p>
      )}

      {editando ? (
        <FormularioServicio
          servicio={editando === 'nuevo' ? null : editando}
          responsable={responsable}
          onListo={(mensaje) => {
            setEditando(null);
            setAviso(mensaje);
            void queryClient.invalidateQueries({ queryKey: ['servicios'] }).then(() => queryClient.invalidateQueries({ queryKey: ['reserva'] }));
          }}
          onCancelar={() => setEditando(null)}
        />
      ) : (
        <Button
          onClick={() => {
            setAviso(null);
            setEditando('nuevo');
          }}
        >
          <Plus aria-hidden /> Nuevo servicio
        </Button>
      )}

      {aviso && <Aviso tipo="exito">{aviso}</Aviso>}
      {(cambio.isError || borrado.isError) && (
        <Aviso tipo="error">
          {mensajeError(cambio.error ?? borrado.error, 'No se pudo guardar el cambio.')}
        </Aviso>
      )}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Servicios</CardTitle>
        </CardHeader>
        <CardContent>
          {servicios.isPending ? (
            <EstadoCargando etiqueta="Cargando servicios…" />
          ) : servicios.isError ? (
            <EstadoError error={servicios.error} onReintentar={servicios.refetch} />
          ) : servicios.data.length === 0 ? (
            <EstadoVacio icono={Wrench} titulo="Todavia no hay servicios" />
          ) : (
            <ul className="divide-y" aria-label="Servicios">
              {servicios.data.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 sm:flex-1">
                    <p className="font-medium">
                      {s.nombre}
                      {!s.activo && (
                        <Badge variant="secondary" className="ml-2">
                          Inactivo
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {CATEGORIA_LABEL[s.categoria]} · {formatearDuracion(s.duracionMinutos)}
                      {s.anticipo && ` · anticipo ${s.anticipo.porcentaje}%`}
                      {/* Sprint 22: va impreso en la orden de trabajo. */}
                      {s.garantiaDias === null
                        ? ' · sin garantia definida'
                        : ` · garantia ${s.garantiaDias} ${s.garantiaDias === 1 ? 'dia' : 'dias'}`}
                    </p>
                  </div>
                  <div className="sm:text-right">
                    <p className="text-sm font-semibold tabular-nums">{textoPrecioFinal(s.precio)}</p>
                    {textoDesglose(s.precio) && (
                      <p className="text-xs text-muted-foreground tabular-nums">{textoDesglose(s.precio)}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAviso(null);
                        setEditando(s);
                      }}
                      aria-label={`Editar ${s.nombre}`}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={cambio.isPending}
                      onClick={() => cambio.mutate({ id: s.id, cambios: { activo: !s.activo } })}
                      aria-label={`${s.activo ? 'Desactivar' : 'Activar'} ${s.nombre}`}
                    >
                      {s.activo ? 'Desactivar' : 'Activar'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={borrado.isPending}
                      onClick={() => {
                        setAviso(null);
                        borrado.mutate(s.id);
                      }}
                      aria-label={`Borrar ${s.nombre}`}
                    >
                      Borrar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FormularioServicio({
  servicio,
  responsable,
  onListo,
  onCancelar,
}: {
  servicio: Servicio | null;
  responsable: boolean;
  onListo: (mensaje: string) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(servicio?.nombre ?? '');
  const [categoria, setCategoria] = useState<DatosServicio['categoria']>(
    servicio?.categoria ?? 'mecanica',
  );
  const [duracion, setDuracion] = useState(String(servicio?.duracionMinutos ?? 30));
  const [tarifa, setTarifa] = useState<TarifaIva>(servicio?.tarifaIva ?? 19);
  // Que carga el admin: la base (sin IVA) o el precio final.
  const [modo, setModo] = useState<'base' | 'final'>('base');
  const [monto, setMonto] = useState(
    // Coma decimal: pesosACentavos toma el punto como separador de miles.
    servicio ? String(servicio.precioBaseCentavos / 100).replace('.', ',') : '',
  );
  const [anticipo, setAnticipo] = useState(servicio?.requiereAnticipo ?? false);
  const [porcentaje, setPorcentaje] = useState(String(servicio?.porcentajeAnticipo ?? 20));
  // Vacio = sin termino definido (la orden remite a la garantia legal).
  const [garantia, setGarantia] = useState(
    servicio?.garantiaDias == null ? '' : String(servicio.garantiaDias),
  );

  const centavos = pesosACentavos(monto);
  const base =
    centavos === null
      ? null
      : modo === 'final' && responsable
        ? baseDesdeTotal(centavos, tarifa)
        : centavos;
  const vista = base === null ? null : calcularPrecio(base, tarifa, responsable);

  const guardar = useMutation({
    mutationFn: (datos: DatosServicio) =>
      servicio ? actualizarServicio(servicio.id, datos) : crearServicio(datos),
    onSuccess: (s) => onListo(servicio ? `Servicio ${s.nombre} actualizado.` : `Servicio ${s.nombre} creado.`),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (base === null) return;
    guardar.mutate({
      nombre: nombre.trim(),
      categoria,
      duracionMinutos: Number(duracion),
      precioBaseCentavos: base,
      tarifaIva: tarifa,
      requiereAnticipo: anticipo,
      porcentajeAnticipo: anticipo ? Number(porcentaje) : null,
      garantiaDias: garantia.trim() === '' ? null : Number(garantia),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{servicio ? `Editar ${servicio.nombre}` : 'Nuevo servicio'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={enviar} className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Nombre">
            <Input value={nombre} required maxLength={120} onChange={(e) => setNombre(e.target.value)} />
          </Campo>
          <Campo etiqueta="Categoria">
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value as DatosServicio['categoria'])}
              className={CLASE_SELECT}
            >
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORIA_LABEL[c]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Duracion (minutos)">
            <Input
              type="number"
              min={5}
              max={600}
              step={5}
              required
              value={duracion}
              onChange={(e) => setDuracion(e.target.value)}
            />
          </Campo>
          <Campo
            etiqueta="Tarifa de IVA"
            ayuda={responsable ? undefined : 'Aplica cuando el taller sea responsable de IVA.'}
          >
            <select
              value={tarifa}
              onChange={(e) => setTarifa(Number(e.target.value) as TarifaIva)}
              className={CLASE_SELECT}
            >
              <option value={19}>19% (general)</option>
              <option value={5}>5% (reducida)</option>
              <option value={0}>0% (exento o excluido)</option>
            </select>
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
                placeholder="80.000"
                aria-invalid={monto !== '' && centavos === null}
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                aria-label={modo === 'final' && responsable ? 'Precio final con IVA' : 'Valor base'}
              />
            </div>
            {vista && (
              <p className="text-sm" data-testid="vista-precio">
                El cliente ve <strong className="tabular-nums">{textoPrecioFinal(vista)}</strong>
                {textoDesglose(vista) && (
                  <span className="text-muted-foreground tabular-nums"> · {textoDesglose(vista)}</span>
                )}
                {modo === 'final' && responsable && base !== null && (
                  <span className="text-muted-foreground"> · base guardada {formatearPesos(base)}</span>
                )}
              </p>
            )}
          </fieldset>

          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="text-sm font-medium">Anticipo</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={anticipo} onChange={(e) => setAnticipo(e.target.checked)} />
              Pide anticipo al reservar (servicios de alto impacto)
            </label>
            {anticipo && (
              <Campo etiqueta="Porcentaje del anticipo" ayuda="Entre 15% y 20% del total." className="max-w-xs">
                <Input
                  type="number"
                  min={15}
                  max={20}
                  required
                  value={porcentaje}
                  onChange={(e) => setPorcentaje(e.target.value)}
                />
              </Campo>
            )}
            {anticipo && vista && (
              <p className="text-xs text-muted-foreground tabular-nums">
                Anticipo: {formatearPesos(Math.floor((vista.totalCentavos * Number(porcentaje) + 50) / 100))}. El
                cobro en linea llega con los pagos.
              </p>
            )}
          </fieldset>

          <Campo
            etiqueta="Garantia (dias)"
            ayuda="Termino de garantia del servicio desde la entrega (Decreto 735 de 2013). Va impreso en la orden de trabajo. Vacio: rige la garantia legal."
            className="sm:col-span-2 sm:max-w-sm"
          >
            <Input
              type="number"
              min={0}
              max={3650}
              value={garantia}
              placeholder="Ej: 90"
              onChange={(e) => setGarantia(e.target.value)}
            />
          </Campo>

          {guardar.isError && (
            <div className="sm:col-span-2">
              <Aviso tipo="error">{mensajeError(guardar.error, 'No se pudo guardar el servicio.')}</Aviso>
            </div>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={guardar.isPending || base === null}>
              {guardar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              {servicio ? 'Guardar cambios' : 'Crear servicio'}
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
