import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session.ts";
import { clientFormValues, getClient } from "@/lib/admin.ts";
import { PageHeader } from "@/components/ui";
import { ClientForm } from "@/components/admin-forms";

export const metadata = { title: "Editar cliente" };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const c = getClient(user.orgId, Number(id));
  if (!c) notFound();
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: `/clientes/${c.id}`, label: c.name }} title="Editar cliente" />
      <ClientForm id={c.id} initial={clientFormValues(c)} />
    </div>
  );
}
