import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Warehouse } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { actualizarBahia, crearBahia, getBahiasTodas, type BahiaCatalogo } from '@/lib/api-client';
import { Aviso } from './comunes';
import { mensajeError } from './formulario';

/**
 * Bahias (Sprint 21). No se borran: sus turnos pasados las nombran. Sacar
 * una de servicio la quita de la reserva y del panel; los turnos que ya
 * tenia siguen en pie y se avisa cuantos son.
 */
export function BahiasSeccion() {
  const queryClient = useQueryClient();
  const bahias = useQuery({ queryKey: ['bahias-todas'], queryFn: getBahiasTodas });
  const [nombre, setNombre] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'exito' | 'advertencia'; texto: string } | null>(null);

  const refrescar = () => {
    void queryClient.invalidateQueries({ queryKey: ['bahias-todas'] });
    void queryClient.invalidateQueries({ queryKey: ['reserva'] });
    void queryClient.invalidateQueries({ queryKey: ['carga-bahias'] });
  };

  const alta = useMutation({
    mutationFn: crearBahia,
    onSuccess: (b) => {
      setNombre('');
      setAviso({ tipo: 'exito', texto: `Bahia ${b.nombre} agregada.` });
      refrescar();
    },
  });
  const cambio = useMutation({
    mutationFn: ({ id, cambios }: { id: string; cambios: Partial<Pick<BahiaCatalogo, 'nombre' | 'activa'>> }) =>
      actualizarBahia(id, cambios),
    onSuccess: (b) => {
      setAviso(
        !b.activa && b.turnosPorVenir > 0
          ? {
              tipo: 'advertencia',
              texto: `${b.nombre} quedo fuera de servicio. Tiene ${b.turnosPorVenir} ${
                b.turnosPorVenir === 1 ? 'turno' : 'turnos'
              } por venir que siguen en pie: reubicalos o avisale a los clientes.`,
            }
          : { tipo: 'exito', texto: `${b.nombre} ${b.activa ? 'en servicio' : 'fuera de servicio'}.` },
      );
      refrescar();
    },
  });

  function agregar(e: FormEvent) {
    e.preventDefault();
    setAviso(null);
    alta.mutate(nombre.trim());
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Nueva bahia</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={agregar} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex-1 space-y-1.5 text-sm">
              <span className="font-medium">Nombre</span>
              <Input value={nombre} required maxLength={80} onChange={(e) => setNombre(e.target.value)} />
            </label>
            <Button type="submit" disabled={alta.isPending}>
              <Plus aria-hidden /> Agregar bahia
            </Button>
          </form>
        </CardContent>
      </Card>

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      {(alta.isError || cambio.isError) && (
        <Aviso tipo="error">{mensajeError(alta.error ?? cambio.error, 'No se pudo guardar.')}</Aviso>
      )}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Bahias</CardTitle>
        </CardHeader>
        <CardContent>
          {bahias.isPending ? (
            <EstadoCargando etiqueta="Cargando bahias…" />
          ) : bahias.isError ? (
            <EstadoError error={bahias.error} onReintentar={bahias.refetch} />
          ) : bahias.data.length === 0 ? (
            <EstadoVacio icono={Warehouse} titulo="Todavia no hay bahias" />
          ) : (
            <ul className="divide-y" aria-label="Bahias">
              {bahias.data.map((b) => (
                <FilaBahia
                  key={b.id}
                  bahia={b}
                  ocupado={cambio.isPending}
                  onCambiar={(cambios) => {
                    setAviso(null);
                    cambio.mutate({ id: b.id, cambios });
                  }}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FilaBahia({
  bahia,
  ocupado,
  onCambiar,
}: {
  bahia: BahiaCatalogo;
  ocupado: boolean;
  onCambiar: (cambios: Partial<Pick<BahiaCatalogo, 'nombre' | 'activa'>>) => void;
}) {
  const [renombrando, setRenombrando] = useState(false);
  const [nombre, setNombre] = useState(bahia.nombre);

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      {renombrando ? (
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onCambiar({ nombre: nombre.trim() });
            setRenombrando(false);
          }}
        >
          <Input
            value={nombre}
            required
            maxLength={80}
            aria-label={`Nuevo nombre de ${bahia.nombre}`}
            onChange={(e) => setNombre(e.target.value)}
          />
          <Button type="submit" size="sm">
            Guardar
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setRenombrando(false)}>
            Cancelar
          </Button>
        </form>
      ) : (
        <>
          <p className="min-w-0 flex-1 font-medium">
            {bahia.nombre}
            {!bahia.activa && (
              <Badge variant="secondary" className="ml-2">
                Fuera de servicio
              </Badge>
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRenombrando(true)}
            aria-label={`Renombrar ${bahia.nombre}`}
          >
            Renombrar
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={ocupado}
            onClick={() => onCambiar({ activa: !bahia.activa })}
            aria-label={`${bahia.activa ? 'Sacar de servicio' : 'Volver a servicio'} ${bahia.nombre}`}
          >
            {bahia.activa ? 'Sacar de servicio' : 'Volver a servicio'}
          </Button>
        </>
      )}
    </li>
  );
}
