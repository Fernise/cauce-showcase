import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session.ts";
import { getClient, getLocation, locationFormValues } from "@/lib/admin.ts";
import { PageHeader } from "@/components/ui";
import { LocationForm } from "@/components/admin-forms";

export const metadata = { title: "Editar centro" };

export default async function EditLocationPage({ params }: { params: Promise<{ id: string; locationId: string }> }) {
  const user = await requireUser();
  const { id, locationId } = await params;
  const c = getClient(user.orgId, Number(id));
  const l = getLocation(user.orgId, Number(locationId));
  if (!c || !l || l.client_id !== c.id) notFound();
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: `/clientes/${c.id}`, label: c.name }} title="Editar centro" subtitle={l.name} />
      <LocationForm id={l.id} clientId={c.id} initial={locationFormValues(l)} />
    </div>
  );
}
