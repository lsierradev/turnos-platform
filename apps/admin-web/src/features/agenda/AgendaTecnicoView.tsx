import { useState } from 'react';
import { CalendarX2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { NavegadorFecha } from '@/components/NavegadorFecha';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/features/auth/AuthProvider';
import { formatearHora, hoyISO } from '@/lib/dates';
import { esUuid } from '@/lib/uuid';
import { useAgendaQuery } from './useAgendaQuery';
import { useTecnicosQuery } from './useTecnicosQuery';

const CATEGORIA_LABEL: Record<string, string> = {
  mecanica: 'Mecanica',
  electrica: 'Electrica',
  latoneria: 'Latoneria',
};

export function AgendaTecnicoView() {
  const { tecnicoId } = useParams<{ tecnicoId: string }>();
  const { usuario } = useAuth();
  const [fecha, setFecha] = useState(hoyISO);

  // Hallazgos 1 y 7 de UX-NOTES.md: un id con forma invalida no se manda
  // al backend (daria un 400 "uuid is expected") y tampoco deja la query
  // deshabilitada en 'pending' para siempre -- se resuelve aca con un
  // mensaje propio.
  const idValido = esUuid(tecnicoId);
  const agenda = useAgendaQuery(idValido ? tecnicoId : undefined, fecha);

  const esPropia = usuario?.id === tecnicoId;
  const esAdmin = usuario?.rol === 'admin';
  // Nombre del tecnico en vez del UUID: solo el admin puede listar
  // tecnicos, y la lista ya esta en cache si vino del selector.
  const tecnicos = useTecnicosQuery(esAdmin && idValido && !esPropia);
  const nombre = tecnicos.data?.find((t) => t.id === tecnicoId)?.nombre;

  const volverAlSelector = esAdmin ? (
    <Link to="/agenda" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      Elegir otro tecnico
    </Link>
  ) : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle>Agenda del tecnico</CardTitle>
            <p className="truncate text-sm text-muted-foreground">
              {esPropia ? (
                'Tus turnos del dia'
              ) : nombre ? (
                nombre
              ) : (
                <span className="font-mono text-xs">{tecnicoId}</span>
              )}
            </p>
          </div>
          {idValido && (
            <NavegadorFecha
              fecha={fecha}
              onCambiar={setFecha}
              actualizando={agenda.isFetching && !agenda.isPending}
            />
          )}
        </CardHeader>
        <CardContent>
          {!idValido ? (
            <EstadoVacio
              icono={CalendarX2}
              titulo="El id del tecnico no es valido"
              descripcion="La direccion no contiene un id de tecnico con el formato correcto."
              accion={volverAlSelector}
            />
          ) : agenda.isPending ? (
            <EstadoCargando etiqueta="Cargando agenda…" />
          ) : agenda.isError ? (
            <EstadoError
              error={agenda.error}
              onReintentar={agenda.refetch}
              accionAlternativa={volverAlSelector}
            />
          ) : agenda.data.length === 0 ? (
            <EstadoVacio
              icono={CalendarX2}
              titulo="Sin turnos para este dia."
              descripcion="Proba con otro dia usando Anterior / Siguiente."
            />
          ) : (
            <div
              className={
                agenda.isFetching ? 'opacity-60 transition-opacity' : undefined
              }
            >
              {/* Escritorio: tabla. */}
              <Table className="hidden sm:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Horario</TableHead>
                    <TableHead>Bahia</TableHead>
                    <TableHead>Servicio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agenda.data.map((turno) => (
                    <TableRow key={turno.id}>
                      <TableCell className="font-mono text-sm">
                        {formatearHora(turno.rangoTiempo.inicio)}–
                        {formatearHora(turno.rangoTiempo.fin)}
                      </TableCell>
                      <TableCell>
                        {turno.bahia?.nombre ?? turno.bahiaId}
                      </TableCell>
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

              {/*
                Celular: lista. Una tabla de 3 columnas a 390px obliga a
                scroll horizontal o corta el nombre del servicio; en una
                tarjeta la hora queda grande a la izquierda, que es lo que
                el tecnico busca primero.
              */}
              <ul className="space-y-2 sm:hidden">
                {agenda.data.map((turno) => (
                  <li
                    key={turno.id}
                    className="flex gap-3 rounded-lg border p-3"
                  >
                    <div className="w-14 shrink-0 font-mono text-sm leading-tight">
                      <span className="block font-semibold">
                        {formatearHora(turno.rangoTiempo.inicio)}
                      </span>
                      <span className="block text-muted-foreground">
                        {formatearHora(turno.rangoTiempo.fin)}
                      </span>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium">
                        {turno.servicio?.nombre ?? turno.servicioId}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {turno.bahia?.nombre ?? turno.bahiaId}
                      </p>
                      {turno.servicio && (
                        <Badge variant="outline">
                          {CATEGORIA_LABEL[turno.servicio.categoria] ??
                            turno.servicio.categoria}
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
