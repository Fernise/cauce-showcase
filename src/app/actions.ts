"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { login, logout, SESSION_COOKIE } from "@/lib/auth.ts";
import { requireUser } from "@/lib/session.ts";
import { understandMessage } from "@/lib/ai.ts";
import { directory, orgTimezone, orgToday } from "@/lib/queries.ts";
import {
  AbsenceOverlapError, affectedShifts, assignDirectly, cancelAbsence, closeCase, createOffer, registerAbsence, respondOnBehalf, respondToOffer,
  withdrawOffer, accessNotesForToken, type OfferResponse,
} from "@/lib/coverage.ts";
import { addIncidentNote, assignIncidentOwner, createIncident, setIncidentStatus } from "@/lib/incidents.ts";
import type { IncidentType, ParsedMessage, ReasonCategory, Severity } from "@/lib/parse-message.ts";
import { get, run } from "@/lib/db.ts";
import { logActivity } from "@/lib/activity.ts";
import { isValidDate, nowTimeIn } from "@/lib/dates.ts";
import { baseUrl } from "@/lib/messages.ts";
import { importEmployeesCsv } from "@/lib/import.ts";
import { regenerateReportToken } from "@/lib/self-report.ts";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => Number(fd.get(k));
const refresh = () => revalidatePath("/", "layout");

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return baseUrl(host ? `${proto}://${host}` : null);
}

// ---------- Auth ----------

export async function loginAction(_prev: string | null, fd: FormData): Promise<string | null> {
  const h = await headers();
  const source = h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? "local";
  const rawPassword = fd.get("password");
  // Passwords are never trimmed (setup forms hash them as typed); only the email is.
  const session = await login(str(fd, "email"), typeof rawPassword === "string" ? rawPassword : "", source);
  if (!session.ok) {
    return session.reason === "throttled"
      ? "Demasiados intentos. Espera unos minutos y vuelve a probar."
      : "Email o contraseña incorrectos.";
  }
  (await cookies()).set(SESSION_COOKIE, session.token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires: session.expires, path: "/",
  });
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) logout(token);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------- Avisos (message intake) ----------

export type AnalyzeState = {
  text: string;
  parsed: ParsedMessage | null;
  affected: { id: number; date: string; start: string; end: string; location_name: string }[];
  error?: string;
};

export async function analyzeMessageAction(_prev: AnalyzeState, fd: FormData): Promise<AnalyzeState> {
  const user = await requireUser();
  const text = str(fd, "text");
  if (text.length < 8) return { text, parsed: null, affected: [], error: "Pega o escribe el mensaje recibido." };
  const today = orgToday(user.orgId);
  const parsed = await understandMessage(text, directory(user.orgId), today);
  const affected =
    parsed.kind === "absence" && parsed.employeeId
      ? affectedShifts(user.orgId, parsed.employeeId, parsed.startDate, parsed.endDate).map((s) => ({
          id: s.id, date: s.date, start: s.start, end: s.end, location_name: s.location_name,
        }))
      : [];
  return { text, parsed, affected };
}

export async function affectedPreviewAction(employeeId: number, start: string, end: string) {
  const user = await requireUser();
  if (!employeeId || !isValidDate(start) || !isValidDate(end)) return [];
  return affectedShifts(user.orgId, employeeId, start, end < start ? start : end).map((s) => ({
    id: s.id, date: s.date, start: s.start, end: s.end, location_name: s.location_name,
  }));
}

export async function confirmAbsenceAction(fd: FormData) {
  const user = await requireUser();
  const employeeId = num(fd, "employeeId");
  if (!employeeId) throw new Error("Selecciona a la persona");
  if (!isValidDate(str(fd, "start")) || (str(fd, "end") && !isValidDate(str(fd, "end")))) throw new Error("Fecha no válida");
  const tz = orgTimezone(user.orgId);
  let absenceId: number;
  try {
    ({ absenceId } = registerAbsence({
    orgId: user.orgId,
    employeeId,
    start: str(fd, "start"),
    end: str(fd, "end") || str(fd, "start"),
    reason: str(fd, "reason") || null,
    reasonCategory: (str(fd, "reasonCategory") || "otro") as ReasonCategory,
    rawMessage: str(fd, "raw") || null,
    source: str(fd, "raw") ? "mensaje" : "manual",
    actor: user.name,
    today: orgToday(user.orgId),
    nowTime: nowTimeIn(tz),
    }));
  } catch (e) {
    // Already registered (e.g. the employee reported it from their link first): show that absence instead.
    if (e instanceof AbsenceOverlapError) redirect(`/ausencias/${e.existingId}?solapada=1`);
    throw e;
  }
  refresh();
  redirect(`/ausencias/${absenceId}`);
}

export async function confirmIncidentAction(fd: FormData) {
  const user = await requireUser();
  const id = createIncident({
    orgId: user.orgId,
    clientId: num(fd, "clientId") || null,
    locationId: num(fd, "locationId") || null,
    type: (str(fd, "type") || "otro") as IncidentType,
    severity: (str(fd, "severity") || "media") as Severity,
    title: str(fd, "title") || "Incidencia",
    description: str(fd, "description") || null,
    rawMessage: str(fd, "raw") || null,
    ownerUserId: user.id,
    actor: user.name,
    today: orgToday(user.orgId),
    nowTime: nowTimeIn(get<{ timezone: string }>("SELECT timezone FROM organizations WHERE id = ?", user.orgId)?.timezone),
  });
  refresh();
  redirect(`/incidencias/${id}`);
}

// ---------- Coverage ----------

export async function offerAction(fd: FormData) {
  const user = await requireUser();
  createOffer(user.orgId, num(fd, "caseId"), num(fd, "employeeId"), user.name, num(fd, "score") || null, await requestOrigin());
  refresh();
}

export async function assignAction(fd: FormData) {
  const user = await requireUser();
  assignDirectly(user.orgId, num(fd, "caseId"), num(fd, "employeeId"), user.name);
  refresh();
}

export async function respondOnBehalfAction(fd: FormData) {
  const user = await requireUser();
  respondOnBehalf(user.orgId, num(fd, "offerId"), str(fd, "answer") === "yes", user.name);
  refresh();
}

export async function withdrawOfferAction(fd: FormData) {
  const user = await requireUser();
  withdrawOffer(user.orgId, num(fd, "offerId"), user.name);
  refresh();
}

export async function closeCaseAction(fd: FormData) {
  const user = await requireUser();
  closeCase(user.orgId, num(fd, "caseId"), str(fd, "outcome") === "cancelled" ? "cancelled" : "unresolved", str(fd, "note"), user.name);
  refresh();
}

export async function cancelAbsenceAction(fd: FormData) {
  const user = await requireUser();
  cancelAbsence(user.orgId, num(fd, "absenceId"), user.name);
  refresh();
}

/** Public: used by the employee's response link. The token is the credential. */
export type EmployeeResponseState = { result: OfferResponse; accessNotes: string | null } | null;

export async function employeeResponseAction(_prev: EmployeeResponseState, fd: FormData): Promise<EmployeeResponseState> {
  const token = str(fd, "token");
  const result = respondToOffer(token, str(fd, "answer") === "yes");
  refresh();
  return { result, accessNotes: result === "accepted" ? accessNotesForToken(token) : null };
}

/** Invalidates an employee's personal self-report link and issues a new one (T-020). */
export async function regenerateReportLinkAction(fd: FormData) {
  const user = await requireUser();
  regenerateReportToken(user.orgId, num(fd, "employeeId"), user.name);
  refresh();
}

// ---------- Incidents ----------

export async function incidentStatusAction(fd: FormData) {
  const user = await requireUser();
  const status = str(fd, "status") as "abierta" | "en_curso" | "resuelta";
  if (!["abierta", "en_curso", "resuelta"].includes(status)) return;
  setIncidentStatus(user.orgId, num(fd, "id"), status, str(fd, "resolution") || null, user.name);
  refresh();
}

export async function incidentOwnerAction(fd: FormData) {
  const user = await requireUser();
  assignIncidentOwner(user.orgId, num(fd, "id"), num(fd, "ownerId"), user.name);
  refresh();
}

export async function incidentNoteAction(fd: FormData) {
  const user = await requireUser();
  addIncidentNote(user.orgId, num(fd, "id"), str(fd, "note"), user.name);
  refresh();
}

// ---------- Settings ----------

export async function settingsAction(fd: FormData) {
  const user = await requireUser();
  const buffer = Math.min(180, Math.max(0, num(fd, "travelBuffer") || 0));
  const maxHours = Math.min(60, Math.max(10, num(fd, "maxWeeklyHours") || 40));
  const name = str(fd, "name");
  const current = get<{ name: string }>("SELECT name FROM organizations WHERE id = ?", user.orgId)!;
  run(
    "UPDATE organizations SET name = ?, travel_buffer_min = ?, max_weekly_hours = ? WHERE id = ?",
    name || current.name, buffer, maxHours, user.orgId,
  );
  logActivity(user.orgId, "org.settings", `Ajustes actualizados (margen desplazamiento ${buffer} min, máx. ${maxHours} h/semana)`, { type: "org", id: user.orgId }, user.name);
  refresh();
}

export type ImportState = { ok?: string; errors?: string[] } | null;

export async function importEmployeesAction(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const user = await requireUser();
  let text = str(fd, "csv");
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 1_000_000) return { errors: ["El archivo es demasiado grande (máx. 1 MB)."] };
    text = await file.text();
  }
  if (!text) return { errors: ["Pega el CSV o selecciona un archivo."] };
  const result = importEmployeesCsv(user.orgId, text, user.name);
  refresh();
  return result.created > 0
    ? { ok: `${result.created} persona(s) importada(s).`, errors: result.errors }
    : { errors: result.errors.length ? result.errors : ["No se ha importado ninguna fila."] };
}
