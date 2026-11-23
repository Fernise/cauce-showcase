// Absence → coverage case → offers → confirmed replacement. All writes are org-scoped.

import { randomBytes } from "node:crypto";
import { all, db, get, run, tx } from "./db.ts";
import { logActivity } from "./activity.ts";
import { addDays, formatDateShort, isValidDate, nowTimeIn, startOfWeek, todayIn } from "./dates.ts";
import { parseSkills } from "./skills.ts";
import { rankCandidates, type Candidate, type RankingResult, type TargetShift } from "./ranking.ts";
import { baseUrl, offerMessage } from "./messages.ts";
import { REASON_LABELS, type ReasonCategory } from "./parse-message.ts";

type ShiftRow = {
  id: number; org_id: number; date: string; start: string; end: string; title: string; required_skills: string;
  employee_id: number | null; status: string; location_id: number; location_name: string; lat: number | null; lng: number | null;
  location_skills: string; address: string | null; access_notes: string | null;
};

const SHIFT_SELECT = `SELECT s.*, l.name AS location_name, l.lat, l.lng, l.required_skills AS location_skills, l.address, l.access_notes
  FROM shifts s JOIN locations l ON l.id = s.location_id AND l.org_id = s.org_id`;

export function getShift(orgId: number, shiftId: number): ShiftRow | undefined {
  return get<ShiftRow>(`${SHIFT_SELECT} WHERE s.org_id = ? AND s.id = ?`, orgId, shiftId);
}

export function affectedShifts(orgId: number, employeeId: number, start: string, end: string): ShiftRow[] {
  return all<ShiftRow>(
    `${SHIFT_SELECT} WHERE s.org_id = ? AND s.employee_id = ? AND s.date BETWEEN ? AND ? AND s.status = 'scheduled' ORDER BY s.date, s.start`,
    orgId, employeeId, start, end,
  );
}

export function registerAbsence(input: {
  orgId: number; employeeId: number; start: string; end: string; reason: string | null;
  reasonCategory: ReasonCategory; rawMessage: string | null; source: string; actor: string; today: string;
}): { absenceId: number; caseIds: number[] } {
  const employee = get<{ name: string }>("SELECT name FROM employees WHERE org_id = ? AND id = ?", input.orgId, input.employeeId);
  if (!employee) throw new Error("Empleado no encontrado");
  if (!isValidDate(input.start) || !isValidDate(input.end)) throw new Error("Fecha no válida");
  if (input.end < input.start) throw new Error("La fecha de fin es anterior a la de inicio");

  return tx(() => {
    // Data minimisation (RGPD, decision D-012): absences may reveal health data, so only the reason
    // *category* is stored — never the employee's message or a free-text detail.
    const absenceId = run(
      `INSERT INTO absences (org_id, employee_id, start_date, end_date, reason, reason_category, raw_message, source)
       VALUES (?, ?, ?, ?, NULL, ?, NULL, ?)`,
      input.orgId, input.employeeId, input.start, input.end, input.reasonCategory, input.source,
    );
    const range = input.start === input.end ? formatDateShort(input.start) : `${formatDateShort(input.start)} – ${formatDateShort(input.end)}`;
    logActivity(input.orgId, "absence.created", `${employee.name} no podrá trabajar (${range}) · ${REASON_LABELS[input.reasonCategory]}`, { type: "absence", id: absenceId }, input.actor);

    const caseIds: number[] = [];
    for (const s of affectedShifts(input.orgId, input.employeeId, input.start < input.today ? input.today : input.start, input.end)) {
      run("UPDATE shifts SET employee_id = NULL, status = 'uncovered' WHERE id = ?", s.id);
      const caseId = run(
        "INSERT INTO coverage_cases (org_id, shift_id, absence_id, original_employee_id) VALUES (?, ?, ?, ?)",
        input.orgId, s.id, absenceId, input.employeeId,
      );
      caseIds.push(caseId);
      logActivity(input.orgId, "case.opened", `Servicio sin cubrir: ${s.location_name}, ${formatDateShort(s.date)} ${s.start}–${s.end}`, { type: "case", id: caseId }, "Cauce");
    }
    return { absenceId, caseIds };
  });
}

export function cancelAbsence(orgId: number, absenceId: number, actor: string): void {
  tx(() => {
    const a = get<{ employee_id: number; name: string; status: string }>(
      "SELECT a.employee_id, e.name, a.status FROM absences a JOIN employees e ON e.id = a.employee_id AND e.org_id = a.org_id WHERE a.org_id = ? AND a.id = ?",
      orgId, absenceId,
    );
    if (!a || a.status !== "active") return;
    run("UPDATE absences SET status = 'cancelled' WHERE id = ?", absenceId);
    // Services still without anyone (open, offering or closed as "sin cobertura") go back to the employee,
    // unless another active absence of hers still covers that day — then the case moves to that absence.
    const cases = all<{ id: number; shift_id: number; date: string; shift_status: string; shift_employee: number | null }>(
      `SELECT c.id, c.shift_id, s.date, s.status AS shift_status, s.employee_id AS shift_employee
         FROM coverage_cases c JOIN shifts s ON s.id = c.shift_id AND s.org_id = c.org_id
        WHERE c.org_id = ? AND c.absence_id = ? AND c.status IN ('open','offering','unresolved')`,
      orgId, absenceId,
    );
    let restored = 0;
    for (const c of cases) {
      const other = get<{ id: number }>(
        "SELECT id FROM absences WHERE org_id = ? AND employee_id = ? AND status = 'active' AND id != ? AND ? BETWEEN start_date AND end_date",
        orgId, a.employee_id, absenceId, c.date,
      );
      if (other) {
        run("UPDATE coverage_cases SET absence_id = ? WHERE id = ?", other.id, c.id);
        continue;
      }
      if (c.shift_status === "uncovered" && c.shift_employee === null) {
        run("UPDATE shifts SET employee_id = ?, status = 'scheduled' WHERE id = ?", a.employee_id, c.shift_id);
        restored++;
      }
      run("UPDATE coverage_cases SET status = 'cancelled', resolved_at = datetime('now') WHERE id = ?", c.id);
      run("UPDATE offers SET status = 'withdrawn' WHERE case_id = ? AND status = 'pending'", c.id);
    }
    logActivity(orgId, "absence.cancelled", `Ausencia de ${a.name} anulada; ${restored} servicio(s) vuelven a su planificación`, { type: "absence", id: absenceId }, actor);
  });
}

// ---------- Ranking ----------

export function orgSettings(orgId: number) {
  return get<{ travel_buffer_min: number; max_weekly_hours: number; timezone: string; name: string }>(
    "SELECT travel_buffer_min, max_weekly_hours, timezone, name FROM organizations WHERE id = ?",
    orgId,
  )!;
}

export function rankForShift(orgId: number, shiftId: number, excludeIds: number[] = []): RankingResult {
  const s = getShift(orgId, shiftId);
  if (!s) throw new Error("Servicio no encontrado");
  const settings = orgSettings(orgId);
  const target: TargetShift = {
    id: s.id, date: s.date, start: s.start, end: s.end, locationId: s.location_id, locationName: s.location_name,
    point: s.lat !== null && s.lng !== null ? { lat: s.lat, lng: s.lng } : null,
    requiredSkills: [...new Set([...parseSkills(s.required_skills), ...parseSkills(s.location_skills)])],
  };

  const weekStart = startOfWeek(s.date);
  const weekEnd = addDays(weekStart, 6);
  const employees = all<{ id: number; name: string; active: number; lat: number | null; lng: number | null; zone: string | null; weekly_hours: number; skills: string }>(
    "SELECT id, name, active, lat, lng, zone, weekly_hours, skills FROM employees WHERE org_id = ?",
    orgId,
  );
  const availability = all<{ employee_id: number; weekday: number; start: string; end: string }>(
    "SELECT a.employee_id, a.weekday, a.start, a.end FROM availability a JOIN employees e ON e.id = a.employee_id WHERE e.org_id = ?",
    orgId,
  );
  const absent = all<{ employee_id: number }>(
    "SELECT employee_id FROM absences WHERE org_id = ? AND status = 'active' AND ? BETWEEN start_date AND end_date",
    orgId, s.date,
  );
  const weekShifts = all<{ id: number; employee_id: number; date: string; start: string; end: string; location_id: number; location_name: string; lat: number | null; lng: number | null }>(
    `SELECT s.id, s.employee_id, s.date, s.start, s.end, s.location_id, l.name AS location_name, l.lat, l.lng
       FROM shifts s JOIN locations l ON l.id = s.location_id
      WHERE s.org_id = ? AND s.employee_id IS NOT NULL AND s.status = 'scheduled' AND s.date BETWEEN ? AND ?`,
    orgId, weekStart, weekEnd,
  );
  const visits = all<{ employee_id: number; n: number }>(
    `SELECT employee_id, COUNT(*) AS n FROM shifts
      WHERE org_id = ? AND location_id = ? AND employee_id IS NOT NULL AND date BETWEEN ? AND ? GROUP BY employee_id`,
    orgId, s.location_id, addDays(s.date, -60), addDays(s.date, -1),
  );
  const subs = all<{ employee_id: number; n: number }>(
    `SELECT resolved_employee_id AS employee_id, COUNT(*) AS n FROM coverage_cases
      WHERE org_id = ? AND status = 'covered' AND resolved_at >= datetime('now', '-30 days') GROUP BY resolved_employee_id`,
    orgId,
  );

  const absentSet = new Set(absent.map((a) => a.employee_id));
  const candidates: Candidate[] = employees.map((e) => ({
    id: e.id,
    name: e.name,
    active: e.active === 1,
    home: e.lat !== null && e.lng !== null ? { lat: e.lat, lng: e.lng } : null,
    zone: e.zone,
    weeklyHours: e.weekly_hours,
    skills: parseSkills(e.skills),
    availability: availability.filter((a) => a.employee_id === e.id),
    absentDates: absentSet.has(e.id) ? [s.date] : [],
    weekShifts: weekShifts
      .filter((w) => w.employee_id === e.id)
      .map((w) => ({ id: w.id, date: w.date, start: w.start, end: w.end, locationId: w.location_id, locationName: w.location_name, point: w.lat !== null && w.lng !== null ? { lat: w.lat, lng: w.lng } : null })),
    visitsToLocation60d: visits.find((v) => v.employee_id === e.id)?.n ?? 0,
    substitutionsLast30d: subs.find((v) => v.employee_id === e.id)?.n ?? 0,
  }));

  return rankCandidates(target, candidates, { travelBufferMin: settings.travel_buffer_min, maxWeeklyHours: settings.max_weekly_hours }, excludeIds);
}

// ---------- Cases & offers ----------

export type CaseRow = {
  id: number; status: string; shift_id: number; absence_id: number | null; original_employee_id: number | null;
  original_name: string | null; resolved_employee_id: number | null; resolved_name: string | null; created_at: string; resolved_at: string | null;
  date: string; start: string; end: string; title: string; location_id: number; location_name: string; client_name: string;
  address: string | null; access_notes: string | null;
};

export const CASE_SELECT = `SELECT c.*, oe.name AS original_name, re.name AS resolved_name,
    s.date, s.start, s.end, s.title, s.location_id, l.name AS location_name, cl.name AS client_name, l.address, l.access_notes
  FROM coverage_cases c
  JOIN shifts s ON s.id = c.shift_id AND s.org_id = c.org_id
  JOIN locations l ON l.id = s.location_id AND l.org_id = c.org_id
  JOIN clients cl ON cl.id = l.client_id AND cl.org_id = c.org_id
  LEFT JOIN employees oe ON oe.id = c.original_employee_id AND oe.org_id = c.org_id
  LEFT JOIN employees re ON re.id = c.resolved_employee_id AND re.org_id = c.org_id`;

export function getCase(orgId: number, caseId: number): CaseRow | undefined {
  return get<CaseRow>(`${CASE_SELECT} WHERE c.org_id = ? AND c.id = ?`, orgId, caseId);
}

/** True once the service has started (org-local wall clock). Offers can no longer be accepted. */
export function shiftStarted(orgId: number, date: string, start: string, now = new Date()): boolean {
  const tz = orgSettings(orgId).timezone;
  const today = todayIn(tz, now);
  return date < today || (date === today && start <= nowTimeIn(tz, now));
}

/** Re-checks the hard rules (availability, overlaps, travel, skills, max hours) for one employee right now. */
export function eligibility(orgId: number, c: CaseRow, employeeId: number): { ok: true } | { ok: false; reason: string } {
  const r = rankForShift(orgId, c.shift_id, c.original_employee_id ? [c.original_employee_id] : []);
  if (r.ranked.some((x) => x.employeeId === employeeId)) return { ok: true };
  const ex = r.excluded.find((x) => x.employeeId === employeeId);
  return { ok: false, reason: ex?.reason ?? (employeeId === c.original_employee_id ? "Es la persona ausente" : "No disponible") };
}

const OPEN = ["open", "offering"];

export function createOffer(orgId: number, caseId: number, employeeId: number, actor: string, score: number | null, origin = baseUrl()) {
  return tx(() => {
    const c = getCase(orgId, caseId);
    if (!c || !OPEN.includes(c.status)) throw new Error("El caso ya no está abierto");
    if (shiftStarted(orgId, c.date, c.start)) throw new Error("El servicio ya ha empezado");
    const emp = get<{ name: string; phone: string | null }>("SELECT name, phone FROM employees WHERE org_id = ? AND id = ?", orgId, employeeId);
    if (!emp) throw new Error("Empleado no encontrado");
    const existing = get<{ id: number }>("SELECT id FROM offers WHERE case_id = ? AND employee_id = ? AND status = 'pending'", caseId, employeeId);
    if (existing) return existing.id;
    const ok = eligibility(orgId, c, employeeId);
    if (!ok.ok) throw new Error(`${emp.name} no puede cubrirlo: ${ok.reason}`);

    const token = randomBytes(12).toString("base64url");
    const message = offerMessage({
      employeeName: emp.name, date: c.date, start: c.start, end: c.end, locationName: c.location_name,
      address: c.address, link: `${origin}/r/${token}`, senderName: actor,
    });
    const id = run(
      "INSERT INTO offers (org_id, case_id, employee_id, token, message, score) VALUES (?, ?, ?, ?, ?, ?)",
      orgId, caseId, employeeId, token, message, score,
    );
    run("UPDATE coverage_cases SET status = 'offering' WHERE id = ? AND status = 'open'", caseId);
    logActivity(orgId, "offer.sent", `Propuesta enviada a ${emp.name} para ${c.location_name} (${formatDateShort(c.date)} ${c.start})`, { type: "case", id: caseId }, actor);
    return id;
  });
}

/** Must run inside tx(). Conditional on the case still being open, so a lost race cannot overwrite. */
function assign(orgId: number, c: CaseRow, employeeId: number, employeeName: string, actor: string, via: string) {
  const updated = db().prepare("UPDATE coverage_cases SET status = 'covered', resolved_employee_id = ?, resolved_at = datetime('now') WHERE id = ? AND status IN ('open','offering')").run(employeeId, c.id);
  if (Number(updated.changes) !== 1) throw new Error("El caso ya no está abierto");
  run("UPDATE shifts SET employee_id = ?, status = 'scheduled' WHERE id = ?", employeeId, c.shift_id);
  run("UPDATE offers SET status = 'withdrawn' WHERE case_id = ? AND status = 'pending' AND employee_id != ?", c.id, employeeId);
  logActivity(orgId, "case.covered", `Cubierto: ${employeeName} hará ${c.location_name} (${formatDateShort(c.date)} ${c.start}–${c.end}) · ${via}`, { type: "case", id: c.id }, actor);
}

/** Site access instructions (keys, alarm codes) — only for the person actually confirmed on the service. */
export function accessNotesForToken(token: string): string | null {
  const r = get<{ access_notes: string | null }>(
    `SELECT l.access_notes FROM offers o
       JOIN coverage_cases c ON c.id = o.case_id AND c.org_id = o.org_id
       JOIN shifts s ON s.id = c.shift_id AND s.org_id = o.org_id
       JOIN locations l ON l.id = s.location_id AND l.org_id = o.org_id
      WHERE o.token = ? AND o.status = 'accepted' AND c.status = 'covered'
        AND c.resolved_employee_id = o.employee_id AND s.employee_id = o.employee_id`,
    token,
  );
  return r?.access_notes ?? null;
}

export type OfferResponse = "accepted" | "declined" | "too_late" | "expired" | "unavailable" | "already_answered" | "not_found";

/** Called from the employee's response link (or by the manager on their behalf). */
export function respondToOffer(token: string, accept: boolean, actorOverride?: string): OfferResponse {
  return tx(() => {
    const offer = get<{ id: number; org_id: number; case_id: number; employee_id: number; status: string; name: string }>(
      "SELECT o.id, o.org_id, o.case_id, o.employee_id, o.status, e.name FROM offers o JOIN employees e ON e.id = o.employee_id AND e.org_id = o.org_id WHERE o.token = ?",
      token,
    );
    if (!offer) return "not_found";
    if (offer.status === "withdrawn") return "too_late";
    if (offer.status !== "pending") return "already_answered";
    const c = getCase(offer.org_id, offer.case_id);
    if (!c) return "not_found";
    const actor = actorOverride ?? offer.name;

    if (!accept) {
      run("UPDATE offers SET status = 'declined', responded_at = datetime('now') WHERE id = ?", offer.id);
      logActivity(offer.org_id, "offer.declined", `${offer.name} no puede cubrir ${c.location_name} (${formatDateShort(c.date)})`, { type: "case", id: c.id }, actor);
      const pending = get<{ n: number }>("SELECT COUNT(*) AS n FROM offers WHERE case_id = ? AND status = 'pending'", c.id)!;
      if (pending.n === 0 && c.status === "offering") run("UPDATE coverage_cases SET status = 'open' WHERE id = ?", c.id);
      return "declined";
    }
    if (!OPEN.includes(c.status)) {
      run("UPDATE offers SET status = 'withdrawn', responded_at = datetime('now') WHERE id = ?", offer.id);
      return "too_late";
    }
    if (shiftStarted(offer.org_id, c.date, c.start)) {
      run("UPDATE offers SET status = 'withdrawn', responded_at = datetime('now') WHERE id = ?", offer.id);
      logActivity(offer.org_id, "offer.expired", `${offer.name} respondió tarde: el servicio de ${c.location_name} ya había empezado`, { type: "case", id: c.id }, "Cauce");
      return "expired";
    }
    const ok = eligibility(offer.org_id, c, offer.employee_id);
    if (!ok.ok) {
      run("UPDATE offers SET status = 'withdrawn', responded_at = datetime('now') WHERE id = ?", offer.id);
      logActivity(offer.org_id, "offer.withdrawn", `${offer.name} aceptó, pero ya no puede cubrirlo (${ok.reason}); propuesta retirada`, { type: "case", id: c.id }, "Cauce");
      const pending = get<{ n: number }>("SELECT COUNT(*) AS n FROM offers WHERE case_id = ? AND status = 'pending'", c.id)!;
      if (pending.n === 0) run("UPDATE coverage_cases SET status = 'open' WHERE id = ? AND status = 'offering'", c.id);
      return "unavailable";
    }
    run("UPDATE offers SET status = 'accepted', responded_at = datetime('now') WHERE id = ?", offer.id);
    logActivity(offer.org_id, "offer.accepted", `${offer.name} acepta cubrir ${c.location_name}`, { type: "case", id: c.id }, actor);
    assign(offer.org_id, c, offer.employee_id, offer.name, "Cauce", actorOverride ? `confirmado por ${actorOverride}` : "confirmado por la empleada/o");
    return "accepted";
  });
}

export function respondOnBehalf(orgId: number, offerId: number, accept: boolean, actor: string): OfferResponse {
  const o = get<{ token: string }>("SELECT token FROM offers WHERE org_id = ? AND id = ?", orgId, offerId);
  if (!o) return "not_found";
  return respondToOffer(o.token, accept, actor);
}

export function assignDirectly(orgId: number, caseId: number, employeeId: number, actor: string): void {
  tx(() => {
    const c = getCase(orgId, caseId);
    if (!c || !OPEN.includes(c.status)) throw new Error("El caso ya no está abierto");
    const emp = get<{ name: string }>("SELECT name FROM employees WHERE org_id = ? AND id = ?", orgId, employeeId);
    if (!emp) throw new Error("Empleado no encontrado");
    const ok = eligibility(orgId, c, employeeId);
    if (!ok.ok) throw new Error(`${emp.name} no puede cubrirlo: ${ok.reason}`);
    // If she had a pending offer, the coordinator confirmed it by phone: close it as accepted (on her behalf).
    run("UPDATE offers SET status = 'accepted', responded_at = datetime('now') WHERE case_id = ? AND employee_id = ? AND status = 'pending'", caseId, employeeId);
    assign(orgId, c, employeeId, emp.name, actor, "asignado directamente por coordinación");
  });
}

export function closeCase(orgId: number, caseId: number, outcome: "unresolved" | "cancelled", note: string, actor: string): void {
  tx(() => {
    const c = getCase(orgId, caseId);
    if (!c || !OPEN.includes(c.status)) return;
    run("UPDATE coverage_cases SET status = ?, resolved_at = datetime('now') WHERE id = ?", outcome, caseId);
    run("UPDATE offers SET status = 'withdrawn' WHERE case_id = ? AND status = 'pending'", caseId);
    if (outcome === "cancelled") run("UPDATE shifts SET status = 'cancelled' WHERE id = ?", c.shift_id);
    const label = outcome === "cancelled" ? "Servicio anulado con el cliente" : "Sin cobertura";
    logActivity(orgId, `case.${outcome}`, `${label}: ${c.location_name} (${formatDateShort(c.date)})${note ? ` · ${note}` : ""}`, { type: "case", id: caseId }, actor);
  });
}

export function withdrawOffer(orgId: number, offerId: number, actor: string): void {
  tx(() => {
    const o = get<{ case_id: number; name: string; status: string }>(
      "SELECT o.case_id, e.name, o.status FROM offers o JOIN employees e ON e.id = o.employee_id AND e.org_id = o.org_id WHERE o.org_id = ? AND o.id = ?",
      orgId, offerId,
    );
    if (!o || o.status !== "pending") return;
    run("UPDATE offers SET status = 'withdrawn' WHERE id = ?", offerId);
    const pending = get<{ n: number }>("SELECT COUNT(*) AS n FROM offers WHERE case_id = ? AND status = 'pending'", o.case_id)!;
    if (pending.n === 0) run("UPDATE coverage_cases SET status = 'open' WHERE id = ? AND status = 'offering'", o.case_id);
    logActivity(orgId, "offer.withdrawn", `Propuesta a ${o.name} retirada`, { type: "case", id: o.case_id }, actor);
  });
}
