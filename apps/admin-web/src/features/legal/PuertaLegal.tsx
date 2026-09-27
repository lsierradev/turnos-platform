import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, LoaderCircle, LogOut } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { EstadoCargando } from '@/components/estados';
import { TextoLegal } from '@/components/TextoLegal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/features/auth/AuthProvider';
import { Aviso } from '@/features/taller/comunes';
import { mensajeError } from '@/features/taller/formulario';
import { aceptarDocumento, getPendientesLegales, type DocumentoLegal } from '@/lib/api-client';
import { useTituloPagina } from '@/lib/titulo';
import { CLAVE_PENDIENTES, TEXTO_ACEPTAR } from './legal';

/**
 * Antes de usar el panel, el usuario acepta los documentos vigentes que le
 * faltan (Sprint 23): el cliente y el tecnico, la politica de datos y la
 * autorizacion; el admin, ademas, los terminos de TurnoPro por su taller.
 * Una version nueva de cualquiera vuelve a pasar por aca.
 *
 * Si la consulta falla (usuarios-service caido) se deja pasar: esto no es
 * un control de seguridad, y bloquear el panel entero por un error de red
 * dejaria al taller sin agenda. Las reservas con condiciones del taller si
 * las exige el backend.
 */
export function PuertaLegal({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  const pendientes = useQuery({
    // Por usuario: en una computadora compartida del taller sale uno y entra
    // otro en la misma pestana, con el mismo cache.
    queryKey: [...CLAVE_PENDIENTES, usuario?.id],
    queryFn: getPendientesLegales,
    staleTime: 5 * 60_000,
  });

  if (pendientes.isPending) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <EstadoCargando forma="bloque" etiqueta="Cargando…" />
      </div>
    );
  }
  if (pendientes.isError || pendientes.data.length === 0) return <>{children}</>;
  return <AceptarDocumentos documentos={pendientes.data} />;
}

function AceptarDocumentos({ documentos }: { documentos: DocumentoLegal[] }) {
  useTituloPagina('Antes de continuar');
  const queryClient = useQueryClient();
  const { cerrarSesion } = useAuth();
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [intento, setIntento] = useState(false);
  const todos = documentos.every((d) => marcados.has(d.documento));

  const aceptar = useMutation({
    // En orden y de a uno: si una falla (se publico otra version mientras
    // leia), las anteriores ya quedaron y la pantalla muestra solo lo que
    // falta.
    mutationFn: async () => {
      for (const d of documentos) await aceptarDocumento(d.documento, d.version);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CLAVE_PENDIENTES }),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    setIntento(true);
    if (todos) aceptar.mutate();
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold" tabIndex={-1}>
            Antes de continuar
          </h1>
          <p className="text-sm text-muted-foreground">
            {documentos.length === 1
              ? 'Hay un documento que todavía no aceptaste, o que cambió desde la última vez.'
              : 'Hay documentos que todavía no aceptaste, o que cambiaron desde la última vez.'}{' '}
            Queda registrado con la versión, la fecha y desde dónde lo aceptaste.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={cerrarSesion}>
          <LogOut aria-hidden />
          Salir
        </Button>
      </div>

      <form onSubmit={enviar} className="space-y-4" noValidate>
        {documentos.map((d) => {
          const id = `aceptar-${d.documento}`;
          return (
            <Card key={d.documento}>
              <CardHeader>
                <CardTitle as="h2" className="flex flex-wrap items-center gap-2">
                  <FileText className="size-4 text-muted-foreground" aria-hidden />
                  {d.titulo}
                  <Badge variant="secondary">Versión {d.version}</Badge>
                  {d.borrador && <Badge variant="outline">Borrador</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Region con scroll propio, enfocable para leerla con el
                    teclado (WCAG 2.1.1). */}
                <div
                  className="max-h-72 overflow-y-auto rounded-lg border bg-muted/30 p-4"
                  tabIndex={0}
                  role="region"
                  aria-label={`Texto de ${d.titulo}`}
                >
                  <TextoLegal contenido={d.contenido} bajarTitulos />
                </div>
                <label htmlFor={id} className="flex items-start gap-2 text-sm font-medium">
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={marcados.has(d.documento)}
                    aria-invalid={intento && !marcados.has(d.documento)}
                    onChange={(e) =>
                      setMarcados((m) => {
                        const nuevo = new Set(m);
                        if (e.target.checked) nuevo.add(d.documento);
                        else nuevo.delete(d.documento);
                        return nuevo;
                      })
                    }
                  />
                  {TEXTO_ACEPTAR[d.documento]}
                </label>
              </CardContent>
            </Card>
          );
        })}

        {intento && !todos && (
          <Aviso tipo="error">Marcá cada casilla para continuar.</Aviso>
        )}
        {aceptar.isError && (
          <Aviso tipo="error">{mensajeError(aceptar.error, 'No se pudo registrar la aceptación.')}</Aviso>
        )}
        <Button type="submit" className="w-full sm:w-auto" disabled={aceptar.isPending}>
          {aceptar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
          Aceptar y continuar
        </Button>
      </form>
    </main>
  );
}
