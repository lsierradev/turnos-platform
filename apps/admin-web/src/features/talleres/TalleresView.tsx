import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, LoaderCircle, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { EstadoCargando, EstadoVacio } from '@/components/estados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  ApiError,
  actualizarTaller,
  crearTaller,
  type TallerCreado,
} from '@/lib/api-client';
import { useTaller } from '@/lib/taller';

/** "Taller Norte Bogota" -> "taller-norte-bogota" (el backend valida igual). */
function slugDe(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Talleres de TurnoPro (Sprint 20, solo superadmin): alta con su primer
 * admin, baja/alta y elegir en cual operar. Operar en un taller deja al
 * superadmin con los permisos de un admin, solo dentro de ese taller.
 */
export function TalleresView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { talleres, tallerId, cargando, elegir } = useTaller();

  const [nombre, setNombre] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTocado, setSlugTocado] = useState(false);
  const [adminNombre, setAdminNombre] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [creado, setCreado] = useState<TallerCreado | null>(null);

  const alta = useMutation({
    mutationFn: crearTaller,
    onSuccess: (r) => {
      setCreado(r);
      setNombre('');
      setSlug('');
      setSlugTocado(false);
      setAdminNombre('');
      setAdminEmail('');
      void queryClient.invalidateQueries({ queryKey: ['talleres'] });
    },
  });

  const cambioEstado = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) => actualizarTaller(id, { activo }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['talleres'] }),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    setCreado(null);
    alta.mutate({
      nombre: nombre.trim(),
      slug: slug || slugDe(nombre),
      admin: { nombre: adminNombre.trim(), email: adminEmail.trim() },
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Talleres</h1>
        <p className="text-sm text-muted-foreground">
          Talleres que usan TurnoPro. Elegi uno para operar en el con permisos de administrador.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Talleres registrados</CardTitle>
        </CardHeader>
        <CardContent>
          {cargando ? (
            <EstadoCargando etiqueta="Cargando talleres…" />
          ) : talleres.length === 0 ? (
            <EstadoVacio icono={Building2} titulo="Todavia no hay talleres" />
          ) : (
            <ul className="divide-y" aria-label="Talleres">
              {talleres.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {t.nombre}
                      {t.id === tallerId && (
                        <Badge variant="secondary" className="ml-2">
                          Operando
                        </Badge>
                      )}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">{t.slug}</p>
                  </div>
                  <span className="text-xs font-medium">{t.activo ? 'Activo' : 'Dado de baja'}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={cambioEstado.isPending}
                    onClick={() => cambioEstado.mutate({ id: t.id, activo: !t.activo })}
                  >
                    {t.activo ? 'Dar de baja' : 'Reactivar'}
                  </Button>
                  <Button
                    size="sm"
                    disabled={t.id === tallerId}
                    onClick={() => {
                      elegir(t.id);
                      navigate('/');
                    }}
                  >
                    Operar aca
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nuevo taller</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={enviar} className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Nombre del taller</span>
              <Input
                value={nombre}
                required
                minLength={2}
                onChange={(e) => {
                  setNombre(e.target.value);
                  if (!slugTocado) setSlug(slugDe(e.target.value));
                }}
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Identificador</span>
              <Input
                value={slug}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTocado(true);
                }}
                className="font-mono"
              />
              <span className="block text-xs text-muted-foreground">Minusculas, numeros y guiones.</span>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Nombre del administrador</span>
              <Input value={adminNombre} required minLength={2} onChange={(e) => setAdminNombre(e.target.value)} />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Correo del administrador</span>
              <Input type="email" value={adminEmail} required onChange={(e) => setAdminEmail(e.target.value)} />
              <span className="block text-xs text-muted-foreground">
                Recibe un enlace para definir su contraseña.
              </span>
            </label>
            {alta.isError && (
              <p role="alert" className="text-sm text-destructive sm:col-span-2">
                {alta.error instanceof ApiError ? alta.error.message : 'No se pudo crear el taller.'}
              </p>
            )}
            {creado && (
              <p role="status" className="rounded-lg border border-exito/40 bg-exito-suave p-3 text-sm sm:col-span-2">
                Taller <strong>{creado.taller.nombre}</strong> creado.{' '}
                {creado.invitacion.enviado
                  ? `Le enviamos a ${creado.admin.email} el enlace para definir su contraseña.`
                  : 'El correo con el enlace no salio (correo sin configurar en el servidor): el enlace quedo en el buzon local.'}
              </p>
            )}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={alta.isPending}>
                {alta.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
                {alta.isPending ? 'Creando…' : 'Crear taller'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
