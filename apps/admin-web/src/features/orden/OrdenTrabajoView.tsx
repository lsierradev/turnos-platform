import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LoaderCircle, Printer } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { EstadoCargando, EstadoError } from '@/components/estados';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ESTADO_TURNO_LABEL } from '@/features/agenda/linea-tiempo';
import { useAuth } from '@/features/auth/AuthProvider';
import { CLASE_TEXTAREA } from '@/features/perfil/strikes';
import { Aviso } from '@/features/taller/comunes';
import { CLASE_SELECT, mensajeError } from '@/features/taller/formulario';
import {
  cancelarTurno,
  cerrarTurno,
  finalizarAtencion,
  getOrden,
  guardarNotas,
  iniciarAtencion,
  type EstadoTurno,
  type OrdenTrabajo,
} from '@/lib/api-client';
import { formatearFechaHora, formatearHora, ZONA_NEGOCIO } from '@/lib/dates';
import { formatearPesos, textoPrecioFinal } from '@/lib/dinero';
import { actuaComoAdmin } from '@/lib/sesion';
import { esUuid } from '@/lib/uuid';
import {
  AceptarRecepcion,
  DetalleRecepcion,
  FormularioRecepcion,
  FotosRecepcion,
} from './RecepcionSeccion';

/**
 * Orden de trabajo de un turno (Sprint 22): recepcion del vehiculo (la
 * constancia de la Ley 1480), atencion del tecnico, cierre y garantia. La
 * ve el personal del taller y el titular del turno; se imprime.
 *
 * ?taller= : el cliente puede estar mirando otro taller; la orden se pide
 * en el del turno (lo pone el enlace de "Mis turnos").
 */
export function OrdenTrabajoView() {
  const { turnoId } = useParams<{ turnoId: string }>();
  const [params] = useSearchParams();
  const taller = params.get('taller') ?? undefined;
  const { usuario } = useAuth();
  const queryClient = useQueryClient();
  const valido = esUuid(turnoId);
  const orden = useQuery({
    queryKey: ['orden', turnoId],
    queryFn: () => getOrden(turnoId!, taller),
    enabled: valido,
  });

  const refrescar = (nueva?: OrdenTrabajo) => {
    if (nueva) queryClient.setQueryData(['orden', turnoId], nueva);
    void queryClient.invalidateQueries({ queryKey: ['orden', turnoId] });
    for (const clave of ['agenda', 'turnos-bahia', 'carga-bahias', 'kpis', 'mis-turnos', 'strikes']) {
      void queryClient.invalidateQueries({ queryKey: [clave] });
    }
  };

  const personal = usuario?.rol === 'admin' || usuario?.rol === 'tecnico' || usuario?.rol === 'superadmin';
  const volver = personal ? (usuario?.rol === 'tecnico' ? `/agenda/${usuario.id}` : '/admin') : '/mis-turnos';

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6 print:max-w-none print:p-0">
      <Link to={volver} className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} print:hidden`}>
        <ArrowLeft aria-hidden /> Volver
      </Link>
      {!valido ? (
        <EstadoError error={new Error('La direccion no tiene un id de turno valido.')} />
      ) : orden.isPending ? (
        <EstadoCargando forma="bloque" etiqueta="Cargando la orden…" />
      ) : orden.isError ? (
        <EstadoError error={orden.error} onReintentar={orden.refetch} />
      ) : (
        <Orden orden={orden.data} personal={personal} taller={taller} onCambio={refrescar} />
      )}
    </div>
  );
}

function Filas({ filas }: { filas: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
      {filas.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Orden({
  orden,
  personal,
  taller,
  onCambio,
}: {
  orden: OrdenTrabajo;
  personal: boolean;
  taller?: string;
  onCambio: (nueva?: OrdenTrabajo) => void;
}) {
  const { usuario } = useAuth();
  const esAdmin = actuaComoAdmin(usuario);
  const { turno, recepcion, vehiculo, cliente } = orden;
  const [editando, setEditando] = useState(false);
  const programado = turno.estado === 'programado';
  const t = orden.taller;

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">
            {orden.numero !== null ? `Orden de trabajo N.° ${orden.numero}` : 'Orden de trabajo'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {turno.servicio.nombre} · {formatearFechaHora(turno.inicio)}–{formatearHora(turno.fin)} (hora del taller,{' '}
            {ZONA_NEGOCIO})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={programado ? 'secondary' : 'outline'}>{ESTADO_TURNO_LABEL[turno.estado]}</Badge>
          {recepcion && (
            <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}>
              <Printer aria-hidden /> Imprimir
            </Button>
          )}
        </div>
      </header>

      <Card className="print:shadow-none">
        <CardHeader>
          <CardTitle as="h2">Datos</CardTitle>
        </CardHeader>
        <CardContent>
          <Filas
            filas={[
              [
                'Taller',
                <>
                  {t.razonSocial ?? t.nombre}
                  {t.nit && ` · NIT ${t.nit}${t.dv !== null ? `-${t.dv}` : ''}`}
                  {t.direccion && (
                    <span className="block font-normal text-muted-foreground">
                      {t.direccion}
                      {t.municipio && `, ${t.municipio}`}
                    </span>
                  )}
                </>,
              ],
              ['Cliente', cliente ? `${cliente.nombre} · ${cliente.email}${cliente.telefono ? ` · ${cliente.telefono}` : ''}` : '—'],
              [
                'Vehiculo',
                vehiculo ? `${vehiculo.marca} ${vehiculo.modelo} ${vehiculo.anio} · placa ${vehiculo.placa}` : 'Sin registrar',
              ],
              ['Servicio', `${turno.servicio.nombre} · ${turno.bahia}`],
              ['Tecnico', turno.tecnico?.nombre ?? 'Sin asignar'],
              ...(turno.precio ? [['Valor', textoPrecioFinal(turno.precio)] as [string, ReactNode]] : []),
              ...(turno.anticipo
                ? [
                    [
                      'Por adelantado',
                      `${formatearPesos(turno.anticipo.centavos)}${turno.anticipo.porStrikes ? ' (100%: el cliente tiene 3 strikes en el taller)' : ''}`,
                    ] as [string, ReactNode],
                  ]
                : []),
              ...(turno.estado === 'cancelado'
                ? [
                    [
                      'Cancelado',
                      `${turno.canceladoPor === 'taller' ? 'Por el taller' : turno.canceladoPor === 'cliente' ? 'Por el cliente' : ''}${turno.motivoCancelacion ? ` · ${turno.motivoCancelacion}` : ''}`,
                    ] as [string, ReactNode],
                  ]
                : []),
            ]}
          />
        </CardContent>
      </Card>

      <Card className="print:shadow-none">
        <CardHeader>
          <CardTitle as="h2">Recepcion del vehiculo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!recepcion ? (
            personal && programado ? (
              <FormularioRecepcion orden={orden} onGuardada={onCambio} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {programado
                  ? 'El taller todavia no registro la recepcion del vehiculo.'
                  : 'Este turno no tuvo recepcion del vehiculo.'}
              </p>
            )
          ) : editando ? (
            <FormularioRecepcion
              orden={orden}
              onGuardada={(o) => {
                setEditando(false);
                onCambio(o);
              }}
              onCancelar={() => setEditando(false)}
            />
          ) : (
            <>
              <DetalleRecepcion recepcion={recepcion} />
              <FotosRecepcion
                recepcion={recepcion}
                editable={personal && !recepcion.aceptacion}
                taller={taller}
                onCambio={() => onCambio()}
              />
              {recepcion.aceptacion ? (
                <p className="text-sm" data-testid="recepcion-aceptada">
                  {recepcion.aceptacion.medio === 'presencial'
                    ? `Aceptada en el taller por ${recepcion.aceptacion.nombre} (documento ${recepcion.aceptacion.documento}) el ${formatearFechaHora(recepcion.aceptacion.en)}.`
                    : `Aceptada por el cliente desde su cuenta el ${formatearFechaHora(recepcion.aceptacion.en)}.`}{' '}
                  <span className="text-muted-foreground">La constancia se envio por correo.</span>
                </p>
              ) : (
                <>
                  {personal && programado && (
                    <Button variant="outline" size="sm" className="print:hidden" onClick={() => setEditando(true)}>
                      Corregir recepcion
                    </Button>
                  )}
                  {(personal || usuario?.id === cliente?.id) && (
                    <AceptarRecepcion
                      recepcion={recepcion}
                      enMostrador={personal}
                      taller={taller}
                      onAceptada={onCambio}
                    />
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Atencion orden={orden} personal={personal} esAdmin={esAdmin} onCambio={onCambio} />

      {personal && <Cierre orden={orden} esAdmin={esAdmin} onCambio={onCambio} />}

      <Card className="print:shadow-none">
        <CardHeader>
          <CardTitle as="h2">Garantia</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm" data-testid="texto-garantia">
            {orden.garantia.texto}
          </p>
        </CardContent>
      </Card>
    </>
  );
}

function Atencion({
  orden,
  personal,
  esAdmin,
  onCambio,
}: {
  orden: OrdenTrabajo;
  personal: boolean;
  esAdmin: boolean;
  onCambio: () => void;
}) {
  const { atencion, turno } = orden;
  const [notas, setNotas] = useState(atencion.notas ?? '');
  const programado = turno.estado === 'programado';
  const accion = useMutation({
    mutationFn: (que: 'inicio' | 'fin' | 'notas') =>
      que === 'inicio'
        ? iniciarAtencion(turno.id)
        : que === 'fin'
          ? finalizarAtencion(turno.id, notas)
          : guardarNotas(turno.id, notas),
    onSuccess: () => onCambio(),
  });

  if (!personal && !atencion.inicio && !atencion.notas) return null;
  return (
    <Card className="print:shadow-none">
      <CardHeader>
        <CardTitle as="h2">Atencion</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Filas
          filas={[
            ['Inicio', atencion.inicio ? formatearFechaHora(atencion.inicio) : 'Sin iniciar'],
            ['Fin', atencion.fin ? formatearFechaHora(atencion.fin) : '—'],
            ...(!personal && atencion.notas ? [['Notas del tecnico', atencion.notas] as [string, ReactNode]] : []),
          ]}
        />
        {personal && (
          <>
            {programado && (
              <div className="flex flex-wrap gap-2 print:hidden">
                {!atencion.inicio && (
                  <Button disabled={accion.isPending} onClick={() => accion.mutate('inicio')}>
                    Iniciar atencion
                  </Button>
                )}
                {atencion.inicio && !atencion.fin && (
                  <Button disabled={accion.isPending} onClick={() => accion.mutate('fin')}>
                    Finalizar atencion
                  </Button>
                )}
              </div>
            )}
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Notas del tecnico</span>
              <textarea
                rows={3}
                maxLength={4000}
                value={notas}
                // Cerrado, las notas las corrige solo el admin (el backend lo exige igual).
                disabled={!programado && !esAdmin}
                onChange={(e) => setNotas(e.target.value)}
                className={`${CLASE_TEXTAREA} print:hidden`}
              />
              {notas && <span className="hidden whitespace-pre-line print:block">{notas}</span>}
            </label>
            <Button
              variant="outline"
              size="sm"
              className="print:hidden"
              disabled={accion.isPending || notas === (atencion.notas ?? '')}
              onClick={() => accion.mutate('notas')}
            >
              {accion.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              Guardar notas
            </Button>
            {accion.isError && <Aviso tipo="error">{mensajeError(accion.error, 'No se pudo guardar.')}</Aviso>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Cierre({
  orden,
  esAdmin,
  onCambio,
}: {
  orden: OrdenTrabajo;
  esAdmin: boolean;
  onCambio: () => void;
}) {
  const { turno } = orden;
  const programado = turno.estado === 'programado';
  const empezo = Date.parse(turno.inicio) <= Date.now();
  const [motivo, setMotivo] = useState('');
  const [correccion, setCorreccion] = useState<EstadoTurno>(turno.estado);
  const [resultado, setResultado] = useState<string | null>(null);

  const cerrar = useMutation({
    mutationFn: (estado: EstadoTurno) => cerrarTurno(turno.id, estado),
    onSuccess: (_r, estado) => {
      setResultado(
        estado === 'no_asistio'
          ? 'Turno cerrado como no asistio. Se sumo un strike al cliente.'
          : `Turno cerrado como ${ESTADO_TURNO_LABEL[estado].toLowerCase()}.`,
      );
      onCambio();
    },
  });
  const cancelar = useMutation({
    mutationFn: (solicitadoPor: 'taller' | 'cliente') =>
      cancelarTurno(turno.id, { motivo: motivo.trim() || undefined, solicitadoPor }),
    onSuccess: (r) => {
      setResultado(
        r.strike
          ? 'Turno cancelado a pedido del cliente, fuera de plazo: se le sumo un strike.'
          : 'Turno cancelado. No suma strike al cliente.',
      );
      onCambio();
    },
  });
  const error = cerrar.error ?? cancelar.error;

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle as="h2">Cierre del turno</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {resultado && <Aviso tipo="exito">{resultado}</Aviso>}
        {error && <Aviso tipo="error">{mensajeError(error, 'No se pudo cerrar el turno.')}</Aviso>}
        {programado ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button disabled={cerrar.isPending} onClick={() => cerrar.mutate('atendido')}>
                Atendido
              </Button>
              <Button
                variant="outline"
                disabled={cerrar.isPending || !empezo}
                onClick={() => cerrar.mutate('no_asistio')}
              >
                No asistio
              </Button>
            </div>
            {!empezo && (
              <p className="text-xs text-muted-foreground">
                "No asistio" se habilita a la hora del turno ({formatearHora(turno.inicio)}).
              </p>
            )}
            {esAdmin && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-sm font-medium">Cancelar el turno</p>
                <input
                  aria-label="Motivo de la cancelacion"
                  placeholder="Motivo (opcional)"
                  maxLength={300}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  className={CLASE_TEXTAREA}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={cancelar.isPending}
                    onClick={() => cancelar.mutate('taller')}
                  >
                    El taller no puede atender
                  </Button>
                  <Button
                    variant="outline"
                    disabled={cancelar.isPending}
                    onClick={() => cancelar.mutate('cliente')}
                  >
                    El cliente pidio cancelar
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Si cancela el taller, nunca suma strike. Si lo pidio el cliente, aplica la politica
                  de cancelacion del taller.
                </p>
              </div>
            )}
          </>
        ) : esAdmin ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">Corregir el cierre</span>
              <select
                value={correccion}
                onChange={(e) => setCorreccion(e.target.value as EstadoTurno)}
                className={CLASE_SELECT}
              >
                {(['atendido', 'no_asistio', 'cancelado', 'programado'] as const).map((e) => (
                  <option key={e} value={e}>
                    {ESTADO_TURNO_LABEL[e]}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              disabled={cerrar.isPending || correccion === turno.estado}
              onClick={() => cerrar.mutate(correccion)}
            >
              Guardar
            </Button>
            <p className="w-full text-xs text-muted-foreground">
              Sacar un turno de "no asistio" anula el strike que sumo.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            El turno ya esta cerrado. Para corregirlo, pedile al administrador.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
