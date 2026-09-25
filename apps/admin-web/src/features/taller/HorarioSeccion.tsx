import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarX, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  agregarFeriado,
  eliminarFeriado,
  getHorario,
  guardarHorario,
  importarFestivosColombia,
  type DiaHorario,
} from '@/lib/api-client';
import { formatearFechaLarga, hoyISO } from '@/lib/dates';
import { Aviso, Campo } from './comunes';
import { mensajeError } from './formulario';

const DIAS = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo'];

interface FilaDia {
  atiende: boolean;
  apertura: string;
  cierre: string;
}

/** Aviso comun: el horario nuevo no cancela turnos ya tomados. */
function textoFueraDeHorario(n: number): string | null {
  if (n === 0) return null;
  return `${n} ${n === 1 ? 'turno ya tomado queda' : 'turnos ya tomados quedan'} fuera del horario. No se cancelan solos: revisalos en el Panel y avisale a los clientes.`;
}

/**
 * Horario por dia de la semana y festivos (Sprint 21). Lo usan la reserva,
 * las sugerencias ante un horario ocupado y el panel de carga.
 */
export function HorarioSeccion() {
  const queryClient = useQueryClient();
  const horario = useQuery({ queryKey: ['horario'], queryFn: getHorario });
  const [filas, setFilas] = useState<FilaDia[] | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'exito' | 'advertencia'; texto: string } | null>(null);

  // El formulario arranca con lo guardado y despues es del usuario.
  useEffect(() => {
    if (!horario.data || filas) return;
    setFilas(
      DIAS.map((_, i) => {
        const d = horario.data.dias.find((x) => x.dia === i + 1);
        return d
          ? { atiende: true, apertura: d.apertura, cierre: d.cierre }
          : { atiende: false, apertura: '08:00', cierre: '18:00' };
      }),
    );
  }, [horario.data, filas]);

  const refrescar = () => {
    void queryClient.invalidateQueries({ queryKey: ['horario'] });
    void queryClient.invalidateQueries({ queryKey: ['carga-bahias'] });
    void queryClient.invalidateQueries({ queryKey: ['reserva'] });
  };
  const resultado = (r: { turnosFueraDeHorario: number }, exito: string) => {
    const fuera = textoFueraDeHorario(r.turnosFueraDeHorario);
    setAviso(fuera ? { tipo: 'advertencia', texto: `${exito} ${fuera}` } : { tipo: 'exito', texto: exito });
    refrescar();
  };

  const guardar = useMutation({
    mutationFn: guardarHorario,
    onSuccess: (r) => resultado(r, 'Horario guardado.'),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!filas) return;
    setAviso(null);
    const dias: DiaHorario[] = filas.flatMap((f, i) =>
      f.atiende ? [{ dia: i + 1, apertura: f.apertura, cierre: f.cierre }] : [],
    );
    guardar.mutate(dias);
  }

  const cambiar = (i: number, cambio: Partial<FilaDia>) =>
    setFilas((actual) => actual && actual.map((f, j) => (j === i ? { ...f, ...cambio } : f)));

  if (horario.isPending || (!filas && !horario.isError)) {
    return <EstadoCargando etiqueta="Cargando horario…" />;
  }
  if (horario.isError) {
    return <EstadoError error={horario.error} onReintentar={horario.refetch} />;
  }

  return (
    <div className="space-y-4">
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Horario de atencion</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={enviar} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              En cuartos de hora. Un dia sin marcar queda cerrado.
            </p>
            <ul className="divide-y">
              {filas!.map((f, i) => (
                <li key={DIAS[i]} className="flex flex-wrap items-center gap-3 py-2">
                  <label className="flex w-32 items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={f.atiende}
                      onChange={(e) => cambiar(i, { atiende: e.target.checked })}
                    />
                    {DIAS[i]}
                  </label>
                  {f.atiende ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Input
                        type="time"
                        step={900}
                        required
                        value={f.apertura}
                        aria-label={`Apertura del ${DIAS[i].toLowerCase()}`}
                        onChange={(e) => cambiar(i, { apertura: e.target.value })}
                        className="w-36"
                      />
                      <span aria-hidden>a</span>
                      <Input
                        type="time"
                        step={900}
                        required
                        value={f.cierre}
                        aria-label={`Cierre del ${DIAS[i].toLowerCase()}`}
                        onChange={(e) => cambiar(i, { cierre: e.target.value })}
                        className="w-36"
                      />
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Cerrado</span>
                  )}
                </li>
              ))}
            </ul>
            {guardar.isError && (
              <Aviso tipo="error">{mensajeError(guardar.error, 'No se pudo guardar el horario.')}</Aviso>
            )}
            <Button type="submit" disabled={guardar.isPending}>
              {guardar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              Guardar horario
            </Button>
          </form>
        </CardContent>
      </Card>

      <Feriados
        feriados={horario.data.feriados}
        onResultado={resultado}
        onBorrado={() => {
          setAviso({ tipo: 'exito', texto: 'Festivo quitado.' });
          refrescar();
        }}
      />
    </div>
  );
}

function Feriados({
  feriados,
  onResultado,
  onBorrado,
}: {
  feriados: { fecha: string; motivo: string }[];
  onResultado: (r: { turnosFueraDeHorario: number }, exito: string) => void;
  onBorrado: () => void;
}) {
  const [fecha, setFecha] = useState('');
  const [motivo, setMotivo] = useState('');
  const anio = Number(hoyISO().slice(0, 4));

  const alta = useMutation({
    mutationFn: agregarFeriado,
    onSuccess: (r) => {
      setFecha('');
      setMotivo('');
      onResultado(r, 'Dia cerrado agregado.');
    },
  });
  const importar = useMutation({
    mutationFn: importarFestivosColombia,
    onSuccess: (r, a) =>
      onResultado(
        r,
        r.agregados === 0
          ? `Los festivos de ${a} ya estaban cargados.`
          : `Se cargaron ${r.agregados} festivos de ${a}.`,
      ),
  });
  const baja = useMutation({ mutationFn: eliminarFeriado, onSuccess: onBorrado });
  const error = alta.error ?? importar.error ?? baja.error;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Festivos y dias cerrados</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {[anio, anio + 1].map((a) => (
            <Button
              key={a}
              variant="outline"
              size="sm"
              disabled={importar.isPending}
              onClick={() => importar.mutate(a)}
            >
              Cargar festivos de Colombia {a}
            </Button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            alta.mutate({ fecha, motivo: motivo.trim() });
          }}
          className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end"
        >
          <Campo etiqueta="Fecha">
            <Input type="date" min={hoyISO()} required value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Campo>
          <Campo etiqueta="Motivo">
            <Input
              required
              maxLength={120}
              placeholder="Inventario, vacaciones…"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </Campo>
          <Button type="submit" disabled={alta.isPending}>
            <Plus aria-hidden /> Agregar
          </Button>
        </form>

        {error && <Aviso tipo="error">{mensajeError(error, 'No se pudo guardar.')}</Aviso>}

        {feriados.length === 0 ? (
          <EstadoVacio icono={CalendarX} titulo="No hay dias cerrados por delante" />
        ) : (
          <ul className="divide-y" aria-label="Dias cerrados">
            {feriados.map((f) => (
              <li key={f.fecha} className="flex items-center gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1 sm:flex sm:gap-3">
                  <span className="block font-medium first-letter:uppercase sm:w-56">{formatearFechaLarga(f.fecha)}</span>
                  <span className="block text-muted-foreground">{f.motivo}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={baja.isPending}
                  onClick={() => baja.mutate(f.fecha)}
                  aria-label={`Quitar el ${formatearFechaLarga(f.fecha)}`}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
