"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CalendarDays, LayoutGrid, LogOut, Menu, Plus, Repeat, X } from "lucide-react";
import { Mark, Wordmark } from "./mark";

const OPERACION = [
  { href: "/", label: "Panel" },
  { href: "/coberturas", label: "Coberturas" },
  { href: "/incidencias", label: "Incidencias" },
  { href: "/planificacion", label: "Planificación" },
  { href: "/ausencias", label: "Ausencias" },
];
const REGISTRO = [
  { href: "/personal", label: "Personal" },
  { href: "/clientes", label: "Clientes" },
  { href: "/actividad", label: "Actividad" },
  { href: "/ajustes", label: "Ajustes" },
];

// Mobile bottom bar: icons are allowed here (navigation at thumb size), always with a word.
const MOBILE_NAV = [
  { href: "/", label: "Panel", icon: LayoutGrid },
  { href: "/coberturas", label: "Coberturas", icon: Repeat },
  null,
  { href: "/incidencias", label: "Incidencias", icon: AlertTriangle },
  { href: "/planificacion", label: "Planificación", icon: CalendarDays },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Count({ n }: { n: number }) {
  return (
    <span className="num inline-flex h-5 min-w-5 items-center justify-center bg-almagre px-1 text-xs font-bold text-cal-claro">
      {n}
    </span>
  );
}

export function Shell({
  children, userName, orgName, badges, logoutAction,
}: {
  children: React.ReactNode;
  userName: string;
  orgName: string;
  badges: Record<string, number>;
  logoutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const group = (title: string, items: typeof OPERACION, onClick?: () => void) => (
    <div>
      <div className="eyebrow mb-1 px-3">{title}</div>
      <ul className="flex flex-col">
        {items.map(({ href, label }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onClick}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 border-l-[3px] px-3 text-[0.9375rem] lg:min-h-9 ${
                  active
                    ? "border-picon bg-cal-hondo font-semibold text-picon"
                    : "border-transparent text-picon-2 hover:bg-cal-hondo/60 hover:text-picon"
                }`}
              >
                <span className="flex-1">{label}</span>
                {badges[href] ? <Count n={badges[href]} /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );

  const nav = (onClick?: () => void) => (
    <nav className="flex flex-col gap-6" aria-label="Principal">
      {group("Operación", OPERACION, onClick)}
      {group("Registro", REGISTRO, onClick)}
    </nav>
  );

  const brand = (
    <Link href="/" className="flex min-h-11 items-center gap-2.5" aria-label="Cauce, ir al panel">
      <Mark className="size-8" />
      <span className="flex min-w-0 flex-col leading-tight">
        <Wordmark className="text-picon" />
        <span className="max-w-40 truncate text-xs text-picon-3">{orgName}</span>
      </span>
    </Link>
  );

  const userBox = (
    <div className="flex items-center justify-between gap-2 border-t border-linea pt-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-picon">{userName}</div>
        <div className="text-xs text-picon-3">Coordinación</div>
      </div>
      <form action={logoutAction}>
        <button className="btn-ghost px-2.5" title="Cerrar sesión" aria-label="Cerrar sesión">
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );

  return (
    <div className="lg:flex">
      {/* Desktop sidebar: an index, not a launcher — words first, counts on the right. */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col gap-6 border-r border-linea bg-cal px-3 py-5 lg:flex">
        <div className="px-2">{brand}</div>
        <Link href="/avisos/nuevo" className="btn-primary mx-1 justify-start">
          <Plus className="size-4" strokeWidth={2.5} /> Registrar aviso
        </Link>
        <div className="-mx-3 flex-1 overflow-y-auto">{nav()}</div>
        <div className="px-2">{userBox}</div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-linea bg-cal/95 px-4 py-1.5 backdrop-blur-sm lg:hidden">
        {brand}
        <button className="btn-ghost -mr-2 size-11 px-0" onClick={() => setOpen(true)} aria-label="Abrir menú">
          <Menu className="size-5" />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-picon/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[min(20rem,88vw)] flex-col gap-5 border-l border-linea bg-cal py-3">
            <div className="flex items-center justify-between px-4">
              {brand}
              <button className="btn-ghost -mr-2 size-11 px-0" onClick={() => setOpen(false)} aria-label="Cerrar menú">
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav(() => setOpen(false))}</div>
            <div className="px-4">{userBox}</div>
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 pb-28 lg:pb-12 lg:pl-60">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-10 lg:py-9">{children}</div>
      </main>

      {/* Mobile bottom bar */}
      <nav
        aria-label="Accesos rápidos"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-linea bg-cal-claro pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {MOBILE_NAV.map((item) => {
          if (!item) {
            return (
              <Link
                key="new"
                href="/avisos/nuevo"
                className="flex min-h-16 flex-col items-center justify-center gap-0.5 bg-picon text-cal-claro active:bg-black"
              >
                <Plus className="size-5" strokeWidth={2.5} />
                <span className="cond text-[0.6875rem] font-bold tracking-[0.06em] uppercase">Aviso</span>
              </Link>
            );
          }
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-16 flex-col items-center justify-center gap-1 border-t-2 text-[0.6875rem] ${
                active ? "border-picon font-bold text-picon" : "border-transparent font-medium text-picon-3"
              }`}
            >
              <item.icon className="size-5" strokeWidth={active ? 2.25 : 1.75} />
              <span className="cond tracking-[0.02em]">{item.label}</span>
              {badges[item.href] ? (
                <span className="absolute top-2 left-[calc(50%+6px)]">
                  <Count n={badges[item.href]} />
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
