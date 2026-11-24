// Dates are plain "YYYY-MM-DD" strings and times "HH:MM" (org-local wall clock).

export const DEFAULT_TZ = "Atlantic/Canary";

export function todayIn(tz = DEFAULT_TZ, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function nowTimeIn(tz = DEFAULT_TZ, now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

/** Strict calendar date "YYYY-MM-DD" (rejects 2026-02-30). */
export function isValidDate(date: unknown): date is string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Strict "HH:MM" between 00:00 and 23:59. */
export function isValidTime(time: unknown): time is string {
  return typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

function toUtc(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** ISO weekday: 1 = Monday … 7 = Sunday */
export function isoWeekday(date: string): number {
  const w = toUtc(date).getUTCDay();
  return w === 0 ? 7 : w;
}

export function startOfWeek(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function hoursBetween(start: string, end: string): number {
  return (toMinutes(end) - toMinutes(start)) / 60;
}

const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const WEEKDAYS_SHORT = ["L", "M", "X", "J", "V", "S", "D"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function weekdayName(isoDay: number): string {
  return WEEKDAYS[isoDay - 1];
}

export function weekdayShort(isoDay: number): string {
  return WEEKDAYS_SHORT[isoDay - 1];
}

/** "mar 24 nov" */
export function formatDateShort(date: string): string {
  const d = toUtc(date);
  return `${WEEKDAYS[isoWeekday(date) - 1].slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "23 de noviembre" */
export function formatDateLong(date: string): string {
  const d = toUtc(date);
  return `${d.getUTCDate()} de ${MONTHS_LONG[d.getUTCMonth()]}`;
}

/** "hoy", "mañana", "ayer" or "mar 24 nov" */
export function formatDateRelative(date: string, today: string): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "hoy";
  if (diff === 1) return "mañana";
  if (diff === -1) return "ayer";
  return formatDateShort(date);
}

export function formatRange(start: string, end: string, today: string): string {
  if (start === end) return formatDateRelative(start, today);
  return `${formatDateRelative(start, today)} → ${formatDateRelative(end, today)}`;
}

/** SQLite datetime('now') is UTC "YYYY-MM-DD HH:MM:SS" → org-local "HH:MM" / relative label. */
export function formatTimestamp(ts: string, tz: string, now = new Date()): string {
  const d = new Date(ts.replace(" ", "T") + "Z");
  const day = todayIn(tz, d);
  const time = nowTimeIn(tz, d);
  const today = todayIn(tz, now);
  if (day === today) return time;
  return `${formatDateRelative(day, today)} ${time}`;
}
