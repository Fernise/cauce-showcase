// CSV import of employees (Excel "Guardar como CSV" uses ';' in Spain; ',' also accepted).
// Columns (header row required, order free): nombre; telefono; email; zona; horas; cualificaciones; disponibilidad
// disponibilidad examples: "L-V 06:00-15:00", "L-D 06:00-22:00", "L,X,V 14:00-20:00"

import { newReportToken, run, tx } from "./db.ts";
import { logActivity } from "./activity.ts";
import { normalize } from "./parse-message.ts";
import { SKILLS } from "./skills.ts";
import { isValidTime } from "./dates.ts";

const DAY_LETTERS: Record<string, number> = { l: 1, m: 2, x: 3, j: 4, v: 5, s: 6, d: 7 };

export function parseAvailability(spec: string): { weekday: number; start: string; end: string }[] {
  const m = spec.trim().toLowerCase().match(/^([lmxjvsd](?:\s*[-,]\s*[lmxjvsd])*)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  if (!m) return [];
  const days = new Set<number>();
  for (const part of m[1].replace(/\s/g, "").split(",")) {
    const [a, b] = part.split("-");
    const from = DAY_LETTERS[a], to = DAY_LETTERS[b ?? a];
    for (let d = from; d <= to; d++) days.add(d);
  }
  const pad = (t: string) => t.padStart(5, "0");
  const start = pad(m[2]), end = pad(m[3]);
  if (!isValidTime(start) || !isValidTime(end) || end <= start) return [];
  return [...days].map((weekday) => ({ weekday, start, end }));
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === sep && !quoted) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function importEmployeesCsv(orgId: number, text: string, actor: string): { created: number; errors: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { created: 0, errors: ["El CSV necesita una fila de cabecera y al menos una persona."] };
  const sep = lines[0].includes(";") ? ";" : ",";
  const header = splitLine(lines[0], sep).map(normalize);
  const col = (names: string[]) => header.findIndex((h) => names.some((n) => h.startsWith(n)));
  const idx = {
    name: col(["nombre"]), phone: col(["telefono", "movil"]), email: col(["email", "correo"]), zone: col(["zona", "municipio"]),
    hours: col(["horas"]), skills: col(["cualificacion", "habilidad"]), avail: col(["disponibilidad"]),
  };
  if (idx.name < 0) return { created: 0, errors: ["Falta la columna «nombre»."] };

  const errors: string[] = [];
  let created = 0;
  tx(() => {
    lines.slice(1).forEach((line, i) => {
      const cells = splitLine(line, sep);
      const get = (k: number) => (k >= 0 ? cells[k] ?? "" : "");
      const name = get(idx.name);
      if (!name) { errors.push(`Fila ${i + 2}: sin nombre, ignorada.`); return; }
      const rawHours = get(idx.hours).trim();
      const hours = rawHours === "" ? 30 : Number(rawHours.replace(",", "."));
      if (!Number.isFinite(hours) || hours <= 0 || hours > 60) {
        errors.push(`Fila ${i + 2} (${name}): horas «${rawHours}» no válidas (entre 1 y 60); fila ignorada.`);
        return;
      }
      const skills = get(idx.skills).split(/[,|/]/).map((s) => normalize(s)).filter((s) => s in SKILLS);
      const avail = parseAvailability(get(idx.avail) || "L-V 06:00-15:00");
      if (get(idx.avail) && !avail.length) errors.push(`Fila ${i + 2}: disponibilidad «${get(idx.avail)}» no reconocida; se usa L-V 06:00-15:00.`);
      const id = run(
        "INSERT INTO employees (org_id, name, phone, email, zone, weekly_hours, skills, report_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        orgId, name, get(idx.phone) || null, get(idx.email) || null, get(idx.zone) || null, hours, skills.join(","), newReportToken(),
      );
      for (const a of avail.length ? avail : parseAvailability("L-V 06:00-15:00")) {
        run("INSERT INTO availability (employee_id, weekday, start, end) VALUES (?, ?, ?, ?)", id, a.weekday, a.start, a.end);
      }
      created++;
    });
    if (created) logActivity(orgId, "employees.imported", `${created} persona(s) importada(s) desde CSV`, undefined, actor);
  });
  return { created, errors };
}
