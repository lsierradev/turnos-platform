import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CLASE_TEXTAREA } from '@/features/perfil/strikes';
import { Aviso, Campo } from '@/features/taller/comunes';
import { CLASE_SELECT, mensajeError } from '@/features/taller/formulario';
import { FormularioVehiculo } from '@/features/vehiculos/FormularioVehiculo';
import { describirVehiculo } from '@/features/vehiculos/vehiculos';
import {
  aceptarRecepcion,
  getFotoRecepcion,
  getVehiculos,
  guardarRecepcion,
  quitarFotoRecepcion,
  subirFotoRecepcion,
  type OrdenTrabajo,
} from '@/lib/api-client';
import { fechaDeInstante, formatearFechaHora, formatearHora, instanteDelTaller } from '@/lib/dates';
import { prepararFoto } from './fotos';

const NIVELES_COMBUSTIBLE = ['Reserva', '1/4', '1/2', '3/4', 'Lleno'];
const MAX_FOTOS = 6;

type Recepcion = NonNullable<OrdenTrabajo['recepcion']>;

/**
 * Formulario de la recepcion (Sprint 22), para crear o corregir el
 * borrador. El vehiculo es del cliente del turno; si no lo tiene cargado,
 * se agrega aca mismo (fuera del <form>: no se anidan formularios).
 */
export function FormularioRecepcion({
  orden,
  onGuardada,
  onCancelar,
}: {
  orden: OrdenTrabajo;
  onGuardada: (o: OrdenTrabajo) => void;
  onCancelar?: () => void;
}) {
  const queryClient = useQueryClient();
  const clienteId = orden.cliente?.id;
  const vehiculos = useQuery({
    queryKey: ['vehiculos', clienteId],
    queryFn: () => getVehiculos(clienteId),
    enabled: Boolean(clienteId),
  });
  const r = orden.recepcion;
  const [vehiculoId, setVehiculoId] = useState(orden.vehiculo?.id ?? '');
  const [agregando, setAgregando] = useState(false);
  const [km, setKm] = useState(r ? String(r.kilometraje) : orden.vehiculo ? String(orden.vehiculo.kilometraje) : '');
  const [combustible, setCombustible] = useState(r?.nivelCombustible ?? 2);
  const [estado, setEstado] = useState(r?.estadoVehiculo ?? '');
  const [objetos, setObjetos] = useState(r && r.objetosDejados !== 'Ninguno' ? r.objetosDejados : '');
  const [observaciones, setObservaciones] = useState(r?.observaciones ?? '');
  const entregaInicial = r?.fechaProbableEntrega ?? orden.turno.fin;
  const [fechaEntrega, setFechaEntrega] = useState(fechaDeInstante(entregaInicial));
  const [horaEntrega, setHoraEntrega] = useState(formatearHora(entregaInicial));

  // Un solo vehiculo cargado: se elige solo.
  useEffect(() => {
    if (!vehiculoId && vehiculos.data?.length === 1) {
      setVehiculoId(vehiculos.data[0].id);
      if (!km) setKm(String(vehiculos.data[0].kilometraje));
    }
  }, [vehiculos.data, vehiculoId, km]);

  const guardar = useMutation({
    mutationFn: () =>
      guardarRecepcion(orden.turno.id, {
        vehiculoId,
        kilometraje: Number(km),
        nivelCombustible: combustible,
        estadoVehiculo: estado.trim(),
        objetosDejados: objetos.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
        fechaProbableEntrega: instanteDelTaller(fechaEntrega, horaEntrega),
      }),
    onSuccess: onGuardada,
  });

  const kmAnterior = vehiculos.data?.find((v) => v.id === vehiculoId)?.kilometraje;
  const kmMenor = kmAnterior !== undefined && km !== '' && Number(km) < kmAnterior;

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!vehiculoId) return;
    guardar.mutate();
  }

  return (
    <div className="space-y-4">
      {agregando && clienteId && (
        <div className="rounded-lg border p-3">
          <p className="mb-3 text-sm font-medium">Nuevo vehiculo de {orden.cliente?.nombre}</p>
          <FormularioVehiculo
            clienteId={clienteId}
            onListo={(v) => {
              setAgregando(false);
              setVehiculoId(v.id);
              setKm(String(v.kilometraje));
              void queryClient.invalidateQueries({ queryKey: ['vehiculos'] });
            }}
            onCancelar={() => setAgregando(false)}
          />
        </div>
      )}

      <form onSubmit={enviar} className="grid gap-4 sm:grid-cols-2" aria-label="Recepcion del vehiculo">
        <Campo etiqueta="Vehiculo" className="sm:col-span-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              required
              value={vehiculoId}
              onChange={(e) => {
                setVehiculoId(e.target.value);
                const v = vehiculos.data?.find((x) => x.id === e.target.value);
                if (v) setKm(String(v.kilometraje));
              }}
              className={CLASE_SELECT}
            >
              <option value="" disabled>
                {vehiculos.isPending ? 'Cargando…' : 'Elegir vehiculo…'}
              </option>
              {vehiculos.data?.map((v) => (
                <option key={v.id} value={v.id}>
                  {describirVehiculo(v)}
                </option>
              ))}
            </select>
            {!agregando && (
              <Button type="button" variant="outline" size="sm" onClick={() => setAgregando(true)}>
                <Plus aria-hidden /> Otro vehiculo
              </Button>
            )}
          </div>
        </Campo>
        <Campo
          etiqueta="Kilometraje"
          ayuda={kmMenor ? `Es menor al ultimo registrado (${kmAnterior!.toLocaleString('es-CO')} km). Revisalo.` : undefined}
        >
          <Input
            type="number"
            required
            min={0}
            max={3000000}
            inputMode="numeric"
            value={km}
            aria-invalid={kmMenor}
            onChange={(e) => setKm(e.target.value)}
          />
        </Campo>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Combustible</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {NIVELES_COMBUSTIBLE.map((n, i) => (
              <label key={n} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="combustible"
                  checked={combustible === i}
                  onChange={() => setCombustible(i)}
                />
                {n}
              </label>
            ))}
          </div>
        </fieldset>
        <Campo
          etiqueta="Estado del vehiculo"
          ayuda="Golpes, rayones, testigos encendidos: lo que se ve al recibirlo."
          className="sm:col-span-2"
        >
          <textarea
            required
            rows={3}
            maxLength={4000}
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            className={CLASE_TEXTAREA}
          />
        </Campo>
        <Campo etiqueta="Objetos dejados en el vehiculo" ayuda="Vacio: ninguno.">
          <textarea
            rows={2}
            maxLength={2000}
            value={objetos}
            onChange={(e) => setObjetos(e.target.value)}
            className={CLASE_TEXTAREA}
          />
        </Campo>
        <Campo etiqueta="Observaciones">
          <textarea
            rows={2}
            maxLength={4000}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            className={CLASE_TEXTAREA}
          />
        </Campo>
        <Campo etiqueta="Entrega probable (dia)">
          <Input type="date" required value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} />
        </Campo>
        <Campo etiqueta="Entrega probable (hora del taller)">
          <Input type="time" required value={horaEntrega} onChange={(e) => setHoraEntrega(e.target.value)} />
        </Campo>

        {guardar.isError && (
          <div className="sm:col-span-2">
            <Aviso tipo="error">{mensajeError(guardar.error, 'No se pudo guardar la recepcion.')}</Aviso>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={guardar.isPending || !vehiculoId}>
            {guardar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
            {r ? 'Guardar cambios' : 'Registrar recepcion'}
          </Button>
          {onCancelar && (
            <Button type="button" variant="outline" onClick={onCancelar}>
              Cancelar
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

/** Datos de la recepcion como constancia (tambien lo que se imprime). */
export function DetalleRecepcion({ recepcion }: { recepcion: Recepcion }) {
  const filas: [string, string][] = [
    ['Recibido', `${formatearFechaHora(recepcion.creadoEn)}${recepcion.recibidoPor ? ` · por ${recepcion.recibidoPor}` : ''}`],
    ['Entrega probable', formatearFechaHora(recepcion.fechaProbableEntrega)],
    ['Kilometraje', `${recepcion.kilometraje.toLocaleString('es-CO')} km`],
    ['Combustible', NIVELES_COMBUSTIBLE[recepcion.nivelCombustible] ?? String(recepcion.nivelCombustible)],
    ['Estado del vehiculo', recepcion.estadoVehiculo],
    ['Objetos dejados', recepcion.objetosDejados],
    ...(recepcion.observaciones ? [['Observaciones', recepcion.observaciones] as [string, string]] : []),
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
      {filas.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium whitespace-pre-line">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Una foto: viene con el token, asi que se baja como Blob. */
function Miniatura({
  recepcionId,
  fotoId,
  taller,
  onQuitar,
  quitando,
}: {
  recepcionId: string;
  fotoId: string;
  taller?: string;
  onQuitar?: () => void;
  quitando?: boolean;
}) {
  const foto = useQuery({
    queryKey: ['foto-recepcion', fotoId],
    queryFn: () => getFotoRecepcion(recepcionId, fotoId, taller),
    staleTime: Infinity,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!foto.data) return;
    const u = URL.createObjectURL(foto.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [foto.data]);

  return (
    <li className="relative size-28 overflow-hidden rounded-md border bg-muted print:size-40">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt="Foto de la recepcion" className="size-full object-cover" />
        </a>
      ) : (
        <span className="sr-only">Cargando foto…</span>
      )}
      {onQuitar && (
        <Button
          type="button"
          size="icon-xs"
          variant="secondary"
          className="absolute top-1 right-1 print:hidden"
          aria-label="Quitar foto"
          disabled={quitando}
          onClick={onQuitar}
        >
          <Trash2 aria-hidden />
        </Button>
      )}
    </li>
  );
}

export function FotosRecepcion({
  recepcion,
  editable,
  taller,
  onCambio,
}: {
  recepcion: Recepcion;
  editable: boolean;
  taller?: string;
  onCambio: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const subir = useMutation({
    mutationFn: async (archivos: File[]) => {
      for (const archivo of archivos) {
        await subirFotoRecepcion(recepcion.id, await prepararFoto(archivo));
      }
    },
    onSuccess: onCambio,
    onError: (e) => setError(mensajeError(e, e instanceof Error ? e.message : 'No se pudo subir la foto.')),
  });
  const quitar = useMutation({
    mutationFn: (fotoId: string) => quitarFotoRecepcion(recepcion.id, fotoId),
    onSuccess: onCambio,
  });
  const lugar = MAX_FOTOS - recepcion.fotos.length;

  if (!editable && recepcion.fotos.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Fotos ({recepcion.fotos.length})</p>
      {recepcion.fotos.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Fotos de la recepcion">
          {recepcion.fotos.map((f) => (
            <Miniatura
              key={f.id}
              recepcionId={recepcion.id}
              fotoId={f.id}
              taller={taller}
              quitando={quitar.isPending}
              onQuitar={editable ? () => quitar.mutate(f.id) : undefined}
            />
          ))}
        </ul>
      )}
      {editable && lugar > 0 && (
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm font-medium hover:bg-muted print:hidden">
          {subir.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
          {subir.isPending ? 'Subiendo…' : 'Agregar fotos (opcional)'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="sr-only"
            disabled={subir.isPending}
            onChange={(e) => {
              setError(null);
              const archivos = Array.from(e.target.files ?? []).slice(0, lugar);
              e.target.value = '';
              if (archivos.length) subir.mutate(archivos);
            }}
          />
        </label>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
    </div>
  );
}

/**
 * Aceptacion de la constancia. Personal: en el mostrador, con nombre y
 * documento de quien entrega. Cliente: desde su cuenta.
 */
export function AceptarRecepcion({
  recepcion,
  enMostrador,
  taller,
  onAceptada,
}: {
  recepcion: Recepcion;
  enMostrador: boolean;
  taller?: string;
  onAceptada: (o: OrdenTrabajo) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [documento, setDocumento] = useState('');
  const [leida, setLeida] = useState(false);
  const aceptar = useMutation({
    mutationFn: () =>
      aceptarRecepcion(
        recepcion.id,
        enMostrador ? { nombre: nombre.trim(), documento: documento.trim() } : {},
        taller,
      ),
    onSuccess: onAceptada,
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    aceptar.mutate();
  }

  return (
    <form onSubmit={enviar} className="space-y-3 rounded-lg border border-info/40 bg-info-suave p-3 print:hidden" aria-label="Aceptar la recepcion">
      <p className="text-sm font-semibold text-info-texto">
        {enMostrador ? 'Aceptacion en el mostrador' : 'Revisa y acepta la recepcion de tu vehiculo'}
      </p>
      <p className="text-sm">
        Al aceptarla queda como constancia de entrega para reparacion (Ley 1480 de 2011) y le llega
        por correo al cliente. Despues no se puede modificar.
      </p>
      {enMostrador && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre de quien entrega">
            <Input required maxLength={160} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </Campo>
          <Campo etiqueta="Documento">
            <Input required maxLength={40} value={documento} onChange={(e) => setDocumento(e.target.value)} />
          </Campo>
        </div>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={leida} onChange={(e) => setLeida(e.target.checked)} />
        {enMostrador
          ? 'Quien entrega leyo el estado, el kilometraje, el combustible y los objetos registrados y esta de acuerdo.'
          : 'Lei el estado, el kilometraje, el combustible y los objetos registrados y estoy de acuerdo.'}
      </label>
      {aceptar.isError && <Aviso tipo="error">{mensajeError(aceptar.error, 'No se pudo aceptar la recepcion.')}</Aviso>}
      <Button type="submit" disabled={!leida || aceptar.isPending}>
        {aceptar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
        Aceptar recepcion
      </Button>
    </form>
  );
}
