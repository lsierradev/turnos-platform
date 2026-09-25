import type { ReactNode } from 'react';

/** Campo con su etiqueta visible y, opcional, una ayuda debajo. */
export function Campo({
  etiqueta,
  ayuda,
  children,
  className = '',
}: {
  etiqueta: string;
  ayuda?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block space-y-1.5 text-sm ${className}`}>
      <span className="font-medium">{etiqueta}</span>
      {children}
      {ayuda && <span className="block text-xs text-muted-foreground">{ayuda}</span>}
    </label>
  );
}

/** Resultado de una accion: exito (status) o error (alert). */
export function Aviso({
  tipo,
  children,
}: {
  tipo: 'exito' | 'error' | 'advertencia';
  children: ReactNode;
}) {
  const clases = {
    exito: 'border-exito/40 bg-exito-suave',
    error: 'border-error/40 bg-error-suave text-error-texto',
    advertencia: 'border-advertencia/40 bg-advertencia-suave',
  }[tipo];
  return (
    <p role={tipo === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${clases}`}>
      {children}
    </p>
  );
}
