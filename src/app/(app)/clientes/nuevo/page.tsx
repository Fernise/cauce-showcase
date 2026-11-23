import { requireUser } from "@/lib/session.ts";
import { clientFormValues } from "@/lib/admin.ts";
import { PageHeader } from "@/components/ui";
import { ClientForm } from "@/components/admin-forms";

export const metadata = { title: "Nuevo cliente" };

export default async function NewClientPage() {
  await requireUser();
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: "/clientes", label: "Clientes" }} title="Nuevo cliente" subtitle="Después podrás añadir sus centros y servicios recurrentes" />
      <ClientForm initial={clientFormValues(null)} />
    </div>
  );
}
