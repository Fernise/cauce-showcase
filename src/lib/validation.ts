// Shared form-parsing helpers for the admin (create/edit) screens. Pure: no DB, safe to import from client code.

export class ValidationError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(errors.join(" "));
    this.name = "ValidationError";
    this.errors = errors;
  }
}

export class NotFoundError extends Error {
  constructor(what = "El registro") {
    super(`${what} no existe o no pertenece a tu empresa.`);
    this.name = "NotFoundError";
  }
}

export const MAX_WEEKLY_HOURS = 60;

/** Structural subset of FormData, so parsers can be tested without a browser. */
export type Raw = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] };

/** Form values echoed back to the form after a validation error. */
export type FormValues = Record<string, string | string[]>;
/** `n` counts submissions so forms can remount controlled fields from the echoed values. */
export type FormState = { errors: string[]; values: FormValues; n?: number } | null;

export function rawValues(fd: Raw & { entries(): IterableIterator<[string, FormDataEntryValue]> }): FormValues {
  const out: FormValues = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string" || k.startsWith("$ACTION")) continue;
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

export const text = (raw: Raw, k: string): string => String(raw.get(k) ?? "").trim();
export const textOrNull = (raw: Raw, k: string): string | null => text(raw, k) || null;

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = (s: string): boolean => TIME_RE.test(s);

export function validPhone(s: string): boolean {
  return /^\+?[\d\s().-]+$/.test(s) && s.replace(/\D/g, "").length >= 9 && s.replace(/\D/g, "").length <= 15;
}

export function validEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 160;
}

export function checkLength(errors: string[], label: string, value: string | null, max: number): void {
  if (value && value.length > max) errors.push(`${label}: máximo ${max} caracteres.`);
}

/** Positive integer id from a form field; null when missing or not a positive integer. */
export function idField(raw: Raw, k: string): number | null {
  const s = text(raw, k);
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** Fail with all collected errors at once. */
export function failIf(errors: string[]): void {
  if (errors.length) throw new ValidationError(errors);
}
