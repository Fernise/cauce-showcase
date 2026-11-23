import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, Phone } from "lucide-react";
import { requireUser } from "@/lib/session.ts";
import { all, get } from "@/lib/db.ts";
import { orgToday } from "@/lib/queries.ts";
import { addDays, formatDateRelative, formatRange, hoursBetween, startOfWeek, weekdayName } from "@/lib/dates.ts";
import { parseSkills, skillLabel } from "@/lib/skills.ts";
import { REASON_LABELS, type ReasonCategory } from "@/lib/parse-message.ts";
import { Badge, PageHeader } from "@/components/ui";

export const metadata = { title: "Ficha" };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const e = get<{ id: number; name: string; phone: string | null; email: string | null; zone: string | null; weekly_hours: number; skills: string; notes: string | null }>(
    "SELECT * FROM employees WHERE org_id = ? AND id = ?", user.orgId, Number(id),
  );
  if (!e) notFound();
  const today = orgToday(user.orgId);
  const ws = startOfWeek(today);
  const avail = all<{ weekday: number; start: string; end: string }>("SELECT weekday, start, end FROM availability WHERE employee_id = ? ORDER BY weekday", e.id);
  const shifts = all<{ id: number; date: string; start: string; end: string; title: string; location_name: string }>(
    `SELECT s.id, s.date, s.start, s.end, s.title, l.name AS location_name FROM shifts s JOIN locations l ON l.id = s.location_id
      WHERE s.employee_id = ? AND s.status = 'scheduled' AND s.date BETWEEN ? AND ? ORDER BY s.date, s.start`,
    e.id, today, addDays(ws, 13),
  );
  const weekHours = shifts.filter((s) => s.date <= addDays(ws, 6)).reduce((h, s) => h + hoursBetween(s.start, s.end), 0)
    + all<{ start: string; end: string }>("SELECT start, end FROM shifts WHERE employee_id = ? AND status = 'scheduled' AND date >= ? AND date < ?", e.id, ws, today)
      .reduce((h, s) => h + hoursBetween(s.start, s.end), 0);
  const absences = all<{ id: number; start_date: string; end_date: string; reason_category: ReasonCategory; status: string }>(
    "SELECT id, start_date, end_date, reason_category, status FROM absences WHERE employee_id = ? ORDER BY start_date DESC LIMIT 8", e.id,
  );
  const covered = get<{ n: number }>("SELECT COUNT(*) AS n FROM coverage_cases WHERE resolved_employee_id = ? AND status = 'covered' AND resolved_at >= datetime('now','-30 days')", e.id)!.n;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/personal", label: "Personal" }} title={e.name} subtitle={`${e.zone ?? "Sin zona"} · contrato ${e.weekly_hours} h/semana`}
        actions={<Link href={`/personal/${e.id}/editar`} className="btn-secondary">Editar</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section>
            <h2 className="h-section mb-2">Próximos servicios</h2>
            {shifts.length === 0 ? (
              <div className="card p-4 text-sm text-slate-500">Sin servicios planificados.</div>
            ) : (
              <ul className="card divide-y divide-slate-100">
                {shifts.slice(0, 20).map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="w-24 shrink-0 text-xs text-slate-500 first-letter:uppercase">{formatDateRelative(s.date, today)}</span>
                    <span className="w-24 shrink-0 tabular-nums">{s.start}–{s.end}</span>
                    <span className="min-w-0 flex-1 truncate">{s.location_name} <span className="text-slate-500">· {s.title}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="h-section mb-2">Ausencias</h2>
            {absences.length === 0 ? (
              <div className="card p-4 text-sm text-slate-500">Sin ausencias registradas.</div>
            ) : (
              <ul className="card divide-y divide-slate-100">
                {absences.map((a) => (
                  <li key={a.id}>
                    <Link href={`/ausencias/${a.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-slate-50">
                      <span className="first-letter:uppercase">{formatRange(a.start_date, a.end_date, today)}</span>
                      <span className="text-slate-500">{REASON_LABELS[a.reason_category]}{a.status === "cancelled" ? " · anulada" : ""}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="flex flex-col gap-6">
          <section className="card p-4 text-sm">
            <h2 className="h-section mb-3">Contacto</h2>
            {e.phone && <a href={`tel:${e.phone}`} className="flex items-center gap-2 py-1 text-slate-700 hover:underline"><Phone className="size-4" /> {e.phone}</a>}
            {e.email && <a href={`mailto:${e.email}`} className="flex items-center gap-2 py-1 text-slate-700 hover:underline"><Mail className="size-4" /> {e.email}</a>}
          </section>
          <section className="card p-4 text-sm">
            <h2 className="h-section mb-3">Esta semana</h2>
            <div className="text-2xl font-semibold tabular-nums">{Math.round(weekHours * 10) / 10} <span className="text-base font-normal text-slate-500">/ {e.weekly_hours} h</span></div>
            <div className="mt-1 text-xs text-slate-500">{covered} sustituciones cubiertas en 30 días</div>
          </section>
          <section className="card p-4 text-sm">
            <h2 className="h-section mb-2">Cualificaciones</h2>
            <div className="flex flex-wrap gap-1.5">
              {parseSkills(e.skills).length ? parseSkills(e.skills).map((s) => <Badge key={s} tone="blue">{skillLabel(s)}</Badge>) : <span className="text-slate-500">Ninguna registrada</span>}
            </div>
            <h2 className="h-section mt-4 mb-2">Disponibilidad</h2>
            <ul className="flex flex-col gap-1">
              {avail.map((a) => (
                <li key={a.weekday} className="flex justify-between">
                  <span className="text-slate-600 first-letter:uppercase">{weekdayName(a.weekday)}</span>
                  <span className="tabular-nums">{a.start}–{a.end}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
