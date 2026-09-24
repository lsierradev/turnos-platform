import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  OctagonAlert,
  type LucideIcon,
} from 'lucide-react';
import { SelectorTema } from '@/components/SelectorTema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { leerToken, razonContraste } from '@/lib/contraste';

/**
 * /design - referencia viva del sistema de diseno (Sprint 13).
 *
 * Todo lo que se ve aca sale de los tokens de src/index.css tal como los
 * resolvio el navegador, asi que cambiar el tema (boton de arriba) cambia
 * los valores y los contrastes mostrados. Los numeros son los mismos que
 * verifica scripts/verificar-contraste.mjs en CI; si esta pagina y el
 * script discrepan, manda el script.
 */

const PASOS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

const ESCALAS: { nombre: string; uso: string }[] = [
  { nombre: 'naranja', uso: 'Marca. 600 = #ea580c, el primario.' },
  { nombre: 'carbon', uso: 'Neutros. 50 = fondo, 800 = #1e293b, el acento.' },
  { nombre: 'exito', uso: 'Semantico: operacion correcta, bahia libre.' },
  { nombre: 'advertencia', uso: 'Semantico: requiere atencion.' },
  { nombre: 'error', uso: 'Semantico: fallo o accion destructiva.' },
  { nombre: 'info', uso: 'Semantico: informativo, turno reservado.' },
  { nombre: 'magenta', uso: 'Categorico: estado demorado, series.' },
  { nombre: 'turquesa', uso: 'Categorico: series de graficos.' },
];

// Pares texto/fondo que usa la app. Mismo listado (resumido) que el script
// de CI.
const PARES: { texto: string; fondo: string; nota: string }[] = [
  { texto: 'foreground', fondo: 'background', nota: 'Texto principal' },
  { texto: 'card-foreground', fondo: 'card', nota: 'Texto en tarjeta' },
  { texto: 'muted-foreground', fondo: 'background', nota: 'Texto secundario' },
  { texto: 'muted-foreground', fondo: 'muted', nota: 'Secundario sobre muted' },
  { texto: 'primary-foreground', fondo: 'primary', nota: 'Boton primario' },
  { texto: 'secondary-foreground', fondo: 'secondary', nota: 'Boton secundario' },
  { texto: 'accent-foreground', fondo: 'accent', nota: 'Resaltado carbon' },
  { texto: 'marca-texto', fondo: 'card', nota: 'Link / cifra destacada' },
  { texto: 'destructive', fondo: 'card', nota: 'Mensaje de error' },
  { texto: 'exito-texto', fondo: 'exito-suave', nota: 'Aviso de exito' },
  { texto: 'advertencia-texto', fondo: 'advertencia-suave', nota: 'Aviso de advertencia' },
  { texto: 'error-texto', fondo: 'error-suave', nota: 'Aviso de error' },
  { texto: 'info-texto', fondo: 'info-suave', nota: 'Aviso informativo' },
];

const SEMANTICOS: {
  token: string;
  titulo: string;
  icono: LucideIcon;
  fondo: string;
  borde: string;
  texto: string;
  iconoClase: string;
  mensaje: string;
}[] = [
  {
    token: 'exito',
    titulo: 'Exito',
    icono: CheckCircle2,
    fondo: 'bg-exito-suave',
    borde: 'border-exito/40',
    texto: 'text-exito-texto',
    iconoClase: 'text-exito',
    mensaje: 'Turno confirmado para la bahia 2 a las 14:00.',
  },
  {
    token: 'advertencia',
    titulo: 'Advertencia',
    icono: AlertTriangle,
    fondo: 'bg-advertencia-suave',
    borde: 'border-advertencia/40',
    texto: 'text-advertencia-texto',
    iconoClase: 'text-advertencia',
    mensaje: 'La bahia 3 lleva 20 minutos mas que el tiempo del servicio.',
  },
  {
    token: 'error',
    titulo: 'Error',
    icono: OctagonAlert,
    fondo: 'bg-error-suave',
    borde: 'border-error/40',
    texto: 'text-error-texto',
    iconoClase: 'text-error',
    mensaje: 'No se pudo reservar: la bahia ya esta ocupada en ese horario.',
  },
  {
    token: 'info',
    titulo: 'Informacion',
    icono: Info,
    fondo: 'bg-info-suave',
    borde: 'border-info/40',
    texto: 'text-info-texto',
    iconoClase: 'text-info',
    mensaje: 'Los recordatorios se envian 24 h antes del turno.',
  },
];

type Estado = 'libre' | 'reservado' | 'en-servicio' | 'demorado' | 'inactivo';

// Clases escritas completas: Tailwind no genera clases armadas en runtime.
const ESTADO: Record<
  Estado,
  { punto: string; suave: string; barra: string; bahia: string; mecanico: string }
> = {
  libre: {
    punto: 'bg-estado-libre',
    suave: 'bg-estado-libre-suave',
    barra: 'bg-estado-libre',
    bahia: 'Libre',
    mecanico: 'Disponible',
  },
  reservado: {
    punto: 'bg-estado-reservado',
    suave: 'bg-estado-reservado-suave',
    barra: 'bg-estado-reservado',
    bahia: 'Reservada',
    mecanico: 'Con turno proximo',
  },
  'en-servicio': {
    punto: 'bg-estado-en-servicio',
    suave: 'bg-estado-en-servicio-suave',
    barra: 'bg-estado-en-servicio',
    bahia: 'En servicio',
    mecanico: 'Atendiendo',
  },
  demorado: {
    punto: 'bg-estado-demorado',
    suave: 'bg-estado-demorado-suave',
    barra: 'bg-estado-demorado',
    bahia: 'Demorada',
    mecanico: 'Excedido',
  },
  inactivo: {
    punto: 'bg-estado-inactivo',
    suave: 'bg-estado-inactivo-suave',
    barra: 'bg-estado-inactivo',
    bahia: 'Fuera de servicio',
    mecanico: 'Ausente',
  },
};

const ESTADOS = Object.keys(ESTADO) as Estado[];

// Linea de tiempo de ejemplo: 8:00 a 18:00, en tramos de media hora.
const TIMELINE: { bahia: string; tramos: [Estado, number][] }[] = [
  { bahia: 'Bahia 1', tramos: [['en-servicio', 4], ['libre', 2], ['reservado', 6], ['libre', 8]] },
  { bahia: 'Bahia 2', tramos: [['reservado', 2], ['en-servicio', 3], ['demorado', 2], ['en-servicio', 5], ['libre', 8]] },
  { bahia: 'Bahia 3', tramos: [['libre', 6], ['en-servicio', 8], ['reservado', 4], ['libre', 2]] },
  { bahia: 'Bahia 4', tramos: [['inactivo', 20]] },
];

const SERIES = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'];

const TIPOGRAFIA: { clase: string; nombre: string; muestra: string }[] = [
  { clase: 'font-heading text-display font-semibold tracking-tight', nombre: 'display · 48/48', muestra: '87%' },
  { clase: 'font-heading text-4xl font-semibold tracking-tight', nombre: '4xl · 36/40', muestra: 'Panel del taller' },
  { clase: 'font-heading text-3xl font-semibold tracking-tight', nombre: '3xl · 30/36', muestra: 'Dashboard de indicadores' },
  { clase: 'font-heading text-2xl font-semibold tracking-tight', nombre: '2xl · 24/32', muestra: 'Agenda del tecnico' },
  { clase: 'font-heading text-xl font-semibold', nombre: 'xl · 20/28', muestra: 'Bahia 2 · Cambio de aceite' },
  { clase: 'text-lg', nombre: 'lg · 18/28', muestra: 'Texto destacado de parrafo' },
  { clase: 'text-base', nombre: 'base · 16/24', muestra: 'Texto de cuerpo para formularios y descripciones.' },
  { clase: 'text-sm', nombre: 'sm · 14/20', muestra: 'Texto de tablas, botones y etiquetas.' },
  { clase: 'text-xs', nombre: 'xs · 12/16', muestra: 'Metadatos, ayudas y leyendas de graficos.' },
];

const ESPACIOS = [
  [1, '4px', 'separacion icono-texto'],
  [2, '8px', 'dentro de un control'],
  [3, '12px', 'entre controles relacionados'],
  [4, '16px', 'padding de tarjeta, gap de grilla'],
  [6, '24px', 'entre bloques de una vista'],
  [8, '32px', 'entre secciones'],
  [12, '48px', 'margen de pagina en pantallas grandes'],
  [16, '64px', 'separacion mayor'],
] as const;

const SOMBRAS = ['shadow-xs', 'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl'];

/** Vuelve a leer los tokens cuando cambia la clase .dark del <html>. */
function useVersionTema(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => setVersion((v) => v + 1));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => obs.disconnect();
  }, []);
  return version;
}

function Seccion({
  id,
  titulo,
  descripcion,
  children,
}: {
  id: string;
  titulo: string;
  descripcion: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">{titulo}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{descripcion}</p>
      </div>
      {children}
    </section>
  );
}

function Veredicto({ razon, minimo }: { razon: number | null; minimo: number }) {
  if (razon === null) return <Badge variant="outline">sin dato</Badge>;
  // shrink-0: en celular el nombre del token se trunca, el veredicto no.
  const pasa = razon >= minimo;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${
        pasa ? 'bg-exito-suave text-exito-texto' : 'bg-error-suave text-error-texto'
      }`}
    >
      {pasa ? <CheckCircle2 className="size-3" /> : <OctagonAlert className="size-3" />}
      {razon.toFixed(2)}:1 {pasa ? 'AA' : 'no pasa'}
    </span>
  );
}

function EscalaColor({ nombre, uso }: { nombre: string; uso: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-heading text-sm font-semibold capitalize">{nombre}</p>
        <p className="text-xs text-muted-foreground">{uso}</p>
      </div>
      <div className="grid grid-cols-11 overflow-hidden rounded-lg border">
        {PASOS.map((paso) => {
          const token = `color-${nombre}-${paso}`;
          const hex = leerToken(token);
          // Texto de la muestra: el extremo de la escala que mas contrasta.
          const sobreClaro =
            (razonContraste(hex, '#ffffff') ?? 0) >= (razonContraste(hex, '#030712') ?? 0);
          return (
            <div
              key={paso}
              className="flex h-16 flex-col justify-end p-1.5 text-[10px] leading-tight"
              style={{
                background: `var(--${token})`,
                color: sobreClaro ? '#ffffff' : '#030712',
              }}
              title={`--${token}: ${hex}`}
            >
              <span className="font-semibold">{paso}</span>
              <span className="hidden font-mono sm:block">{hex}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DesignView() {
  useVersionTema();

  const secciones = [
    ['paleta', 'Paleta'],
    ['roles', 'Roles y contraste'],
    ['semanticos', 'Semanticos'],
    ['estados', 'Estados operativos'],
    ['graficos', 'Graficos'],
    ['tipografia', 'Tipografia'],
    ['espaciado', 'Espaciado'],
    ['sombras', 'Sombras y radios'],
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-12 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-wider text-marca-texto uppercase">
            Sistema de diseno
          </p>
          <h1 className="text-3xl font-semibold">TurnosPro Bahias</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Tokens de <code className="font-mono text-xs">src/index.css</code>, leidos en
            vivo del tema activo. Los contrastes se calculan con los valores reales; el
            mismo chequeo corre en CI con{' '}
            <code className="font-mono text-xs">scripts/verificar-contraste.mjs</code>.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card p-1.5 pl-3 text-sm shadow-xs">
          <span className="text-muted-foreground">Tema</span>
          <SelectorTema />
        </div>
      </header>

      <nav aria-label="Secciones" className="flex flex-wrap gap-2">
        {secciones.map(([id, nombre]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-full border bg-card px-3 py-1 text-xs font-medium hover:bg-muted"
          >
            {nombre}
          </a>
        ))}
      </nav>

      <Seccion
        id="paleta"
        titulo="Paleta"
        descripcion="Escalas 50-950 generadas en OKLCH y ancladas en los colores de marca. Son materia prima: los componentes no las usan directo, usan los roles de la seccion siguiente."
      >
        <div className="space-y-5">
          {ESCALAS.map((e) => (
            <EscalaColor key={e.nombre} {...e} />
          ))}
        </div>
      </Seccion>

      <Seccion
        id="roles"
        titulo="Roles y contraste"
        descripcion="Cada par texto/fondo que usa la aplicacion, con su razon de contraste en el tema activo. AA exige 4.5:1 para texto normal."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PARES.map(({ texto, fondo, nota }) => {
            const [hexTexto, hexFondo] = [leerToken(texto), leerToken(fondo)];
            return (
              <div
                key={`${texto}-${fondo}`}
                className="flex min-w-0 items-center justify-between gap-3 rounded-lg border p-3"
                style={{ background: `var(--${fondo})`, color: `var(--${texto})` }}
              >
                <div className="min-w-0">
                  <p className="font-heading text-base font-semibold">{nota}</p>
                  <p className="truncate font-mono text-xs">
                    --{texto} / --{fondo}
                  </p>
                </div>
                <Veredicto razon={razonContraste(hexTexto, hexFondo)} minimo={4.5} />
              </div>
            );
          })}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Componentes con los roles aplicados</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button>Reservar turno</Button>
            <Button variant="secondary">Secundario</Button>
            <Button variant="outline">Anterior</Button>
            <Button variant="ghost">Fantasma</Button>
            <Button variant="destructive">Cancelar turno</Button>
            <Button variant="link">Ver agenda</Button>
            <Badge>Primario</Badge>
            <Badge variant="secondary">Tecnico</Badge>
            <Badge variant="outline">Mecanica</Badge>
            <Badge variant="destructive">No asistio</Badge>
            <Input className="max-w-56" placeholder="Buscar placa..." />
          </CardContent>
        </Card>
      </Seccion>

      <Seccion
        id="semanticos"
        titulo="Colores semanticos"
        descripcion="Tres tokens por familia: solido (iconos y barras, 3:1 contra la tarjeta), texto (4.5:1 sobre cualquier fondo) y suave (fondo de avisos). El error es carmesi y la advertencia ambar-amarillo para no confundirse con el naranja de marca."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {SEMANTICOS.map(({ token, titulo, icono: Icono, fondo, borde, texto, iconoClase, mensaje }) => (
            <div
              key={token}
              role="status"
              className={`flex gap-3 rounded-lg border p-3 ${fondo} ${borde}`}
            >
              <Icono className={`mt-0.5 size-5 shrink-0 ${iconoClase}`} aria-hidden />
              <div className="space-y-0.5">
                <p className={`text-sm font-semibold ${texto}`}>{titulo}</p>
                <p className="text-sm text-foreground">{mensaje}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  --{token} · --{token}-texto · --{token}-suave
                </p>
              </div>
            </div>
          ))}
        </div>
      </Seccion>

      <Seccion
        id="estados"
        titulo="Estados operativos"
        descripcion="Un mismo juego de cinco estados para bahias y mecanicos. Separados de a pares incluso simulando los tres tipos de daltonismo; aun asi un estado nunca se comunica solo con color: siempre lleva su etiqueta."
      >
        <div className="grid gap-3 sm:grid-cols-5">
          {ESTADOS.map((e) => (
            <div key={e} className={`space-y-2 rounded-lg border p-3 ${ESTADO[e].suave}`}>
              <div className="flex items-center gap-2">
                <span className={`size-3 rounded-full ${ESTADO[e].punto}`} aria-hidden />
                <span className="text-sm font-semibold">{ESTADO[e].bahia}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Mecanico: {ESTADO[e].mecanico}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground">--estado-{e}</p>
            </div>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Ocupacion del dia (ejemplo)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {TIMELINE.map(({ bahia, tramos }) => (
              <div key={bahia} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-sm font-medium">{bahia}</span>
                <div className="flex h-7 flex-1 gap-0.5 overflow-hidden rounded-md">
                  {tramos.map(([estado, mediasHoras], i) => (
                    <div
                      key={i}
                      className={`${ESTADO[estado].barra} flex items-center justify-center`}
                      style={{ flexGrow: mediasHoras }}
                      title={`${ESTADO[estado].bahia} · ${mediasHoras * 30} min`}
                    >
                      <span className="sr-only">{ESTADO[estado].bahia}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 pl-19 text-xs text-muted-foreground">
              <span>8:00</span>
              <span className="ml-auto">18:00</span>
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {ESTADOS.map((e) => (
                <li key={e} className="flex items-center gap-1.5">
                  <span className={`size-2.5 rounded-sm ${ESTADO[e].punto}`} aria-hidden />
                  {ESTADO[e].bahia}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </Seccion>

      <Seccion
        id="graficos"
        titulo="Series de graficos"
        descripcion="Orden de uso para series categoricas. chart-1 y chart-2 son las del dashboard (atendidos / no asistio). chart-5 es el neutro para 'otros'. Minimo 3:1 contra la tarjeta."
      >
        <div className="grid gap-3 sm:grid-cols-5">
          {SERIES.map((s) => {
            const hex = leerToken(s);
            return (
              <div key={s} className="overflow-hidden rounded-lg border bg-card">
                <div className="h-14" style={{ background: `var(--${s})` }} />
                <div className="flex items-center justify-between gap-1 p-2">
                  <span className="font-mono text-xs">--{s}</span>
                  <Veredicto razon={razonContraste(hex, leerToken('card'))} minimo={3} />
                </div>
              </div>
            );
          })}
        </div>
        <Card>
          <CardContent className="flex h-40 items-end gap-3 pt-4" aria-hidden>
            {[
              [70, 20, 45, 30, 12],
              [55, 35, 30, 40, 18],
              [80, 15, 50, 25, 10],
              [62, 28, 40, 35, 15],
            ].map((grupo, i) => (
              // h-full: sin alto propio, el height en % de cada barra no
              // tiene contra que resolverse y las barras miden 0.
              <div key={i} className="flex h-full flex-1 items-end gap-1">
                {grupo.map((altura, j) => (
                  <div
                    key={j}
                    className="flex-1 rounded-t-sm"
                    style={{ height: `${altura}%`, background: `var(--${SERIES[j]})` }}
                  />
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      </Seccion>

      <Seccion
        id="tipografia"
        titulo="Tipografia"
        descripcion="Inter para titulos (--font-heading), Public Sans para texto (--font-sans). Cifras tabulares en tablas para que los horarios queden alineados."
      >
        <Card>
          <CardContent className="divide-y">
            {TIPOGRAFIA.map(({ clase, nombre, muestra }) => (
              <div key={nombre} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 py-3">
                <span className="w-28 shrink-0 font-mono text-xs text-muted-foreground">
                  {nombre}
                </span>
                <span className={clase}>{muestra}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </Seccion>

      <Seccion
        id="espaciado"
        titulo="Espaciado"
        descripcion="Base de 4px (--spacing). Estos son los pasos que usa el panel; evitar valores intermedios salvo en ajustes de iconos."
      >
        <Card>
          <CardContent className="space-y-2">
            {ESPACIOS.map(([paso, px, uso]) => (
              <div key={paso} className="flex items-center gap-4 text-sm">
                <span className="w-10 shrink-0 font-mono text-xs">{paso}</span>
                <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                  {px}
                </span>
                <span
                  className="h-3 shrink-0 rounded-sm bg-primary"
                  style={{ width: `calc(var(--spacing) * ${paso})` }}
                />
                <span className="text-muted-foreground">{uso}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </Seccion>

      <Seccion
        id="sombras"
        titulo="Sombras y radios"
        descripcion="Sombras con tinte carbon; en modo oscuro suben de opacidad, pero la jerarquia la dan sobre todo las superficies (fondo -> tarjeta)."
      >
        <div className="grid gap-4 sm:grid-cols-5">
          {SOMBRAS.map((s) => (
            <div
              key={s}
              className={`flex h-20 items-center justify-center rounded-lg bg-card font-mono text-xs ${s}`}
            >
              {s}
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-5">
          {['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl', 'rounded-2xl'].map((r) => (
            <div
              key={r}
              className={`flex h-16 items-center justify-center border-2 border-primary bg-card font-mono text-xs ${r}`}
            >
              {r}
            </div>
          ))}
        </div>
      </Seccion>
    </div>
  );
}
