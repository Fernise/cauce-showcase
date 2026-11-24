import { orgTimezone } from "@/lib/queries.ts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { requireUser } from "@/lib/session.ts";
import { all, get } from "@/lib/db.ts";
import { getIncident, incidentTimeline } from "@/lib/incidents.ts";
import { INCIDENT_LABELS } from "@/lib/parse-message.ts";
import { formatDateShort, formatTimestamp } from "@/lib/dates.ts";
import { whatsappLink } from "@/lib/messages.ts";
import { incidentNoteAction, incidentOwnerAction, incidentStatusAction } from "@/app/actions";
import { INCIDENT_STATUS, PageHeader, SEVERITY, SectionHead, StatusBadge } from "@/components/ui";
import { CopyButton, SubmitButton } from "@/components/client";
import { ActivityList } from "@/components/activity-list";

export const metadata = { title: "Incidencia" };

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const tz = orgTimezone(user.orgId);
  const { id } = await params;
  const i = getIncident(user.orgId, Number(id));
  if (!i) notFound();
  const users = all<{ id: number; name: string }>("SELECT id, name FROM users WHERE org_id = ? ORDER BY name", user.orgId);
  const client = i.client_id
    ? get<{ contact_name: string | null; contact_phone: string | null }>("SELECT contact_name, contact_phone FROM clients WHERE id = ?", i.client_id)
    : undefined;
  const timeline = incidentTimeline(user.orgId, i.id).map((t) => ({ ...t, entity_type: null, entity_id: null }));

  const contactFirst = client?.contact_name?.split(/[ (]/)[0];
  const reply =
    i.status === "resuelta"
      ? `Hola${contactFirst ? ` ${contactFirst}` : ""}, le confirmamos que la incidencia «${i.title}» está resuelta${i.resolution ? `: ${i.resolution}` : "."} Gracias por avisarnos. Un saludo.`
      : `Hola${contactFirst ? ` ${contactFirst}` : ""}, hemos recibido su aviso sobre «${i.title}». Ya lo estamos gestionando y le confirmaremos en cuanto esté resuelto. Disculpe las molestias.`;
  const wa = whatsappLink(client?.contact_phone ?? null, reply);

  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        back={{ href: "/incidencias", label: "Incidencias" }}
        title={i.title}
        subtitle={`${INCIDENT_LABELS[i.type]} · creada ${formatTimestamp(i.created_at, tz)}`}
        actions={<div className="flex gap-5"><StatusBadge map={SEVERITY} status={i.severity} /><StatusBadge map={INCIDENT_STATUS} status={i.status} /></div>}
      />
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-10 lg:col-span-2">
          {i.description && (
            <section>
              <SectionHead title="Descripción" />
              <p className="voz mt-3 whitespace-pre-line text-picon">{i.description}</p>
              {i.raw_message && i.raw_message !== i.description && (
                <blockquote className="voz mt-3 border-l-[3px] border-linea-fuerte pl-3 text-picon-2 italic">«{i.raw_message}»</blockquote>
              )}
            </section>
          )}

          <section>
            <SectionHead title="Gestión" />
            {i.status !== "resuelta" ? (
              <form action={incidentStatusAction} className="mt-3 flex flex-col gap-3">
                <input type="hidden" name="id" value={i.id} />
                <div>
                  <label className="label" htmlFor="resolution">Cómo se ha resuelto</label>
                  <textarea id="resolution" name="resolution" rows={2} className="input" placeholder="Ej.: se repasaron los baños a las 16:00; se habló con la persona del servicio." />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {i.status === "abierta" && <SubmitButton className="btn-secondary" name="status" value="en_curso">Marcar en curso</SubmitButton>}
                  <SubmitButton name="status" value="resuelta">Marcar resuelta</SubmitButton>
                </div>
              </form>
            ) : (
              <div className="mt-3 text-sm">
                <p className="flex flex-wrap items-center gap-x-2 text-picon-2"><StatusBadge map={INCIDENT_STATUS} status="resuelta" /> {i.resolved_at ? formatTimestamp(i.resolved_at, tz) : ""}{i.resolution ? ` · ${i.resolution}` : ""}</p>
                <form action={incidentStatusAction} className="mt-2">
                  <input type="hidden" name="id" value={i.id} />
                  <SubmitButton className="btn-ghost" name="status" value="abierta">Reabrir</SubmitButton>
                </form>
              </div>
            )}
          </section>

          <section>
            <SectionHead title="Respuesta al cliente" />
            <p className="voz mt-3 border border-linea bg-cal-claro px-4 py-3 text-picon">{reply}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn-whatsapp"><MessageCircle className="size-4" /> WhatsApp</a>}
              <CopyButton text={reply} />
            </div>
          </section>

          <section>
            <SectionHead title="Historial" className="mb-1" />
            <ActivityList tz={tz} items={timeline} linkEntities={false} />
            <form action={incidentNoteAction} className="mt-3 flex gap-2">
              <input type="hidden" name="id" value={i.id} />
              <input name="note" className="input" placeholder="Añadir nota interna…" required />
              <SubmitButton className="btn-secondary">Añadir</SubmitButton>
            </form>
          </section>
        </div>

        <aside className="flex flex-col gap-8">
          <section className="text-sm">
            <SectionHead title="Contexto" />
            <dl className="divide-y divide-linea-suave">
              <Row label="Cliente">{i.client_id ? <Link className="link" href={`/clientes/${i.client_id}`}>{i.client_name}</Link> : "—"}</Row>
              <Row label="Centro">{i.location_name ?? "—"}</Row>
              <Row label="Contacto">{client?.contact_name ?? "—"}{client?.contact_phone ? ` · ${client.contact_phone}` : ""}</Row>
              <Row label="Último servicio">{i.shift_date ? `${formatDateShort(i.shift_date)} ${i.shift_start}–${i.shift_end}` : "—"}</Row>
              <Row label="Lo realizó">{i.employee_id ? <Link className="link" href={`/personal/${i.employee_id}`}>{i.employee_name}</Link> : "—"}</Row>
            </dl>
          </section>
          <section className="text-sm">
            <SectionHead title="Responsable" />
            <form action={incidentOwnerAction} className="mt-3 flex gap-2">
              <input type="hidden" name="id" value={i.id} />
              <select name="ownerId" defaultValue={i.owner_user_id ?? ""} className="input">
                <option value="" disabled>Sin asignar</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <SubmitButton className="btn-secondary">Asignar</SubmitButton>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-2">
      <dt className="text-picon-3">{label}</dt>
      <dd className="min-w-0 text-picon">{children}</dd>
    </div>
  );
}
