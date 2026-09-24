import {
  AlertTriangle,
  CircleDashed,
  CircleGauge,
  OctagonAlert,
  type LucideIcon,
} from 'lucide-react';
import type { NivelOcupacion } from '@/lib/api-client';

/**
 * Como se ve cada nivel de ocupacion. El nivel lo decide el backend
 * (umbrales en la respuesta); aca solo se pinta.
 *
 * Siempre color + icono + texto (WCAG 1.4.1). La barra de "normal" es azul
 * (info) y NO el naranja de marca: el naranja y el ambar de "alta" se
 * confunden con daltonismo rojo-verde, y "alta" es justo lo que tiene que
 * saltar a la vista. Clases completas: Tailwind no genera clases armadas.
 */
export const NIVEL: Record<
  NivelOcupacion,
  {
    etiqueta: string;
    icono: LucideIcon;
    barra: string;
    texto: string;
    suave: string;
    borde: string;
  }
> = {
  libre: {
    etiqueta: 'Libre',
    icono: CircleDashed,
    barra: 'bg-muted',
    texto: 'text-muted-foreground',
    suave: 'bg-card',
    borde: 'border-border',
  },
  normal: {
    etiqueta: 'Normal',
    icono: CircleGauge,
    barra: 'bg-info',
    texto: 'text-info-texto',
    suave: 'bg-info-suave',
    borde: 'border-border',
  },
  alta: {
    etiqueta: 'Ocupacion alta',
    icono: AlertTriangle,
    barra: 'bg-advertencia',
    texto: 'text-advertencia-texto',
    suave: 'bg-advertencia-suave',
    borde: 'border-advertencia/60',
  },
  completa: {
    etiqueta: 'Completa',
    icono: OctagonAlert,
    barra: 'bg-error',
    texto: 'text-error-texto',
    suave: 'bg-error-suave',
    borde: 'border-error/60',
  },
};

export const porcentaje = (fraccion: number) => `${Math.round(fraccion * 100)}%`;
