import { useMutation } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Aviso, Campo } from '@/features/taller/comunes';
import { mensajeError } from '@/features/taller/formulario';
import {
  actualizarVehiculo,
  crearVehiculo,
  type Vehiculo,
} from '@/lib/api-client';
import { normalizarPlaca } from './vehiculos';

/**
 * Alta o edicion de un vehiculo (Sprint 22). El cliente carga los suyos en
 * el perfil; el personal, el de un cliente en la recepcion (clienteId).
 */
export function FormularioVehiculo({
  vehiculo,
  clienteId,
  onListo,
  onCancelar,
}: {
  vehiculo?: Vehiculo;
  /** Personal del taller: a nombre de que cliente. */
  clienteId?: string;
  onListo: (v: Vehiculo) => void;
  onCancelar: () => void;
}) {
  const [placa, setPlaca] = useState(vehiculo?.placa ?? '');
  const [marca, setMarca] = useState(vehiculo?.marca ?? '');
  const [modelo, setModelo] = useState(vehiculo?.modelo ?? '');
  const [anio, setAnio] = useState(vehiculo ? String(vehiculo.anio) : '');
  const [km, setKm] = useState(vehiculo ? String(vehiculo.kilometraje) : '');
  const anioMaximo = new Date().getFullYear() + 1;
  const placaValida = /^[A-Z0-9]{5,7}$/.test(normalizarPlaca(placa));

  const guardar = useMutation({
    mutationFn: () => {
      const datos = {
        placa: normalizarPlaca(placa),
        marca: marca.trim(),
        modelo: modelo.trim(),
        anio: Number(anio),
        kilometraje: Number(km),
      };
      return vehiculo
        ? actualizarVehiculo(vehiculo.id, datos)
        : crearVehiculo(clienteId ? { ...datos, clienteId } : datos);
    },
    onSuccess: onListo,
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!placaValida) return;
    guardar.mutate();
  }

  return (
    <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2" aria-label={vehiculo ? 'Editar vehiculo' : 'Nuevo vehiculo'}>
      <Campo etiqueta="Placa" ayuda="Por ejemplo ABC123 (carro) o ABC12D (moto).">
        <Input
          value={placa}
          required
          maxLength={10}
          autoCapitalize="characters"
          aria-invalid={placa !== '' && !placaValida}
          onChange={(e) => setPlaca(e.target.value)}
        />
      </Campo>
      <Campo etiqueta="Marca">
        <Input value={marca} required maxLength={60} onChange={(e) => setMarca(e.target.value)} />
      </Campo>
      <Campo etiqueta="Modelo">
        <Input value={modelo} required maxLength={80} onChange={(e) => setModelo(e.target.value)} />
      </Campo>
      <Campo etiqueta="Año">
        <Input
          type="number"
          required
          min={1950}
          max={anioMaximo}
          value={anio}
          onChange={(e) => setAnio(e.target.value)}
        />
      </Campo>
      <Campo etiqueta="Kilometraje">
        <Input
          type="number"
          required
          min={0}
          max={3000000}
          inputMode="numeric"
          value={km}
          onChange={(e) => setKm(e.target.value)}
        />
      </Campo>
      {guardar.isError && (
        <div className="sm:col-span-2">
          <Aviso tipo="error">{mensajeError(guardar.error, 'No se pudo guardar el vehiculo.')}</Aviso>
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={guardar.isPending || !placaValida}>
          {guardar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
          {vehiculo ? 'Guardar vehiculo' : 'Agregar vehiculo'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
