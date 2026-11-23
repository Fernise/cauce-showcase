import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session.ts";
import { getClient, locationFormValues } from "@/lib/admin.ts";
import { PageHeader } from "@/components/ui";
import { LocationForm } from "@/components/admin-forms";

export const metadata = { title: "Nuevo centro" };

export default async function NewLocationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const c = getClient(user.orgId, Number(id));
  if (!c) notFound();
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: `/clientes/${c.id}`, label: c.name }} title="Nuevo centro" subtitle="Lugar donde se presta el servicio" />
      <LocationForm clientId={c.id} initial={locationFormValues(null)} />
    </div>
  );
}
