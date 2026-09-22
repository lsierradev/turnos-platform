import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatearHora, hoyISO, sumarDiasISO } from '@/lib/dates';
import { useAgendaQuery } from './useAgendaQuery';

const CATEGORIA_LABEL: Record<string, string> = {
  mecanica: 'Mecanica',
  electrica: 'Electrica',
  latoneria: 'Latoneria',
};

export function AgendaTecnicoView() {
  const { tecnicoId } = useParams<{ tecnicoId: string }>();
  const [fecha, setFecha] = useState(hoyISO);

  const { data, isPending, isFetching, isError, error } = useAgendaQuery(
    tecnicoId,
    fecha,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Agenda del tecnico</CardTitle>
            <p className="text-sm text-muted-foreground">
              Tecnico:{' '}
              <span className="font-mono text-xs">{tecnicoId}</span>
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
            <Badge
              variant="secondary"
              className={isFetching ? 'opacity-60' : undefined}
            >
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
        </CardHeader>
        <CardContent>
          {isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin turnos para este dia.
            </p>
          ) : (
            <Table className={isFetching ? 'opacity-60' : undefined}>
              <TableHeader>
                <TableRow>
                  <TableHead>Horario</TableHead>
                  <TableHead>Bahia</TableHead>
                  <TableHead>Servicio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((turno) => (
                  <TableRow key={turno.id}>
                    <TableCell className="font-mono text-sm">
                      {formatearHora(turno.rangoTiempo.inicio)}–
                      {formatearHora(turno.rangoTiempo.fin)}
                    </TableCell>
                    <TableCell>{turno.bahia?.nombre ?? turno.bahiaId}</TableCell>
                    <TableCell>
                      {turno.servicio?.nombre ?? turno.servicioId}
                      {turno.servicio && (
                        <Badge variant="outline" className="ml-2">
                          {CATEGORIA_LABEL[turno.servicio.categoria] ??
                            turno.servicio.categoria}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
