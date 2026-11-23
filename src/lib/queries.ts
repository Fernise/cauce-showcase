// Read models for pages. All org-scoped.

import { all, get } from "./db.ts";
import { addDays, todayIn } from "./dates.ts";
import type { Directory } from "./parse-message.ts";
import { CASE_SELECT, type CaseRow } from "./coverage.ts";

export function orgToday(orgId: number): string {
  const tz = get<{ timezone: string }>("SELECT timezone FROM organizations WHERE id = ?", orgId)?.timezone;
  return todayIn(tz);
}

export function directory(orgId: number): Directory {
  return {
    employees: all("SELECT id, name FROM employees WHERE org_id = ? AND active = 1 ORDER BY name", orgId),
    clients: all("SELECT id, name FROM clients WHERE org_id = ? ORDER BY name", orgId),
    locations: all("SELECT id, name, client_id AS clientId, municipality FROM locations WHERE org_id = ? ORDER BY name", orgId),
  };
}

export function navBadges(orgId: number): Record<string, number> {
  const today = orgToday(orgId);
  const cases = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM coverage_cases c JOIN shifts s ON s.id = c.shift_id
      WHERE c.org_id = ? AND c.status IN ('open','offering') AND s.date >= ?`,
    orgId, today,
  )!.n;
  const incidents = get<{ n: number }>("SELECT COUNT(*) AS n FROM incidents WHERE org_id = ? AND status != 'resuelta'", orgId)!.n;
  return { "/coberturas": cases, "/incidencias": incidents };
}

export function activeCases(orgId: number, fromDate: string): CaseRow[] {
  return all<CaseRow>(
    `${CASE_SELECT} WHERE c.org_id = ? AND c.status IN ('open','offering') AND s.date >= ? ORDER BY s.date, s.start`,
    orgId, fromDate,
  );
}

export function dashboardStats(orgId: number) {
  const today = orgToday(orgId);
  const tomorrow = addDays(today, 1);
  const day = (d: string) =>
    get<{ total: number; uncovered: number }>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'uncovered' THEN 1 ELSE 0 END) AS uncovered
         FROM shifts WHERE org_id = ? AND date = ? AND status != 'cancelled'`,
      orgId, d,
    )!;
  const coverTime = get<{ avg: number | null; n: number }>(
    `SELECT AVG((julianday(resolved_at) - julianday(created_at)) * 1440) AS avg, COUNT(*) AS n
       FROM coverage_cases WHERE org_id = ? AND status = 'covered' AND resolved_at >= datetime('now', '-30 days')
        AND resolved_at > created_at`,
    orgId,
  )!;
  const coveredMonth = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM coverage_cases WHERE org_id = ? AND status = 'covered' AND resolved_at >= datetime('now', '-30 days')",
    orgId,
  )!.n;
  const absentToday = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM absences WHERE org_id = ? AND status = 'active' AND ? BETWEEN start_date AND end_date",
    orgId, today,
  )!.n;
  return { today, tomorrow, todayShifts: day(today), tomorrowShifts: day(tomorrow), coverTime, coveredMonth, absentToday };
}

export function recentActivity(orgId: number, limit = 10, offset = 0) {
  return all<{ id: number; type: string; entity_type: string | null; entity_id: number | null; actor: string | null; summary: string; created_at: string }>(
    "SELECT * FROM activity WHERE org_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
    orgId, limit, offset,
  );
}

export function entityHref(entityType: string | null, entityId: number | null): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "case": return `/coberturas/${entityId}`;
    case "incident": return `/incidencias/${entityId}`;
    case "absence": return `/ausencias/${entityId}`;
    case "employee": return `/personal/${entityId}`;
    case "client": return `/clientes/${entityId}`;
    default: return null;
  }
}
