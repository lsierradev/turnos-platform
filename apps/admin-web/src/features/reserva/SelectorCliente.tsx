import { useId, useState, type ReactNode } from 'react';
import { UserRound, Users } from 'lucide-react';
import { BuscadorPersonas } from '@/components/BuscadorPersonas';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/estados';
import { Button } from '@/components/ui/button';
import type { Cliente, DatosClienteNuevo } from '@/lib/api-client';
import { validarClienteNuevo } from './cliente-nuevo';
import { useClientesQuery } from './useReservaQueries';

export type ModoCliente = 'existente' | 'nuevo';

/**
 * A nombre de quien reserva el admin (Sprint 17): un cliente registrado, o
 * uno nuevo con sus datos de perfil -- nombre, correo, telefono (para los
 * recordatorios) y ciudad. Sin contrasena: la cuenta queda creada pero sin
 * acceso al sistema (ver UsuariosService.create). Se crea recien al
 * confirmar la reserva (ver ReservaView).
 */
export function SelectorCliente({
  modo,
  onModo,
  elegido,
  onElegir,
  datos,
  onDatos,
  mostrarErrores,
}: {
  modo: ModoCliente;
  onModo: (modo: ModoCliente) => void;
  elegido: Cliente | null;
  onElegir: (cliente: Cliente | null) => void;
  datos: DatosClienteNuevo;
  onDatos: (datos: DatosClienteNuevo) => void;
  mostrarErrores: boolean;
}) {
  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label="Tipo de cliente"
        className="inline-flex rounded-lg border bg-muted p-0.5"
      >
        {(
          [
            ['existente', 'Cliente existente'],
            ['nuevo', 'Cliente nuevo'],
          ] as const
        ).map(([valor, texto]) => (
          <button
            key={valor}
            type="button"
            aria-pressed={modo === valor}
            onClick={() => onModo(valor)}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              modo === valor
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {texto}
          </button>
        ))}
      </div>

      {modo === 'existente' ? (
        <ClienteExistente
          elegido={elegido}
          onElegir={onElegir}
          mostrarErrores={mostrarErrores}
        />
      ) : (
        <ClienteNuevo datos={datos} onDatos={onDatos} mostrarErrores={mostrarErrores} />
      )}
    </div>
  );
}

function ClienteExistente({
  elegido,
  onElegir,
  mostrarErrores,
}: {
  elegido: Cliente | null;
  onElegir: (cliente: Cliente | null) => void;
  mostrarErrores: boolean;
}) {
  const clientes = useClientesQuery(true);

  if (elegido) {
    return (
      <div className="flex items-center gap-3 rounded-lg border p-3" data-testid="cliente-elegido">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <UserRound className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{elegido.nombre}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {elegido.email}
            {elegido.telefono ? ` · ${elegido.telefono}` : ''}
            {elegido.ciudad ? ` · ${elegido.ciudad}` : ''}
          </span>
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => onElegir(null)}>
          Cambiar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {clientes.isPending ? (
        <EstadoCargando etiqueta="Cargando clientes…" />
      ) : clientes.isError ? (
        <EstadoError error={clientes.error} onReintentar={clientes.refetch} />
      ) : clientes.data.length === 0 ? (
        <EstadoVacio
          icono={Users}
          titulo="Todavia no hay clientes"
          descripcion="Usa “Cliente nuevo” para darlo de alta con esta reserva."
        />
      ) : (
        <BuscadorPersonas
          personas={clientes.data}
          onElegir={onElegir}
          singular="cliente"
          plural="clientes"
          alto="max-h-64"
        />
      )}
      {mostrarErrores && (
        <p className="text-sm text-destructive" role="alert">
          Elegi el cliente para el que es el turno.
        </p>
      )}
    </div>
  );
}

function ClienteNuevo({
  datos,
  onDatos,
  mostrarErrores,
}: {
  datos: DatosClienteNuevo;
  onDatos: (datos: DatosClienteNuevo) => void;
  mostrarErrores: boolean;
}) {
  // Un campo muestra su error al salir de el o al intentar confirmar, no
  // mientras se escribe la primera letra.
  const [tocados, setTocados] = useState<Set<string>>(new Set());
  const errores = validarClienteNuevo(datos);
  const error = (campo: keyof DatosClienteNuevo) =>
    mostrarErrores || tocados.has(campo) ? errores[campo] : undefined;
  const tocar = (campo: string) => setTocados((t) => new Set(t).add(campo));
  const cambiar = (campo: keyof DatosClienteNuevo, valor: string) =>
    onDatos({ ...datos, [campo]: valor });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Campo etiqueta="Nombre completo" error={error('nombre')}>
        {(p) => (
          <input
            {...p}
            autoComplete="off"
            value={datos.nombre}
            onChange={(e) => cambiar('nombre', e.target.value)}
            onBlur={() => tocar('nombre')}
          />
        )}
      </Campo>
      <Campo etiqueta="Correo" ayuda="Identifica al cliente: no puede estar repetido." error={error('email')}>
        {(p) => (
          <input
            {...p}
            type="email"
            autoComplete="off"
            value={datos.email}
            onChange={(e) => cambiar('email', e.target.value)}
            onBlur={() => tocar('email')}
          />
        )}
      </Campo>
      <Campo
        etiqueta="Telefono (opcional)"
        ayuda="Para el recordatorio por WhatsApp 24 h antes."
        error={error('telefono')}
      >
        {(p) => (
          <input
            {...p}
            type="tel"
            autoComplete="off"
            placeholder="+57 300 123 4567"
            value={datos.telefono ?? ''}
            onChange={(e) => cambiar('telefono', e.target.value)}
            onBlur={() => tocar('telefono')}
          />
        )}
      </Campo>
      <Campo etiqueta="Ciudad" error={error('ciudad')}>
        {(p) => (
          <input
            {...p}
            autoComplete="off"
            placeholder="Bogota"
            value={datos.ciudad}
            onChange={(e) => cambiar('ciudad', e.target.value)}
            onBlur={() => tocar('ciudad')}
          />
        )}
      </Campo>
    </div>
  );
}

interface PropsControl {
  id: string;
  className: string;
  'aria-invalid': boolean;
  'aria-describedby'?: string;
}

function Campo({
  etiqueta,
  ayuda,
  error,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  error?: string;
  children: (props: PropsControl) => ReactNode;
}) {
  const id = useId();
  const descripcion = error ? `${id}-error` : ayuda ? `${id}-ayuda` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {etiqueta}
      </label>
      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': descripcion,
        className:
          'h-9 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30',
      })}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        ayuda && (
          <p id={`${id}-ayuda`} className="text-xs text-muted-foreground">
            {ayuda}
          </p>
        )
      )}
    </div>
  );
}
