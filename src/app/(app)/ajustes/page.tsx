import { requireUser } from "@/lib/session.ts";
import { get } from "@/lib/db.ts";
import { aiEnabled, aiModel } from "@/lib/ai.ts";
import { settingsAction } from "@/app/actions";
import { Badge, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { ImportForm } from "./import-form";

export const metadata = { title: "Ajustes" };

export default async function SettingsPage() {
  const user = await requireUser();
  const org = get<{ name: string; travel_buffer_min: number; max_weekly_hours: number; timezone: string }>(
    "SELECT name, travel_buffer_min, max_weekly_hours, timezone FROM organizations WHERE id = ?", user.orgId,
  )!;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Ajustes" subtitle="Reglas que Cauce usa para proponer sustituciones." />

      <section className="card p-5">
        <h2 className="h-section mb-4">Organización y reglas</h2>
        <form action={settingsAction} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="name">Nombre de la empresa</label>
            <input id="name" name="name" defaultValue={org.name} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="travelBuffer">Margen de desplazamiento (min)</label>
            <input id="travelBuffer" name="travelBuffer" type="number" min={0} max={180} defaultValue={org.travel_buffer_min} className="input" />
            <p className="mt-1 text-xs text-slate-500">Tiempo mínimo entre dos servicios de la misma persona.</p>
          </div>
          <div>
            <label className="label" htmlFor="maxWeeklyHours">Máximo de horas semanales</label>
            <input id="maxWeeklyHours" name="maxWeeklyHours" type="number" min={10} max={60} step={0.5} defaultValue={org.max_weekly_hours} className="input" />
            <p className="mt-1 text-xs text-slate-500">Nadie será propuesto si lo supera.</p>
          </div>
          <div className="flex justify-end sm:col-span-2">
            <SubmitButton pendingText="Guardando…">Guardar</SubmitButton>
          </div>
        </form>
      </section>

      <section className="card p-5 text-sm">
        <h2 className="h-section mb-3">Integraciones</h2>
        <ul className="flex flex-col gap-3">
          <li className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">Interpretación de mensajes</div>
              <div className="text-slate-500">
                {aiEnabled()
                  ? `IA activada (${aiModel()}). Si falla, se usan reglas automáticamente.`
                  : "Reglas en español, sin coste. Para usar IA, configura ANTHROPIC_API_KEY en el servidor."}
              </div>
            </div>
            <Badge tone={aiEnabled() ? "green" : "slate"}>{aiEnabled() ? "IA" : "Reglas"}</Badge>
          </li>
          <li className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">WhatsApp</div>
              <div className="text-slate-500">Mensajes preparados que se abren en tu WhatsApp con un toque. Integración con WhatsApp Business: próximamente.</div>
            </div>
            <Badge tone="green">Enlaces</Badge>
          </li>
          <li className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">Zona horaria</div>
              <div className="text-slate-500">{org.timezone}</div>
            </div>
          </li>
        </ul>
      </section>

      <section id="importar" className="card p-5">
        <h2 className="h-section mb-1">Importar personal desde Excel (CSV)</h2>
        <p className="mb-4 text-sm text-slate-500">
          Exporta tu hoja como CSV. Columnas: <code className="text-xs">nombre; telefono; email; zona; horas; cualificaciones; disponibilidad</code>.
          Disponibilidad tipo <code className="text-xs">L-V 06:00-15:00</code>.
        </p>
        <ImportForm />
      </section>
    </div>
  );
}
