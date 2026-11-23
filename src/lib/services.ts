// Recurring services (service_templates) and the shifts generated from them (T-013).
//
// Rules for (re)generating shifts, window = today … end of NEXT ISO week:
//  - missing shifts for the template's weekdays are created (status scheduled, or uncovered without default employee);
//  - existing shifts of the template that are 'scheduled'/'uncovered', in the window, and have NO coverage case
//    get the template's current times, skills and employee;
//  - same kind of shifts on weekdays the template no longer runs are cancelled;
//  - shifts with any coverage case, cancelled shifts and shifts in the past are never touched.
// Removing a template cancels its future case-less shifts and detaches the rest (FK), then deletes it.

import { all, get, run, tx } from "./db.ts";
import { logActivity } from "./activity.ts";
import { addDays, dateRange, hoursBetween, isoWeekday, startOfWeek, weekdayName, weekdayShort } from "./dates.ts";
import { parseSkills, skillLabel } from "./skills.ts";
import { getEmployee, getLocation, parseSkillKeys, type EmployeeRow } from "./admin.ts";
import { checkLength, failIf, isTime, NotFoundError, text, ValidationError, type FormValues, type Raw } from "./validation.ts";

export type Clock = { today: string; /** "HH:MM" now; shifts of today that already ended count as past. Omit to treat all of today as future. */ time?: string };

export function windowEnd(today: string): string {
  return addDays(startOfWeek(today), 13);
}

// ---------- parsing ----------

export type TemplateInput = { name: string; weekdays: number[]; start: string; end: string; skills: string[]; defaultEmployeeId: number | null };

export function parseWeekdays(raw: Raw): number[] {
  return [...new Set(raw.getAll("weekdays").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort((a, b) => a - b);
}

export function parseTemplateForm(raw: Raw): TemplateInput {
  const errors: string[] = [];
  const name = text(raw, "name");
  if (!name) errors.push("El nombre del servicio es obligatorio.");
  checkLength(errors, "Nombre del servicio", name, 120);
  const weekdays = parseWeekdays(raw);
  if (!weekdays.length) errors.push("Elige al menos un día de la semana.");
  const start = text(raw, "start"), end = text(raw, "end");
  if (!isTime(start) || !isTime(end)) errors.push("Indica hora de inicio y de fin (HH:MM).");
  else if (end <= start) errors.push("La hora de fin debe ser posterior a la de inicio (no se admiten servicios que cruzan la medianoche).");
  const skills = parseSkillKeys(raw, errors);
  const emp = text(raw, "defaultEmployeeId");
  if (emp && !/^\d+$/.test(emp)) errors.push("La persona titular no es válida.");
  failIf(errors);
  return { name, weekdays, start, end, skills, defaultEmployeeId: emp ? Number(emp) : null };
}

// ---------- reads ----------

export type TemplateRow = {
  id: number; org_id: number; location_id: number; name: string; weekdays: string; start: string; end: string;
  required_skills: string; default_employee_id: number | null; client_id: number; location_name: string;
};

export function getTemplate(orgId: number, id: number): TemplateRow | undefined {
  return get<TemplateRow>(
    `SELECT t.*, l.client_id, l.name AS location_name FROM service_templates t JOIN locations l ON l.id = t.location_id
      WHERE t.org_id = ? AND t.id = ?`,
    orgId, id,
  );
}

export function templateFormValues(t: TemplateRow | null): FormValues {
  return {
    name: t?.name ?? "",
    weekdays: t ? t.weekdays.split(",").filter(Boolean) : ["1", "2", "3", "4", "5"],
    start: t?.start ?? "08:00", end: t?.end ?? "12:00",
    skills: parseSkills(t?.required_skills),
    defaultEmployeeId: t?.default_employee_id ? String(t.default_employee_id) : "",
  };
}

/** Employees that can be picked as default: active ones (plus the current one even if inactive). */
export function assignableEmployees(orgId: number, currentId: number | null): { id: number; name: string; zone: string | null; active: number }[] {
  return all(
    "SELECT id, name, zone, active FROM employees WHERE org_id = ? AND (active = 1 OR id = ?) ORDER BY name",
    orgId, currentId ?? 0,
  );
}

function checkEmployee(orgId: number, employeeId: number | null, currentId: number | null): void {
  if (employeeId === null) return;
  const e = getEmployee(orgId, employeeId);
  if (!e) throw new ValidationError(["La persona titular seleccionada no existe."]);
  if (!e.active && employeeId !== currentId) throw new ValidationError([`${e.name} está de baja; elige otra persona titular o reactívala primero.`]);
}

// ---------- generation ----------

export type Generation = { created: number; updated: number; cancelled: number };

type ExistingShift = {
  id: number; date: string; start: string; end: string; title: string; required_skills: string;
  employee_id: number | null; status: string; has_case: number;
};

function isPast(date: string, end: string, clock: Clock): boolean {
  return date < clock.today || (date === clock.today && clock.time !== undefined && end <= clock.time);
}

/** Must run inside a transaction (the public wrappers add one). */
function generate(orgId: number, t: { id: number; location_id: number; name: string; weekdays: string; start: string; end: string; required_skills: string; default_employee_id: number | null }, clock: Clock): Generation {
  const days = new Set(t.weekdays.split(",").map(Number));
  const to = windowEnd(clock.today);
  const status = t.default_employee_id ? "scheduled" : "uncovered";
  const out: Generation = { created: 0, updated: 0, cancelled: 0 };

  const existing = all<ExistingShift>(
    `SELECT s.id, s.date, s.start, s.end, s.title, s.required_skills, s.employee_id, s.status,
            EXISTS (SELECT 1 FROM coverage_cases c WHERE c.shift_id = s.id) AS has_case
       FROM shifts s WHERE s.org_id = ? AND s.template_id = ? AND s.date BETWEEN ? AND ?`,
    orgId, t.id, clock.today, to,
  );
  const seen = new Set(existing.map((s) => s.date));

  for (const s of existing) {
    if (s.has_case || !["scheduled", "uncovered"].includes(s.status) || isPast(s.date, s.end, clock)) continue;
    if (!days.has(isoWeekday(s.date))) {
      run("UPDATE shifts SET status = 'cancelled' WHERE org_id = ? AND id = ?", orgId, s.id);
      out.cancelled++;
      continue;
    }
    if (s.title !== t.name || s.start !== t.start || s.end !== t.end || s.required_skills !== t.required_skills || s.employee_id !== t.default_employee_id || s.status !== status) {
      run(
        "UPDATE shifts SET title = ?, start = ?, end = ?, required_skills = ?, employee_id = ?, status = ? WHERE org_id = ? AND id = ?",
        t.name, t.start, t.end, t.required_skills, t.default_employee_id, status, orgId, s.id,
      );
      out.updated++;
    }
  }

  for (const date of dateRange(clock.today, to)) {
    if (!days.has(isoWeekday(date)) || seen.has(date) || isPast(date, t.end, clock)) continue;
    run(
      "INSERT INTO shifts (org_id, template_id, location_id, title, date, start, end, required_skills, employee_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      orgId, t.id, t.location_id, t.name, date, t.start, t.end, t.required_skills, t.default_employee_id, status,
    );
    out.created++;
  }
  return out;
}

export function regenerateShifts(orgId: number, templateId: number, clock: Clock): Generation {
  const t = getTemplate(orgId, templateId);
  if (!t) throw new NotFoundError("El servicio");
  return tx(() => generate(orgId, t, clock));
}

// ---------- writes ----------

export function weekdaysLabel(days: number[]): string {
  return days.map(weekdayShort).join(" ");
}

function describeGeneration(g: Generation): string {
  return `${g.created} creado(s), ${g.updated} actualizado(s), ${g.cancelled} anulado(s)`;
}

export function createTemplate(orgId: number, locationId: number, input: TemplateInput, actor: string, clock: Clock): { id: number; clientId: number; generation: Generation } {
  const loc = getLocation(orgId, locationId);
  if (!loc) throw new NotFoundError("El centro");
  checkEmployee(orgId, input.defaultEmployeeId, null);
  return tx(() => {
    const id = run(
      "INSERT INTO service_templates (org_id, location_id, name, weekdays, start, end, required_skills, default_employee_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      orgId, locationId, input.name, input.weekdays.join(","), input.start, input.end, input.skills.join(","), input.defaultEmployeeId,
    );
    const generation = generate(orgId, getTemplate(orgId, id)!, clock);
    logActivity(
      orgId, "template.created",
      `Servicio recurrente creado: ${input.name} en ${loc.name} (${weekdaysLabel(input.weekdays)} ${input.start}–${input.end}) · servicios: ${describeGeneration(generation)}`,
      { type: "client", id: loc.client_id }, actor,
    );
    return { id, clientId: loc.client_id, generation };
  });
}

export function updateTemplate(orgId: number, id: number, input: TemplateInput, actor: string, clock: Clock): { clientId: number; locationId: number; generation: Generation } {
  const current = getTemplate(orgId, id);
  if (!current) throw new NotFoundError("El servicio");
  checkEmployee(orgId, input.defaultEmployeeId, current.default_employee_id);
  return tx(() => {
    run(
      "UPDATE service_templates SET name = ?, weekdays = ?, start = ?, end = ?, required_skills = ?, default_employee_id = ? WHERE org_id = ? AND id = ?",
      input.name, input.weekdays.join(","), input.start, input.end, input.skills.join(","), input.defaultEmployeeId, orgId, id,
    );
    const generation = generate(orgId, getTemplate(orgId, id)!, clock);
    logActivity(
      orgId, "template.updated",
      `Servicio recurrente actualizado: ${input.name} en ${current.location_name} (${weekdaysLabel(input.weekdays)} ${input.start}–${input.end}) · servicios: ${describeGeneration(generation)}`,
      { type: "client", id: current.client_id }, actor,
    );
    return { clientId: current.client_id, locationId: current.location_id, generation };
  });
}

export function removeTemplate(orgId: number, id: number, actor: string, clock: Clock): { clientId: number; cancelled: number } {
  const t = getTemplate(orgId, id);
  if (!t) throw new NotFoundError("El servicio");
  return tx(() => {
    const future = all<{ id: number; date: string; end: string }>(
      `SELECT s.id, s.date, s.end FROM shifts s
        WHERE s.org_id = ? AND s.template_id = ? AND s.date >= ? AND s.status IN ('scheduled', 'uncovered')
          AND NOT EXISTS (SELECT 1 FROM coverage_cases c WHERE c.shift_id = s.id)`,
      orgId, id, clock.today,
    ).filter((s) => !isPast(s.date, s.end, clock));
    for (const s of future) run("UPDATE shifts SET status = 'cancelled' WHERE org_id = ? AND id = ?", orgId, s.id);
    // Shifts keep their history; they just stop pointing at the deleted template.
    run("UPDATE shifts SET template_id = NULL WHERE org_id = ? AND template_id = ?", orgId, id);
    run("DELETE FROM service_templates WHERE org_id = ? AND id = ?", orgId, id);
    logActivity(
      orgId, "template.removed",
      `Servicio recurrente eliminado: ${t.name} en ${t.location_name} · ${future.length} servicio(s) futuro(s) anulado(s)`,
      { type: "client", id: t.client_id }, actor,
    );
    return { clientId: t.client_id, cancelled: future.length };
  });
}

// ---------- warnings for the default employee ----------

export type FitInput = { employeeId: number; weekdays: number[]; start: string; end: string; skills: string[]; locationId: number; excludeTemplateId?: number | null };

/** Non-blocking warnings (Spanish) about assigning this employee as default for the service. Empty = fits. */
export function templateFit(orgId: number, input: FitInput): string[] {
  const e: EmployeeRow | undefined = getEmployee(orgId, input.employeeId);
  const loc = getLocation(orgId, input.locationId);
  if (!e || !loc || !isTime(input.start) || !isTime(input.end) || input.end <= input.start || !input.weekdays.length) return [];
  const warnings: string[] = [];

  const windows = all<{ weekday: number; start: string; end: string }>("SELECT weekday, start, end FROM availability WHERE employee_id = ?", e.id);
  const unavailable = input.weekdays.filter((d) => !windows.some((w) => w.weekday === d && w.start <= input.start && w.end >= input.end));
  if (!windows.length) warnings.push(`${e.name} no tiene disponibilidad registrada.`);
  else if (unavailable.length) {
    warnings.push(`${e.name} no está disponible de ${input.start} a ${input.end} el ${unavailable.map(weekdayName).join(", ")}.`);
  }

  const have = new Set(parseSkills(e.skills));
  const missing = [...new Set([...input.skills, ...parseSkills(loc.required_skills)])].filter((s) => !have.has(s));
  if (missing.length) warnings.push(`A ${e.name} le falta: ${missing.map(skillLabel).join(", ")}.`);

  const others = all<{ name: string; weekdays: string; start: string; end: string; location_name: string }>(
    `SELECT t.name, t.weekdays, t.start, t.end, l.name AS location_name FROM service_templates t JOIN locations l ON l.id = t.location_id
      WHERE t.org_id = ? AND t.default_employee_id = ? AND t.id != ?`,
    orgId, e.id, input.excludeTemplateId ?? 0,
  );
  let weekly = hoursBetween(input.start, input.end) * input.weekdays.length;
  for (const o of others) {
    const days = o.weekdays.split(",").map(Number);
    weekly += hoursBetween(o.start, o.end) * days.length;
    const shared = days.filter((d) => input.weekdays.includes(d));
    if (shared.length && o.start < input.end && input.start < o.end) {
      warnings.push(`Se solapa con «${o.name}» (${o.location_name}, ${o.start}–${o.end}) el ${shared.map(weekdayName).join(", ")}.`);
    }
  }
  if (weekly > e.weekly_hours) {
    warnings.push(`Con este servicio tendría ${Math.round(weekly * 10) / 10} h fijas a la semana, por encima de su contrato (${e.weekly_hours} h).`);
  }
  return warnings;
}
