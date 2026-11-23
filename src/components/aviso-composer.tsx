"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  analyzeMessageAction, affectedPreviewAction, confirmAbsenceAction, confirmIncidentAction, type AnalyzeState,
} from "@/app/actions";
import { SubmitButton } from "./client";
import type { Directory, ParsedMessage } from "@/lib/parse-message.ts";
import { INCIDENT_LABELS, REASON_LABELS } from "@/lib/parse-message.ts";
import { formatDateRelative } from "@/lib/dates.ts";

const EXAMPLES = [
  { label: "Ausencia (WhatsApp)", text: "Hola Carmen, soy Yurena Díaz. Mañana no voy a poder ir a trabajar, el peque tiene fiebre. Lo siento mucho 🙏" },
  { label: "Ausencia ambigua", text: "Buenas, soy María, el jueves no puedo ir que tengo médico" },
  { label: "Queja de cliente", text: "Buenos días, les escribo del Hotel Mencey Plaza. Esta mañana no ha venido nadie a limpiar las zonas comunes y el lobby está fatal. Es urgente." },
  { label: "Falta material", text: "Hola, desde Notaría Herrera: nos falta papel higiénico y jabón en los baños." },
];

type Shift = AnalyzeState["affected"][number];

export function AvisoComposer({ dir, today, compact = false, defaultKind }: {
  dir: Directory; today: string; compact?: boolean; defaultKind?: "absence" | "incident";
}) {
  const [state, analyze, analyzing] = useActionState(analyzeMessageAction, { text: "", parsed: null, affected: [] });
  const [text, setText] = useState("");
  const [manual, setManual] = useState<"absence" | "incident" | null>(defaultKind ?? null);

  const parsed: ParsedMessage | null =
    state.parsed ??
    (manual
      ? {
          kind: manual, engine: "reglas", employeeId: null, employeeCandidates: [], startDate: today, endDate: today, dateExplicit: true,
          reason: null, reasonCategory: "otro", clientId: null, locationId: null, incidentType: manual === "incident" ? "otro" : null,
          severity: "media", title: null, warnings: [],
        }
      : null);

  return (
    <div className="flex flex-col gap-4">
      <form action={analyze} className="card p-4">
        <label htmlFor="aviso-text" className="mb-2 block text-[0.9375rem] font-semibold text-picon">
          Pega el mensaje que has recibido
          <span className="mt-0.5 block text-sm font-normal text-picon-3">Una ausencia de alguien del equipo o la queja de un cliente.</span>
        </label>
        <textarea
          id="aviso-text"
          name="text"
          rows={compact ? 3 : 4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="«Buenas, soy Nayra, mañana no puedo ir que tengo al niño malo…»"
          className="input resize-y font-serif text-[1.0625rem]! leading-snug"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn-primary" disabled={analyzing}>
            {analyzing ? "Interpretando…" : "Interpretar"}
          </button>
          {!compact && (
            <>
              <button type="button" className="btn-ghost" onClick={() => setManual("absence")}>Ausencia manual</button>
              <button type="button" className="btn-ghost" onClick={() => setManual("incident")}>Incidencia manual</button>
            </>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 border-t border-dashed border-linea pt-2 text-sm text-picon-3">
          <span className="eyebrow">Ejemplos</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => setText(ex.text)}
              className="inline-flex min-h-11 cursor-pointer items-center text-picon-2 underline decoration-linea-fuerte underline-offset-[3px] hover:text-picon hover:decoration-picon sm:min-h-8"
            >
              {ex.label}
            </button>
          ))}
        </div>
        {state.error && <p className="mt-2 text-sm font-medium text-almagre">{state.error}</p>}
      </form>

      {parsed && (
        <Draft
          key={JSON.stringify(state.parsed ?? manual) + state.text}
          parsed={parsed}
          raw={state.parsed ? state.text : ""}
          dir={dir}
          today={today}
          initialAffected={state.affected}
        />
      )}
    </div>
  );
}

function Draft({ parsed, raw, dir, today, initialAffected }: {
  parsed: ParsedMessage; raw: string; dir: Directory; today: string; initialAffected: Shift[];
}) {
  const [kind, setKind] = useState<"absence" | "incident">(parsed.kind === "incident" ? "incident" : "absence");
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-linea px-4 py-3">
        <div className="flex border border-linea-fuerte text-sm" role="group" aria-label="Tipo de aviso">
          {(["absence", "incident"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`flex min-h-10 cursor-pointer items-center px-4 font-semibold ${kind === k ? "bg-picon text-cal-claro" : "text-picon-2 hover:bg-cal-hondo"}`}
            >
              {k === "absence" ? "Ausencia" : "Incidencia"}
            </button>
          ))}
        </div>
        {raw && (
          <span className="text-[0.8125rem] text-picon-3">
            {parsed.engine === "claude" ? "Interpretado con IA · revisa antes de confirmar" : "Interpretado automáticamente · revisa antes de confirmar"}
          </span>
        )}
      </div>

      {parsed.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 border-b border-linea border-l-4 border-l-azufre bg-azufre-tinte px-4 py-2.5 text-sm text-azufre-texto">
          {parsed.warnings.map((w) => (
            <li key={w} className="font-medium">
              {w}
            </li>
          ))}
        </ul>
      )}

      {kind === "absence" ? (
        <AbsenceForm parsed={parsed} raw={raw} dir={dir} today={today} initialAffected={initialAffected} />
      ) : (
        <IncidentForm parsed={parsed} raw={raw} dir={dir} />
      )}
    </div>
  );
}

function AbsenceForm({ parsed, raw, dir, today, initialAffected }: {
  parsed: ParsedMessage; raw: string; dir: Directory; today: string; initialAffected: Shift[];
}) {
  const [employeeId, setEmployeeId] = useState(parsed.employeeId ?? 0);
  const [start, setStart] = useState(parsed.startDate);
  const [end, setEnd] = useState(parsed.endDate);
  const [affected, setAffected] = useState<Shift[]>(initialAffected);
  const [loading, startTransition] = useTransition();

  useEffect(() => {
    if (!employeeId) return;
    startTransition(async () => setAffected(await affectedPreviewAction(employeeId, start, end)));
  }, [employeeId, start, end]);

  const candidates = parsed.employeeCandidates;
  const sorted = [...dir.employees].sort((a, b) => Number(candidates.includes(b.id)) - Number(candidates.includes(a.id)));

  return (
    <form action={confirmAbsenceAction} className="grid gap-4 p-4 sm:grid-cols-2">
      <input type="hidden" name="raw" value={raw} />
      <div className="sm:col-span-2">
        <label className="label" htmlFor="employeeId">Persona</label>
        {candidates.length > 1 && !employeeId && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {candidates.map((id) => (
              <button key={id} type="button" onClick={() => setEmployeeId(id)} className="min-h-11 cursor-pointer rounded-xs border border-azufre bg-azufre-tinte px-3 text-sm font-semibold text-azufre-texto hover:bg-amber-200 sm:min-h-9">
                {dir.employees.find((e) => e.id === id)?.name}
              </button>
            ))}
          </div>
        )}
        <select id="employeeId" name="employeeId" required value={employeeId || ""} onChange={(e) => setEmployeeId(Number(e.target.value))} className="input">
          <option value="">Selecciona…</option>
          {sorted.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="start">Desde</label>
        <input id="start" type="date" name="start" required value={start} min={today} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="end">Hasta (incluido)</label>
        <input id="end" type="date" name="end" required value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="reasonCategory">Motivo</label>
        <select id="reasonCategory" name="reasonCategory" defaultValue={parsed.reasonCategory} className="input">
          {Object.entries(REASON_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <p className="self-end text-xs text-picon-3">Por protección de datos solo se guarda la categoría del motivo, no el mensaje ni detalles de salud.</p>

      <div className="sm:col-span-2">
        <div className="label">Servicios afectados</div>
        {!employeeId ? (
          <p className="text-sm text-picon-3">Selecciona a la persona para ver sus servicios.</p>
        ) : loading ? (
          <p className="text-sm text-picon-3">Buscando servicios…</p>
        ) : affected.length === 0 ? (
          <p className="text-sm text-picon-3">No tiene servicios planificados en esas fechas.</p>
        ) : (
          <ul className="divide-y divide-linea-suave border-y border-linea">
            {affected.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
                <span className="font-semibold text-picon">{s.location_name}</span>
                <span className="num text-picon-2"><span className="first-letter:uppercase">{formatDateRelative(s.date, today)}</span> · {s.start}–{s.end}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[0.8125rem] text-picon-3">
          Al confirmar, los servicios quedan sin asignar y Cauce prepara la búsqueda de sustituta/o para cada uno.
        </p>
        <SubmitButton pendingText="Registrando…">
          Confirmar ausencia{affected.length ? ` y buscar cobertura (${affected.length})` : ""}
        </SubmitButton>
      </div>
    </form>
  );
}

function IncidentForm({ parsed, raw, dir }: { parsed: ParsedMessage; raw: string; dir: Directory }) {
  const [clientId, setClientId] = useState(parsed.clientId ?? 0);
  const locations = dir.locations.filter((l) => !clientId || l.clientId === clientId);
  return (
    <form action={confirmIncidentAction} className="grid gap-4 p-4 sm:grid-cols-2">
      <input type="hidden" name="raw" value={raw} />
      <div>
        <label className="label" htmlFor="clientId">Cliente</label>
        <select id="clientId" name="clientId" value={clientId || ""} onChange={(e) => setClientId(Number(e.target.value))} className="input">
          <option value="">Selecciona…</option>
          {dir.clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="locationId">Centro</label>
        <select key={clientId} id="locationId" name="locationId" defaultValue={parsed.locationId ?? ""} className="input">
          <option value="">{locations.length > 1 ? "Selecciona…" : "—"}</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="type">Tipo</label>
        <select id="type" name="type" defaultValue={parsed.incidentType ?? "otro"} className="input">
          {Object.entries(INCIDENT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="severity">Prioridad</label>
        <select id="severity" name="severity" defaultValue={parsed.severity} className="input">
          <option value="alta">Alta</option>
          <option value="media">Media</option>
          <option value="baja">Baja</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="title">Resumen</label>
        <input id="title" name="title" required defaultValue={parsed.title ?? ""} className="input" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="description">Descripción</label>
        <textarea id="description" name="description" rows={3} defaultValue={raw} className="input" />
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[0.8125rem] text-picon-3">Cauce enlaza el último servicio realizado en el centro y la persona responsable.</p>
        <SubmitButton pendingText="Creando…">Crear incidencia</SubmitButton>
      </div>
    </form>
  );
}
