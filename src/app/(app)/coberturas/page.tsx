import Link from "next/link";
import { requireUser } from "@/lib/session.ts";
import { all } from "@/lib/db.ts";
import { CASE_SELECT, type CaseRow } from "@/lib/coverage.ts";
import { orgToday, orgTimezone } from "@/lib/queries.ts";
import { formatDateRelative, formatTimestamp } from "@/lib/dates.ts";
import { CASE_STATUS, EmptyState, PageHeader, StatusBadge, Tabs } from "@/components/ui";

export const metadata = { title: "Coberturas" };

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const user = await requireUser();
  const tz = orgTimezone(user.orgId);
  const { estado = "pendientes" } = await searchParams;
  const today = orgToday(user.orgId);

  const filters: Record<string, string> = {
    pendientes: "c.status IN ('open','offering') AND s.date >= ?",
    resueltas: "c.status IN ('covered','unresolved','cancelled') AND (s.date >= date(?, '-30 days'))",
    todas: "s.date >= date(?, '-60 days')",
  };
  const where = filters[estado] ?? filters.pendientes;
  const order = estado === "pendientes" ? "s.date, s.start" : "COALESCE(c.resolved_at, c.created_at) DESC";
  const rows = all<CaseRow & { pending_offers: number }>(
    `SELECT * FROM (${CASE_SELECT} WHERE c.org_id = ? AND ${where} ORDER BY ${order}) x`,
    user.orgId, today,
  );
  const count = (w: string) => all<{ n: number }>(`SELECT COUNT(*) AS n FROM coverage_cases c JOIN shifts s ON s.id = c.shift_id WHERE c.org_id = ? AND ${w}`, user.orgId, today)[0].n;

  return (
    <div>
      <PageHeader
        title="Coberturas"
        subtitle="Servicios que se han quedado sin persona asignada y su sustitución."
        actions={<Link href="/avisos/nuevo" className="btn-primary">Registrar ausencia</Link>}
      />
      <Tabs
        active={estado}
        items={[
          { key: "pendientes", label: "Pendientes", href: "/coberturas", count: count(filters.pendientes) },
          { key: "resueltas", label: "Resueltas (30 días)", href: "/coberturas?estado=resueltas" },
          { key: "todas", label: "Todas", href: "/coberturas?estado=todas" },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState title="No hay coberturas pendientes">Cuando registres una ausencia, sus servicios aparecerán aquí.</EmptyState>
      ) : (
        <ul className="divide-y divide-linea-suave border-t-2 border-picon">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/coberturas/${c.id}`} className="-mx-2 grid min-h-16 grid-cols-[4.5rem_1fr] items-center gap-x-3 px-2 py-3 hover:bg-cal-hondo/60 sm:grid-cols-[5rem_1fr_auto]">
                <div className="num leading-tight">
                  <div className="text-xl font-bold">{c.start}</div>
                  <div className="eyebrow text-[0.6875rem] first-letter:uppercase">{formatDateRelative(c.date, today)}</div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[0.9375rem] font-semibold">{c.location_name}</div>
                  <div className="truncate text-sm text-picon-3">
                    {c.title} · <span className="num">{c.start}–{c.end}</span>
                    {c.original_name ? ` · ausente: ${c.original_name}` : ""}
                    {c.resolved_name ? ` · cubre: ${c.resolved_name}` : ""}
                    {c.resolved_at ? ` · ${formatTimestamp(c.resolved_at, tz)}` : ""}
                  </div>
                  <StatusBadge map={CASE_STATUS} status={c.status} className="mt-0.5 sm:hidden" />
                </div>
                <span className="hidden sm:block"><StatusBadge map={CASE_STATUS} status={c.status} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
