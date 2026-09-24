import { LogOut, Palette, Wrench } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { SelectorTema } from '@/components/SelectorTema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthProvider';
import { itemsPara, ROL_LABEL, type ItemNavegacion } from './navegacion';

/*
 * Estructura del panel (Sprint 14):
 *
 *   >= lg (1024px): barra lateral fija a la izquierda + header arriba.
 *   <  lg         : header arriba + barra de pestanas abajo.
 *
 * En el celular la navegacion va ABAJO y no en un menu hamburguesa: son 4
 * destinos como mucho, y en un taller el panel se usa con una mano (la otra
 * suele estar ocupada). Una pestana abajo esta al alcance del pulgar y
 * siempre visible; un menu escondido arriba cuesta dos toques y hay que
 * estirarse.
 */

function Marca({ compacta = false }: { compacta?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-md">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Wrench className="size-4" aria-hidden />
      </span>
      <span className={compacta ? 'sr-only sm:not-sr-only' : undefined}>
        <span className="block font-heading text-sm leading-tight font-semibold">
          TurnosPro
        </span>
        <span className="block text-xs leading-tight opacity-80">Bahias</span>
      </span>
    </Link>
  );
}

function BarraLateral({ items, esAdmin }: { items: ItemNavegacion[]; esAdmin: boolean }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex h-14 items-center px-4">
        <Marca />
      </div>
      <nav aria-label="Principal" className="flex-1 px-3 py-4">
        <ul className="space-y-1">
          {items.map(({ to, etiqueta, icono: Icono, exacto }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={exacto}
                className={({ isActive }) =>
                  `relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-sidebar-primary'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  }`
                }
              >
                <Icono className="size-4 shrink-0" aria-hidden />
                {etiqueta}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      {esAdmin && (
        <div className="border-t border-sidebar-border px-3 py-3">
          <NavLink
            to="/design"
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2 text-xs font-medium ${
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              }`
            }
          >
            <Palette className="size-4" aria-hidden />
            Sistema de diseno
          </NavLink>
        </div>
      )}
    </aside>
  );
}

function BarraInferior({ items }: { items: ItemNavegacion[] }) {
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul
        className="grid"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map(({ to, etiqueta, icono: Icono, exacto }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={exacto}
              className={({ isActive }) =>
                // 56px de alto: por encima del minimo de 44px de area tactil.
                `relative flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                  isActive
                    ? 'text-marca-texto before:absolute before:inset-x-6 before:top-0 before:h-0.5 before:rounded-full before:bg-primary'
                    : 'text-muted-foreground'
                }`
              }
            >
              <Icono className="size-5" aria-hidden />
              {etiqueta}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Encabezado() {
  const { usuario, cerrarSesion } = useAuth();
  const inicial = usuario?.email.charAt(0).toUpperCase() ?? '?';

  return (
    <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="flex h-14 items-center justify-between gap-3 px-4 lg:px-6">
        {/* La marca va en la barra lateral en escritorio; aca solo en celular. */}
        <div className="lg:hidden">
          <Marca compacta />
        </div>
        <div className="hidden lg:block" />

        <div className="flex items-center gap-2 sm:gap-3">
          {usuario && (
            <div className="flex items-center gap-2">
              <span
                className="flex size-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
                aria-hidden
              >
                {inicial}
              </span>
              <div className="hidden min-w-0 flex-col leading-tight sm:flex">
                <span className="max-w-48 truncate text-xs text-muted-foreground">
                  {usuario.email}
                </span>
              </div>
              <Badge variant="secondary">{ROL_LABEL[usuario.rol] ?? usuario.rol}</Badge>
            </div>
          )}
          <SelectorTema />
          <Button variant="outline" size="sm" onClick={cerrarSesion} aria-label="Salir">
            <LogOut aria-hidden />
            <span className="hidden sm:inline">Salir</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

export function AppLayout() {
  const { usuario } = useAuth();
  const items = itemsPara(usuario);
  // Con un solo destino (el cliente) una barra de pestanas no navega a
  // ningun lado: no se muestra.
  const conBarraInferior = items.length > 1;

  return (
    <div className="min-h-svh">
      <a
        href="#contenido"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Saltar al contenido
      </a>
      <BarraLateral items={items} esAdmin={usuario?.rol === 'admin'} />
      <div className="lg:pl-60">
        <Encabezado />
        <main
          id="contenido"
          tabIndex={-1}
          className={`outline-none ${conBarraInferior ? 'pb-20 lg:pb-0' : ''}`}
        >
          <Outlet />
        </main>
      </div>
      {conBarraInferior && <BarraInferior items={items} />}
    </div>
  );
}
