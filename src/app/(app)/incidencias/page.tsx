import Link from "next/link";
import { requireUser } from "@/lib/session.ts";
import { all } from "@/lib/db.ts";
import { INCIDENT_SELECT, type IncidentRow } from "@/lib/incidents.ts";
import { INCIDENT_LABELS } from "@/lib/parse-message.ts";
import { formatTimestamp } from "@/lib/dates.ts";
import { EmptyState, INCIDENT_STATUS, PageHeader, SEVERITY, StatusBadge, StatusMark, Tabs } from "@/components/ui";

export const metadata = { title: "Incidencias" };

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const user = await requireUser();
  const { estado = "abiertas" } = await searchParams;
  const where = estado === "resueltas" ? "i.status = 'resuelta'" : estado === "todas" ? "1 = 1" : "i.status != 'resuelta'";
  const rows = all<IncidentRow>(
    `${INCIDENT_SELECT} WHERE i.org_id = ? AND ${where}
      ORDER BY CASE i.status WHEN 'abierta' THEN 0 WHEN 'en_curso' THEN 1 ELSE 2 END,
               CASE i.severity WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, i.created_at DESC LIMIT 200`,
    user.orgId,
  );
  const openCount = all<{ n: number }>("SELECT COUNT(*) AS n FROM incidents WHERE org_id = ? AND status != 'resuelta'", user.orgId)[0].n;

  return (
    <div>
      <PageHeader
        title="Incidencias"
        subtitle="Quejas y avisos de clientes, desde que llegan hasta que se resuelven."
        actions={<Link href="/avisos/nuevo?tipo=incidencia" className="btn-primary">Nueva incidencia</Link>}
      />
      <Tabs active={estado} items={[
        { key: "abiertas", label: "Abiertas", href: "/incidencias", count: openCount },
        { key: "resueltas", label: "Resueltas", href: "/incidencias?estado=resueltas" },
        { key: "todas", label: "Todas", href: "/incidencias?estado=todas" },
      ]} />
      {rows.length === 0 ? (
        <EmptyState title="Sin incidencias" />
      ) : (
        <ul className="divide-y divide-linea-suave border-t-2 border-picon">
          {rows.map((i) => (
            <li key={i.id}>
              <Link href={`/incidencias/${i.id}`} className="-mx-2 grid min-h-16 grid-cols-[1.25rem_1fr] items-center gap-x-3 px-2 py-3 hover:bg-cal-hondo/60 sm:grid-cols-[1.25rem_1fr_auto]">
                <StatusMark map={i.status === "resuelta" ? INCIDENT_STATUS : SEVERITY} status={i.status === "resuelta" ? i.status : i.severity} className="justify-center" />
                <div className="min-w-0">
                  <div className="truncate text-[0.9375rem] font-semibold">{i.title}</div>
                  <div className="truncate text-sm text-picon-3">
                    {INCIDENT_LABELS[i.type]} · {i.location_name ?? i.client_name ?? "Sin centro"} · <span className="num">{formatTimestamp(i.created_at)}</span>
                    {i.owner_name ? ` · ${i.owner_name}` : " · sin responsable"}
                  </div>
                  <div className="mt-0.5 flex gap-4 sm:hidden">
                    {i.status !== "resuelta" && <StatusBadge map={SEVERITY} status={i.severity} />}
                    <StatusBadge map={INCIDENT_STATUS} status={i.status} />
                  </div>
                </div>
                <div className="hidden items-center gap-5 sm:flex">
                  {i.status !== "resuelta" && <StatusBadge map={SEVERITY} status={i.severity} className="w-16" />}
                  <StatusBadge map={INCIDENT_STATUS} status={i.status} className="w-24" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
