"use client";

import { useActionState } from "react";
import { importEmployeesAction } from "@/app/actions";

const SAMPLE = `nombre;telefono;email;zona;horas;cualificaciones;disponibilidad
Ana Pérez Luis;600111222;ana@ejemplo.es;La Laguna;30;cristales;L-V 06:00-15:00`;

export function ImportForm() {
  const [state, action, pending] = useActionState(importEmployeesAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="file" name="file" accept=".csv,text/csv" className="text-sm" />
      <textarea name="csv" rows={4} placeholder={SAMPLE} className="input font-mono text-xs" />
      {state?.ok && <p className="text-sm font-medium text-mar">{state.ok}</p>}
      {state?.errors?.map((e) => <p key={e} className="text-sm font-medium text-azufre-texto">{e}</p>)}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={pending}>{pending ? "Importando…" : "Importar"}</button>
      </div>
    </form>
  );
}
