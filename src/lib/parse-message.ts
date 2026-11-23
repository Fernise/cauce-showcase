// Deterministic Spanish message understanding (free fallback for the AI layer).
// Turns a pasted WhatsApp/email text into a structured absence or incident draft.

import { addDays, daysBetween, isoWeekday } from "./dates.ts";

export type Directory = {
  employees: { id: number; name: string }[];
  clients: { id: number; name: string }[];
  locations: { id: number; name: string; clientId: number; municipality: string | null }[];
};

export type ReasonCategory = "enfermedad" | "familiar" | "transporte" | "personal" | "otro";
export type IncidentType = "no_realizado" | "retraso" | "calidad" | "suministros" | "cambio_servicio" | "falta_personal" | "otro";
export type Severity = "baja" | "media" | "alta";

export type ParsedMessage = {
  kind: "absence" | "incident" | "unknown";
  engine: "reglas" | "claude";
  employeeId: number | null;
  employeeCandidates: number[]; // when ambiguous
  startDate: string;
  endDate: string;
  dateExplicit: boolean;
  reason: string | null;
  reasonCategory: ReasonCategory;
  clientId: number | null;
  locationId: number | null;
  incidentType: IncidentType | null;
  severity: Severity;
  title: string | null;
  warnings: string[];
};

export const REASON_LABELS: Record<ReasonCategory, string> = {
  enfermedad: "Enfermedad",
  familiar: "Motivo familiar",
  transporte: "Transporte",
  personal: "Asunto personal",
  otro: "Otro",
};

export const INCIDENT_LABELS: Record<IncidentType, string> = {
  no_realizado: "Servicio no realizado",
  retraso: "Retraso",
  calidad: "Calidad de la limpieza",
  suministros: "Material / suministros",
  cambio_servicio: "Cambio de servicio",
  falta_personal: "Falta de personal",
  otro: "Otro",
};

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ/\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ABSENCE_CUES = [
  "no puedo ir", "no voy a poder", "no podre", "no voy a ir", "no ire", "no puedo trabajar", "no voy", "no puedo acudir",
  "baja", "enferm", "fiebre", "medico", "urgencias", "malisima", "malisimo", "me encuentro mal", "estoy mala", "estoy malo",
  "falto", "faltar", "ausencia", "no llego", "no podre ir", "gripe", "vomit", "hospital",
];
const INCIDENT_CUES = [
  "queja", "reclam", "no ha venido", "no vino", "no han venido", "nadie", "sucio", "sucia", "mal limpi", "no han limpiado",
  "no se ha limpiado", "papel", "jabon", "falta material", "sin material", "llego tarde", "ha llegado tarde", "tarde",
  "cambio", "cambiar el servicio", "adelantar", "atrasar", "polvo", "manchas", "basura", "no estaba limpio", "insatisf",
  "producto", "suministro", "nos falta", "otra vez",
];

const REASON_CUES: [ReasonCategory, string[]][] = [
  ["enfermedad", ["fiebre", "enferm", "medico", "gripe", "vomit", "mala", "malo", "dolor", "urgencias", "hospital", "baja", "covid", "migrana", "operacion"]],
  ["familiar", ["nino", "nina", "hijo", "hija", "peque", "madre", "padre", "abuela", "abuelo", "familia", "marido", "mujer", "colegio", "guarderia"]],
  ["transporte", ["coche", "guagua", "averia", "rueda", "trafico", "atasco", "transporte", "taxi"]],
  ["personal", ["asunto personal", "cita", "juzgado", "notaria", "papeles", "tramite", "mudanza"]],
];

const INCIDENT_TYPE_CUES: [IncidentType, string[]][] = [
  ["no_realizado", ["no ha venido", "no vino", "no han venido", "nadie", "no se ha hecho", "no han limpiado", "no se ha limpiado", "sin hacer"]],
  ["retraso", ["tarde", "retraso", "no ha llegado todavia", "aun no ha llegado"]],
  ["suministros", ["papel", "jabon", "material", "producto", "suministro", "bolsas", "gel"]],
  ["cambio_servicio", ["cambio", "cambiar", "adelantar", "atrasar", "mover el servicio", "otro dia", "anular", "cancelar"]],
  ["falta_personal", ["falta personal", "falta gente", "solo vino una", "solo ha venido"]],
  ["calidad", ["sucio", "sucia", "mal limpi", "polvo", "manchas", "basura", "no estaba limpio", "insatisf", "queja", "dejado"]],
];

const WEEKDAY_WORDS: Record<string, number> = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 };
const NUMBER_WORDS: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7 };
const STOP_NAMES = new Set(["de", "del", "la", "las", "los", "el", "y"]);

const countCues = (text: string, cues: string[]) => cues.filter((c) => text.includes(c)).length;

// Someone (usually the client) reporting that a worker didn't show up: an incident, not a self-reported absence.
const THIRD_PARTY_CUES = [
  "no ha venido", "no vino", "no han venido", "nos dijo", "nos ha dicho", "les escribo", "os escribo", "vuestra", "vuestro",
  "su empleada", "su empleado", "la chica", "el chico", "la limpiadora", "la senora de la limpieza", "nadie",
];

// Words that identify who is writing ("soy Nayra", "me llamo…", a short signature line) and who is
// being greeted ("Hola Yurena, …" — the coordinator, not the absent person).
function speakerHints(raw: string): { self: Set<string>; addressee: Set<string> } {
  const words = (s: string) => normalize(s).split(" ").filter((w) => w.length > 2);
  const self = new Set<string>();
  const addressee = new Set<string>();
  for (const m of raw.matchAll(/\b(?:soy|me llamo|te habla|le habla|aqu[ií])\s+([^,.;:!?\n]+)/gi)) {
    words(m[1]).slice(0, 3).forEach((w) => self.add(w));
  }
  const lines = raw.trim().split(/\n+/);
  const last = lines[lines.length - 1].trim();
  const sig = last.match(/(?:^|[.!?]\s*)([A-ZÁÉÍÓÚÑ][\p{L}]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}]+){0,2})\.?$/u);
  if (sig && sig[1].split(/\s+/).length <= 3) words(sig[1]).forEach((w) => self.add(w));
  const greet = raw.match(/^\s*(?:hola|buenas(?:\s+(?:tardes|noches))?|buenos\s+d[ií]as|buen\s+d[ií]a|querida|querido)\s+([^,.;:!?\n]+)[,.;:!?\n]/i);
  if (greet) words(greet[1]).slice(0, 3).forEach((w) => addressee.add(w));
  return { self, addressee };
}

function matchEmployee(text: string, employees: Directory["employees"], raw = text): { id: number | null; candidates: number[] } {
  const hints = speakerHints(raw);
  if (hints.self.size) {
    const bySelf = matchEmployee([...hints.self].join(" "), employees, "");
    if (bySelf.id || bySelf.candidates.length) return bySelf;
  }
  const words = new Set(text.split(" ").filter((w) => !hints.addressee.has(w)));
  const scored = employees
    .map((e) => {
      const parts = normalize(e.name).split(" ").filter((p) => p.length > 2 && !STOP_NAMES.has(p));
      const hits = parts.filter((p) => words.has(p));
      // first name + surname is a strong match; a lone surname or first name is weak
      return { id: e.id, hits: hits.length, first: words.has(parts[0]) };
    })
    .filter((s) => s.hits > 0);
  if (!scored.length) return { id: null, candidates: [] as number[] };
  const best = Math.max(...scored.map((s) => s.hits));
  const top = scored.filter((s) => s.hits === best);
  if (top.length === 1 && (best >= 2 || top[0].first)) return { id: top[0].id, candidates: [] };
  return { id: null, candidates: top.map((t) => t.id) };
}

function matchLocation(text: string, dir: Directory) {
  const score = (name: string) => {
    const parts = normalize(name).split(" ").filter((p) => p.length > 3 && !STOP_NAMES.has(p));
    return parts.filter((p) => text.includes(p)).length / Math.max(1, parts.length);
  };
  const locs = dir.locations.map((l) => ({ l, s: score(l.name) })).sort((a, b) => b.s - a.s);
  const clients = dir.clients.map((c) => ({ c, s: score(c.name) })).sort((a, b) => b.s - a.s);
  const loc = locs[0] && locs[0].s >= 0.5 && (!locs[1] || locs[1].s < locs[0].s) ? locs[0].l : null;
  const client = loc ? dir.clients.find((c) => c.id === loc.clientId) ?? null : clients[0] && clients[0].s >= 0.5 ? clients[0].c : null;
  // A client with a single location implies that location.
  const onlyLocation = !loc && client ? dir.locations.filter((l) => l.clientId === client.id) : [];
  return { clientId: client?.id ?? null, locationId: loc?.id ?? (onlyLocation.length === 1 ? onlyLocation[0].id : null) };
}

/** A dd/mm date more than ~2 months in the past most likely means next year (said in late December). */
function rollYear(date: string, today: string): string {
  return daysBetween(today, date) < -60 ? `${+date.slice(0, 4) + 1}${date.slice(4)}` : date;
}

export function parseDates(text: string, today: string): { start: string; end: string; explicit: boolean } {
  const year = today.slice(0, 4);
  const pad = (n: number) => String(n).padStart(2, "0");

  // "del 3 al 5", "desde el 3 hasta el 5"
  const range = text.match(/(?:del|desde el|desde)\s+(\d{1,2})(?:\/(\d{1,2}))?\s+(?:al|hasta el|hasta)\s+(\d{1,2})(?:\/(\d{1,2}))?/);
  if (range) {
    const month = range[4] ?? range[2] ?? today.slice(5, 7);
    const startMonth = range[2] ?? month;
    const start = rollYear(`${year}-${pad(+startMonth)}-${pad(+range[1])}`, today);
    let end = `${start.slice(0, 4)}-${pad(+month)}-${pad(+range[3])}`;
    if (end < start) end = `${+start.slice(0, 4) + 1}${end.slice(4)}`; // "del 30/12 al 2/1"
    return { start, end, explicit: true };
  }
  // dd/mm
  const dm = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);

  let start: string | null = null;
  // "mañana" as a day vs. "por la mañana" / "esta mañana" as a time of day.
  const dayText = text.replace(/\b(?:esta|por la|de la|a la|en la|toda la) manana\b/g, " ");
  if (text.includes("pasado manana")) start = addDays(today, 2);
  else if (/\bmanana\b/.test(dayText)) start = addDays(today, 1);
  else if (/\bhoy\b|\besta manana\b|\besta tarde\b|\bahora\b/.test(text)) start = today;
  else if (dm) start = rollYear(`${year}-${pad(+dm[2])}-${pad(+dm[1])}`, today);
  else {
    for (const [w, n] of Object.entries(WEEKDAY_WORDS)) {
      if (new RegExp(`\\b${w}\\b`).test(text)) {
        const diff = (n - isoWeekday(today) + 7) % 7;
        start = addDays(today, diff === 0 ? 7 : diff);
        break;
      }
    }
  }

  let end = start;
  const nDays = text.match(/\b(\d|un|uno|una|dos|tres|cuatro|cinco|seis|siete)\s+dias\b/);
  if (/toda la semana|resto de la semana|esta semana/.test(text)) {
    start ??= today;
    end = addDays(start, 7 - isoWeekday(start));
  } else if (nDays) {
    const n = NUMBER_WORDS[nDays[1]] ?? Number(nDays[1]);
    start ??= today;
    end = addDays(start, Math.max(0, n - 1));
  }

  if (!start) return { start: today, end: today, explicit: false };
  return { start, end: end ?? start, explicit: true };
}

function firstSentenceWith(raw: string, cues: string[]): string | null {
  const sentences = raw.split(/(?<=[.!?\n])\s+/).map((s) => s.trim()).filter(Boolean);
  const hit = sentences.find((s) => cues.some((c) => normalize(s).includes(c)));
  return hit ?? null;
}

export function parseMessageRules(raw: string, dir: Directory, today: string): ParsedMessage {
  const text = normalize(raw);
  const warnings: string[] = [];

  const absenceScore = countCues(text, ABSENCE_CUES);
  const incidentScore = countCues(text, INCIDENT_CUES);
  const thirdParty = countCues(text, THIRD_PARTY_CUES) > 0 && !/\b(soy|me llamo)\b/.test(text);
  const kind = absenceScore === 0 && incidentScore === 0 ? "unknown" : thirdParty || incidentScore > absenceScore ? "incident" : "absence";
  if (absenceScore > 0 && incidentScore > 0) warnings.push("El mensaje mezcla señales de ausencia e incidencia: revisa el tipo.");
  if (thirdParty && absenceScore > 0) warnings.push("Parece un cliente avisando de que alguien no ha ido: si hace falta, registra también la ausencia.");

  const emp = matchEmployee(text, dir.employees, raw);
  const dates = parseDates(text, today);
  const loc = matchLocation(text, dir);

  let reasonCategory: ReasonCategory = "otro";
  for (const [cat, cues] of REASON_CUES) if (countCues(text, cues) > 0) { reasonCategory = cat; break; }

  let incidentType: IncidentType | null = null;
  if (kind === "incident") {
    incidentType = "otro";
    for (const [t, cues] of INCIDENT_TYPE_CUES) if (countCues(text, cues) > 0) { incidentType = t; break; }
  }

  const severity: Severity =
    /urgente|inmediat|ya mismo|muy mal|inaceptable|otra vez|de nuevo|ultima vez/.test(text) || incidentType === "no_realizado"
      ? "alta"
      : incidentType === "suministros" ? "baja" : "media";

  if (kind === "unknown") warnings.push("No está claro si es una ausencia o una incidencia.");
  if (kind === "absence") {
    if (emp.candidates.length > 1) warnings.push("Hay varias personas con ese nombre: elige la correcta.");
    else if (!emp.id) warnings.push("No se ha identificado a la persona: selecciónala.");
    if (!dates.explicit) warnings.push("El mensaje no indica fecha: se asume hoy.");
    if (reasonCategory === "otro") warnings.push("No se indica el motivo.");
  }
  if (kind === "incident") {
    if (!loc.clientId) warnings.push("No se ha identificado el cliente o centro.");
    else if (!loc.locationId) warnings.push("El cliente tiene varios centros: indica cuál.");
  }

  const reason = kind === "absence" ? firstSentenceWith(raw, REASON_CUES.flatMap(([, c]) => c)) : null;
  const title =
    kind === "incident"
      ? (firstSentenceWith(raw, INCIDENT_CUES) ?? raw.trim().split("\n")[0]).slice(0, 120)
      : null;

  return {
    kind,
    engine: "reglas",
    employeeId: emp.id,
    employeeCandidates: emp.candidates,
    startDate: dates.start,
    endDate: dates.end,
    dateExplicit: dates.explicit,
    reason,
    reasonCategory,
    clientId: loc.clientId,
    locationId: loc.locationId,
    incidentType,
    severity,
    title,
    warnings,
  };
}
