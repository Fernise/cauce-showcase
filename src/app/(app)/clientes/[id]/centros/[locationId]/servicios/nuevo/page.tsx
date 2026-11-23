import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session.ts";
import { getClient, getLocation } from "@/lib/admin.ts";
import { assignableEmployees, templateFormValues } from "@/lib/services.ts";
import { PageHeader } from "@/components/ui";
import { TemplateForm } from "@/components/admin-forms";

export const metadata = { title: "Nuevo servicio recurrente" };

export default async function NewTemplatePage({ params }: { params: Promise<{ id: string; locationId: string }> }) {
  const user = await requireUser();
  const { id, locationId } = await params;
  const c = getClient(user.orgId, Number(id));
  const l = getLocation(user.orgId, Number(locationId));
  if (!c || !l || l.client_id !== c.id) notFound();
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: `/clientes/${c.id}`, label: c.name }} title="Nuevo servicio recurrente" subtitle={l.name} />
      <TemplateForm
        locationId={l.id} clientId={c.id} initial={templateFormValues(null)}
        employees={assignableEmployees(user.orgId, null)} initialWarnings={[]}
      />
    </div>
  );
}
