"use client";

// Create/edit forms for employees, clients, locations and recurring services (T-013).
// Uncontrolled inputs read their defaults from the value echoed back by the server action, so a validation
// error keeps what the user typed. Styling uses only the shared utility classes.

import { useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import Link from "next/link";
import {
  checkTemplateFitAction, saveClientAction, saveEmployeeAction, saveLocationAction, saveTemplateAction,
} from "@/app/admin-actions";
import { SubmitButton } from "@/components/client";
import { AVAILABILITY_PRESETS, presetWindows } from "@/lib/availability.ts";
import { weekdayName, weekdayShort } from "@/lib/dates.ts";
import { SKILLS } from "@/lib/skills.ts";
import { MAX_WEEKLY_HOURS, type FormState, type FormValues } from "@/lib/validation.ts";
import { ZONE_OTHER, zonesByIsland } from "@/lib/zones.ts";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

function useForm(action: Action, initial: FormValues) {
  // Controlled fields (zone select, availability grid) are reset by React to their first render after each submit,
  // so they are keyed by `n` and remount from the echoed values.
  const [state, formAction] = useActionState(async (prev: FormState, fd: FormData): Promise<FormState> => {
    const next = await action(prev, fd);
    return next && { ...next, n: (prev?.n ?? 0) + 1 };
  }, null);
  const values = state?.values ?? initial;
  const val = (k: string): string => {
    const v = values[k];
    return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  };
  const list = (k: string): string[] => {
    const v = values[k];
    return Array.isArray(v) ? v : v ? [v] : [];
  };
  return { state, formAction, val, list, formKey: state?.n ?? 0 };
}

function FormErrors({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      <p className="font-medium">Revisa el formulario:</p>
      <ul className="mt-1 list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
    </div>
  );
}

function Actions({ back, submit }: { back: string; submit: string }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Link href={back} className="btn-ghost">Cancelar</Link>
      <SubmitButton pendingText="Guardando…">{submit}</SubmitButton>
    </div>
  );
}

function SkillsField({ label, selected, hint }: { label: string; selected: string[]; hint?: string }) {
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {Object.entries(SKILLS).map(([key, name]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="skills" value={key} defaultChecked={selected.includes(key)} />
            {name}
          </label>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </fieldset>
  );
}

function ZoneField({ label, zone, other, hint }: { label: string; zone: string; other: string; hint: string }) {
  const [choice, setChoice] = useState(zone);
  return (
    <div>
      <label className="label" htmlFor="zone">{label}</label>
      <select id="zone" name="zone" className="input" defaultValue={zone} onChange={(e) => setChoice(e.target.value)}>
        <option value="">— Sin indicar —</option>
        {zonesByIsland().map((g) => (
          <optgroup key={g.island} label={g.island}>
            {g.zones.map((z) => <option key={z.name} value={z.name}>{z.name}</option>)}
          </optgroup>
        ))}
        <option value={ZONE_OTHER}>Otra (texto libre)</option>
      </select>
      {choice === ZONE_OTHER && (
        <input name="zoneOther" defaultValue={other} placeholder="Escribe la zona" maxLength={80} className="input mt-2" aria-label={`${label} (texto libre)`} />
      )}
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

// ---------- Employee ----------

type DayRow = { on: boolean; start: string; end: string };

function AvailabilityEditor({ initial }: { initial: (k: string) => string }) {
  const [rows, setRows] = useState<DayRow[]>(() =>
    [1, 2, 3, 4, 5, 6, 7].map((d) => ({
      on: initial(`av_${d}_on`) === "on", start: initial(`av_${d}_start`) || "06:00", end: initial(`av_${d}_end`) || "15:00",
    })),
  );
  const patch = (i: number, p: Partial<DayRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const apply = (key: string) => {
    const w = presetWindows(key);
    setRows((r) => r.map((x, i) => {
      const hit = w.find((y) => y.weekday === i + 1);
      return hit ? { on: true, start: hit.start, end: hit.end } : { ...x, on: false };
    }));
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {AVAILABILITY_PRESETS.map((p) => (
          <button key={p.key} type="button" className="btn-secondary" onClick={() => apply(p.key)}>{p.label}</button>
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[7rem_1fr_auto_1fr] items-center gap-2 text-sm">
            <label className="flex items-center gap-2 first-letter:uppercase">
              <input type="checkbox" name={`av_${i + 1}_on`} value="on" checked={r.on} onChange={(e) => patch(i, { on: e.target.checked })} />
              {weekdayName(i + 1)}
            </label>
            <input type="time" name={`av_${i + 1}_start`} value={r.start} disabled={!r.on} onChange={(e) => patch(i, { start: e.target.value })} className="input" aria-label={`${weekdayName(i + 1)} desde`} />
            <span className="text-slate-400">–</span>
            <input type="time" name={`av_${i + 1}_end`} value={r.end} disabled={!r.on} onChange={(e) => patch(i, { end: e.target.value })} className="input" aria-label={`${weekdayName(i + 1)} hasta`} />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">Marca los días en que puede trabajar y su franja horaria. Los días sin marcar cuentan como no disponible.</p>
    </div>
  );
}

export function EmployeeForm({ id, initial }: { id?: number; initial: FormValues }) {
  const { state, formAction, val, list, formKey } = useForm(saveEmployeeAction, initial);
  return (
    <form action={formAction} className="card flex flex-col gap-5 p-4 sm:p-5">
      <input type="hidden" name="id" value={id ?? ""} />
      <FormErrors errors={state?.errors} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">Nombre y apellidos</label>
          <input id="name" name="name" defaultValue={val("name")} required maxLength={120} className="input" autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="phone">Teléfono</label>
          <input id="phone" name="phone" type="tel" defaultValue={val("phone")} className="input" placeholder="600 123 456" />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" defaultValue={val("email")} className="input" />
        </div>
        <ZoneField key={`z${formKey}`} label="Zona" zone={val("zone")} other={val("zoneOther")} hint="Con una zona de la lista Cauce calcula distancias para proponer sustitutos cercanos. Una zona libre no tiene coordenadas y la proximidad se puntúa neutra." />
        <div>
          <label className="label" htmlFor="weeklyHours">Horas semanales de contrato</label>
          <input id="weeklyHours" name="weeklyHours" type="number" inputMode="decimal" step="0.5" min={1} max={MAX_WEEKLY_HOURS} defaultValue={val("weeklyHours")} required className="input" />
        </div>
      </div>
      <SkillsField label="Cualificaciones" selected={list("skills")} />
      <section>
        <h2 className="h-section mb-2">Disponibilidad semanal</h2>
        <AvailabilityEditor key={`a${formKey}`} initial={val} />
      </section>
      <div>
        <label className="label" htmlFor="notes">Notas</label>
        <textarea id="notes" name="notes" rows={3} defaultValue={val("notes")} maxLength={1000} className="input" />
      </div>
      <Actions back={id ? `/personal/${id}` : "/personal"} submit={id ? "Guardar cambios" : "Crear persona"} />
    </form>
  );
}

// ---------- Client ----------

export function ClientForm({ id, initial }: { id?: number; initial: FormValues }) {
  const { state, formAction, val } = useForm(saveClientAction, initial);
  return (
    <form action={formAction} className="card flex flex-col gap-5 p-4 sm:p-5">
      <input type="hidden" name="id" value={id ?? ""} />
      <FormErrors errors={state?.errors} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">Nombre del cliente</label>
          <input id="name" name="name" defaultValue={val("name")} required maxLength={120} className="input" autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="contactName">Persona de contacto</label>
          <input id="contactName" name="contactName" defaultValue={val("contactName")} maxLength={120} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="contactPhone">Teléfono de contacto</label>
          <input id="contactPhone" name="contactPhone" type="tel" defaultValue={val("contactPhone")} className="input" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="contactEmail">Email de contacto</label>
          <input id="contactEmail" name="contactEmail" type="email" defaultValue={val("contactEmail")} className="input" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="notes">Notas</label>
        <textarea id="notes" name="notes" rows={3} defaultValue={val("notes")} maxLength={1000} className="input" />
      </div>
      <Actions back={id ? `/clientes/${id}` : "/clientes"} submit={id ? "Guardar cambios" : "Crear cliente"} />
    </form>
  );
}

// ---------- Location ----------

export function LocationForm({ id, clientId, initial }: { id?: number; clientId: number; initial: FormValues }) {
  const { state, formAction, val, list, formKey } = useForm(saveLocationAction, initial);
  return (
    <form action={formAction} className="card flex flex-col gap-5 p-4 sm:p-5">
      <input type="hidden" name="id" value={id ?? ""} />
      <input type="hidden" name="clientId" value={clientId} />
      <FormErrors errors={state?.errors} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">Nombre del centro</label>
          <input id="name" name="name" defaultValue={val("name")} required maxLength={120} className="input" autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="address">Dirección</label>
          <input id="address" name="address" defaultValue={val("address")} maxLength={200} className="input" />
        </div>
        <ZoneField key={`z${formKey}`} label="Municipio" zone={val("zone")} other={val("zoneOther")} hint="Con un municipio de la lista Cauce sitúa el centro para calcular distancias." />
      </div>
      <div>
        <label className="label" htmlFor="accessNotes">Notas de acceso</label>
        <textarea id="accessNotes" name="accessNotes" rows={3} defaultValue={val("accessNotes")} maxLength={1000} className="input" placeholder="Llaves, alarma, puerta de personal…" />
      </div>
      <SkillsField label="Cualificaciones exigidas en el centro" selected={list("skills")} hint="Se exigen en todos los servicios de este centro al buscar sustitutos." />
      <Actions back={`/clientes/${clientId}`} submit={id ? "Guardar cambios" : "Crear centro"} />
    </form>
  );
}

// ---------- Recurring service ----------

export function TemplateForm({
  id, locationId, clientId, initial, employees, initialWarnings,
}: {
  id?: number; locationId: number; clientId: number; initial: FormValues;
  employees: { id: number; name: string; zone: string | null; active: number }[]; initialWarnings: string[];
}) {
  const { state, formAction, val, list } = useForm(saveTemplateAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [warnings, setWarnings] = useState(initialWarnings);
  const [, startTransition] = useTransition();

  // Re-check the default employee against the current form values (debounced, server-side, non-blocking).
  const recheck = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!formRef.current) return;
      const fd = new FormData(formRef.current);
      startTransition(async () => setWarnings(await checkTemplateFitAction(fd)));
    }, 300);
  };

  return (
    <form ref={formRef} action={formAction} onChange={recheck} className="card flex flex-col gap-5 p-4 sm:p-5">
      <input type="hidden" name="id" value={id ?? ""} />
      <input type="hidden" name="locationId" value={locationId} />
      <FormErrors errors={state?.errors} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">Nombre del servicio</label>
          <input id="name" name="name" defaultValue={val("name")} required maxLength={120} className="input" placeholder="Oficinas, Habitaciones planta 1–3…" autoComplete="off" />
        </div>
        <div className="sm:col-span-2">
          <span className="label">Días</span>
          <div className="flex flex-wrap gap-3">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <label key={d} className="flex items-center gap-1.5 text-sm" title={weekdayName(d)}>
                <input type="checkbox" name="weekdays" value={d} defaultChecked={list("weekdays").includes(String(d))} />
                {weekdayShort(d)}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="start">Inicio</label>
          <input id="start" name="start" type="time" defaultValue={val("start")} required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="end">Fin</label>
          <input id="end" name="end" type="time" defaultValue={val("end")} required className="input" />
        </div>
      </div>
      <SkillsField label="Cualificaciones extra para este servicio" selected={list("skills")} hint="Se suman a las que ya exige el centro." />
      <div>
        <label className="label" htmlFor="defaultEmployeeId">Persona titular</label>
        <select id="defaultEmployeeId" name="defaultEmployeeId" defaultValue={val("defaultEmployeeId")} className="input">
          <option value="">— Sin titular (el servicio quedará sin cubrir) —</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.name}{e.zone ? ` · ${e.zone}` : ""}{e.active ? "" : " (de baja)"}</option>
          ))}
        </select>
        {warnings.length > 0 && (
          <div role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">Ojo con esta asignación (puedes guardar igualmente):</p>
            <ul className="mt-1 list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Al guardar se crean o actualizan los servicios desde hoy hasta el final de la próxima semana. Los servicios con una cobertura abierta o ya pasados no se modifican.
      </p>
      <Actions back={`/clientes/${clientId}`} submit={id ? "Guardar cambios" : "Crear servicio"} />
    </form>
  );
}

// ---------- Small helpers ----------

/** Submit button that asks for confirmation first (used for removing a recurring service). */
export function ConfirmSubmit({ children, message, className = "btn-danger" }: { children: React.ReactNode; message: string; className?: string }) {
  return (
    <button type="submit" className={className} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
