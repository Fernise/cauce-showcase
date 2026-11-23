// Create/edit logic for employees, clients and locations (T-013). Every function takes the caller's
// orgId and refuses ids that don't belong to it. Parsers turn raw form data into typed input and throw
// ValidationError with Spanish messages; writers append an activity event for each change.

import { all, get, run, tx } from "./db.ts";
import { logActivity } from "./activity.ts";
import { weekdayName } from "./dates.ts";
import { parseSkills, SKILLS } from "./skills.ts";
import { findZone, ZONE_OTHER } from "./zones.ts";
import { presetWindows, type AvailabilityWindow } from "./availability.ts";
import {
  checkLength, failIf, isTime, MAX_WEEKLY_HOURS, NotFoundError, text, textOrNull, validEmail, validPhone, type FormValues, type Raw,
} from "./validation.ts";


// ---------- shared parsing ----------

export type ZoneInput = { name: string | null; lat: number | null; lng: number | null };

/** `zone` select (a known zone name, "__other" or empty) + `zoneOther` free text. Known names get coordinates. */
export function parseZone(raw: Raw, errors: string[], label: string): ZoneInput {
  const choice = text(raw, "zone");
  const name = choice === ZONE_OTHER ? textOrNull(raw, "zoneOther") : choice || null;
  checkLength(errors, label, name, 80);
  if (!name) return { name: null, lat: null, lng: null };
  const known = findZone(name);
  return known ? { name: known.name, lat: known.lat, lng: known.lng } : { name, lat: null, lng: null };
}

/** Keep the stored coordinates when the zone didn't change (they may be more precise than the zone centre). */
function resolveCoords(stored: { zone: string | null; lat: number | null; lng: number | null }, next: ZoneInput): ZoneInput {
  if (next.name === stored.zone && stored.lat !== null && stored.lng !== null) return { name: next.name, lat: stored.lat, lng: stored.lng };
  return next;
}

export function parseSkillKeys(raw: Raw, errors: string[], field = "skills"): string[] {
  const keys = [...new Set(raw.getAll(field).map((v) => String(v).trim()).filter(Boolean))];
  const unknown = keys.filter((k) => !(k in SKILLS));
  if (unknown.length) errors.push(`Cualificación desconocida: ${unknown.join(", ")}.`);
  return keys.filter((k) => k in SKILLS).sort((a, b) => Object.keys(SKILLS).indexOf(a) - Object.keys(SKILLS).indexOf(b));
}

function requireName(errors: string[], name: string, label = "El nombre"): void {
  if (!name) errors.push(`${label} es obligatorio.`);
  else if (name.length > 120) errors.push(`${label} no puede superar 120 caracteres.`);
}

function zoneFormValues(zone: string | null): { zone: string; zoneOther: string } {
  if (!zone) return { zone: "", zoneOther: "" };
  const known = findZone(zone);
  return known ? { zone: known.name, zoneOther: "" } : { zone: ZONE_OTHER, zoneOther: zone };
}

// ---------- employees ----------

export type EmployeeInput = {
  name: string; phone: string | null; email: string | null; zone: ZoneInput; weeklyHours: number;
  skills: string[]; notes: string | null; availability: AvailabilityWindow[];
};

export function parseAvailabilityFields(raw: Raw, errors: string[]): AvailabilityWindow[] {
  const out: AvailabilityWindow[] = [];
  for (let d = 1; d <= 7; d++) {
    if (!text(raw, `av_${d}_on`)) continue;
    const start = text(raw, `av_${d}_start`), end = text(raw, `av_${d}_end`);
    if (!isTime(start) || !isTime(end)) errors.push(`Disponibilidad del ${weekdayName(d)}: indica hora de inicio y de fin (HH:MM).`);
    else if (end <= start) errors.push(`Disponibilidad del ${weekdayName(d)}: la hora de fin debe ser posterior a la de inicio.`);
    else out.push({ weekday: d, start, end });
  }
  return out;
}

export function parseEmployeeForm(raw: Raw): EmployeeInput {
  const errors: string[] = [];
  const name = text(raw, "name");
  requireName(errors, name);
  const phone = textOrNull(raw, "phone"), email = textOrNull(raw, "email")?.toLowerCase() ?? null, notes = textOrNull(raw, "notes");
  if (phone && !validPhone(phone)) errors.push("El teléfono no es válido (mínimo 9 dígitos).");
  if (email && !validEmail(email)) errors.push("El email no es válido.");
  checkLength(errors, "Notas", notes, 1000);
  const hoursText = text(raw, "weeklyHours").replace(",", ".");
  const weeklyHours = hoursText === "" ? NaN : Number(hoursText);
  if (!Number.isFinite(weeklyHours) || weeklyHours < 1 || weeklyHours > MAX_WEEKLY_HOURS) {
    errors.push(`Las horas semanales de contrato deben estar entre 1 y ${MAX_WEEKLY_HOURS}.`);
  }
  const zone = parseZone(raw, errors, "Zona");
  const skills = parseSkillKeys(raw, errors);
  const availability = parseAvailabilityFields(raw, errors);
  if (!availability.length && !errors.some((e) => e.startsWith("Disponibilidad"))) errors.push("Indica al menos un día de disponibilidad.");
  failIf(errors);
  return { name, phone, email, zone, weeklyHours, skills, notes, availability };
}

export type EmployeeRow = {
  id: number; org_id: number; name: string; phone: string | null; email: string | null; zone: string | null;
  lat: number | null; lng: number | null; weekly_hours: number; skills: string; active: number; notes: string | null;
};

export function getEmployee(orgId: number, id: number): EmployeeRow | undefined {
  return get<EmployeeRow>("SELECT * FROM employees WHERE org_id = ? AND id = ?", orgId, id);
}

export function employeeAvailability(employeeId: number): AvailabilityWindow[] {
  return all<AvailabilityWindow>("SELECT weekday, start, end FROM availability WHERE employee_id = ? ORDER BY weekday, start", employeeId);
}

export function availabilityFormValues(windows: AvailabilityWindow[]): FormValues {
  const out: FormValues = {};
  for (const w of windows) {
    if (out[`av_${w.weekday}_on`]) continue; // the form edits one window per weekday
    out[`av_${w.weekday}_on`] = "on";
    out[`av_${w.weekday}_start`] = w.start;
    out[`av_${w.weekday}_end`] = w.end;
  }
  return out;
}

export function employeeFormValues(e: EmployeeRow | null): FormValues {
  if (!e) {
    return { name: "", phone: "", email: "", ...zoneFormValues(null), weeklyHours: "30", skills: [], notes: "", ...availabilityFormValues(presetWindows("manana")) };
  }
  return {
    name: e.name, phone: e.phone ?? "", email: e.email ?? "", ...zoneFormValues(e.zone), weeklyHours: String(e.weekly_hours),
    skills: parseSkills(e.skills), notes: e.notes ?? "", ...availabilityFormValues(employeeAvailability(e.id)),
  };
}

function writeAvailability(employeeId: number, windows: AvailabilityWindow[]): void {
  run("DELETE FROM availability WHERE employee_id = ?", employeeId);
  for (const w of windows) run("INSERT INTO availability (employee_id, weekday, start, end) VALUES (?, ?, ?, ?)", employeeId, w.weekday, w.start, w.end);
}

export function createEmployee(orgId: number, input: EmployeeInput, actor: string): number {
  return tx(() => {
    const id = run(
      "INSERT INTO employees (org_id, name, phone, email, zone, lat, lng, weekly_hours, skills, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      orgId, input.name, input.phone, input.email, input.zone.name, input.zone.lat, input.zone.lng, input.weeklyHours, input.skills.join(","), input.notes,
    );
    writeAvailability(id, input.availability);
    logActivity(orgId, "employee.created", `Alta de personal: ${input.name}`, { type: "employee", id }, actor);
    return id;
  });
}

export function updateEmployee(orgId: number, id: number, input: EmployeeInput, actor: string): void {
  const current = getEmployee(orgId, id);
  if (!current) throw new NotFoundError("La persona");
  const zone = resolveCoords({ zone: current.zone, lat: current.lat, lng: current.lng }, input.zone);
  tx(() => {
    run(
      "UPDATE employees SET name = ?, phone = ?, email = ?, zone = ?, lat = ?, lng = ?, weekly_hours = ?, skills = ?, notes = ? WHERE org_id = ? AND id = ?",
      input.name, input.phone, input.email, zone.name, zone.lat, zone.lng, input.weeklyHours, input.skills.join(","), input.notes, orgId, id,
    );
    writeAvailability(id, input.availability);
    logActivity(orgId, "employee.updated", `Datos actualizados: ${input.name}`, { type: "employee", id }, actor);
  });
}

export function setEmployeeActive(orgId: number, id: number, active: boolean, actor: string): void {
  const e = getEmployee(orgId, id);
  if (!e) throw new NotFoundError("La persona");
  if ((e.active === 1) === active) return;
  tx(() => {
    run("UPDATE employees SET active = ? WHERE org_id = ? AND id = ?", active ? 1 : 0, orgId, id);
    logActivity(
      orgId, active ? "employee.reactivated" : "employee.deactivated",
      active ? `${e.name} vuelve a estar activa/o` : `${e.name} dada/o de baja (no se le propondrán sustituciones)`,
      { type: "employee", id }, actor,
    );
  });
}

/** Future scheduled shifts of an employee (informational, shown before deactivating). */
export function futureShiftCount(orgId: number, employeeId: number, today: string): number {
  return get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM shifts WHERE org_id = ? AND employee_id = ? AND status = 'scheduled' AND date >= ?",
    orgId, employeeId, today,
  )!.n;
}

// ---------- clients ----------

export type ClientInput = { name: string; contactName: string | null; contactPhone: string | null; contactEmail: string | null; notes: string | null };

export function parseClientForm(raw: Raw): ClientInput {
  const errors: string[] = [];
  const name = text(raw, "name");
  requireName(errors, name);
  const contactName = textOrNull(raw, "contactName"), contactPhone = textOrNull(raw, "contactPhone");
  const contactEmail = textOrNull(raw, "contactEmail")?.toLowerCase() ?? null, notes = textOrNull(raw, "notes");
  checkLength(errors, "Persona de contacto", contactName, 120);
  if (contactPhone && !validPhone(contactPhone)) errors.push("El teléfono de contacto no es válido (mínimo 9 dígitos).");
  if (contactEmail && !validEmail(contactEmail)) errors.push("El email de contacto no es válido.");
  checkLength(errors, "Notas", notes, 1000);
  failIf(errors);
  return { name, contactName, contactPhone, contactEmail, notes };
}

export type ClientRow = { id: number; org_id: number; name: string; contact_name: string | null; contact_phone: string | null; contact_email: string | null; notes: string | null };

export function getClient(orgId: number, id: number): ClientRow | undefined {
  return get<ClientRow>("SELECT * FROM clients WHERE org_id = ? AND id = ?", orgId, id);
}

export function clientFormValues(c: ClientRow | null): FormValues {
  return {
    name: c?.name ?? "", contactName: c?.contact_name ?? "", contactPhone: c?.contact_phone ?? "",
    contactEmail: c?.contact_email ?? "", notes: c?.notes ?? "",
  };
}

export function createClient(orgId: number, input: ClientInput, actor: string): number {
  return tx(() => {
    const id = run(
      "INSERT INTO clients (org_id, name, contact_name, contact_phone, contact_email, notes) VALUES (?, ?, ?, ?, ?, ?)",
      orgId, input.name, input.contactName, input.contactPhone, input.contactEmail, input.notes,
    );
    logActivity(orgId, "client.created", `Nuevo cliente: ${input.name}`, { type: "client", id }, actor);
    return id;
  });
}

export function updateClient(orgId: number, id: number, input: ClientInput, actor: string): void {
  if (!getClient(orgId, id)) throw new NotFoundError("El cliente");
  tx(() => {
    run(
      "UPDATE clients SET name = ?, contact_name = ?, contact_phone = ?, contact_email = ?, notes = ? WHERE org_id = ? AND id = ?",
      input.name, input.contactName, input.contactPhone, input.contactEmail, input.notes, orgId, id,
    );
    logActivity(orgId, "client.updated", `Datos del cliente actualizados: ${input.name}`, { type: "client", id }, actor);
  });
}

// ---------- locations (centros) ----------

export type LocationInput = { name: string; address: string | null; zone: ZoneInput; accessNotes: string | null; skills: string[] };

export function parseLocationForm(raw: Raw): LocationInput {
  const errors: string[] = [];
  const name = text(raw, "name");
  requireName(errors, name);
  const address = textOrNull(raw, "address"), accessNotes = textOrNull(raw, "accessNotes");
  checkLength(errors, "Dirección", address, 200);
  checkLength(errors, "Notas de acceso", accessNotes, 1000);
  const zone = parseZone(raw, errors, "Municipio");
  const skills = parseSkillKeys(raw, errors);
  failIf(errors);
  return { name, address, zone, accessNotes, skills };
}

export type LocationRow = {
  id: number; org_id: number; client_id: number; name: string; address: string | null; municipality: string | null;
  lat: number | null; lng: number | null; access_notes: string | null; required_skills: string;
};

export function getLocation(orgId: number, id: number): LocationRow | undefined {
  return get<LocationRow>("SELECT * FROM locations WHERE org_id = ? AND id = ?", orgId, id);
}

export function locationFormValues(l: LocationRow | null): FormValues {
  return {
    name: l?.name ?? "", address: l?.address ?? "", ...zoneFormValues(l?.municipality ?? null),
    accessNotes: l?.access_notes ?? "", skills: parseSkills(l?.required_skills),
  };
}

export function createLocation(orgId: number, clientId: number, input: LocationInput, actor: string): number {
  const client = getClient(orgId, clientId);
  if (!client) throw new NotFoundError("El cliente");
  return tx(() => {
    const id = run(
      "INSERT INTO locations (org_id, client_id, name, address, municipality, lat, lng, access_notes, required_skills) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      orgId, clientId, input.name, input.address, input.zone.name, input.zone.lat, input.zone.lng, input.accessNotes, input.skills.join(","),
    );
    logActivity(orgId, "location.created", `Nuevo centro de ${client.name}: ${input.name}`, { type: "client", id: clientId }, actor);
    return id;
  });
}

/** Returns the owning client id (for redirects). */
export function updateLocation(orgId: number, id: number, input: LocationInput, actor: string): number {
  const current = getLocation(orgId, id);
  if (!current) throw new NotFoundError("El centro");
  const zone = resolveCoords({ zone: current.municipality, lat: current.lat, lng: current.lng }, input.zone);
  tx(() => {
    run(
      "UPDATE locations SET name = ?, address = ?, municipality = ?, lat = ?, lng = ?, access_notes = ?, required_skills = ? WHERE org_id = ? AND id = ?",
      input.name, input.address, zone.name, zone.lat, zone.lng, input.accessNotes, input.skills.join(","), orgId, id,
    );
    logActivity(orgId, "location.updated", `Centro actualizado: ${input.name}`, { type: "client", id: current.client_id }, actor);
  });
  return current.client_id;
}
