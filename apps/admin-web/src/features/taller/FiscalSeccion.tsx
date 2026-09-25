import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EstadoCargando, EstadoError } from '@/components/estados';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  getConfiguracionFiscal,
  guardarDatosFiscales,
  guardarFacturacion,
  guardarWompi,
  type ConfiguracionFiscal,
} from '@/lib/api-client';
import { digitoVerificacion } from '@/lib/nit';
import { Aviso, Campo } from './comunes';
import { mensajeError } from './formulario';

/**
 * Datos fiscales y cuentas del taller (Sprint 21). Los tokens y llaves se
 * guardan cifrados y nunca vuelven completos: la pantalla muestra los
 * ultimos 4 caracteres, y un campo vacio conserva lo guardado.
 */
export function FiscalSeccion() {
  const fiscal = useQuery({ queryKey: ['configuracion-fiscal'], queryFn: getConfiguracionFiscal });

  if (fiscal.isPending) return <EstadoCargando etiqueta="Cargando configuracion fiscal…" />;
  if (fiscal.isError) return <EstadoError error={fiscal.error} onReintentar={fiscal.refetch} />;

  return (
    <div className="space-y-4">
      <p className="flex gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        El taller es responsable de su categoria fiscal, del IVA y de su facturacion ante la DIAN. TurnoPro no
        recibe dinero: los pagos van directo a la cuenta Wompi del taller.
      </p>
      <DatosFiscales actual={fiscal.data} />
      <Facturacion actual={fiscal.data} />
      <Wompi actual={fiscal.data} />
    </div>
  );
}

function useGuardadoFiscal() {
  const queryClient = useQueryClient();
  return (datos: ConfiguracionFiscal) => {
    queryClient.setQueryData(['configuracion-fiscal'], datos);
    // Responsable o no cambia el precio que ven los clientes.
    void queryClient.invalidateQueries({ queryKey: ['servicios'] });
    void queryClient.invalidateQueries({ queryKey: ['reserva'] });
  };
}

function DatosFiscales({ actual }: { actual: ConfiguracionFiscal }) {
  const alGuardar = useGuardadoFiscal();
  const [razonSocial, setRazonSocial] = useState(actual.razonSocial ?? '');
  const [nit, setNit] = useState(actual.nit ?? '');
  const [dv, setDv] = useState(actual.dv === null ? '' : String(actual.dv));
  const [direccion, setDireccion] = useState(actual.direccion ?? '');
  const [municipio, setMunicipio] = useState(actual.municipio ?? '');
  const [departamento, setDepartamento] = useState(actual.departamento ?? '');
  const [responsable, setResponsable] = useState(actual.responsableIva);
  const [listo, setListo] = useState(false);

  const nitLimpio = nit.replace(/[.\s]/g, '');
  const esperado = digitoVerificacion(nitLimpio);
  const dvMal = dv !== '' && esperado !== null && Number(dv) !== esperado;

  const guardar = useMutation({
    mutationFn: guardarDatosFiscales,
    onSuccess: (d) => {
      setListo(true);
      alGuardar(d);
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    setListo(false);
    guardar.mutate({
      razonSocial: razonSocial.trim(),
      nit: nitLimpio,
      dv: Number(dv),
      direccion: direccion.trim(),
      municipio: municipio.trim(),
      departamento: departamento.trim(),
      responsableIva: responsable,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Datos fiscales</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={enviar} className="grid gap-4 sm:grid-cols-2">
          {!actual.completa && (
            <div className="sm:col-span-2">
              <Aviso tipo="advertencia">
                Faltan los datos fiscales del taller. Se necesitan para facturar.
              </Aviso>
            </div>
          )}
          <Campo etiqueta="Razon social" className="sm:col-span-2">
            <Input value={razonSocial} required minLength={2} maxLength={200} onChange={(e) => setRazonSocial(e.target.value)} />
          </Campo>
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Campo etiqueta="NIT" ayuda="Sin el digito de verificacion.">
              <Input
                value={nit}
                required
                inputMode="numeric"
                placeholder="900123456"
                onChange={(e) => setNit(e.target.value)}
              />
            </Campo>
            <Campo etiqueta="DV">
              <Input
                value={dv}
                required
                inputMode="numeric"
                maxLength={1}
                pattern="[0-9]"
                aria-invalid={dvMal}
                aria-describedby={dvMal ? 'dv-error' : undefined}
                onChange={(e) => setDv(e.target.value)}
              />
            </Campo>
            {dvMal && (
              <p id="dv-error" className="col-span-2 text-xs text-error-texto">
                Para ese NIT el digito de verificacion es {esperado}. Revisa el RUT.
              </p>
            )}
          </div>
          <Campo etiqueta="Direccion">
            <Input value={direccion} required maxLength={200} onChange={(e) => setDireccion(e.target.value)} />
          </Campo>
          <Campo etiqueta="Municipio">
            <Input value={municipio} required maxLength={120} onChange={(e) => setMunicipio(e.target.value)} />
          </Campo>
          <Campo etiqueta="Departamento">
            <Input value={departamento} required maxLength={120} onChange={(e) => setDepartamento(e.target.value)} />
          </Campo>

          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="text-sm font-medium">Responsabilidad frente al IVA</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="iva" checked={responsable} onChange={() => setResponsable(true)} />
              Responsable de IVA: a cada precio se le suma el IVA y el cliente lo ve incluido.
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="iva" checked={!responsable} onChange={() => setResponsable(false)} />
              No responsable de IVA: el precio cargado es el final.
            </label>
            {responsable !== actual.responsableIva && (
              <Aviso tipo="advertencia">
                Al guardar cambia el precio que ven los clientes en las reservas nuevas. Los turnos ya
                tomados conservan su precio.
              </Aviso>
            )}
          </fieldset>

          {guardar.isError && (
            <div className="sm:col-span-2">
              <Aviso tipo="error">{mensajeError(guardar.error, 'No se pudieron guardar los datos fiscales.')}</Aviso>
            </div>
          )}
          {listo && (
            <div className="sm:col-span-2">
              <Aviso tipo="exito">Datos fiscales guardados.</Aviso>
            </div>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={guardar.isPending || dvMal}>
              {guardar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              Guardar datos fiscales
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function textoValidado(validado: boolean, proveedor: string): string {
  return validado
    ? `${proveedor} confirmo las credenciales. Quedaron guardadas.`
    : `Quedaron guardadas sin consultar a ${proveedor} (validacion desactivada en este servidor).`;
}

function Facturacion({ actual }: { actual: ConfiguracionFiscal }) {
  const alGuardar = useGuardadoFiscal();
  const [usuario, setUsuario] = useState(actual.facturacion?.usuario ?? '');
  const [token, setToken] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: guardarFacturacion,
    onSuccess: (r) => {
      setToken('');
      setMensaje(textoValidado(r.validado, 'Alegra'));
      alGuardar(r);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Facturacion electronica</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setMensaje(null);
            guardar.mutate({ proveedor: 'alegra', usuario: usuario.trim(), token: token.trim() });
          }}
          className="grid gap-4 sm:grid-cols-2"
        >
          {/* Un solo proveedor por ahora: texto, no un campo que no se puede tocar. */}
          <div className="space-y-1.5 text-sm">
            <p className="font-medium">Proveedor</p>
            <p className="flex h-8 items-center">Alegra</p>
            <p className="text-xs text-muted-foreground">Siigo llega mas adelante.</p>
          </div>
          <Campo etiqueta="Correo de la cuenta de Alegra">
            <Input type="email" required value={usuario} onChange={(e) => setUsuario(e.target.value)} />
          </Campo>
          <Campo
            etiqueta="Token de Alegra"
            ayuda={
              actual.facturacion
                ? `Guardado: ${actual.facturacion.token}. Para cambiarlo, pega el nuevo.`
                : 'En Alegra: Configuracion > Integraciones > API.'
            }
            className="sm:col-span-2"
          >
            <Input
              type="password"
              autoComplete="off"
              required
              minLength={8}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </Campo>
          {guardar.isError && (
            <div className="sm:col-span-2">
              <Aviso tipo="error">{mensajeError(guardar.error, 'No se pudo guardar el token.')}</Aviso>
            </div>
          )}
          {mensaje && (
            <div className="sm:col-span-2">
              <Aviso tipo="exito">{mensaje}</Aviso>
            </div>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={guardar.isPending}>
              {guardar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              {guardar.isPending ? 'Validando con Alegra…' : 'Validar y guardar'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Wompi({ actual }: { actual: ConfiguracionFiscal }) {
  const alGuardar = useGuardadoFiscal();
  const [ambiente, setAmbiente] = useState<'pruebas' | 'produccion'>(actual.wompi?.ambiente ?? 'pruebas');
  const [llavePublica, setLlavePublica] = useState(actual.wompi?.llavePublica ?? '');
  const [llavePrivada, setLlavePrivada] = useState('');
  const [secretoIntegridad, setSecretoIntegridad] = useState('');
  const [secretoEventos, setSecretoEventos] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);

  // Sin nada guardado, o cambiando de ambiente, hay que pegar todo.
  const exigeSecretos = !actual.wompi || actual.wompi.ambiente !== ambiente;
  const guardado = (valor: string | null | undefined) =>
    !exigeSecretos && valor ? `Guardado: ${valor}. Vacio lo conserva.` : undefined;

  const guardar = useMutation({
    mutationFn: guardarWompi,
    onSuccess: (r) => {
      setLlavePrivada('');
      setSecretoIntegridad('');
      setSecretoEventos('');
      setMensaje(textoValidado(r.validado, 'Wompi'));
      alGuardar(r);
    },
  });

  const opcional = (v: string) => (v.trim() ? v.trim() : undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Pagos con Wompi</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setMensaje(null);
            guardar.mutate({
              ambiente,
              llavePublica: llavePublica.trim(),
              llavePrivada: opcional(llavePrivada),
              secretoIntegridad: opcional(secretoIntegridad),
              secretoEventos: opcional(secretoEventos),
            });
          }}
          className="grid gap-4 sm:grid-cols-2"
        >
          <p className="text-sm text-muted-foreground sm:col-span-2">
            Las llaves estan en el panel de comercios de Wompi, en Desarrolladores. El cobro en linea se
            habilita con los pagos; aca se dejan configuradas y validadas.
          </p>
          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="text-sm font-medium">Ambiente</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="ambiente" checked={ambiente === 'pruebas'} onChange={() => setAmbiente('pruebas')} />
                Pruebas (sandbox)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="ambiente"
                  checked={ambiente === 'produccion'}
                  onChange={() => setAmbiente('produccion')}
                />
                Produccion
              </label>
            </div>
          </fieldset>
          <Campo etiqueta="Llave publica" className="sm:col-span-2">
            <Input
              required
              value={llavePublica}
              placeholder={ambiente === 'pruebas' ? 'pub_test_…' : 'pub_prod_…'}
              onChange={(e) => setLlavePublica(e.target.value)}
              className="font-mono"
            />
          </Campo>
          <Campo etiqueta="Llave privada" ayuda={guardado(actual.wompi?.llavePrivada)}>
            <Input
              type="password"
              autoComplete="off"
              required={exigeSecretos}
              value={llavePrivada}
              onChange={(e) => setLlavePrivada(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Secreto de integridad" ayuda={guardado(actual.wompi?.secretoIntegridad)}>
            <Input
              type="password"
              autoComplete="off"
              required={exigeSecretos}
              value={secretoIntegridad}
              onChange={(e) => setSecretoIntegridad(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Secreto de eventos" ayuda={guardado(actual.wompi?.secretoEventos)}>
            <Input
              type="password"
              autoComplete="off"
              required={exigeSecretos}
              value={secretoEventos}
              onChange={(e) => setSecretoEventos(e.target.value)}
            />
          </Campo>
          {guardar.isError && (
            <div className="sm:col-span-2">
              <Aviso tipo="error">{mensajeError(guardar.error, 'No se pudieron guardar las llaves.')}</Aviso>
            </div>
          )}
          {mensaje && (
            <div className="sm:col-span-2">
              <Aviso tipo="exito">{mensaje}</Aviso>
            </div>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={guardar.isPending}>
              {guardar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              {guardar.isPending ? 'Validando con Wompi…' : 'Validar y guardar'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
