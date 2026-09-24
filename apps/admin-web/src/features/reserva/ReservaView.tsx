import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarCheck,
  CalendarX,
  CircleAlert,
  Clock,
  LoaderCircle,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { NavegadorFecha } from '@/components/NavegadorFecha';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  ApiError,
  crearCliente,
  crearTurno,
  sugerenciasDeConflicto,
  type Cliente,
  type DatosClienteNuevo,
  type NuevoTurno,
  type Opcion,
  type RangoTiempo,
  type Servicio,
  type TurnoCreado,
} from '@/lib/api-client';
import {
  fechaDeInstante,
  formatearDiaCorto,
  formatearDuracion,
  formatearFechaLarga,
  formatearHora,
  hoyISO,
  minutosDelDia,
  sumarDiasISO,
  ZONA_NEGOCIO,
} from '@/lib/dates';
import { describirError } from '@/lib/errores';
import {
  useBahiasQuery,
  useDisponibilidadQuery,
  useServiciosQuery,
  useTecnicosReservablesQuery,
} from './useReservaQueries';
import { CLIENTE_NUEVO_VACIO, validarClienteNuevo } from './cliente-nuevo';
import { SelectorCliente, type ModoCliente } from './SelectorCliente';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
type Campo = 'bahia' | 'servicio' | 'tecnico';

interface ConflictoReserva {
  mensaje: string;
  /** Instante que se intento y dio 409. */
  intentado: string;
  sugerencias: RangoTiempo[];
}

interface Reservado {
  turno: TurnoCreado;
  bahia: string;
  servicio: Servicio;
  tecnico: Opcion;
  /** Solo si reservo un admin para un cliente. */
  cliente?: Cliente;
  /** El cliente se registro con esta reserva. */
  clienteNuevo?: boolean;
}

interface Intento {
  turno: NuevoTurno;
  /** Cliente a dar de alta antes de reservar (admin, "Cliente nuevo"). */
  nuevo?: DatosClienteNuevo;
}

/** Fallo el alta del cliente, no la reserva: se muestra distinto. */
class ErrorAltaCliente extends Error {
  readonly causa: unknown;

  constructor(causa: unknown) {
    super(causa instanceof Error ? causa.message : 'No se pudo crear el cliente.');
    this.causa = causa;
  }
}

/**
 * Flujo de reserva (Sprint 17, UX-NOTES puntos 8-10).
 *
 * - Seleccion encadenada bahia -> servicio -> tecnico -> dia -> horario.
 *   Los tres catalogos se piden juntos al abrir; los horarios, apenas la
 *   combinacion esta completa (y el dia siguiente queda precargado).
 * - Sin UI optimista: el turno se muestra como reservado recien con el 201.
 *   Mientras tanto el boton queda deshabilitado con spinner y el formulario
 *   bloqueado, para que nadie cambie la seleccion con la request en vuelo.
 * - 409: las sugerencias del backend se ofrecen como botones que reintentan
 *   con ese horario.
 *
 * Seleccion y dia van en la URL, como en la agenda y el panel: recargar o
 * compartir el link no pierde lo elegido. El horario no: un horario libre
 * de hace un rato no es una promesa.
 */
export function ReservaView() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  const hoy = hoyISO();
  const fechaParam = params.get('fecha');
  const fecha =
    fechaParam && FECHA.test(fechaParam) && fechaParam >= hoy ? fechaParam : hoy;

  const bahias = useBahiasQuery();
  const servicios = useServiciosQuery();
  const tecnicos = useTecnicosReservablesQuery();

  // Un id de la URL solo vale si existe en el catalogo (una bahia dada de
  // baja, un link viejo): si no, el campo queda sin elegir.
  const bahia = bahias.data?.find((b) => b.id === params.get('bahia'));
  const servicio = servicios.data?.find((s) => s.id === params.get('servicio'));
  const tecnico = tecnicos.data?.find((t) => t.id === params.get('tecnico'));

  // A nombre de quien (solo admin). Un cliente siempre reserva para si
  // mismo: el backend toma el usuario del token.
  const [modoCliente, setModoCliente] = useState<ModoCliente>('existente');
  const [clienteElegido, setClienteElegido] = useState<Cliente | null>(null);
  const [datosNuevo, setDatosNuevo] = useState<DatosClienteNuevo>(CLIENTE_NUEVO_VACIO);
  const [mostrarErroresCliente, setMostrarErroresCliente] = useState(false);
  // Cliente creado en un intento que despues dio 409: al reintentar no se
  // vuelve a crear (daria "correo repetido"), y la confirmacion igual lo
  // muestra como recien registrado.
  // Ref y no estado: lo lee onSuccess en el mismo tick en que se escribio.
  const creadoEnIntento = useRef<Cliente | null>(null);

  const clienteListo =
    !esAdmin ||
    (modoCliente === 'existente'
      ? clienteElegido !== null
      : Object.keys(validarClienteNuevo(datosNuevo)).length === 0);

  const disponibilidad = useDisponibilidadQuery(
    bahia && servicio && tecnico
      ? {
          bahiaId: bahia.id,
          servicioId: servicio.id,
          tecnicoId: tecnico.id,
          fecha,
          clienteId: esAdmin ? clienteElegido?.id : undefined,
        }
      : null,
  );

  const [inicio, setInicio] = useState<string | null>(null);
  const [reservado, setReservado] = useState<Reservado | null>(null);
  // El 409 se guarda aparte del estado de la mutacion: al reintentar con
  // una sugerencia la mutacion pasa a pending y pierde el error, pero las
  // alternativas tienen que seguir a la vista (con el spinner en la
  // elegida) hasta que llegue la respuesta.
  const [conflicto, setConflicto] = useState<ConflictoReserva | null>(null);

  const reserva = useMutation({
    // Dos pasos cuando el admin da de alta un cliente: primero la cuenta
    // (usuarios-service), despues el turno a su nombre. No es atomico (son
    // dos servicios): si el turno falla, la cuenta queda creada y elegida
    // para el reintento, en vez de intentar crearla otra vez.
    mutationFn: async ({ turno, nuevo }: Intento) => {
      let clienteId = turno.clienteId;
      if (nuevo) {
        let creado: Cliente;
        try {
          creado = await crearCliente(nuevo);
        } catch (error) {
          throw new ErrorAltaCliente(error);
        }
        clienteId = creado.id;
        creadoEnIntento.current = creado;
        setClienteElegido(creado);
        setModoCliente('existente');
        void queryClient.invalidateQueries({ queryKey: ['clientes'] });
      }
      return crearTurno({ ...turno, clienteId });
    },
    onSuccess: (turno) => {
      setConflicto(null);
      const creado =
        creadoEnIntento.current?.id === turno.usuarioId ? creadoEnIntento.current : null;
      setReservado({
        turno,
        bahia: bahia!.nombre,
        servicio: servicio!,
        tecnico: tecnico!,
        cliente: esAdmin ? (creado ?? clienteElegido ?? undefined) : undefined,
        clienteNuevo: creado !== null,
      });
      // Todo lo que muestra ocupacion quedo viejo.
      for (const clave of ['disponibilidad', 'agenda', 'carga-bahias', 'turnos-bahia', 'kpis', 'mis-turnos']) {
        void queryClient.invalidateQueries({ queryKey: [clave] });
      }
    },
    onError: (error, { turno }) => {
      const sugerencias = sugerenciasDeConflicto(error);
      if (sugerencias !== null) {
        setConflicto({ mensaje: error.message, intentado: turno.inicio, sugerencias });
        // La grilla que se estaba mirando ya no es cierta.
        setInicio(null);
        void disponibilidad.refetch();
      }
    },
  });

  function elegir(campo: Campo, valor: string) {
    const siguiente = new URLSearchParams(params);
    if (valor) siguiente.set(campo, valor);
    else siguiente.delete(campo);
    setParams(siguiente, { replace: true });
    limpiarIntento();
  }

  function limpiarIntento() {
    setInicio(null);
    setConflicto(null);
    reserva.reset();
  }

  function irAFecha(f: string) {
    const siguiente = new URLSearchParams(params);
    if (f === hoy) siguiente.delete('fecha');
    else siguiente.set('fecha', f);
    setParams(siguiente, { replace: true });
  }

  function cambiarFecha(f: string) {
    irAFecha(f);
    limpiarIntento();
  }

  function reservar(instante: string) {
    if (!bahia || !servicio || !tecnico) return;
    if (!clienteListo) {
      setMostrarErroresCliente(true);
      document.getElementById('reserva-cliente')?.scrollIntoView({ block: 'start' });
      return;
    }
    setInicio(instante);
    // Una sugerencia puede caer en otro dia (el backend mira 3 dias).
    irAFecha(fechaDeInstante(instante));
    const nuevo =
      esAdmin && modoCliente === 'nuevo'
        ? {
            nombre: datosNuevo.nombre.trim(),
            email: datosNuevo.email.trim(),
            telefono: datosNuevo.telefono?.trim() || undefined,
            ciudad: datosNuevo.ciudad.trim(),
          }
        : undefined;
    reserva.mutate({
      turno: {
        bahiaId: bahia.id,
        servicioId: servicio.id,
        tecnicoId: tecnico.id,
        inicio: instante,
        clienteId: esAdmin && !nuevo ? clienteElegido?.id : undefined,
      },
      nuevo,
    });
  }

  function cambiarCliente(cambio: () => void) {
    cambio();
    limpiarIntento();
  }

  function reservarOtro() {
    setReservado(null);
    setClienteElegido(null);
    setDatosNuevo(CLIENTE_NUEVO_VACIO);
    setModoCliente('existente');
    setMostrarErroresCliente(false);
    creadoEnIntento.current = null;
    limpiarIntento();
  }

  if (reservado) {
    return (
      <Contenedor>
        <Confirmacion
          reservado={reservado}
          esAdmin={esAdmin}
          onReservarOtro={reservarOtro}
        />
      </Contenedor>
    );
  }

  const enVuelo = reserva.isPending;
  const catalogoConError = [bahias, servicios, tecnicos].find((q) => q.isError);
  const errorAlta = reserva.error instanceof ErrorAltaCliente ? reserva.error : null;
  const otroError =
    reserva.isError && !errorAlta && sugerenciasDeConflicto(reserva.error) === null
      ? reserva.error
      : null;
  const inicioEnVuelo = enVuelo ? reserva.variables?.turno.inicio : undefined;
  // Numeracion de los pasos: el admin tiene uno mas al principio.
  const paso = (n: number) => n + (esAdmin ? 1 : 0);
  const desdeSugerencia =
    inicioEnVuelo !== undefined &&
    Boolean(conflicto?.sugerencias.some((s) => s.inicio === inicioEnVuelo));

  const fin =
    inicio && servicio
      ? new Date(new Date(inicio).getTime() + servicio.duracionMinutos * 60_000).toISOString()
      : null;

  return (
    <Contenedor>
      {catalogoConError ? (
        <EstadoError error={catalogoConError.error} onReintentar={catalogoConError.refetch} />
      ) : (
        <form
          className="space-y-4"
          aria-busy={enVuelo}
          onSubmit={(e) => {
            e.preventDefault();
            if (inicio && !enVuelo) reservar(inicio);
          }}
        >
          {/* Un fieldset deshabilitado bloquea todo lo de adentro de una vez
              mientras la reserva esta en vuelo. min-w-0: un fieldset tiene
              min-width: min-content y un texto largo lo ensanchaba en el celular. */}
          <fieldset disabled={enVuelo} className="min-w-0 space-y-4">
            {esAdmin && (
              <Card id="reserva-cliente" className="scroll-mt-20">
                <CardHeader>
                  <CardTitle>1. Cliente</CardTitle>
                </CardHeader>
                <CardContent>
                  <SelectorCliente
                    modo={modoCliente}
                    onModo={(m) => cambiarCliente(() => setModoCliente(m))}
                    elegido={clienteElegido}
                    onElegir={(c) => cambiarCliente(() => setClienteElegido(c))}
                    datos={datosNuevo}
                    onDatos={setDatosNuevo}
                    mostrarErrores={mostrarErroresCliente}
                  />
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle>{paso(1)}. Que y donde</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <CampoSelect
                  id="reserva-bahia"
                  etiqueta="Bahia"
                  valor={bahia?.id ?? ''}
                  cargando={bahias.isPending}
                  vacio="No hay bahias en servicio"
                  opciones={(bahias.data ?? []).map((b) => ({ valor: b.id, texto: b.nombre }))}
                  onCambiar={(v) => elegir('bahia', v)}
                />
                <CampoSelect
                  id="reserva-servicio"
                  etiqueta="Servicio"
                  valor={servicio?.id ?? ''}
                  cargando={servicios.isPending}
                  bloqueadoPor={!bahia ? 'Elegi primero la bahia.' : undefined}
                  vacio="No hay servicios disponibles"
                  opciones={(servicios.data ?? []).map((s) => ({
                    valor: s.id,
                    texto: `${s.nombre} · ${formatearDuracion(s.duracionMinutos)}`,
                  }))}
                  onCambiar={(v) => elegir('servicio', v)}
                />
                <CampoSelect
                  id="reserva-tecnico"
                  etiqueta="Tecnico"
                  valor={tecnico?.id ?? ''}
                  cargando={tecnicos.isPending}
                  bloqueadoPor={
                    !bahia
                      ? 'Elegi primero la bahia.'
                      : !servicio
                        ? 'Elegi primero el servicio.'
                        : undefined
                  }
                  vacio="No hay tecnicos cargados"
                  opciones={(tecnicos.data ?? []).map((t) => ({ valor: t.id, texto: t.nombre }))}
                  onCambiar={(v) => elegir('tecnico', v)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{paso(2)}. Cuando</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <NavegadorFecha
                  fecha={fecha}
                  minimo={hoy}
                  etiqueta={formatearFechaLarga(fecha)}
                  onCambiar={cambiarFecha}
                  actualizando={disponibilidad.isFetching && !disponibilidad.isPending}
                />
                <GrillaHorarios
                  completo={Boolean(bahia && servicio && tecnico)}
                  disponibilidad={disponibilidad}
                  elegido={inicio}
                  onElegir={(i) => {
                    limpiarIntento();
                    setInicio(i);
                  }}
                  onDiaSiguiente={() => cambiarFecha(sumarDiasISO(fecha, 1))}
                />
              </CardContent>
            </Card>
          </fieldset>

          <Card>
            <CardHeader>
              <CardTitle>{paso(3)}. Confirmar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {inicio && fin && bahia && servicio && tecnico ? (
                <Resumen
                  filas={[
                    ...(esAdmin
                      ? [['Cliente', nombreCliente(modoCliente, clienteElegido, datosNuevo)] as [string, string]]
                      : []),
                    ['Dia', formatearFechaLarga(fechaDeInstante(inicio))],
                    ['Horario', `${formatearHora(inicio)}–${formatearHora(fin)}`],
                    ['Bahia', bahia.nombre],
                    ['Servicio', `${servicio.nombre} · ${formatearDuracion(servicio.duracionMinutos)}`],
                    ['Tecnico', tecnico.nombre],
                  ]}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {conflicto
                    ? 'Elegi una de las alternativas o un horario de la grilla.'
                    : 'Elegi un horario para ver el resumen.'}
                </p>
              )}

              {conflicto && (
                <Conflicto
                  conflicto={conflicto}
                  enVuelo={enVuelo}
                  inicioEnVuelo={inicioEnVuelo}
                  onElegir={reservar}
                />
              )}
              {errorAlta && (
                <AltaFallida
                  error={errorAlta}
                  onBuscarExistente={() => cambiarCliente(() => setModoCliente('existente'))}
                />
              )}
              {otroError && (
                <EstadoError
                  error={otroError}
                  onReintentar={
                    describirError(otroError).reintentable && reserva.variables
                      ? () => reservar(reserva.variables!.turno.inicio)
                      : undefined
                  }
                />
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full sm:w-auto"
                disabled={!inicio || enVuelo}
              >
                {enVuelo && !desdeSugerencia ? (
                  <>
                    <LoaderCircle className="animate-spin" aria-hidden />
                    Reservando…
                  </>
                ) : (
                  'Confirmar reserva'
                )}
              </Button>
              {/* El cambio de estado del boton no lo anuncia un lector de
                  pantalla por si solo. */}
              <span role="status" className="sr-only">
                {enVuelo ? 'Reservando el turno…' : ''}
              </span>
            </CardContent>
          </Card>
        </form>
      )}
    </Contenedor>
  );
}

function Contenedor({ children }: { children: ReactNode }) {
  // La zona del navegador no importa para el taller; solo se avisa cuando
  // difiere, para que quien reserva de viaje no lea "09:00" como su hora.
  const zonaNavegador = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Reservar turno</h1>
        <p className="text-sm text-muted-foreground">
          Horarios en hora del taller ({ZONA_NEGOCIO})
          {zonaNavegador !== ZONA_NEGOCIO && `, no en la de tu equipo (${zonaNavegador})`}.
        </p>
      </div>
      {children}
    </div>
  );
}

function nombreCliente(
  modo: ModoCliente,
  elegido: Cliente | null,
  nuevo: DatosClienteNuevo,
): string {
  if (modo === 'existente') return elegido ? elegido.nombre : 'Sin elegir';
  return nuevo.nombre.trim() ? `${nuevo.nombre.trim()} (nuevo)` : 'Cliente nuevo, sin completar';
}

function AltaFallida({
  error,
  onBuscarExistente,
}: {
  error: ErrorAltaCliente;
  onBuscarExistente: () => void;
}) {
  const repetido = error.causa instanceof ApiError && error.causa.status === 409;
  if (!repetido) return <EstadoError error={error.causa} />;
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-error/40 bg-error-suave p-4">
      <p className="text-sm font-semibold text-destructive">No se creo el cliente</p>
      <p className="text-sm text-foreground">
        {error.message} Si es la misma persona, buscala entre los clientes existentes.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onBuscarExistente}>
        Buscar entre existentes
      </Button>
    </div>
  );
}

// --- Campos ------------------------------------------------------------------

/**
 * <select> nativo y no el Select de base-ui: en el celular abre el selector
 * del sistema (la pantalla se usa en el taller, desde el telefono), y el
 * label, el teclado y el lector de pantalla vienen resueltos.
 */
function CampoSelect({
  id,
  etiqueta,
  valor,
  opciones,
  onCambiar,
  cargando,
  vacio,
  bloqueadoPor,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  opciones: { valor: string; texto: string }[];
  onCambiar: (valor: string) => void;
  cargando: boolean;
  vacio: string;
  bloqueadoPor?: string;
}) {
  const sinOpciones = !cargando && opciones.length === 0;
  const ayuda = bloqueadoPor ?? (sinOpciones ? vacio : undefined);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {etiqueta}
      </label>
      <select
        id={id}
        value={valor}
        disabled={cargando || sinOpciones || Boolean(bloqueadoPor)}
        aria-describedby={ayuda ? `${id}-ayuda` : undefined}
        onChange={(e) => onCambiar(e.target.value)}
        className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
      >
        <option value="" disabled>
          {cargando ? 'Cargando…' : 'Elegir…'}
        </option>
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
      {ayuda && (
        <p id={`${id}-ayuda`} className="text-xs text-muted-foreground">
          {ayuda}
        </p>
      )}
    </div>
  );
}

// --- Horarios ----------------------------------------------------------------

function GrillaHorarios({
  completo,
  disponibilidad,
  elegido,
  onElegir,
  onDiaSiguiente,
}: {
  completo: boolean;
  disponibilidad: ReturnType<typeof useDisponibilidadQuery>;
  elegido: string | null;
  onElegir: (inicio: string) => void;
  onDiaSiguiente: () => void;
}) {
  if (!completo) {
    return (
      <EstadoVacio
        icono={Clock}
        titulo="Elegi bahia, servicio y tecnico"
        descripcion="Con los tres elegidos aparecen los horarios libres del dia."
      />
    );
  }
  if (disponibilidad.isPending) {
    return <EstadoCargando forma="bloque" etiqueta="Buscando horarios libres…" />;
  }
  if (disponibilidad.isError) {
    return <EstadoError error={disponibilidad.error} onReintentar={disponibilidad.refetch} />;
  }

  const { horarios, jornada, duracionMinutos } = disponibilidad.data;
  // Datos de la combinacion anterior mientras llegan los nuevos: se ven,
  // pero no se pueden elegir.
  const viejos = disponibilidad.isPlaceholderData;

  if (horarios.length === 0) {
    return (
      <EstadoVacio
        icono={CalendarX}
        titulo="No quedan horarios libres este dia"
        descripcion={`Jornada ${jornada.apertura}–${jornada.cierre}. Proba el dia siguiente u otro tecnico.`}
        accion={
          <Button type="button" variant="outline" size="sm" onClick={onDiaSiguiente}>
            Ver dia siguiente
          </Button>
        }
      />
    );
  }

  const manana = horarios.filter((h) => minutosDelDia(h.inicio) < 12 * 60);
  const tarde = horarios.filter((h) => minutosDelDia(h.inicio) >= 12 * 60);

  return (
    <div className={`space-y-3 ${viejos ? 'opacity-60 transition-opacity' : ''}`}>
      <p className="text-sm text-muted-foreground">
        {horarios.length} {horarios.length === 1 ? 'horario libre' : 'horarios libres'} · el
        servicio dura {formatearDuracion(duracionMinutos)}
      </p>
      {[
        ['Mañana', manana] as const,
        ['Tarde', tarde] as const,
      ].map(
        ([titulo, lista]) =>
          lista.length > 0 && (
            <div key={titulo} role="group" aria-label={`Horarios de la ${titulo.toLowerCase()}`}>
              <p className="mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                {titulo}
              </p>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {lista.map((h) => {
                  const activo = elegido === h.inicio;
                  return (
                    <button
                      key={h.inicio}
                      type="button"
                      aria-pressed={activo}
                      disabled={viejos}
                      onClick={() => onElegir(h.inicio)}
                      className={`h-9 rounded-lg border font-mono text-sm tabular-nums transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed ${
                        activo
                          ? 'border-primary bg-primary font-semibold text-primary-foreground'
                          : 'bg-card hover:border-primary/60'
                      }`}
                    >
                      {formatearHora(h.inicio)}
                    </button>
                  );
                })}
              </div>
            </div>
          ),
      )}
    </div>
  );
}

// --- Conflicto ---------------------------------------------------------------

/** "a las 09:30" o, si cae otro dia, "el vie 26 a las 09:30". */
function cuando(rango: RangoTiempo, diaIntentado: string): string {
  const dia = fechaDeInstante(rango.inicio);
  const hora = `a las ${formatearHora(rango.inicio)}`;
  return dia === diaIntentado ? hora : `el ${formatearDiaCorto(dia)} ${hora}`;
}

function Conflicto({
  conflicto: { mensaje, intentado, sugerencias },
  enVuelo,
  inicioEnVuelo,
  onElegir,
}: {
  conflicto: ConflictoReserva;
  enVuelo: boolean;
  inicioEnVuelo?: string;
  onElegir: (inicio: string) => void;
}) {
  const diaIntentado = fechaDeInstante(intentado);
  return (
    <div
      role="alert"
      className="space-y-3 rounded-lg border border-advertencia/40 bg-advertencia-suave p-4"
    >
      <div className="flex gap-3">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-advertencia" aria-hidden />
        <div className="space-y-0.5 text-sm">
          <p className="font-semibold text-advertencia-texto">
            El horario de las {formatearHora(intentado)} ya no esta disponible
          </p>
          {mensaje && <p className="text-foreground">{mensaje}</p>}
        </div>
      </div>
      {sugerencias.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-foreground">Los horarios libres mas cercanos:</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap" aria-label="Horarios alternativos" role="group">
            {sugerencias.map((s) => {
              const este = inicioEnVuelo === s.inicio;
              return (
                <Button
                  key={s.inicio}
                  type="button"
                  variant="outline"
                  disabled={enVuelo}
                  onClick={() => onElegir(s.inicio)}
                >
                  {este && <LoaderCircle className="animate-spin" aria-hidden />}
                  {este ? 'Reservando…' : `Reservar ${cuando(s, diaIntentado)} en su lugar`}
                </Button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-sm text-foreground">
          No hay horarios libres cerca de ese. Proba otro dia u otro tecnico.
        </p>
      )}
    </div>
  );
}

// --- Resumen y confirmacion ----------------------------------------------------

function Resumen({ filas }: { filas: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {filas.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Confirmacion({
  reservado,
  esAdmin,
  onReservarOtro,
}: {
  reservado: Reservado;
  esAdmin: boolean;
  onReservarOtro: () => void;
}) {
  const navigate = useNavigate();
  const titulo = useRef<HTMLHeadingElement>(null);
  // El formulario desaparece: el foco va al resultado para que el teclado y
  // el lector de pantalla no queden en la nada.
  useEffect(() => titulo.current?.focus(), []);

  const { turno, servicio, tecnico, cliente, clienteNuevo } = reservado;
  const { inicio, fin } = turno.rangoTiempo;
  const dia = fechaDeInstante(inicio);

  return (
    <Card>
      <CardContent className="space-y-4">
        <div role="status" className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-exito-suave">
            <CalendarCheck className="size-5 text-exito-texto" aria-hidden />
          </span>
          <div>
            <h2 ref={titulo} tabIndex={-1} className="text-lg font-semibold outline-none">
              Turno reservado
            </h2>
            <p className="text-sm text-muted-foreground">
              {formatearFechaLarga(dia)}, de {formatearHora(inicio)} a {formatearHora(fin)}
            </p>
          </div>
        </div>
        {/* Los datos del 201, no los del formulario: esto es lo que quedo
            guardado (el fin lo calcula el servidor). */}
        <Resumen
          filas={[
            ...(cliente ? [['Cliente', cliente.nombre] as [string, string]] : []),
            ['Dia', formatearFechaLarga(dia)],
            ['Horario', `${formatearHora(inicio)}–${formatearHora(fin)}`],
            ['Bahia', reservado.bahia],
            ['Servicio', servicio.nombre],
            ['Tecnico', tecnico.nombre],
          ]}
        />
        {cliente && clienteNuevo && (
          <div
            className="space-y-2 rounded-lg border border-info/40 bg-info-suave p-4"
            data-testid="cliente-registrado"
          >
            <p className="text-sm font-semibold text-info-texto">
              Cliente registrado: {cliente.nombre}
            </p>
            <Resumen
              filas={[
                ['Correo', cliente.email],
                ['Telefono', cliente.telefono ?? 'Sin telefono'],
                ['Ciudad', cliente.ciudad ?? '—'],
              ]}
            />
            {/* La contrasena la define el cliente con el enlace del correo;
                el admin nunca la ve. */}
            <p className="text-sm text-foreground">
              {cliente.invitacion?.enviado
                ? `Le enviamos a ${cliente.email} un correo para que defina su contraseña (el enlace vale 72 horas).`
                : 'El correo para definir la contraseña no salio: el envio de correos no esta configurado en el servidor. El cliente puede pedirlo desde "¿Olvidaste tu contraseña?".'}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={onReservarOtro}>Reservar otro turno</Button>
          {esAdmin && (
            <Button
              variant="outline"
              onClick={() => navigate(`/agenda/${turno.tecnicoId}?fecha=${dia}`)}
            >
              Ver agenda de {tecnico.nombre}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
