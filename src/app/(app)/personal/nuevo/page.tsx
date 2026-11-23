import { requireUser } from "@/lib/session.ts";
import { employeeFormValues } from "@/lib/admin.ts";
import { PageHeader } from "@/components/ui";
import { EmployeeForm } from "@/components/admin-forms";

export const metadata = { title: "Nueva persona" };

export default async function NewEmployeePage() {
  await requireUser();
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: "/personal", label: "Personal" }} title="Nueva persona" subtitle="Alta de personal de limpieza" />
      <EmployeeForm initial={employeeFormValues(null)} />
    </div>
  );
}
