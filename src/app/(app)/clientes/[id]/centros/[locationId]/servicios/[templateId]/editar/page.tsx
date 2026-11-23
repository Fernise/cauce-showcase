import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session.ts";
import { getClient, getLocation } from "@/lib/admin.ts";
import { assignableEmployees, getTemplate, templateFit, templateFormValues } from "@/lib/services.ts";
import { PageHeader } from "@/components/ui";
import { ConfirmSubmit, TemplateForm } from "@/components/admin-forms";
import { deleteTemplateAction } from "@/app/admin-actions";
import { parseSkills } from "@/lib/skills.ts";

export const metadata = { title: "Editar servicio recurrente" };

export default async function EditTemplatePage({
  params, searchParams,
}: { params: Promise<{ id: string; locationId: string; templateId: string }>; searchParams: Promise<{ ok?: string }> }) {
  const user = await requireUser();
  const { id, locationId, templateId } = await params;
  const { ok } = await searchParams;
  const c = getClient(user.orgId, Number(id));
  const l = getLocation(user.orgId, Number(locationId));
  const t = getTemplate(user.orgId, Number(templateId));
  if (!c || !l || !t || l.client_id !== c.id || t.location_id !== l.id) notFound();

  const saved = ok?.match(/^(\d+)\.(\d+)\.(\d+)$/);
  const warnings = t.default_employee_id
    ? templateFit(user.orgId, {
        employeeId: t.default_employee_id, locationId: l.id, weekdays: t.weekdays.split(",").map(Number), start: t.start, end: t.end,
        skills: parseSkills(t.required_skills), excludeTemplateId: t.id,
      })
    : [];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader back={{ href: `/clientes/${c.id}`, label: c.name }} title="Editar servicio recurrente" subtitle={l.name} />
      {saved && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          Guardado. Servicios hasta el final de la próxima semana: {saved[1]} creado(s), {saved[2]} actualizado(s), {saved[3]} anulado(s).{" "}
          <Link href={`/clientes/${c.id}`} className="font-medium underline">Volver al cliente</Link>
        </div>
      )}
      <TemplateForm
        id={t.id} locationId={l.id} clientId={c.id} initial={templateFormValues(t)}
        employees={assignableEmployees(user.orgId, t.default_employee_id)} initialWarnings={warnings}
      />
      <section className="card p-4 sm:p-5">
        <h2 className="h-section mb-1">Eliminar servicio</h2>
        <p className="mb-3 text-sm text-slate-600">
          Se anulan los servicios futuros sin cobertura abierta. Los ya pasados y los que tienen una cobertura en curso o resuelta se conservan.
        </p>
        <form action={deleteTemplateAction}>
          <input type="hidden" name="id" value={t.id} />
          <ConfirmSubmit message="¿Eliminar este servicio recurrente y anular sus servicios futuros?">Eliminar servicio</ConfirmSubmit>
        </form>
      </section>
    </div>
  );
}
