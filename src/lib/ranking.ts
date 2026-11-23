// Deterministic, explainable replacement ranking. Pure: no DB access.
// Business rules: docs/product-spec.md § "Business rules — replacement ranking".

import { hoursBetween, isoWeekday, toMinutes } from "./dates.ts";
import { roadKm, type Point } from "./geo.ts";
import { skillLabel } from "./skills.ts";

export type TargetShift = {
  id: number;
  date: string;
  start: string;
  end: string;
  locationId: number;
  locationName: string;
  point: Point | null;
  requiredSkills: string[];
};

export type CandidateShift = {
  id: number;
  date: string;
  start: string;
  end: string;
  locationId: number;
  locationName: string;
  point: Point | null;
};

export type Candidate = {
  id: number;
  name: string;
  active: boolean;
  home: Point | null;
  zone: string | null;
  weeklyHours: number; // contracted
  skills: string[];
  availability: { weekday: number; start: string; end: string }[];
  absentDates: string[]; // dates with an active absence (only needs to cover target date)
  weekShifts: CandidateShift[]; // all shifts this ISO week (any status except cancelled)
  visitsToLocation60d: number;
  substitutionsLast30d: number;
};

export type RankingSettings = {
  travelBufferMin: number;
  maxWeeklyHours: number;
};

export type Reason = { kind: "pro" | "con" | "info"; text: string };

export type RankedCandidate = {
  employeeId: number;
  name: string;
  score: number; // 0..100
  factors: { proximity: number; hours: number; familiarity: number; fairness: number; fit: number };
  reasons: Reason[];
  distanceKm: number | null;
  weekHoursAfter: number;
  overtimeHours: number;
};

export type ExcludedCandidate = { employeeId: number; name: string; reason: string };

export type RankingResult = { ranked: RankedCandidate[]; excluded: ExcludedCandidate[] };

/** Island driving estimate: 45 km/h average + 5 min parking. */
export function travelMinutes(km: number): number {
  return Math.round((km / 45) * 60 + 5);
}

export const WEIGHTS = { proximity: 35, hours: 25, familiarity: 20, fairness: 10, fit: 10 };

const fmtH = (h: number) => (Number.isInteger(h) ? `${h}` : h.toFixed(1).replace(".", ",")) + " h";
const fmtKm = (km: number) => (km < 10 ? km.toFixed(1).replace(".", ",") : Math.round(km).toString()) + " km";

export function rankCandidates(
  target: TargetShift,
  candidates: Candidate[],
  settings: RankingSettings,
  excludeEmployeeIds: number[] = [],
): RankingResult {
  const ranked: RankedCandidate[] = [];
  const excluded: ExcludedCandidate[] = [];
  const tStart = toMinutes(target.start);
  const tEnd = toMinutes(target.end);
  const shiftHours = hoursBetween(target.start, target.end);
  const weekday = isoWeekday(target.date);

  for (const c of candidates) {
    if (excludeEmployeeIds.includes(c.id)) continue;
    const exclude = (reason: string) => excluded.push({ employeeId: c.id, name: c.name, reason });

    if (!c.active) { exclude("Inactiva/o"); continue; }
    if (c.absentDates.includes(target.date)) { exclude("Ausente ese día"); continue; }

    const missing = target.requiredSkills.filter((s) => !c.skills.includes(s));
    if (missing.length) { exclude(`Sin cualificación: ${missing.map(skillLabel).join(", ")}`); continue; }

    const window = c.availability.find(
      (a) => a.weekday === weekday && toMinutes(a.start) <= tStart && toMinutes(a.end) >= tEnd,
    );
    if (!window) { exclude(`Fuera de su disponibilidad del ${["lunes","martes","miércoles","jueves","viernes","sábado","domingo"][weekday - 1]}`); continue; }

    const sameDay = c.weekShifts.filter((s) => s.date === target.date && s.id !== target.id);
    const clash = sameDay.find(
      (s) => toMinutes(s.start) < tEnd + settings.travelBufferMin && toMinutes(s.end) + settings.travelBufferMin > tStart,
    );
    if (clash) { exclude(`Coincide con ${clash.locationName} ${clash.start}–${clash.end}`); continue; }

    const weekHoursBefore = c.weekShifts.filter((s) => s.id !== target.id).reduce((h, s) => h + hoursBetween(s.start, s.end), 0);
    const weekHoursAfter = weekHoursBefore + shiftHours;
    if (weekHoursAfter > settings.maxWeeklyHours) {
      exclude(`Superaría el máximo de ${fmtH(settings.maxWeeklyHours)} semanales (${fmtH(weekHoursAfter)})`);
      continue;
    }

    // Travel feasibility between consecutive services (buffer alone is not enough on an island).
    const prev = sameDay.filter((s) => toMinutes(s.end) <= tStart).sort((a, b) => toMinutes(b.end) - toMinutes(a.end))[0];
    const next = sameDay.filter((s) => toMinutes(s.start) >= tEnd).sort((a, b) => toMinutes(a.start) - toMinutes(b.start))[0];
    if (target.point && prev?.point && travelMinutes(roadKm(prev.point, target.point)) > tStart - toMinutes(prev.end)) {
      exclude(`No llega a tiempo desde ${prev.locationName} (termina a las ${prev.end}, ≈${travelMinutes(roadKm(prev.point, target.point))} min de trayecto)`);
      continue;
    }
    if (target.point && next?.point && travelMinutes(roadKm(target.point, next.point)) > toMinutes(next.start) - tEnd) {
      exclude(`No llegaría a ${next.locationName} a las ${next.start} (≈${travelMinutes(roadKm(target.point, next.point))} min de trayecto)`);
      continue;
    }

    const reasons: Reason[] = [];

    // Proximity: nearest of home, previous shift end location, next shift start location.
    let distance: number | null = null;
    let from = "";
    if (target.point) {
      const options: { km: number; from: string }[] = [];
      if (c.home) options.push({ km: roadKm(c.home, target.point), from: `desde su zona (${c.zone ?? "domicilio"})` });
      const here = (s: CandidateShift) => s.locationId === target.locationId;
      if (prev?.point) options.push({ km: here(prev) ? 0 : roadKm(prev.point, target.point), from: here(prev) ? `ya está en ${prev.locationName} hasta las ${prev.end}` : `desde ${prev.locationName}, donde termina a las ${prev.end}` });
      if (next?.point) options.push({ km: here(next) ? 0 : roadKm(target.point, next.point), from: here(next) ? `entra en ${next.locationName} a las ${next.start}` : `hasta ${next.locationName}, donde empieza a las ${next.start}` });
      const best = options.sort((a, b) => a.km - b.km)[0];
      if (best) { distance = best.km; from = best.from; }
    }
    const proximity = distance === null ? 0.5 : Math.max(0, 1 - distance / 40);
    if (distance !== null) {
      reasons.push({
        kind: distance <= 10 ? "pro" : distance > 25 ? "con" : "info",
        text: distance === 0 ? `Mismo centro: ${from}` : `A ${fmtKm(distance)} ${from}`,
      });
    }

    // Hours: prefer filling contracted hours, penalise overtime.
    const spare = c.weeklyHours - weekHoursBefore;
    const overtime = Math.max(0, weekHoursAfter - c.weeklyHours);
    let hours: number;
    if (overtime === 0) {
      hours = 1;
      reasons.push({ kind: "pro", text: `Le quedan ${fmtH(spare)} de contrato esta semana (pasaría a ${fmtH(weekHoursAfter)} de ${fmtH(c.weeklyHours)})` });
    } else {
      hours = Math.max(0, 1 - overtime / 8);
      reasons.push({ kind: "con", text: `Horas extra: pasaría a ${fmtH(weekHoursAfter)} con contrato de ${fmtH(c.weeklyHours)} (+${fmtH(overtime)})` });
    }

    // Familiarity with the site.
    const familiarity = c.visitsToLocation60d > 0 ? Math.min(1, 0.6 + c.visitsToLocation60d * 0.1) : 0;
    reasons.push(
      c.visitsToLocation60d > 0
        ? { kind: "pro", text: `Conoce ${target.locationName} (${c.visitsToLocation60d} servicios en 60 días)` }
        : { kind: "con", text: `No conoce ${target.locationName}: conviene enviarle las instrucciones de acceso` },
    );

    // Fairness: spread substitutions across the team.
    const fairness = [1, 0.6, 0.3][c.substitutionsLast30d] ?? 0;
    if (c.substitutionsLast30d >= 2) reasons.push({ kind: "con", text: `Ya ha cubierto ${c.substitutionsLast30d} sustituciones este mes` });

    // Fit with the rest of the day.
    let fit = 0.6;
    const gaps = [prev ? tStart - toMinutes(prev.end) : null, next ? toMinutes(next.start) - tEnd : null].filter(
      (g): g is number => g !== null,
    );
    if (gaps.length) {
      const minGap = Math.min(...gaps);
      fit = minGap <= 90 ? 1 : minGap <= 180 ? 0.7 : 0.4;
      if (minGap <= 90) reasons.push({ kind: "pro", text: "Encaja con su jornada sin huecos largos" });
      else if (minGap > 180) reasons.push({ kind: "info", text: `Le quedaría un hueco de ${fmtH(Math.round(minGap / 6) / 10)} en su jornada` });
    } else {
      reasons.push({ kind: "info", text: "No tiene otros servicios ese día (desplazamiento solo para este)" });
    }

    const factors = { proximity, hours, familiarity, fairness, fit };
    const score = Math.round(
      factors.proximity * WEIGHTS.proximity +
        factors.hours * WEIGHTS.hours +
        factors.familiarity * WEIGHTS.familiarity +
        factors.fairness * WEIGHTS.fairness +
        factors.fit * WEIGHTS.fit,
    );

    ranked.push({ employeeId: c.id, name: c.name, score, factors, reasons, distanceKm: distance, weekHoursAfter, overtimeHours: overtime });
  }

  ranked.sort((a, b) => b.score - a.score || (a.distanceKm ?? 99) - (b.distanceKm ?? 99) || a.name.localeCompare(b.name));
  excluded.sort((a, b) => a.name.localeCompare(b.name));
  return { ranked, excluded };
}

/** One-line summary of the main trade-off between the top two candidates. */
export function tradeoffSummary(ranked: RankedCandidate[]): string | null {
  if (ranked.length < 2) return null;
  const [a, b] = ranked;
  if (a.overtimeHours > 0 && b.overtimeHours === 0) {
    return `${a.name} es la opción más práctica, pero genera ${fmtH(a.overtimeHours)} extra; ${b.name} no genera horas extra.`;
  }
  if (a.factors.familiarity === 0 && b.factors.familiarity > 0) {
    const closer = a.distanceKm !== null && b.distanceKm !== null && a.distanceKm < b.distanceKm;
    return closer
      ? `${a.name} está más cerca, pero no conoce el centro; ${b.name} sí lo conoce.`
      : `${a.name} no conoce el centro, pero encaja mejor en horas y jornada; ${b.name} sí lo conoce.`;
  }
  if (a.distanceKm !== null && b.distanceKm !== null && b.distanceKm < a.distanceKm) {
    return `${b.name} está más cerca, pero ${a.name} encaja mejor con sus horas y el centro.`;
  }
  return null;
}
