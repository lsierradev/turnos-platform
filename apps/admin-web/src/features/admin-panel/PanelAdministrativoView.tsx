import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { hoyISO, sumarDiasISO } from '@/lib/dates';
import { useCargaDiariaQuery } from './useCargaDiariaQuery';

export function PanelAdministrativoView() {
  const [fecha, setFecha] = useState(hoyISO);
  const { data, isPending, isFetching } = useCargaDiariaQuery(fecha);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Panel administrativo v1</h1>
          <p className="text-sm text-muted-foreground">
            Carga de trabajo diaria por bahia
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFecha((f) => sumarDiasISO(f, -1))}
          >
            Anterior
          </Button>
          <Badge variant="secondary" className={isFetching ? 'opacity-60' : undefined}>
            {fecha}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFecha((f) => sumarDiasISO(f, 1))}
          >
            Siguiente
          </Button>
        </div>
      </div>

      <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        Datos de ejemplo (mock) -- todavia no existe un endpoint de carga por
        bahia en el backend. Ver docs/ENDPOINTS.txt.
      </p>

      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <div
          className={`grid gap-4 sm:grid-cols-3 ${isFetching ? 'opacity-60' : ''}`}
        >
          {data?.map((bahia) => {
            const porcentaje = Math.round(
              (bahia.minutosOcupados / bahia.minutosJornada) * 100,
            );
            return (
              <Card key={bahia.bahiaId}>
                <CardHeader>
                  <CardTitle className="text-base">
                    {bahia.nombreBahia}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-2xl font-semibold">
                    {bahia.cantidadTurnos}{' '}
                    <span className="text-sm font-normal text-muted-foreground">
                      turnos
                    </span>
                  </p>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
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
