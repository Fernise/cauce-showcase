import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session.ts";
import { employeeFormValues, futureShiftCount, getEmployee } from "@/lib/admin.ts";
import { orgToday } from "@/lib/queries.ts";
import { Badge, PageHeader } from "@/components/ui";
import { EmployeeForm } from "@/components/admin-forms";
import { SubmitButton } from "@/components/client";
import { setEmployeeActiveAction } from "@/app/admin-actions";

export const metadata = { title: "Editar persona" };

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const e = getEmployee(user.orgId, Number(id));
  if (!e) notFound();
  const active = e.active === 1;
  const future = active ? futureShiftCount(user.orgId, e.id, orgToday(user.orgId)) : 0;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        back={{ href: `/personal/${e.id}`, label: e.name }}
        title="Editar persona"
        subtitle={active ? undefined : <Badge tone="slate">De baja</Badge>}
      />
      <EmployeeForm id={e.id} initial={employeeFormValues(e)} />
      <section className="card p-4 sm:p-5">
        <h2 className="h-section mb-1">{active ? "Dar de baja" : "Reactivar"}</h2>
        <p className="mb-3 text-sm text-slate-600">
          {active
            ? "Una persona de baja deja de proponerse como sustituta. No se borra nada: su historial se conserva y puedes reactivarla cuando quieras."
            : "Esta persona está de baja y no se propone como sustituta. Reactívala para que vuelva a aparecer en las propuestas."}
        </p>
        {future > 0 && (
          <p className="mb-3 text-sm text-amber-800">
            Tiene {future} servicio{future !== 1 ? "s" : ""} planificado{future !== 1 ? "s" : ""} a partir de hoy; seguirán asignados hasta que los reasignes.
          </p>
        )}
        <form action={setEmployeeActiveAction}>
          <input type="hidden" name="id" value={e.id} />
          <input type="hidden" name="active" value={active ? "0" : "1"} />
          <SubmitButton className={active ? "btn-danger" : "btn-secondary"}>{active ? "Dar de baja" : "Reactivar"}</SubmitButton>
        </form>
      </section>
    </div>
  );
}
