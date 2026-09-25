import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, LoaderCircle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CLASE_TEXTAREA, ESTADO_STRIKE, MOTIVO_STRIKE } from '@/features/perfil/strikes';
import {
  anularStrike,
  getPolitica,
  getStrikesTaller,
  guardarPolitica,
  resolverReclamo,
  type Strike,
} from '@/lib/api-client';
import { fechaDeInstante, formatearFechaConAnio, formatearFechaLarga } from '@/lib/dates';
import { Aviso, Campo } from './comunes';
import { mensajeError } from './formulario';

type Filtro = 'reclamos' | 'vigentes' | 'todos';
const FILTROS: { id: Filtro; texto: string }[] = [
  { id: 'reclamos', texto: 'Reclamos pendientes' },
  { id: 'vigentes', texto: 'Vigentes' },
  { id: 'todos', texto: 'Todos' },
];

/**
 * Politica de cancelacion y strikes del taller (Sprint 22). El taller
 * define la ventana sin costo y cuanto dura un strike; revisa los reclamos
 * y anula con justificacion (el cliente la lee).
 */
export function CancelacionesSeccion() {
  return (
    <div className="space-y-4">
      <PoliticaFormulario />
      <StrikesTaller />
    </div>
  );
}

function PoliticaFormulario() {
  const queryClient = useQueryClient();
  const politica = useQuery({ queryKey: ['politica', 'taller'], queryFn: () => getPolitica() });
  const [ventana, setVentana] = useState('');
  const [vigencia, setVigencia] = useState('');
  useEffect(() => {
    if (!politica.data) return;
    setVentana(String(politica.data.ventanaHoras));
    setVigencia(String(politica.data.vigenciaStrikesMeses));
  }, [politica.data]);
  const guardar = useMutation({
    mutationFn: () =>
      guardarPolitica({ ventanaHoras: Number(ventana), vigenciaStrikesMeses: Number(vigencia) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['politica'] }),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    guardar.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Politica de cancelacion</CardTitle>
      </CardHeader>
      <CardContent>
        {politica.isPending ? (
          <EstadoCargando etiqueta="Cargando politica…" />
        ) : politica.isError ? (
          <EstadoError error={politica.error} onReintentar={politica.refetch} />
        ) : (
          <form onSubmit={enviar} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              El cliente cancela o reprograma sin costo hasta la ventana. Despues, o si no se
              presenta, suma un strike. Con {politica.data.strikesParaPrepago} vigentes, solo
              reserva pagando el total por adelantado. Si el taller cancela o no atiende, nunca suma.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Ventana sin costo (horas antes del turno)" ayuda="De 0 a 72.">
                <Input type="number" min={0} max={72} required value={ventana} onChange={(e) => setVentana(e.target.value)} />
              </Campo>
              <Campo
                etiqueta="Vigencia de un strike (meses)"
                ayuda="De 1 a 36. Los strikes ya puestos conservan su vencimiento."
              >
                <Input type="number" min={1} max={36} required value={vigencia} onChange={(e) => setVigencia(e.target.value)} />
              </Campo>
            </div>
            {guardar.isSuccess && <Aviso tipo="exito">Politica guardada.</Aviso>}
            {guardar.isError && <Aviso tipo="error">{mensajeError(guardar.error, 'No se pudo guardar la politica.')}</Aviso>}
            <Button type="submit" disabled={guardar.isPending}>
              {guardar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              Guardar politica
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function StrikesTaller() {
  const [filtro, setFiltro] = useState<Filtro>('reclamos');
  const strikes = useQuery({
    queryKey: ['strikes', 'taller', filtro],
    queryFn: () => getStrikesTaller(filtro),
  });
  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle as="h2">Strikes de clientes</CardTitle>
        <div role="group" aria-label="Filtro" className="inline-flex self-start rounded-lg border bg-muted p-0.5">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filtro === f.id}
              onClick={() => setFiltro(f.id)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                filtro === f.id ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.texto}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {strikes.isPending ? (
          <EstadoCargando etiqueta="Cargando strikes…" />
        ) : strikes.isError ? (
          <EstadoError error={strikes.error} onReintentar={strikes.refetch} />
        ) : strikes.data.length === 0 ? (
          <EstadoVacio
            icono={CircleCheck}
            titulo={filtro === 'reclamos' ? 'No hay reclamos pendientes' : 'No hay strikes'}
          />
        ) : (
          <ul className="space-y-3" aria-label="Strikes">
            {strikes.data.map((s) => (
              <FilaStrike key={s.id} strike={s} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FilaStrike({ strike }: { strike: Strike }) {
  const queryClient = useQueryClient();
  const [respuesta, setRespuesta] = useState('');
  const [abierto, setAbierto] = useState(false);
  const pendiente = strike.reclamo !== null && strike.reclamo.resultado === null;
  const accion = useMutation({
    mutationFn: (que: 'anular' | 'rechazar') =>
      que === 'anular'
        ? pendiente
          ? resolverReclamo(strike.id, true, respuesta.trim())
          : anularStrike(strike.id, respuesta.trim())
        : resolverReclamo(strike.id, false, respuesta.trim()),
    onSuccess: () => {
      setAbierto(false);
      void queryClient.invalidateQueries({ queryKey: ['strikes'] });
      void queryClient.invalidateQueries({ queryKey: ['politica'] });
    },
  });
  const estado = ESTADO_STRIKE[strike.estado];
  const valida = respuesta.trim().length >= 10;

  return (
    <li className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {strike.cliente?.nombre} · {MOTIVO_STRIKE[strike.motivo]}
          </p>
          <p className="text-sm">{strike.detalle}</p>
          <p className="text-xs text-muted-foreground">
            {strike.cliente?.email} · {formatearFechaLarga(fechaDeInstante(strike.creadoEn))}
            {strike.estado === 'vigente' && ` · vence el ${formatearFechaConAnio(fechaDeInstante(strike.venceEn))}`}
          </p>
        </div>
        <Badge variant={estado.variante}>{estado.texto}</Badge>
      </div>
      {strike.anulacion && (
        <p className="text-sm text-muted-foreground">Anulado: {strike.anulacion.justificacion}</p>
      )}
      {strike.reclamo && (
        <div className="rounded-md bg-muted p-2 text-sm">
          <p>
            <span className="font-medium">Reclamo del cliente:</span> {strike.reclamo.texto}
          </p>
          {strike.reclamo.resultado && (
            <p>
              <span className="font-medium">
                {strike.reclamo.resultado === 'aceptado' ? 'Aceptado' : 'Rechazado'}:
              </span>{' '}
              {strike.reclamo.respuesta}
            </p>
          )}
        </div>
      )}
      {strike.estado === 'vigente' && !abierto && (
        <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
          {pendiente ? 'Responder reclamo' : 'Anular'}
        </Button>
      )}
      {abierto && (
        <div className="space-y-2">
          <Campo
            etiqueta={pendiente ? 'Respuesta al cliente' : 'Justificacion'}
            ayuda="El cliente la ve en su perfil. Al menos 10 caracteres."
          >
            <textarea
              rows={2}
              maxLength={1000}
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
              className={CLASE_TEXTAREA}
            />
          </Campo>
          {accion.isError && <Aviso tipo="error">{mensajeError(accion.error, 'No se pudo guardar.')}</Aviso>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!valida || accion.isPending} onClick={() => accion.mutate('anular')}>
              {pendiente ? 'Aceptar y anular strike' : 'Anular strike'}
            </Button>
            {pendiente && (
              <Button size="sm" variant="outline" disabled={!valida || accion.isPending} onClick={() => accion.mutate('rechazar')}>
                Rechazar reclamo
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
