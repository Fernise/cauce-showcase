import Link from "next/link";
import { requireUser } from "@/lib/session.ts";
import { activeCases, dashboardStats, directory, recentActivity, orgTimezone } from "@/lib/queries.ts";
import { all } from "@/lib/db.ts";
import { formatDateLong, formatDateRelative, formatTimestamp, weekdayName, isoWeekday } from "@/lib/dates.ts";
import { INCIDENT_SELECT, type IncidentRow } from "@/lib/incidents.ts";
import { AvisoComposer } from "@/components/aviso-composer";
import { CASE_STATUS, CoverageStrip, Glyph, SEVERITY, SectionHead, StatusBadge, StatusMark } from "@/components/ui";
import { ActivityList } from "@/components/activity-list";

export const metadata = { title: "Panel" };

export default async function Dashboard() {
  const user = await requireUser();
  const tz = orgTimezone(user.orgId);
  const stats = dashboardStats(user.orgId);
  const cases = activeCases(user.orgId, stats.today);
  const incidents = all<IncidentRow>(
    `${INCIDENT_SELECT} WHERE i.org_id = ? AND i.status != 'resuelta'
      ORDER BY CASE i.severity WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, i.created_at DESC LIMIT 5`,
    user.orgId,
  );
  const activity = recentActivity(user.orgId, 8);
  const urgent = cases.filter((c) => c.date <= stats.tomorrow);
  const later = cases.filter((c) => c.date > stats.tomorrow);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="eyebrow">
          <span className="first-letter:uppercase">{weekdayName(isoWeekday(stats.today))}, {formatDateLong(stats.today)}</span>
          <span className="text-picon-4"> · </span>Hola, {user.name.split(" ")[0]}
        </p>
        <h1 className="cond mt-1 max-w-3xl text-[1.875rem] leading-[1.06] font-[750] tracking-[-0.015em] text-balance sm:text-[2.5rem]">
          {urgent.length === 0
            ? "Todo cubierto para hoy y mañana."
            : `${urgent.length} servicio${urgent.length > 1 ? "s" : ""} pendiente${urgent.length > 1 ? "s" : ""} de cubrir entre hoy y mañana.`}
        </h1>
      </header>

      {/* El tablero: the one dark surface in the app — today at a glance, like a departures board. */}
      <section aria-label="Resumen de cobertura" className="tablero grid grid-cols-2 lg:grid-cols-4">
        <DayCell label="Cobertura hoy" d={stats.todayShifts} />
        <DayCell label="Cobertura mañana" d={stats.tomorrowShifts} className="border-l border-cal/15" />
        <Cell label="Ausencias hoy" className="border-t border-cal/15 lg:border-t-0 lg:border-l">
          <Big>{stats.absentToday}</Big>
          <Foot>{stats.absentToday === 1 ? "persona" : "personas"}</Foot>
        </Cell>
        <Cell label="Tiempo medio de cobertura" className="border-t border-l border-cal/15 lg:border-t-0">
          <Big>
            {stats.coverTime.avg !== null ? Math.max(1, Math.round(stats.coverTime.avg)) : "—"}
            {stats.coverTime.avg !== null && <span className="ml-1 text-lg font-semibold text-cal/70">min</span>}
          </Big>
          <Foot>{stats.coveredMonth} sustituciones en 30 días</Foot>
        </Cell>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5 lg:gap-10">
        <div className="flex flex-col gap-8 lg:col-span-3">
          <section>
            <SectionHead title="Requiere tu atención" aside={<Link href="/coberturas" className="link text-sm">Ver coberturas</Link>} />
            {cases.length === 0 ? (
              <p className="flex items-center gap-2 py-4 text-sm text-picon-2">
                <Glyph kind="check" className="text-mar" /> No hay servicios pendientes de cubrir.
              </p>
            ) : (
              <ul className="divide-y divide-linea-suave">
                {[...urgent, ...later].slice(0, 7).map((c) => (
                  <li key={c.id}>
                    <Link href={`/coberturas/${c.id}`} className="-mx-2 grid min-h-16 grid-cols-[4rem_1fr] items-center gap-x-3 px-2 py-3 hover:bg-cal-hondo/60 sm:grid-cols-[4.5rem_1fr_auto]">
                      <div className="num leading-tight">
                        <div className="text-xl font-bold">{c.start}</div>
                        <div className="eyebrow text-[0.6875rem] first-letter:uppercase">{formatDateRelative(c.date, stats.today)}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[0.9375rem] font-semibold">{c.location_name}</div>
                        <div className="truncate text-sm text-picon-3">
                          <span className="num">{c.start}–{c.end}</span> · {c.title}
                          {c.original_name ? ` · falta ${c.original_name.split(" ")[0]}` : ""}
                        </div>
                        <StatusBadge map={CASE_STATUS} status={c.status} className="mt-0.5 sm:hidden" />
                      </div>
                      <span className="hidden sm:block"><StatusBadge map={CASE_STATUS} status={c.status} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionHead title="Incidencias abiertas" aside={<Link href="/incidencias" className="link text-sm">Ver todas</Link>} />
            {incidents.length === 0 ? (
              <p className="py-4 text-sm text-picon-2">Sin incidencias abiertas.</p>
            ) : (
              <ul className="divide-y divide-linea-suave">
                {incidents.map((i) => (
                  <li key={i.id}>
                    <Link href={`/incidencias/${i.id}`} className="-mx-2 flex min-h-14 items-center gap-3 px-2 py-3 hover:bg-cal-hondo/60">
                      <StatusMark map={SEVERITY} status={i.severity} className="w-4 justify-center" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[0.9375rem] font-semibold">{i.title}</div>
                        <div className="truncate text-sm text-picon-3">
                          {i.location_name ?? i.client_name ?? "Sin centro"} · {formatTimestamp(i.created_at, tz)}
                          {i.status === "en_curso" ? " · en curso" : ""}
                        </div>
                      </div>
                      <span className="hidden sm:block"><StatusBadge map={SEVERITY} status={i.severity} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-8 lg:col-span-2">
          <section>
            <SectionHead title="Registrar aviso" className="mb-3" />
            <AvisoComposer dir={directory(user.orgId)} today={stats.today} compact />
          </section>
          <section>
            <SectionHead title="Actividad reciente" aside={<Link href="/actividad" className="link text-sm">Ver todo</Link>} className="mb-3" />
            <ActivityList tz={tz} items={activity} />
          </section>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 px-4 py-4 sm:px-5 ${className}`}>
      <div className="cond text-[0.6875rem] font-bold tracking-[0.1em] text-cal/65 uppercase">{label}</div>
      {children}
    </div>
  );
}

function Big({ children }: { children: React.ReactNode }) {
  return <div className="num text-[2.5rem] leading-none font-bold tracking-[-0.01em] text-cal-claro">{children}</div>;
}

function Foot({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-[0.8125rem] text-cal/70 ${className}`}>{children}</div>;
}

function DayCell({ label, d, className = "" }: { label: string; d: { total: number; uncovered: number }; className?: string }) {
  const gaps = d.uncovered ?? 0;
  return (
    <Cell label={label} className={className}>
      <Big>
        {d.total - gaps}
        <span className="text-xl font-semibold text-cal/55">/{d.total}</span>
      </Big>
      <CoverageStrip total={d.total} gaps={gaps} className="my-1" />
      {gaps ? (
        <Foot className="flex items-center gap-1.5 font-semibold !text-almagre-claro">
          <Glyph kind="solid" /> {gaps} sin cubrir
        </Foot>
      ) : (
        <Foot className="flex items-center gap-1.5 !text-mar-claro">
          <Glyph kind="check" /> Todo cubierto
        </Foot>
      )}
    </Cell>
  );
}
