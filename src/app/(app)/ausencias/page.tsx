import Link from "next/link";
import { requireUser } from "@/lib/session.ts";
import { all } from "@/lib/db.ts";
import { orgToday } from "@/lib/queries.ts";
import { formatRange, formatTimestamp } from "@/lib/dates.ts";
import { REASON_LABELS, type ReasonCategory } from "@/lib/parse-message.ts";
import { Badge, EmptyState, Initials, PageHeader, Tabs } from "@/components/ui";

export const metadata = { title: "Ausencias" };

type Row = {
  id: number; employee_id: number; name: string; start_date: string; end_date: string; reason: string | null; reason_category: ReasonCategory;
  status: string; source: string; created_at: string; open_cases: number; covered_cases: number; total_cases: number;
};

export default async function AbsencesPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const user = await requireUser();
  const { ver = "actuales" } = await searchParams;
  const today = orgToday(user.orgId);
  const where = ver === "pasadas" ? "a.end_date < ?" : "a.end_date >= ?";
  const rows = all<Row>(
    `SELECT a.*, e.name,
        (SELECT COUNT(*) FROM coverage_cases c WHERE c.absence_id = a.id AND c.status IN ('open','offering')) AS open_cases,
        (SELECT COUNT(*) FROM coverage_cases c WHERE c.absence_id = a.id AND c.status = 'covered') AS covered_cases,
        (SELECT COUNT(*) FROM coverage_cases c WHERE c.absence_id = a.id) AS total_cases
       FROM absences a JOIN employees e ON e.id = a.employee_id
      WHERE a.org_id = ? AND ${where} ORDER BY a.start_date ${ver === "pasadas" ? "DESC" : "ASC"} LIMIT 100`,
    user.orgId, today,
  );

  return (
    <div>
      <PageHeader
        title="Ausencias"
        subtitle="Quién no está y qué servicios se han visto afectados."
        actions={<Link href="/avisos/nuevo?tipo=ausencia" className="btn-primary">Registrar ausencia</Link>}
      />
      <Tabs active={ver} items={[
        { key: "actuales", label: "Actuales y próximas", href: "/ausencias" },
        { key: "pasadas", label: "Pasadas", href: "/ausencias?ver=pasadas" },
      ]} />
      {rows.length === 0 ? (
        <EmptyState title="Sin ausencias registradas" />
      ) : (
        <ul className="card divide-y divide-slate-100">
          {rows.map((a) => (
            <li key={a.id}>
              <Link href={`/ausencias/${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <Initials name={a.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{a.name}</div>
                  <div className="truncate text-xs text-slate-500">
                    <span className="first-letter:uppercase">{formatRange(a.start_date, a.end_date, today)}</span> · {REASON_LABELS[a.reason_category]}
                    {a.reason ? ` · ${a.reason}` : ""} · registrada {formatTimestamp(a.created_at)}
                  </div>
                </div>
                {a.status === "cancelled" ? (
                  <Badge>Anulada</Badge>
                ) : a.open_cases > 0 ? (
                  <Badge tone="red">{a.open_cases} sin cubrir</Badge>
                ) : a.total_cases > 0 ? (
                  <Badge tone="green">{a.covered_cases}/{a.total_cases} cubiertos</Badge>
                ) : (
                  <Badge>Sin servicios</Badge>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
