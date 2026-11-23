import { all, get, run, tx } from "./db.ts";
import { logActivity } from "./activity.ts";
import type { IncidentType, Severity } from "./parse-message.ts";

export type IncidentRow = {
  id: number; client_id: number | null; location_id: number | null; shift_id: number | null; employee_id: number | null;
  type: IncidentType; severity: Severity; title: string; description: string | null; raw_message: string | null;
  owner_user_id: number | null; status: "abierta" | "en_curso" | "resuelta"; resolution: string | null;
  created_at: string; resolved_at: string | null;
  client_name: string | null; location_name: string | null; employee_name: string | null; owner_name: string | null;
  shift_date: string | null; shift_start: string | null; shift_end: string | null;
};

export const INCIDENT_SELECT = `SELECT i.*, c.name AS client_name, l.name AS location_name, e.name AS employee_name, u.name AS owner_name,
    s.date AS shift_date, s.start AS shift_start, s.end AS shift_end
  FROM incidents i
  LEFT JOIN clients c ON c.id = i.client_id AND c.org_id = i.org_id
  LEFT JOIN locations l ON l.id = i.location_id AND l.org_id = i.org_id
  LEFT JOIN employees e ON e.id = i.employee_id AND e.org_id = i.org_id
  LEFT JOIN users u ON u.id = i.owner_user_id AND u.org_id = i.org_id
  LEFT JOIN shifts s ON s.id = i.shift_id AND s.org_id = i.org_id`;

export const STATUS_LABELS = { abierta: "Abierta", en_curso: "En curso", resuelta: "Resuelta" } as const;

export function getIncident(orgId: number, id: number) {
  return get<IncidentRow>(`${INCIDENT_SELECT} WHERE i.org_id = ? AND i.id = ?`, orgId, id);
}

/** The last service at that location that has already started (org-local), with someone assigned. */
export function findRelatedShift(orgId: number, locationId: number, date: string, time = "23:59") {
  return get<{ id: number; employee_id: number | null }>(
    `SELECT id, employee_id FROM shifts
      WHERE org_id = ? AND location_id = ? AND status = 'scheduled' AND employee_id IS NOT NULL
        AND (date < ? OR (date = ? AND start <= ?))
      ORDER BY date DESC, start DESC LIMIT 1`,
    orgId, locationId, date, date, time,
  );
}

export function createIncident(input: {
  orgId: number; clientId: number | null; locationId: number | null; type: IncidentType; severity: Severity;
  title: string; description: string | null; rawMessage: string | null; ownerUserId: number | null; actor: string; today: string;
  nowTime?: string;
}): number {
  // Never trust ids from the form: keep only those that belong to this organization.
  let clientId = input.clientId && get("SELECT 1 FROM clients WHERE org_id = ? AND id = ?", input.orgId, input.clientId) ? input.clientId : null;
  const loc = input.locationId
    ? get<{ client_id: number }>("SELECT client_id FROM locations WHERE org_id = ? AND id = ?", input.orgId, input.locationId)
    : undefined;
  const locationId = loc ? input.locationId : null;
  let shiftId: number | null = null;
  let employeeId: number | null = null;
  if (loc && locationId) {
    clientId = loc.client_id;
    const shift = findRelatedShift(input.orgId, locationId, input.today, input.nowTime);
    shiftId = shift?.id ?? null;
    employeeId = shift?.employee_id ?? null;
  }
  return tx(() => {
    const id = run(
      `INSERT INTO incidents (org_id, client_id, location_id, shift_id, employee_id, type, severity, title, description, raw_message, owner_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.orgId, clientId, locationId, shiftId, employeeId, input.type, input.severity, input.title,
      input.description, input.rawMessage, input.ownerUserId,
    );
    logActivity(input.orgId, "incident.created", `Nueva incidencia: ${input.title}`, { type: "incident", id }, input.actor);
    return id;
  });
}

export function setIncidentStatus(orgId: number, id: number, status: IncidentRow["status"], resolution: string | null, actor: string) {
  const inc = getIncident(orgId, id);
  if (!inc || inc.status === status) return;
  tx(() => {
    run(
      `UPDATE incidents SET status = ?, resolution = COALESCE(?, resolution),
         resolved_at = CASE WHEN ? = 'resuelta' THEN datetime('now') ELSE NULL END WHERE id = ?`,
      status, resolution, status, id,
    );
    logActivity(orgId, `incident.${status}`, `Incidencia ${STATUS_LABELS[status].toLowerCase()}: ${inc.title}${resolution ? ` · ${resolution}` : ""}`, { type: "incident", id }, actor);
  });
}

export function assignIncidentOwner(orgId: number, id: number, userId: number, actor: string) {
  const user = get<{ name: string }>("SELECT name FROM users WHERE org_id = ? AND id = ?", orgId, userId);
  if (!user) return;
  if (!getIncident(orgId, id)) return;
  run("UPDATE incidents SET owner_user_id = ? WHERE org_id = ? AND id = ?", userId, orgId, id);
  logActivity(orgId, "incident.assigned", `Incidencia asignada a ${user.name}`, { type: "incident", id }, actor);
}

export function addIncidentNote(orgId: number, id: number, note: string, actor: string) {
  if (!note.trim() || !getIncident(orgId, id)) return;
  logActivity(orgId, "incident.note", note.trim(), { type: "incident", id }, actor);
}

export function incidentTimeline(orgId: number, id: number) {
  return all<{ id: number; type: string; summary: string; actor: string | null; created_at: string }>(
    "SELECT id, type, summary, actor, created_at FROM activity WHERE org_id = ? AND entity_type = 'incident' AND entity_id = ? ORDER BY id",
    orgId, id,
  );
}
