import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Car, CircleCheck, LoaderCircle, Plus, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Aviso } from '@/features/taller/comunes';
import { mensajeError } from '@/features/taller/formulario';
import { FormularioVehiculo } from '@/features/vehiculos/FormularioVehiculo';
import { describirVehiculo } from '@/features/vehiculos/vehiculos';
import {
  darDeBajaVehiculo,
  getMisStrikes,
  getVehiculos,
  reclamarStrike,
  type Strike,
  type Vehiculo,
} from '@/lib/api-client';
import { fechaDeInstante, formatearFechaConAnio, formatearFechaLarga, formatearHora } from '@/lib/dates';
import { CLASE_TEXTAREA, ESTADO_STRIKE, MOTIVO_STRIKE } from './strikes';

/**
 * Perfil del cliente (Sprint 22): sus vehiculos y sus strikes en cada
 * taller, con el reclamo. Los strikes son por taller: cada uno dice de
 * cual es.
 */
export function PerfilView() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Mi perfil</h1>
        <p className="text-sm text-muted-foreground">Tus vehiculos y tu historial de cancelaciones.</p>
      </div>
      <VehiculosCliente />
      <StrikesCliente />
    </div>
  );
}

function VehiculosCliente() {
  const queryClient = useQueryClient();
  const vehiculos = useQuery({ queryKey: ['vehiculos', 'mios'], queryFn: () => getVehiculos() });
  const [editando, setEditando] = useState<Vehiculo | 'nuevo' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const baja = useMutation({
    mutationFn: darDeBajaVehiculo,
    onSuccess: () => {
      setAviso('Vehiculo quitado de tu lista.');
      void queryClient.invalidateQueries({ queryKey: ['vehiculos'] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Mis vehiculos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {aviso && <Aviso tipo="exito">{aviso}</Aviso>}
        {baja.isError && <Aviso tipo="error">{mensajeError(baja.error, 'No se pudo quitar el vehiculo.')}</Aviso>}
        {vehiculos.isPending ? (
          <EstadoCargando etiqueta="Cargando vehiculos…" />
        ) : vehiculos.isError ? (
          <EstadoError error={vehiculos.error} onReintentar={vehiculos.refetch} />
        ) : vehiculos.data.length === 0 && editando === null ? (
          <EstadoVacio
            icono={Car}
            titulo="Todavia no cargaste vehiculos"
            descripcion="Con tu vehiculo cargado, el taller lo tiene listo al recibirlo."
          />
        ) : (
          <ul className="divide-y" aria-label="Vehiculos">
            {vehiculos.data.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 py-3">
                <Car className="size-4 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{describirVehiculo(v)}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {v.kilometraje.toLocaleString('es-CO')} km
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Editar ${v.placa}`}
                    onClick={() => {
                      setAviso(null);
                      setEditando(v);
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Quitar ${v.placa}`}
                    disabled={baja.isPending}
                    onClick={() => {
                      setAviso(null);
                      baja.mutate(v.id);
                    }}
                  >
                    Quitar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {editando ? (
          <FormularioVehiculo
            vehiculo={editando === 'nuevo' ? undefined : editando}
            onListo={(v) => {
              setEditando(null);
              setAviso(editando === 'nuevo' ? `Vehiculo ${v.placa} agregado.` : `Vehiculo ${v.placa} actualizado.`);
              void queryClient.invalidateQueries({ queryKey: ['vehiculos'] });
            }}
            onCancelar={() => setEditando(null)}
          />
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              setAviso(null);
              setEditando('nuevo');
            }}
          >
            <Plus aria-hidden /> Agregar vehiculo
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function StrikesCliente() {
  const strikes = useQuery({ queryKey: ['strikes', 'mios'], queryFn: getMisStrikes });
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Cancelaciones tardias y faltas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Cancelar o reprogramar fuera del plazo del taller, o no presentarte, suma un strike en ese
          taller. Vencen solos con el tiempo. Con 3 vigentes en un taller, ahi solo podes reservar
          pagando el total por adelantado. Si uno no corresponde, reclamalo.
        </p>
        {strikes.isPending ? (
          <EstadoCargando etiqueta="Cargando…" />
        ) : strikes.isError ? (
          <EstadoError error={strikes.error} onReintentar={strikes.refetch} />
        ) : strikes.data.length === 0 ? (
          <EstadoVacio icono={CircleCheck} titulo="Sin strikes" descripcion="Nunca cancelaste tarde ni faltaste." />
        ) : (
          <ul className="space-y-3" aria-label="Strikes">
            {strikes.data.map((s) => (
              <TarjetaStrike key={s.id} strike={s} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TarjetaStrike({ strike }: { strike: Strike }) {
  const queryClient = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const reclamo = useMutation({
    mutationFn: () => reclamarStrike(strike.id, texto.trim()),
    onSuccess: () => {
      setAbierto(false);
      void queryClient.invalidateQueries({ queryKey: ['strikes'] });
    },
  });
  const estado = ESTADO_STRIKE[strike.estado];

  function enviar(e: FormEvent) {
    e.preventDefault();
    reclamo.mutate();
  }

  return (
    <li className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            <ShieldAlert className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
            {MOTIVO_STRIKE[strike.motivo]} · {strike.taller.nombre}
          </p>
          <p className="text-sm">{strike.detalle}</p>
          <p className="text-xs text-muted-foreground">
            {formatearFechaLarga(fechaDeInstante(strike.creadoEn))}
            {strike.estado === 'vigente' &&
              ` · vence el ${formatearFechaConAnio(fechaDeInstante(strike.venceEn))}`}
          </p>
        </div>
        <Badge variant={estado.variante}>{estado.texto}</Badge>
      </div>

      {strike.anulacion && (
        <p className="text-sm text-muted-foreground">
          Anulado por el taller: {strike.anulacion.justificacion}
        </p>
      )}

      {strike.reclamo ? (
        <div className="rounded-md bg-muted p-2 text-sm">
          <p>
            <span className="font-medium">Tu reclamo:</span> {strike.reclamo.texto}
          </p>
          {strike.reclamo.resultado === null ? (
            <p className="text-muted-foreground">Esperando respuesta del taller.</p>
          ) : (
            <p>
              <span className="font-medium">
                {strike.reclamo.resultado === 'aceptado' ? 'Aceptado' : 'Rechazado'}:
              </span>{' '}
              {strike.reclamo.respuesta}
            </p>
          )}
        </div>
      ) : strike.estado === 'vigente' && !abierto ? (
        <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
          Reclamar
        </Button>
      ) : null}

      {abierto && (
        <form onSubmit={enviar} className="space-y-2">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Que paso</span>
            <textarea
              required
              minLength={10}
              maxLength={2000}
              rows={3}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className={CLASE_TEXTAREA}
            />
            <span className="block text-xs text-muted-foreground">
              El turno era el {formatearFechaLarga(fechaDeInstante(strike.turno.inicio))} a las{' '}
              {formatearHora(strike.turno.inicio)} ({strike.turno.servicio}).
            </span>
          </label>
          {reclamo.isError && <Aviso tipo="error">{mensajeError(reclamo.error, 'No se pudo enviar el reclamo.')}</Aviso>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={reclamo.isPending || texto.trim().length < 10}>
              {reclamo.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              Enviar reclamo
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
