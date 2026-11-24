import { orgTimezone } from "@/lib/queries.ts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session.ts";
import { all, get } from "@/lib/db.ts";
import { INCIDENT_SELECT, type IncidentRow } from "@/lib/incidents.ts";
import { formatTimestamp, weekdayShort } from "@/lib/dates.ts";
import { parseSkills, skillLabel } from "@/lib/skills.ts";
import { Badge, INCIDENT_STATUS, PageHeader, StatusBadge } from "@/components/ui";

export const metadata = { title: "Cliente" };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const tz = orgTimezone(user.orgId);
  const { id } = await params;
  const c = get<{ id: number; name: string; contact_name: string | null; contact_phone: string | null; contact_email: string | null }>(
    "SELECT * FROM clients WHERE org_id = ? AND id = ?", user.orgId, Number(id),
  );
  if (!c) notFound();
  const locations = all<{ id: number; name: string; address: string | null; municipality: string | null; access_notes: string | null; required_skills: string }>(
    "SELECT * FROM locations WHERE client_id = ? ORDER BY name", c.id,
  );
  const templates = all<{ id: number; location_id: number; name: string; weekdays: string; start: string; end: string; employee_id: number | null; employee_name: string | null }>(
    `SELECT t.id, t.location_id, t.name, t.weekdays, t.start, t.end, e.id AS employee_id, e.name AS employee_name
       FROM service_templates t LEFT JOIN employees e ON e.id = t.default_employee_id
      WHERE t.location_id IN (SELECT id FROM locations WHERE client_id = ?) ORDER BY t.start`,
    c.id,
  );
  const incidents = all<IncidentRow>(`${INCIDENT_SELECT} WHERE i.org_id = ? AND i.client_id = ? ORDER BY i.created_at DESC LIMIT 10`, user.orgId, c.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/clientes", label: "Clientes" }}
        title={c.name}
        subtitle={[c.contact_name, c.contact_phone, c.contact_email].filter(Boolean).join(" · ")}
        actions={<>
          <Link href={`/clientes/${c.id}/editar`} className="btn-secondary">Editar</Link>
          <Link href={`/clientes/${c.id}/centros/nuevo`} className="btn-primary">Nuevo centro</Link>
        </>}
      />
      <div className="grid gap-4 md:grid-cols-2">
        {locations.map((l) => (
          <section key={l.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-medium">{l.name}</h2>
                <div className="text-xs text-slate-500">{l.address} · {l.municipality}</div>
                <Link href={`/clientes/${c.id}/centros/${l.id}/editar`} className="text-xs text-slate-700 hover:underline">Editar centro</Link>
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                {parseSkills(l.required_skills).map((s) => <Badge key={s} tone="blue">{skillLabel(s)}</Badge>)}
              </div>
            </div>
            {l.access_notes && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600"><b>Acceso:</b> {l.access_notes}</p>}
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {templates.filter((t) => t.location_id === l.id).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="truncate">{t.name}</div>
                    <div className="text-xs text-slate-500 tabular-nums">
                      {t.weekdays.split(",").map((d) => weekdayShort(Number(d))).join(" ")} · {t.start}–{t.end}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {t.employee_id ? (
                      <Link href={`/personal/${t.employee_id}`} className="text-xs text-slate-700 hover:underline">{t.employee_name}</Link>
                    ) : (
                      <Badge tone="red">Sin titular</Badge>
                    )}
                    <Link href={`/clientes/${c.id}/centros/${l.id}/servicios/${t.id}/editar`} className="text-xs text-slate-700 hover:underline">Editar</Link>
                  </div>
                </li>
              ))}
            </ul>
            <Link href={`/clientes/${c.id}/centros/${l.id}/servicios/nuevo`} className="btn-secondary mt-3">Añadir servicio</Link>
          </section>
        ))}
      </div>
      <section>
        <h2 className="h-section mb-2">Incidencias</h2>
        {incidents.length === 0 ? (
          <div className="card p-4 text-sm text-slate-500">Sin incidencias.</div>
        ) : (
          <ul className="card divide-y divide-slate-100">
            {incidents.map((i) => (
              <li key={i.id}>
                <Link href={`/incidencias/${i.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-slate-50">
                  <span className="min-w-0 truncate">{i.title} <span className="text-slate-500">· {formatTimestamp(i.created_at, tz)}</span></span>
                  <StatusBadge map={INCIDENT_STATUS} status={i.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
