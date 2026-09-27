import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Eye, LoaderCircle, Pencil, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EstadoCargando, EstadoError } from '@/components/estados';
import { TextoLegal } from '@/components/TextoLegal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CLASE_TEXTAREA } from '@/features/perfil/strikes';
import {
  getBorradorCondiciones,
  getVersionesCondiciones,
  publicarCondiciones,
} from '@/lib/api-client';
import { formatearFechaHora } from '@/lib/dates';
import { useTaller } from '@/lib/taller';
import { Aviso } from './comunes';
import { mensajeError } from './formulario';

/** Mismas marcas que bloquean la publicacion en usuarios-service. */
function marcasPendientes(texto: string): string[] {
  return [...(texto.match(/⟦[^⟧]*⟧/g) ?? []), ...(texto.match(/\{\{[^}]*\}\}/g) ?? [])];
}

/**
 * Condiciones del servicio con los clientes (Sprint 23). Parten de la
 * plantilla de TurnoPro, llena con los datos fiscales y la politica de
 * cancelacion del taller; el admin completa lo marcado y publica. Cada
 * publicacion es una version nueva que los clientes aceptan en su proxima
 * reserva.
 */
export function CondicionesSeccion() {
  const queryClient = useQueryClient();
  const { tallerId } = useTaller();
  const versiones = useQuery({ queryKey: ['condiciones', 'versiones'], queryFn: getVersionesCondiciones });
  const [desdePlantilla, setDesdePlantilla] = useState(false);
  const borrador = useQuery({
    queryKey: ['condiciones', 'borrador', desdePlantilla],
    queryFn: () => getBorradorCondiciones(desdePlantilla),
  });
  const [texto, setTexto] = useState('');
  const [vista, setVista] = useState<'editar' | 'previa'>('editar');
  useEffect(() => {
    if (borrador.data) setTexto(borrador.data.contenido);
  }, [borrador.data]);

  const publicar = useMutation({
    mutationFn: () => publicarCondiciones(texto),
    onSuccess: () => {
      setDesdePlantilla(false);
      void queryClient.invalidateQueries({ queryKey: ['condiciones'] });
    },
  });

  const marcas = marcasPendientes(texto);
  const vigente = versiones.data?.[0];
  const proxima = (vigente?.version ?? 0) + 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Condiciones del servicio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Lo que tus clientes aceptan al reservar: precios con IVA, anticipo, ventana de
            cancelación, strikes, garantía y retracto. Cada vez que publicás, es una versión nueva y
            se la volvemos a pedir a cada cliente en su próxima reserva.
          </p>
          {versiones.isPending ? (
            <EstadoCargando filas={1} />
          ) : versiones.isError ? (
            <EstadoError error={versiones.error} onReintentar={versiones.refetch} />
          ) : vigente ? (
            <p className="flex flex-wrap items-center gap-2">
              <Badge>Versión {vigente.version} publicada</Badge>
              <span className="text-muted-foreground">
                {formatearFechaHora(vigente.publicadoEn)} · aceptada por {vigente.aceptaciones}{' '}
                {vigente.aceptaciones === 1 ? 'cliente' : 'clientes'}
              </span>
            </p>
          ) : (
            <Aviso tipo="advertencia">
              Todavía no publicaste condiciones: tus clientes reservan sin aceptar ninguna.
            </Aviso>
          )}
          <Aviso tipo="advertencia">
            La plantilla es un borrador pendiente de revisión legal. Revisala con tu abogado antes de
            publicarla: las condiciones son del taller y el taller responde por ellas.
          </Aviso>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle as="h2">
            {borrador.data?.basadoEn === 'publicada' ? `Editar (partiendo de la versión ${vigente?.version})` : 'Editar (partiendo de la plantilla)'}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-pressed={vista === 'previa'}
              onClick={() => setVista(vista === 'editar' ? 'previa' : 'editar')}
            >
              {vista === 'editar' ? <Eye aria-hidden /> : <Pencil aria-hidden />}
              {vista === 'editar' ? 'Vista previa' : 'Editar'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDesdePlantilla(true);
                void queryClient.invalidateQueries({ queryKey: ['condiciones', 'borrador', true] });
              }}
            >
              <RotateCcw aria-hidden />
              Volver a la plantilla
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {borrador.isPending ? (
            <EstadoCargando forma="bloque" etiqueta="Cargando condiciones…" />
          ) : borrador.isError ? (
            <EstadoError error={borrador.error} onReintentar={borrador.refetch} />
          ) : vista === 'previa' ? (
            <div className="rounded-lg border p-4">
              <TextoLegal contenido={texto} bajarTitulos />
            </div>
          ) : (
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Texto (Markdown)</span>
              <textarea
                className={`${CLASE_TEXTAREA} min-h-96 font-mono text-xs leading-relaxed`}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                spellCheck
              />
              <span className="block text-xs text-muted-foreground">
                # Título, ## Sección, - lista, **negrita**. Lo que está entre ⟦ ⟧ hay que completarlo o
                quitarlo antes de publicar. La razón social, el NIT y la dirección salen de Datos fiscales.
              </span>
            </label>
          )}

          {marcas.length > 0 && (
            <Aviso tipo="advertencia">
              Faltan {marcas.length} {marcas.length === 1 ? 'dato' : 'datos'} por completar antes de
              publicar: {[...new Set(marcas)].slice(0, 3).join(' · ')}
              {new Set(marcas).size > 3 ? '…' : ''}
            </Aviso>
          )}
          {publicar.isSuccess && (
            <Aviso tipo="exito">
              <CircleCheck className="mr-1 inline size-4" aria-hidden />
              Versión {publicar.data.version} publicada.
            </Aviso>
          )}
          {publicar.isError && (
            <Aviso tipo="error">{mensajeError(publicar.error, 'No se pudieron publicar.')}</Aviso>
          )}
          <Button onClick={() => publicar.mutate()} disabled={marcas.length > 0 || publicar.isPending || !texto.trim()}>
            {publicar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
            Publicar versión {proxima}
          </Button>
        </CardContent>
      </Card>

      {versiones.data && versiones.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Versiones publicadas</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {versiones.data.map((v) => (
                <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <Badge variant={v === vigente ? 'default' : 'secondary'}>v{v.version}</Badge>
                    <span className="text-muted-foreground">
                      {formatearFechaHora(v.publicadoEn)}
                      {v.publicadoPor ? ` · ${v.publicadoPor}` : ''} · {v.aceptaciones}{' '}
                      {v.aceptaciones === 1 ? 'aceptación' : 'aceptaciones'}
                    </span>
                  </span>
                  {tallerId && (
                    <Link
                      to={`/legal/talleres/${tallerId}/condiciones?version=${v.version}`}
                      className="font-medium text-marca-texto underline-offset-4 hover:underline"
                    >
                      Ver
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
