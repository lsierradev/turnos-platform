import { useId, useState } from 'react';
import { ChevronDown, ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CATEGORIA_CLASES,
  ESTADO_TURNO_LABEL,
} from '@/features/agenda/linea-tiempo';
import type { CargaBahia, CargaResponse } from '@/lib/api-client';
import { formatearDuracion, formatearHora } from '@/lib/dates';
import { NIVEL, porcentaje } from './niveles';
import { useTurnosBahiaQuery } from './useCargaQuery';

export function TarjetaBahia({
  bahia,
  fecha,
  jornada,
  umbrales,
}: {
  bahia: CargaBahia;
  fecha: string;
  jornada: CargaResponse['jornada'];
  umbrales: CargaResponse['umbrales'];
}) {
  const [abierto, setAbierto] = useState(false);
  const idDetalle = useId();
  const dia = bahia.dias.find((d) => d.fecha === fecha) ?? bahia.dias[0];
  const nivel = NIVEL[dia.nivel];
  const Icono = nivel.icono;
  const alerta = dia.nivel === 'alta' || dia.nivel === 'completa';
  const libres = Math.max(jornada.minutos - dia.minutosOcupados, 0);

  return (
    <Card
      data-testid={`bahia-${bahia.bahiaId}`}
      className={alerta ? `ring-2 ${dia.nivel === 'completa' ? 'ring-error/60' : 'ring-advertencia/60'}` : undefined}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle className="truncate">{bahia.nombre}</CardTitle>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${nivel.suave} ${nivel.texto}`}
        >
          <Icono className="size-3.5" aria-hidden />
          {nivel.etiqueta}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-heading text-3xl font-semibold tabular-nums">
            {porcentaje(dia.ocupacion)}
          </p>
          <p className="text-sm text-muted-foreground">
            {dia.turnos} turno{dia.turnos === 1 ? '' : 's'}
          </p>
        </div>

        <div
          className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-label={`Ocupacion de ${bahia.nombre}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(dia.ocupacion * 100)}
          aria-valuetext={`${porcentaje(dia.ocupacion)}, ${nivel.etiqueta.toLowerCase()}`}
        >
          <div
            className={`h-full rounded-full ${nivel.barra}`}
            style={{ width: `${Math.min(dia.ocupacion, 1) * 100}%` }}
          />
          {/* Marca del umbral de alerta: que se vea cuanto falta para 80%. */}
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/40"
            style={{ left: `${umbrales.alta * 100}%` }}
            aria-hidden
          />
        </div>

        <p className="text-xs text-muted-foreground">
          {formatearDuracion(dia.minutosOcupados)} ocupadas ·{' '}
          {formatearDuracion(libres)} libres de {jornada.apertura} a {jornada.cierre}
        </p>

        {dia.turnos > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2"
            aria-expanded={abierto}
            aria-controls={idDetalle}
            onClick={() => setAbierto((a) => !a)}
          >
            <ChevronDown
              className={`transition-transform ${abierto ? 'rotate-180' : ''}`}
              aria-hidden
            />
            {abierto ? 'Ocultar turnos' : 'Ver turnos'}
          </Button>
        )}
        {abierto && (
          <div id={idDetalle}>
            <DetalleTurnos bahiaId={bahia.bahiaId} fecha={fecha} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DetalleTurnos({ bahiaId, fecha }: { bahiaId: string; fecha: string }) {
  const detalle = useTurnosBahiaQuery(bahiaId, fecha, true);

  if (detalle.isPending) return <EstadoCargando filas={2} etiqueta="Cargando turnos…" />;
  if (detalle.isError) {
    return <EstadoError error={detalle.error} onReintentar={detalle.refetch} />;
  }
  if (detalle.data.turnos.length === 0) {
    return <EstadoVacio icono={ClipboardList} titulo="Sin turnos en este dia." />;
  }

  return (
    <ol className="divide-y rounded-lg border" aria-label="Turnos de la bahia">
      {detalle.data.turnos.map((t) => {
        const cat = CATEGORIA_CLASES[t.servicio.categoria];
        const Icono = cat.icono;
        const cancelado = t.estado === 'cancelado';
        return (
          <li key={t.id} className="flex gap-3 px-3 py-2.5 text-sm">
            <span
              className={`w-24 shrink-0 font-mono text-xs leading-5 ${
                cancelado ? 'text-muted-foreground line-through' : ''
              }`}
            >
              {formatearHora(t.inicio)}–{formatearHora(t.fin)}
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p
                className={`flex items-center gap-1.5 font-medium ${
                  cancelado ? 'text-muted-foreground line-through' : ''
                }`}
              >
                <Icono
                  className={`size-3.5 shrink-0 ${cancelado ? 'text-muted-foreground' : cat.texto}`}
                  aria-hidden
                />
                <span className="truncate">{t.servicio.nombre}</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {t.tecnico ? (
                  <Link
                    to={`/agenda/${t.tecnico.id}?fecha=${fecha}`}
                    className="text-marca-texto underline-offset-2 hover:underline"
                  >
                    {t.tecnico.nombre}
                  </Link>
                ) : (
                  'Sin tecnico'
                )}
                {t.clienteNombre && ` · ${t.clienteNombre}`}
              </p>
            </div>
            {t.estado !== 'programado' && (
              <Badge variant={cancelado ? 'outline' : 'secondary'} className="self-start">
                {ESTADO_TURNO_LABEL[t.estado]}
              </Badge>
            )}
          </li>
        );
      })}
    </ol>
  );
}
