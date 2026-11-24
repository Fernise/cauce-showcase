// Employee self-report (T-020): every employee has a permanent personal link (/a/<token>) where they tell
// coordination they can't work. The link is the credential, so everything here is defensive:
//   · only active employees resolve; every later query is scoped by the employee's org_id;
//   · there is NO free-text input — only a reason *category* (D-012, RGPD data minimisation);
//   · dates are validated in the organisation's timezone, ranges are capped, duplicates are refused,
//     and a leaked link can create at most MAX_REPORTS_PER_DAY absences per day.
// Writes go through registerAbsence() so cases, activity and ranking behave exactly as for a coordinator.

import { all, get, newReportToken, run, tx } from "./db.ts";
import { logActivity } from "./activity.ts";
import { addDays, daysBetween, isValidDate, nowTimeIn, todayIn } from "./dates.ts";
import { AbsenceOverlapError, pendingAffectedShifts, registerAbsence } from "./coverage.ts";
import { firstName } from "./messages.ts";
import { REASON_LABELS, type ReasonCategory } from "./parse-message.ts";

export const SELF_REPORT_SOURCE = "self_report";
export const MAX_RANGE_DAYS = 31;
export const MAX_ADVANCE_DAYS = 90;
export const MAX_REPORTS_PER_DAY = 5;

export const REASON_CATEGORIES = Object.keys(REASON_LABELS) as ReasonCategory[];

export function isReasonCategory(v: unknown): v is ReasonCategory {
  return typeof v === "string" && (REASON_CATEGORIES as string[]).includes(v);
}

/** Neutral wording (no gendered guess) shown wherever an absence's origin is displayed. */
export const SELF_REPORT_LABEL = "Aviso de la propia persona";
export function sourceLabel(source: string | null | undefined): string | null {
  return source === SELF_REPORT_SOURCE ? SELF_REPORT_LABEL : null;
}

export type Reporter = { id: number; orgId: number; name: string; orgName: string; timezone: string };

/** The active employee behind a personal link, or undefined (unknown token / deactivated person). */
export function findReporter(token: string): Reporter | undefined {
  if (typeof token !== "string" || token.length < 16 || token.length > 64) return undefined;
  const r = get<{ id: number; org_id: number; name: string; org_name: string; timezone: string }>(
    `SELECT e.id, e.org_id, e.name, o.name AS org_name, o.timezone
       FROM employees e JOIN organizations o ON o.id = e.org_id
      WHERE e.report_token = ? AND e.active = 1`,
    token,
  );
  return r ? { id: r.id, orgId: r.org_id, name: r.name, orgName: r.org_name, timezone: r.timezone } : undefined;
}

export type AffectedService = { date: string; start: string; end: string; locationName: string };

export type SelfReportError =
  | "not_found" | "invalid_dates" | "past" | "too_long" | "too_far" | "invalid_reason" | "duplicate" | "rate_limited";

export const ERROR_MESSAGES: Record<SelfReportError, string> = {
  not_found: "Este enlace ya no es válido. Pide uno nuevo a coordinación.",
  invalid_dates: "Revisa las fechas: la de fin no puede ser anterior a la de inicio.",
  past: "Solo puedes avisar desde hoy en adelante. Si es de un día pasado, habla con coordinación.",
  too_long: `Para ausencias de más de ${MAX_RANGE_DAYS} días, habla directamente con coordinación.`,
  too_far: `Solo puedes avisar con hasta ${MAX_ADVANCE_DAYS} días de antelación.`,
  invalid_reason: "Elige el motivo de la lista.",
  duplicate: "Ya tienes un aviso para esos días. Coordinación ya lo sabe.",
  rate_limited: "Has enviado muchos avisos hoy. Habla directamente con coordinación.",
};

export type Failure = { ok: false; error: SelfReportError; message: string };
const fail = (error: SelfReportError): Failure => ({ ok: false, error, message: ERROR_MESSAGES[error] });

export type Preview = { ok: true; start: string; end: string; reason: ReasonCategory; services: AffectedService[] };
export type Submitted = { ok: true; absenceId: number; start: string; end: string; reason: ReasonCategory; services: AffectedService[] };

/** Quick choices of the page → concrete dates. "otras" needs desde (and optionally hasta). */
export function resolveWhen(when: string, today: string, desde?: string | null, hasta?: string | null): { start: string; end: string } | null {
  if (when === "hoy") return { start: today, end: today };
  if (when === "manana") return { start: addDays(today, 1), end: addDays(today, 1) };
  if (when === "otras") {
    if (!desde || !isValidDate(desde)) return null;
    const end = hasta && isValidDate(hasta) ? hasta : desde;
    return { start: desde, end };
  }
  return null;
}

function checkInput(r: Reporter, start: string, end: string, reason: string, now: Date): Failure | null {
  if (!isValidDate(start) || !isValidDate(end) || end < start) return fail("invalid_dates");
  if (!isReasonCategory(reason)) return fail("invalid_reason");
  const today = todayIn(r.timezone, now);
  if (start < today) return fail("past");
  if (daysBetween(start, end) + 1 > MAX_RANGE_DAYS) return fail("too_long");
  if (daysBetween(today, start) > MAX_ADVANCE_DAYS) return fail("too_far");
  return null;
}

function servicesOf(r: Reporter, start: string, end: string, now: Date): AffectedService[] {
  // Date, time and site name only — never access notes or addresses. Same cutoff as registerAbsence.
  return pendingAffectedShifts(r.orgId, r.id, start, end, todayIn(r.timezone, now), nowTimeIn(r.timezone, now)).map((s) => ({ date: s.date, start: s.start, end: s.end, locationName: s.location_name }));
}

function overlappingAbsence(r: Reporter, start: string, end: string): { id: number } | undefined {
  return get<{ id: number }>(
    "SELECT id FROM absences WHERE org_id = ? AND employee_id = ? AND status = 'active' AND start_date <= ? AND end_date >= ? LIMIT 1",
    r.orgId, r.id, end, start,
  );
}

function reportsLast24h(r: Reporter): number {
  return get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM absences WHERE org_id = ? AND employee_id = ? AND source = ? AND created_at >= datetime('now', '-1 day')",
    r.orgId, r.id, SELF_REPORT_SOURCE,
  )!.n;
}

/** Read-only: validates and lists the services the report would affect. Nothing is written. */
export function previewSelfReport(token: string, input: { start: string; end: string; reason: string }, now = new Date()): Preview | Failure {
  const r = findReporter(token);
  if (!r) return fail("not_found");
  const bad = checkInput(r, input.start, input.end, input.reason, now);
  if (bad) return bad;
  if (overlappingAbsence(r, input.start, input.end)) return fail("duplicate");
  return { ok: true, start: input.start, end: input.end, reason: input.reason as ReasonCategory, services: servicesOf(r, input.start, input.end, now) };
}

/** Registers the absence (opening coverage cases) on behalf of the person behind the link. */
export function submitSelfReport(token: string, input: { start: string; end: string; reason: string }, now = new Date()): Submitted | Failure {
  const r = findReporter(token);
  if (!r) return fail("not_found");
  const bad = checkInput(r, input.start, input.end, input.reason, now);
  if (bad) return bad;
  const reason = input.reason as ReasonCategory;

  return tx(() => {
    // Re-check inside the write lock: the link may have been regenerated or the person deactivated meanwhile,
    // and two simultaneous taps (or a coordinator registering the same notice) must not create two absences.
    if (findReporter(token)?.id !== r.id) return fail("not_found");
    if (overlappingAbsence(r, input.start, input.end)) return fail("duplicate");
    if (reportsLast24h(r) >= MAX_REPORTS_PER_DAY) return fail("rate_limited");
    const services = servicesOf(r, input.start, input.end, now);
    let absenceId: number;
    try {
      ({ absenceId } = registerAbsence({
        orgId: r.orgId, employeeId: r.id, start: input.start, end: input.end, reason: null, reasonCategory: reason,
        rawMessage: null, source: SELF_REPORT_SOURCE, actor: r.name, today: todayIn(r.timezone, now), nowTime: nowTimeIn(r.timezone, now),
      }));
    } catch (e) {
      if (e instanceof AbsenceOverlapError) return fail("duplicate");
      throw e;
    }
    // Make the timeline say where the notice came from (registerAbsence logged the generic line).
    run(
      "UPDATE activity SET summary = summary || ? WHERE org_id = ? AND entity_type = 'absence' AND entity_id = ? AND type = 'absence.created'",
      ` · ${SELF_REPORT_LABEL.toLowerCase()}`, r.orgId, absenceId,
    );
    return { ok: true as const, absenceId, start: input.start, end: input.end, reason, services };
  });
}

/** For the confirmation screen: the services that were opened for coverage by this self-reported absence. */
export function selfReportOutcome(token: string, absenceId: number): Submitted | undefined {
  const r = findReporter(token);
  if (!r) return undefined;
  const a = get<{ id: number; start_date: string; end_date: string; reason_category: ReasonCategory }>(
    // Only fresh receipts: the permanent link must not become a browsable history of past absences.
    "SELECT id, start_date, end_date, reason_category FROM absences WHERE org_id = ? AND employee_id = ? AND id = ? AND source = ? AND created_at >= datetime('now', '-1 day')",
    r.orgId, r.id, absenceId, SELF_REPORT_SOURCE,
  );
  if (!a) return undefined;
  const services = all<{ date: string; start: string; end: string; location_name: string }>(
    `SELECT s.date, s.start, s.end, l.name AS location_name
       FROM coverage_cases c JOIN shifts s ON s.id = c.shift_id AND s.org_id = c.org_id
       JOIN locations l ON l.id = s.location_id AND l.org_id = c.org_id
      WHERE c.org_id = ? AND c.absence_id = ? ORDER BY s.date, s.start`,
    r.orgId, a.id,
  ).map((s) => ({ date: s.date, start: s.start, end: s.end, locationName: s.location_name }));
  return { ok: true, absenceId: a.id, start: a.start_date, end: a.end_date, reason: a.reason_category, services };
}

/** Invalidates the old link and issues a new one. Returns the new token. */
export function regenerateReportToken(orgId: number, employeeId: number, actor: string): string | null {
  return tx(() => {
    const e = get<{ name: string }>("SELECT name FROM employees WHERE org_id = ? AND id = ?", orgId, employeeId);
    if (!e) return null;
    const token = newReportToken();
    run("UPDATE employees SET report_token = ? WHERE org_id = ? AND id = ?", token, orgId, employeeId);
    logActivity(orgId, "employee.report_link_regenerated", `Enlace personal de ${e.name} regenerado (el anterior deja de funcionar)`, { type: "employee", id: employeeId }, actor);
    return token;
  });
}

export function reportLinkMessage(p: { employeeName: string; senderName: string; link: string }): string {
  return [
    `Hola ${firstName(p.employeeName)}, soy ${firstName(p.senderName)}.`,
    `Tu enlace para avisar si no puedes ir: ${p.link}`,
    `Guárdalo: es solo tuyo y siempre es el mismo.`,
  ].join("\n");
}
