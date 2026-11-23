import Link from "next/link";
import { requireUser } from "@/lib/session.ts";
import { all } from "@/lib/db.ts";
import { orgToday } from "@/lib/queries.ts";
import { addDays, startOfWeek } from "@/lib/dates.ts";
import { parseSkills, skillLabel } from "@/lib/skills.ts";
import { Badge, Initials, PageHeader } from "@/components/ui";

export const metadata = { title: "Personal" };

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q = "" } = await searchParams;
  const today = orgToday(user.orgId);
  const ws = startOfWeek(today);
  const rows = all<{ id: number; name: string; zone: string | null; phone: string | null; weekly_hours: number; skills: string; active: number; week_hours: number; absent: number; today_shifts: number }>(
    `SELECT e.*,
        COALESCE((SELECT SUM((julianday('2000-01-01 ' || s.end) - julianday('2000-01-01 ' || s.start)) * 24) FROM shifts s
                   WHERE s.employee_id = e.id AND s.status = 'scheduled' AND s.date BETWEEN ? AND ?), 0) AS week_hours,
        EXISTS (SELECT 1 FROM absences a WHERE a.employee_id = e.id AND a.status = 'active' AND ? BETWEEN a.start_date AND a.end_date) AS absent,
        (SELECT COUNT(*) FROM shifts s WHERE s.employee_id = e.id AND s.date = ? AND s.status = 'scheduled') AS today_shifts
       FROM employees e WHERE e.org_id = ? AND e.name LIKE ? ORDER BY e.name`,
    ws, addDays(ws, 6), today, today, user.orgId, `%${q}%`,
  );

  return (
    <div>
      <PageHeader
        title="Personal"
        subtitle={`${rows.length} personas · horas planificadas esta semana frente a contrato`}
        actions={<>
          <Link href="/ajustes#importar" className="btn-secondary">Importar CSV</Link>
          <Link href="/personal/nuevo" className="btn-primary">Nueva persona</Link>
        </>}
      />
      <form className="mb-4">
        <input name="q" defaultValue={q} placeholder="Buscar por nombre…" className="input max-w-sm" />
      </form>
      <ul className="card divide-y divide-slate-100">
        {rows.map((e) => {
          const pct = Math.min(100, Math.round((e.week_hours / e.weekly_hours) * 100));
          return (
            <li key={e.id}>
              <Link href={`/personal/${e.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <Initials name={e.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{e.name}</span>
                    {!e.active ? <Badge tone="slate">De baja</Badge> : e.absent ? <Badge tone="red">Ausente hoy</Badge> : e.today_shifts ? <Badge tone="green">Trabaja hoy</Badge> : null}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {e.zone ?? "—"}{parseSkills(e.skills).length ? ` · ${parseSkills(e.skills).map(skillLabel).join(", ")}` : ""}
                  </div>
                </div>
                <div className="hidden w-40 sm:block">
                  <div className="flex justify-between text-xs text-slate-500 tabular-nums">
                    <span>{Math.round(e.week_hours * 10) / 10} h</span>
                    <span>{e.weekly_hours} h</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden bg-linea-suave">
                    <div className={`h-full ${e.week_hours > e.weekly_hours ? "bg-almagre" : "bg-picon-2"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
