import Link from "next/link";
import { requireUser } from "@/lib/session.ts";
import { all } from "@/lib/db.ts";
import { Badge, PageHeader } from "@/components/ui";

export const metadata = { title: "Clientes" };

export default async function ClientsPage() {
  const user = await requireUser();
  const rows = all<{ id: number; name: string; contact_name: string | null; locations: number; services: number; open_incidents: number; municipalities: string }>(
    `SELECT c.id, c.name, c.contact_name,
        (SELECT COUNT(*) FROM locations l WHERE l.client_id = c.id) AS locations,
        (SELECT COUNT(*) FROM service_templates t JOIN locations l ON l.id = t.location_id WHERE l.client_id = c.id) AS services,
        (SELECT COUNT(*) FROM incidents i WHERE i.client_id = c.id AND i.status != 'resuelta') AS open_incidents,
        (SELECT GROUP_CONCAT(DISTINCT l.municipality) FROM locations l WHERE l.client_id = c.id) AS municipalities
       FROM clients c WHERE c.org_id = ? ORDER BY c.name`,
    user.orgId,
  );
  return (
    <div>
      <PageHeader
        title="Clientes" subtitle={`${rows.length} clientes · ${rows.reduce((n, r) => n + r.locations, 0)} centros`}
        actions={<Link href="/clientes/nuevo" className="btn-primary">Nuevo cliente</Link>}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((c) => (
          <Link key={c.id} href={`/clientes/${c.id}`} className="card p-4 hover:border-slate-300">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{c.name}</div>
              {c.open_incidents > 0 && <Badge tone="amber">{c.open_incidents} incid.</Badge>}
            </div>
            <div className="mt-1 text-xs text-slate-500">{c.municipalities?.split(",").join(" · ")}</div>
            <div className="mt-3 text-sm text-slate-600">
              {c.locations} centro{c.locations !== 1 ? "s" : ""} · {c.services} servicio{c.services !== 1 ? "s" : ""} recurrente{c.services !== 1 ? "s" : ""}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
