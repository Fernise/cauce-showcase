import Link from "next/link";

/*
 * Status is never colour alone: every state has a glyph (shape) + a word.
 *   solid square  = something is missing (sin cubrir, abierta)
 *   half square   = waiting on someone (esperando, pendiente, en curso)
 *   check         = flowing again (cubierto, aceptada, resuelta)
 *   hollow square = closed without outcome (anulado, retirada)
 *   cross         = refused (rechazada)
 *   bars 1–3      = severity (baja / media / alta)
 * See docs/design.md § Status.
 */

type Tone = "green" | "red" | "amber" | "blue" | "slate" | "violet";
export type GlyphKind = "solid" | "half" | "check" | "hollow" | "cross" | "bars1" | "bars2" | "bars3";

const TONE_TEXT: Record<Tone, string> = {
  red: "text-almagre",
  amber: "text-azufre-texto",
  green: "text-mar",
  blue: "text-mar",
  slate: "text-picon-3",
  violet: "text-[#5b3e8a]",
};
const TONE_MARK: Record<Tone, string> = {
  red: "text-almagre",
  amber: "text-azufre",
  green: "text-mar",
  blue: "text-mar",
  slate: "text-picon-4",
  violet: "text-[#5b3e8a]",
};

export function Glyph({ kind, className = "" }: { kind: GlyphKind; className?: string }) {
  const common = { viewBox: "0 0 12 12", className: `size-3 shrink-0 ${className}`, "aria-hidden": true } as const;
  switch (kind) {
    case "solid":
      return <svg {...common}><rect x="1" y="1" width="10" height="10" fill="currentColor" /></svg>;
    case "half":
      return (
        <svg {...common}>
          <rect x="1.75" y="1.75" width="8.5" height="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="1" y="1" width="5" height="10" fill="currentColor" />
        </svg>
      );
    case "check":
      return <svg {...common}><path d="M1.5 6.5 4.6 9.5 10.5 2.5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
    case "hollow":
      return <svg {...common}><rect x="1.75" y="1.75" width="8.5" height="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
    case "cross":
      return <svg {...common}><path d="M2 2 10 10M10 2 2 10" fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
    default: {
      const n = kind === "bars3" ? 3 : kind === "bars2" ? 2 : 1;
      return (
        <svg {...common} viewBox="0 0 14 12" className={`h-3 w-3.5 shrink-0 ${className}`}>
          {[0, 1, 2].map((i) => (
            <rect key={i} x={i * 5} y={8 - i * 3.5} width="3.5" height={4 + i * 3.5} fill="currentColor" opacity={i < n ? 1 : 0.22} />
          ))}
        </svg>
      );
    }
  }
}

export function Badge({ tone = "slate", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`cond inline-flex items-center gap-1 rounded-xs border border-current/35 px-1.5 py-px text-[0.6875rem] leading-4 font-bold tracking-[0.07em] whitespace-nowrap uppercase ${TONE_TEXT[tone]}`}>
      {children}
    </span>
  );
}

type StatusDef = { label: string; tone: Tone; glyph: GlyphKind };

export const CASE_STATUS: Record<string, StatusDef> = {
  open: { label: "Sin cubrir", tone: "red", glyph: "solid" },
  offering: { label: "Esperando respuesta", tone: "amber", glyph: "half" },
  covered: { label: "Cubierto", tone: "green", glyph: "check" },
  unresolved: { label: "Sin cobertura", tone: "slate", glyph: "hollow" },
  cancelled: { label: "Anulado", tone: "slate", glyph: "hollow" },
};

export const OFFER_STATUS: Record<string, StatusDef> = {
  pending: { label: "Pendiente", tone: "amber", glyph: "half" },
  accepted: { label: "Aceptada", tone: "green", glyph: "check" },
  declined: { label: "Rechazada", tone: "red", glyph: "cross" },
  withdrawn: { label: "Retirada", tone: "slate", glyph: "hollow" },
};

export const INCIDENT_STATUS: Record<string, StatusDef> = {
  abierta: { label: "Abierta", tone: "red", glyph: "solid" },
  en_curso: { label: "En curso", tone: "amber", glyph: "half" },
  resuelta: { label: "Resuelta", tone: "green", glyph: "check" },
};

export const SEVERITY: Record<string, StatusDef> = {
  alta: { label: "Alta", tone: "red", glyph: "bars3" },
  media: { label: "Media", tone: "amber", glyph: "bars2" },
  baja: { label: "Baja", tone: "slate", glyph: "bars1" },
};

const TONE_DARK: Record<Tone, string> = {
  red: "text-almagre-claro",
  amber: "text-azufre-claro",
  green: "text-mar-claro",
  blue: "text-mar-claro",
  slate: "text-picon-4",
  violet: "text-[#b9a3dd]",
};

/** Glyph + word. No pill, no fill — the shape carries the meaning, colour reinforces it. */
export function StatusBadge({
  map, status, className = "", onDark = false,
}: { map: Record<string, StatusDef>; status: string; className?: string; onDark?: boolean }) {
  const s = map[status] ?? { label: status, tone: "slate" as Tone, glyph: "hollow" as GlyphKind };
  return (
    <span className={`cond inline-flex items-center gap-1.5 text-[0.8125rem] leading-5 font-semibold whitespace-nowrap ${onDark ? TONE_DARK[s.tone] : TONE_TEXT[s.tone]} ${className}`}>
      <Glyph kind={s.glyph} className={onDark ? "" : TONE_MARK[s.tone]} />
      {s.label}
    </span>
  );
}

/** Just the mark, for dense rows (e.g. severity bars at the start of an incident row). */
export function StatusMark({ map, status, className = "" }: { map: Record<string, StatusDef>; status: string; className?: string }) {
  const s = map[status] ?? { label: status, tone: "slate" as Tone, glyph: "hollow" as GlyphKind };
  return (
    <span className={`inline-flex ${TONE_MARK[s.tone]} ${className}`} title={s.label}>
      <Glyph kind={s.glyph} />
      <span className="sr-only">{s.label}</span>
    </span>
  );
}

export function PageHeader({
  title, subtitle, actions, back, kicker,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  kicker?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="eyebrow -ml-1 mb-1 inline-flex min-h-8 items-center gap-1 px-1 hover:text-picon">
            <span aria-hidden>←</span> {back.label}
          </Link>
        )}
        {kicker && <div className="eyebrow mb-1">{kicker}</div>}
        <h1 className="cond text-[1.75rem] leading-[1.08] font-[750] tracking-[-0.012em] text-balance text-picon sm:text-[2.125rem]">{title}</h1>
        {subtitle && <div className="mt-1.5 text-[0.9375rem] text-picon-2">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Section title sitting on an ink rule, like a timetable header. */
export function SectionHead({ title, aside, className = "" }: { title: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-9 flex-wrap items-end justify-between gap-x-4 gap-y-0.5 border-b-2 border-picon pb-1.5 ${className}`}>
      <h2 className="h-section">{title}</h2>
      {aside && <div className="text-sm whitespace-nowrap text-picon-3">{aside}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-dashed border-linea-fuerte px-5 py-8">
      <div className="text-[0.9375rem] font-semibold text-picon">{title}</div>
      {children && <div className="mt-1 max-w-prose text-sm text-picon-3">{children}</div>}
    </div>
  );
}

export function Tabs({ items, active }: { items: { href: string; label: string; count?: number; key: string }[]; active: string }) {
  return (
    <div className="mb-5 flex gap-5 overflow-x-auto border-b border-linea">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`cond -mb-px flex min-h-11 items-center gap-1.5 border-b-2 text-[0.8125rem] font-bold tracking-[0.06em] whitespace-nowrap uppercase ${
            t.key === active ? "border-picon text-picon" : "border-transparent text-picon-3 hover:text-picon"
          }`}
        >
          {t.label}
          {t.count !== undefined && <span className="num font-semibold text-picon-3">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function Initials({ name, className = "" }: { name: string; className?: string }) {
  const parts = name.split(" ");
  const initials = (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  return (
    <span className={`cond inline-flex size-8 shrink-0 items-center justify-center rounded-xs bg-cal-hondo text-xs font-bold tracking-wide text-picon-2 ${className}`}>
      {initials}
    </span>
  );
}

/** Ten-cell meter (departure-board style) for a 0–100 value. */
export function Meter({ value, className = "" }: { value: number; className?: string }) {
  const filled = Math.round(Math.max(0, Math.min(100, value)) / 10);
  return (
    <span className={`inline-flex gap-[2px] ${className}`} aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={`h-2.5 w-1.5 ${i < filled ? "bg-picon" : "bg-linea"}`} />
      ))}
    </span>
  );
}

/** Coverage strip: one cell per service of the day, gaps in almagre. */
export function CoverageStrip({ total, gaps, className = "" }: { total: number; gaps: number; className?: string }) {
  const n = Math.min(total, 60);
  const g = Math.min(gaps, n);
  return (
    <span className={`flex max-w-56 gap-[2px] ${className}`} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`h-3 min-w-px flex-1 ${i >= n - g ? "bg-almagre-claro" : "bg-cal/60"}`} />
      ))}
    </span>
  );
}
