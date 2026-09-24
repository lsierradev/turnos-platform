import { useState } from 'react';
import { Info, Warehouse } from 'lucide-react';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { NavegadorFecha } from '@/components/NavegadorFecha';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { hoyISO } from '@/lib/dates';
import { useCargaDiariaQuery } from './useCargaDiariaQuery';

export function PanelAdministrativoView() {
  const [fecha, setFecha] = useState(hoyISO);
  const carga = useCargaDiariaQuery(fecha);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Panel del taller</h1>
          <p className="text-sm text-muted-foreground">
            Carga de trabajo diaria por bahia
          </p>
        </div>
        <NavegadorFecha
          fecha={fecha}
          onCambiar={setFecha}
          actualizando={carga.isFetching && !carga.isPending}
        />
      </div>

      <p className="flex gap-2 rounded-lg border border-info/40 bg-info-suave p-3 text-xs text-info-texto">
        <Info className="size-4 shrink-0" aria-hidden />
        Datos de ejemplo (mock): todavia no existe un endpoint de carga por
        bahia en el backend. Ver docs/ENDPOINTS.txt.
      </p>

      {carga.isPending ? (
        <EstadoCargando forma="tarjetas" etiqueta="Cargando carga por bahia…" />
      ) : carga.isError ? (
        <EstadoError error={carga.error} onReintentar={carga.refetch} />
      ) : carga.data.length === 0 ? (
        <EstadoVacio
          icono={Warehouse}
          titulo="Sin bahias para mostrar"
          descripcion="No hay bahias con turnos en este dia."
        />
      ) : (
        <div
          className={`grid gap-4 sm:grid-cols-3 ${
            carga.isFetching ? 'opacity-60 transition-opacity' : ''
          }`}
        >
          {carga.data.map((bahia) => {
            const porcentaje = Math.round(
              (bahia.minutosOcupados / bahia.minutosJornada) * 100,
            );
            return (
              <Card key={bahia.bahiaId}>
                <CardHeader>
                  <CardTitle>{bahia.nombreBahia}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="font-heading text-2xl font-semibold">
                    {bahia.cantidadTurnos}{' '}
                    <span className="font-sans text-sm font-normal text-muted-foreground">
                      turnos
                    </span>
                  </p>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label={`Ocupacion de ${bahia.nombreBahia}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.min(porcentaje, 100)}
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(porcentaje, 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {porcentaje}% de la jornada ocupada
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
