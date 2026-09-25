import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  crearTecnico,
  darDeBajaTecnico,
  getTecnicos,
  reactivarTecnico,
  type Tecnico,
} from '@/lib/api-client';
import { Aviso, Campo } from './comunes';
import { mensajeError } from './formulario';

/**
 * Tecnicos (Sprint 21). Alta: le llega un correo para elegir su
 * contrasena. Baja: no puede entrar, deja de aparecer para reservar y sus
 * turnos que vienen quedan sin tecnico para reasignar desde el panel.
 */
export function TecnicosSeccion() {
  const queryClient = useQueryClient();
  const tecnicos = useQuery({ queryKey: ['tecnicos'], queryFn: getTecnicos });
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'exito' | 'advertencia'; texto: ReactNode } | null>(
    null,
  );
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const refrescar = () => {
    void queryClient.invalidateQueries({ queryKey: ['tecnicos'] });
    void queryClient.invalidateQueries({ queryKey: ['tecnicos-reservables'] });
    void queryClient.invalidateQueries({ queryKey: ['reserva'] });
    void queryClient.invalidateQueries({ queryKey: ['turnos-sin-tecnico'] });
  };

  const alta = useMutation({
    mutationFn: crearTecnico,
    onSuccess: (t) => {
      setNombre('');
      setEmail('');
      setAviso({ tipo: 'exito', texto: `${t.nombre} agregado. Le enviamos a ${t.email} el enlace para elegir su contraseña.` });
      refrescar();
    },
  });
  const baja = useMutation({
    mutationFn: (t: Tecnico) => darDeBajaTecnico(t.id).then((r) => ({ ...r, t })),
    onSuccess: ({ turnosParaReasignar, t }) => {
      setConfirmando(null);
      setAviso(
        turnosParaReasignar > 0
          ? {
              tipo: 'advertencia',
              texto: (
                <>
                  {t.nombre} quedo dado de baja. {turnosParaReasignar}{' '}
                  {turnosParaReasignar === 1 ? 'turno quedo' : 'turnos quedaron'} sin tecnico:{' '}
                  <Link to="/admin" className="font-medium underline">
                    reasignalos en el Panel
                  </Link>
                  .
                </>
              ),
            }
          : { tipo: 'exito', texto: `${t.nombre} quedo dado de baja.` },
      );
      refrescar();
    },
  });
  const reactivar = useMutation({
    mutationFn: (t: Tecnico) => reactivarTecnico(t.id).then(() => t),
    onSuccess: (t) => {
      setAviso({ tipo: 'exito', texto: `${t.nombre} esta activo de nuevo.` });
      refrescar();
    },
  });

  function agregar(e: FormEvent) {
    e.preventDefault();
    setAviso(null);
    alta.mutate({ nombre: nombre.trim(), email: email.trim() });
  }

  const error = alta.error ?? baja.error ?? reactivar.error;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Nuevo tecnico</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={agregar} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Campo etiqueta="Nombre completo">
              <Input value={nombre} required minLength={2} onChange={(e) => setNombre(e.target.value)} />
            </Campo>
            <Campo etiqueta="Correo">
              <Input type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
            </Campo>
            <Button type="submit" disabled={alta.isPending}>
              <Plus aria-hidden /> Agregar tecnico
            </Button>
          </form>
        </CardContent>
      </Card>

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      {error && <Aviso tipo="error">{mensajeError(error, 'No se pudo guardar.')}</Aviso>}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Tecnicos</CardTitle>
        </CardHeader>
        <CardContent>
          {tecnicos.isPending ? (
            <EstadoCargando etiqueta="Cargando tecnicos…" />
          ) : tecnicos.isError ? (
            <EstadoError error={tecnicos.error} onReintentar={tecnicos.refetch} />
          ) : tecnicos.data.length === 0 ? (
            <EstadoVacio icono={Users} titulo="Todavia no hay tecnicos" />
          ) : (
            <ul className="divide-y" aria-label="Tecnicos">
              {tecnicos.data.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {t.nombre}
                      {!t.activo && (
                        <Badge variant="secondary" className="ml-2">
                          Dado de baja
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{t.email}</p>
                  </div>
                  {!t.activo ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={reactivar.isPending}
                      onClick={() => {
                        setAviso(null);
                        reactivar.mutate(t);
                      }}
                      aria-label={`Reactivar a ${t.nombre}`}
                    >
                      Reactivar
                    </Button>
                  ) : confirmando === t.id ? (
                    <div role="group" aria-label={`Confirmar la baja de ${t.nombre}`} className="flex flex-wrap items-center gap-2">
                      <span className="text-sm">Sus turnos que vienen quedan sin tecnico.</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={baja.isPending}
                        onClick={() => {
                          setAviso(null);
                          baja.mutate(t);
                        }}
                      >
                        Confirmar baja
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmando(null)}>
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmando(t.id)}
                      aria-label={`Dar de baja a ${t.nombre}`}
                    >
                      Dar de baja
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
