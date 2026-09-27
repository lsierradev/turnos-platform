import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Download, LoaderCircle, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { EstadoCargando, EstadoError } from '@/components/estados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/AuthProvider';
import { Aviso, Campo } from '@/features/taller/comunes';
import { mensajeError } from '@/features/taller/formulario';
import {
  exportarMisDatos,
  getMisDatos,
  rectificarMisDatos,
  suprimirMiCuenta,
  type AceptacionLegal,
  type MisDatos,
} from '@/lib/api-client';
import { formatearFechaHora } from '@/lib/dates';
import { CANAL, NOMBRE_DOCUMENTO } from './legal';

const CLAVE = ['mis-datos'] as const;

const TIPO_SOLICITUD: Record<MisDatos['solicitudes'][number]['tipo'], string> = {
  exportacion: 'Descargaste tus datos',
  rectificacion: 'Corregiste tus datos',
  supresion: 'Suprimiste tu cuenta',
};

/**
 * Mis datos (Sprint 23): los derechos del titular de la Ley 1581 de 2012
 * en autoservicio. Consultar, rectificar, exportar y suprimir; y ver que
 * documentos acepto, con que version y cuando.
 */
export function MisDatosView() {
  const datos = useQuery({ queryKey: CLAVE, queryFn: getMisDatos });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Mis datos</h1>
        <p className="text-sm text-muted-foreground">
          Consultá, corregí, descargá o suprimí tus datos personales. Así se tratan: {' '}
          <Link to="/legal/politica_datos" className="font-medium text-marca-texto underline-offset-4 hover:underline">
            Política de Tratamiento de Datos
          </Link>
          .
        </p>
      </div>
      {datos.isPending ? (
        <EstadoCargando forma="bloque" etiqueta="Cargando tus datos…" />
      ) : datos.isError ? (
        <EstadoError error={datos.error} onReintentar={datos.refetch} />
      ) : (
        <>
          <Rectificar perfil={datos.data.perfil} />
          <Resumen datos={datos.data} />
          <Aceptaciones aceptaciones={datos.data.aceptaciones} />
          {datos.data.perfil.rol === 'cliente' && <Suprimir supresion={datos.data.supresion} />}
        </>
      )}
    </div>
  );
}

function Rectificar({ perfil }: { perfil: MisDatos['perfil'] }) {
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState(perfil.nombre);
  const [telefono, setTelefono] = useState(perfil.telefono ?? '');
  const [ciudad, setCiudad] = useState(perfil.ciudad ?? '');
  useEffect(() => {
    setNombre(perfil.nombre);
    setTelefono(perfil.telefono ?? '');
    setCiudad(perfil.ciudad ?? '');
  }, [perfil]);
  const guardar = useMutation({
    mutationFn: () => rectificarMisDatos({ nombre: nombre.trim(), telefono, ciudad }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: CLAVE }),
  });
  const nombreCorto = nombre.trim().length < 2;

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!nombreCorto) guardar.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Tus datos</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={enviar} className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Nombre" ayuda={nombreCorto ? 'Mínimo 2 caracteres.' : undefined}>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} aria-invalid={nombreCorto} maxLength={120} />
          </Campo>
          <Campo
            etiqueta="Correo"
            ayuda="Es tu usuario para ingresar. Para cambiarlo, escribinos al correo de datos personales de la política."
          >
            <Input value={perfil.email} readOnly />
          </Campo>
          <Campo etiqueta="Teléfono (opcional)">
            <Input type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} maxLength={30} />
          </Campo>
          <Campo etiqueta="Ciudad">
            <Input value={ciudad} onChange={(e) => setCiudad(e.target.value)} maxLength={80} />
          </Campo>
          <div className="space-y-3 sm:col-span-2">
            {guardar.isSuccess && (
              <Aviso tipo="exito">
                <CircleCheck className="mr-1 inline size-4" aria-hidden />
                Datos actualizados.
              </Aviso>
            )}
            {guardar.isError && <Aviso tipo="error">{mensajeError(guardar.error, 'No se pudieron guardar.')}</Aviso>}
            <Button type="submit" disabled={guardar.isPending}>
              {guardar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              Guardar cambios
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Resumen({ datos }: { datos: MisDatos }) {
  const queryClient = useQueryClient();
  const descargar = useMutation({
    mutationFn: exportarMisDatos,
    onSuccess: (archivo) => {
      const url = URL.createObjectURL(archivo);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = `mis-datos-turnopro-${new Date().toISOString().slice(0, 10)}.json`;
      enlace.click();
      URL.revokeObjectURL(url);
      void queryClient.invalidateQueries({ queryKey: CLAVE });
    },
  });
  const { resumen, solicitudes } = datos;
  const cifras = [
    { etiqueta: 'Vehículos', valor: resumen.vehiculos },
    { etiqueta: 'Turnos', valor: resumen.turnos },
    { etiqueta: 'Recepciones', valor: resumen.recepciones },
    { etiqueta: 'Strikes', valor: resumen.strikes },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Lo que guardamos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {cifras.map((c) => (
            <div key={c.etiqueta} className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">{c.etiqueta}</dt>
              <dd className="text-xl font-semibold tabular-nums">{c.valor}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">
          La descarga incluye todo: perfil, vehículos, turnos en todos los talleres, recepciones con
          fotos, strikes y reclamos, notificaciones y los documentos que aceptaste.
        </p>
        {descargar.isError && (
          <Aviso tipo="error">{mensajeError(descargar.error, 'No se pudo generar el archivo.')}</Aviso>
        )}
        <Button variant="outline" onClick={() => descargar.mutate()} disabled={descargar.isPending}>
          {descargar.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Download aria-hidden />}
          Descargar mis datos
        </Button>
        {solicitudes.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Tus solicitudes</h3>
            <ul className="divide-y text-sm">
              {solicitudes.map((s) => (
                <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {TIPO_SOLICITUD[s.tipo]}
                    {s.detalle.campos?.length ? ` (${s.detalle.campos.join(', ')})` : ''}
                  </span>
                  <span className="text-muted-foreground tabular-nums">{formatearFechaHora(s.creadoEn)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function enlaceDocumento(a: AceptacionLegal): string {
  return a.documento === 'condiciones_taller'
    ? `/legal/talleres/${a.tallerId}/condiciones?version=${a.version}`
    : `/legal/${a.documento}?version=${a.version}`;
}

function Aceptaciones({ aceptaciones }: { aceptaciones: AceptacionLegal[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
          Documentos que aceptaste
        </CardTitle>
      </CardHeader>
      <CardContent>
        {aceptaciones.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no aceptaste ningún documento.</p>
        ) : (
          <ul className="divide-y text-sm">
            {aceptaciones.map((a) => (
              <li key={a.id} className="space-y-1 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={enlaceDocumento(a)} className="font-medium text-marca-texto underline-offset-4 hover:underline">
                    {NOMBRE_DOCUMENTO[a.documento]}
                  </Link>
                  <Badge variant="secondary">v{a.version}</Badge>
                  <Badge variant="outline">{CANAL[a.canal]}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatearFechaHora(a.aceptadoEn)}
                  {a.tallerNombre ? ` · ${a.tallerNombre}` : ''}
                  {a.registradoPor ? ` · registró ${a.registradoPor}` : ''}
                  {a.ip ? ` · IP ${a.ip}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Suprimir({ supresion }: { supresion: MisDatos['supresion'] }) {
  const { cerrarSesion } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmo, setConfirmo] = useState(false);
  const suprimir = useMutation({ mutationFn: () => suprimirMiCuenta(password) });

  if (suprimir.isSuccess) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Aviso tipo="exito">Tu cuenta fue suprimida. Conservamos, sin tus datos de contacto:</Aviso>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {suprimir.data.conservado.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button onClick={cerrarSesion}>
            <LogOut aria-hidden />
            Salir
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-error/40">
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <Trash2 className="size-4 text-error-texto" aria-hidden />
          Suprimir mi cuenta
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          Se borran tu nombre, correo, teléfono y ciudad, los vehículos que no figuran en una orden
          de trabajo y tus strikes. No vas a poder volver a ingresar con esta cuenta.
        </p>
        <p className="text-muted-foreground">
          Por ley se conservan, sin tus datos de contacto: los turnos con sus precios (soporte contable
          de los talleres), las constancias de recepción y órdenes de trabajo (garantía), y el registro
          de lo que aceptaste.
        </p>
        {!supresion.posible ? (
          <Aviso tipo="advertencia">{supresion.motivo}</Aviso>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (confirmo && password) suprimir.mutate();
            }}
          >
            <Campo etiqueta="Tu contraseña, para confirmar">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Campo>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={confirmo}
                onChange={(e) => setConfirmo(e.target.checked)}
              />
              Entiendo que esto no se puede deshacer.
            </label>
            {suprimir.isError && (
              <Aviso tipo="error">{mensajeError(suprimir.error, 'No se pudo suprimir la cuenta.')}</Aviso>
            )}
            <Button type="submit" variant="destructive" disabled={!confirmo || !password || suprimir.isPending}>
              {suprimir.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              Suprimir mi cuenta
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
