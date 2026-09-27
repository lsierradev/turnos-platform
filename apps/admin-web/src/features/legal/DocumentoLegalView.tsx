import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { EstadoCargando, EstadoError } from '@/components/estados';
import { TextoLegal } from '@/components/TextoLegal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getCondicionesDeTaller, getDocumentoLegal } from '@/lib/api-client';
import { formatearFechaConAnio } from '@/lib/dates';
import { useTituloPagina } from '@/lib/titulo';
import { esDocumentoPublico } from './legal';

/**
 * Un documento legal, publico (Sprint 23): se abre desde el login, desde la
 * casilla de autorizacion o desde la reserva, con o sin sesion.
 *
 * - /legal/:documento: terminos, politica o autorizacion de TurnoPro.
 * - /legal/talleres/:tallerId/condiciones: las condiciones de un taller.
 *
 * ?version=N muestra una version anterior: lo que alguien acepto se tiene
 * que poder volver a leer tal cual.
 */
export function DocumentoLegalView() {
  const { documento, tallerId } = useParams();
  const [params] = useSearchParams();
  const version = Number(params.get('version')) || undefined;
  const valido = tallerId !== undefined || esDocumentoPublico(documento);

  const consulta = useQuery({
    queryKey: ['legal', 'documento', documento ?? 'condiciones', tallerId ?? null, version ?? null],
    queryFn: () =>
      tallerId
        ? getCondicionesDeTaller(tallerId, version)
        : getDocumentoLegal(documento as Parameters<typeof getDocumentoLegal>[0], version),
    enabled: valido,
  });
  useTituloPagina(consulta.data?.titulo ?? 'Documento legal');

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button variant="ghost" size="sm" render={<Link to="/" />} nativeButton={false}>
          <ArrowLeft aria-hidden />
          Volver
        </Button>
        {consulta.data && (
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer aria-hidden />
            Imprimir
          </Button>
        )}
      </div>

      {!valido ? (
        <EstadoError error={new Error('Ese documento no existe.')} />
      ) : consulta.isPending ? (
        <EstadoCargando forma="bloque" etiqueta="Cargando documento…" />
      ) : consulta.isError ? (
        <EstadoError error={consulta.error} onReintentar={consulta.refetch} />
      ) : (
        <article className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">Versión {consulta.data.version}</Badge>
            {consulta.data.borrador && <Badge variant="outline">Borrador pendiente de revisión legal</Badge>}
            <span>Vigente desde el {formatearFechaConAnio(consulta.data.vigenteDesde)}</span>
          </div>
          <TextoLegal contenido={consulta.data.contenido} />
          <p className="break-all text-xs text-muted-foreground">
            Huella SHA-256 de este texto: <span className="font-mono">{consulta.data.sha256}</span>
          </p>
        </article>
      )}
    </main>
  );
}
