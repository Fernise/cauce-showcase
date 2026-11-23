// Demo dataset: "Limpiezas Atlántico S.L." (Tenerife). Dates are relative to today.
// Usage: npm run demo:reset   (deletes and recreates the SQLite file)

import { db, dbPath, SCHEMA, all, get, run, tx } from "../src/lib/db.ts";

// Drop and recreate tables in place (keeps the file, so a running server sees the new data).
const path = dbPath();
const conn = db();
conn.exec("PRAGMA foreign_keys = OFF;");
for (const { name } of all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")) {
  conn.exec(`DROP TABLE IF EXISTS "${name}"`);
}
conn.exec(SCHEMA);
const { hashPassword } = await import("../src/lib/auth.ts");
const { formatDateShort, addDays, hoursBetween, isoWeekday, startOfWeek, todayIn, toMinutes } = await import("../src/lib/dates.ts");
const { distanceKm } = await import("../src/lib/geo.ts");
const { registerAbsence, rankForShift } = await import("../src/lib/coverage.ts");

const TODAY = todayIn();
const ZONES: Record<string, [number, number]> = {
  "Santa Cruz": [28.4636, -16.2518],
  "La Laguna": [28.4874, -16.3159],
  Taco: [28.4445, -16.3005],
  Tacoronte: [28.4772, -16.4103],
  "La Orotava": [28.3906, -16.5232],
  "Puerto de la Cruz": [28.4141, -16.5484],
  "Los Realejos": [28.3843, -16.5826],
  Candelaria: [28.3547, -16.3714],
  Güímar: [28.3154, -16.4101],
  Adeje: [28.1227, -16.7260],
  "Los Cristianos": [28.0510, -16.7166],
  "San Isidro": [28.0775, -16.5574],
};

const jitter = (n: number, i: number) => n + (((i * 7919) % 100) - 50) / 5000;

// ---------- Organization & users ----------
const orgId = run("INSERT INTO organizations (name) VALUES (?)", "Limpiezas Atlántico S.L.");
const carmenId = run("INSERT INTO users (org_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'owner')", orgId, "Carmen Morales", "demo@cauce.app", hashPassword("demo1234"));
run("INSERT INTO users (org_id, name, email, password_hash) VALUES (?, ?, ?, ?)", orgId, "Jonay Pérez", "jonay@cauce.app", hashPassword("demo1234"));

// ---------- Employees ----------
type Profile = "manana" | "tarde" | "partida" | "flexible";
const EMPLOYEES: [string, string, number, string, Profile][] = [
  // name, zone, weekly hours, skills, availability profile
  ["Yurena Díaz Hernández", "Santa Cruz", 40, "llaves", "flexible"],
  ["Nayra González Pérez", "Santa Cruz", 25, "", "manana"],
  ["Acerina Rodríguez Afonso", "La Laguna", 30, "sanitario", "flexible"],
  ["Dácil Martín Cabrera", "Santa Cruz", 20, "cristales", "flexible"],
  ["Cathaysa Hernández Luis", "Taco", 30, "", "partida"],
  ["Idaira Pérez Rodríguez", "La Laguna", 40, "maquinaria,sanitario", "partida"],
  ["Tamara Delgado Expósito", "Santa Cruz", 25, "llaves", "tarde"],
  ["María José García Toledo", "La Laguna", 30, "sanitario,llaves", "manana"],
  ["Ruth Medina Febles", "Tacoronte", 20, "cocina", "flexible"],
  ["Gara Suárez Mesa", "Candelaria", 30, "industrial,maquinaria", "partida"],
  ["Yaiza Morales Díaz", "Güímar", 40, "industrial,altura,maquinaria", "partida"],
  ["Elena Rodríguez Bethencourt", "La Orotava", 30, "", "flexible"],
  ["Laura Hernández Alonso", "Puerto de la Cruz", 25, "cocina", "flexible"],
  ["Cristina Afonso Ramos", "Los Realejos", 30, "", "tarde"],
  ["Rosa Delia Padilla", "La Orotava", 20, "sanitario", "manana"],
  ["Mercedes Luis Trujillo", "Puerto de la Cruz", 30, "cristales,altura", "partida"],
  ["Jonathan Barrios Pérez", "Santa Cruz", 40, "cristales,altura,maquinaria", "partida"],
  ["Airam Castro Hernández", "La Laguna", 30, "industrial,maquinaria", "tarde"],
  ["Echedey Marrero Díaz", "Candelaria", 40, "industrial,altura,maquinaria", "flexible"],
  ["Beatriz Santana Cruz", "Adeje", 30, "", "flexible"],
  ["Yanira Torres Rodríguez", "Adeje", 25, "sanitario", "flexible"],
  ["Sonia García Herrera", "Los Cristianos", 30, "maquinaria", "flexible"],
  ["Noelia Febles Martín", "Los Cristianos", 20, "cocina", "flexible"],
  ["Raquel Dorta González", "San Isidro", 30, "maquinaria", "flexible"],
  ["Fátima Benítez Reyes", "Adeje", 40, "", "flexible"],
  ["Patricia Expósito León", "Los Cristianos", 25, "cristales", "flexible"],
  ["Vanesa Mendoza Rivero", "San Isidro", 30, "sanitario", "flexible"],
  ["Olga Ramos Quintero", "Santa Cruz", 20, "", "flexible"],
  ["Desirée Alonso Plasencia", "La Laguna", 25, "sanitario", "flexible"],
  ["Haridian Cabrera Gil", "Taco", 30, "llaves", "partida"],
  ["Antonia Mesa Rodríguez", "Tacoronte", 30, "cocina", "flexible"],
  ["Inmaculada Perdomo Sosa", "La Orotava", 25, "", "tarde"],
  ["Tania Quintero Báez", "Güímar", 20, "", "flexible"],
  ["Mónica Reyes Acosta", "Santa Cruz", 30, "sanitario", "flexible"],
  ["Lidia Sosa Hernández", "La Laguna", 20, "cristales", "manana"],
];

const PROFILES: Record<Profile, { days: number[]; start: string; end: string }> = {
  manana: { days: [1, 2, 3, 4, 5], start: "06:00", end: "15:00" },
  tarde: { days: [1, 2, 3, 4, 5], start: "13:00", end: "22:00" },
  partida: { days: [1, 2, 3, 4, 5], start: "06:00", end: "21:00" },
  flexible: { days: [1, 2, 3, 4, 5, 6, 7], start: "06:00", end: "22:00" },
};

type Emp = { id: number; name: string; zone: string; lat: number; lng: number; hours: number; skills: string[]; profile: Profile; load: number; slots: { day: number; s: number; e: number }[] };
const emps: Emp[] = EMPLOYEES.map(([name, zone, hours, skills, profile], i) => {
  const [lat, lng] = ZONES[zone];
  const phone = `6${String(10000000 + ((i * 7654321) % 89999999)).padStart(8, "0")}`;
  const email = name.split(" ")[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") + `.${i + 1}@ejemplo.es`;
  const id = run(
    "INSERT INTO employees (org_id, name, phone, email, zone, lat, lng, weekly_hours, skills) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    orgId, name, phone, email, zone, jitter(lat, i), jitter(lng, i + 3), hours, skills,
  );
  const p = PROFILES[profile];
  for (const d of p.days) run("INSERT INTO availability (employee_id, weekday, start, end) VALUES (?, ?, ?, ?)", id, d, p.start, p.end);
  return { id, name, zone, lat: jitter(lat, i), lng: jitter(lng, i + 3), hours, skills: skills ? skills.split(",") : [], profile, load: 0, slots: [] };
});

// ---------- Clients & locations ----------
const CLIENTS: { name: string; contact: string; phone: string; locations: [string, string, string, string, string?][] }[] = [
  // locations: name, zone, address, required skills, access notes
  { name: "Hotel Mencey Plaza", contact: "Sergio Ávila (gobernanta: Pilar)", phone: "922000101", locations: [["Hotel Mencey Plaza", "Santa Cruz", "C/ Dr. José Naveiras 38", "", "Entrada por personal, C/ Méndez Núñez. Preguntar por Pilar."]] },
  { name: "Clínicas Dentales Sonríe", contact: "Dra. Laura Febles", phone: "922000202", locations: [
    ["Sonríe Santa Cruz", "Santa Cruz", "Rambla de Santa Cruz 112", "sanitario", "Código alarma en el sobre de llaves."],
    ["Sonríe La Laguna", "La Laguna", "C/ Heraclio Sánchez 40", "sanitario"],
    ["Sonríe Adeje", "Adeje", "Av. de los Pueblos 5", "sanitario"],
  ] },
  { name: "Atlántida Seguros", contact: "Rubén Hernández", phone: "922000303", locations: [
    ["Atlántida Seguros – Sede Rambla", "Santa Cruz", "Rambla de Pulido 60, 3ª planta", "llaves", "Llave en conserjería. Desconectar alarma (código en app)."],
    ["Atlántida Seguros – Oficina La Laguna", "La Laguna", "C/ Obispo Rey Redondo 18", ""],
  ] },
  { name: "CC Costa Dorada", contact: "Gerencia CC", phone: "922000404", locations: [["Centro Comercial Costa Dorada", "Los Cristianos", "Av. Juan Carlos I s/n", "maquinaria", "Acceso por muelle de carga, puerta 3."]] },
  { name: "Residencia de Mayores San Roque", contact: "Ana Belén Torres", phone: "922000505", locations: [["Residencia San Roque", "La Laguna", "Camino San Roque 22", "sanitario"]] },
  { name: "Comunidad Edificio Teide", contact: "Administración de fincas Oliva", phone: "922000606", locations: [
    ["Edificio Teide – Portal 1", "Santa Cruz", "Av. Tres de Mayo 71", ""],
    ["Edificio Teide – Portal 2", "Santa Cruz", "Av. Tres de Mayo 73", ""],
  ] },
  { name: "Colegio Los Naranjos", contact: "Secretaría", phone: "922000707", locations: [
    ["Colegio Los Naranjos – Aulario", "La Orotava", "C/ Los Naranjos 3", ""],
    ["Colegio Los Naranjos – Pabellón", "La Orotava", "C/ Los Naranjos 3", "maquinaria"],
  ] },
  { name: "Apartamentos Playa Sur", contact: "Recepción", phone: "922000808", locations: [
    ["Playa Sur – Bloque A", "Los Cristianos", "Av. Habana 4", ""],
    ["Playa Sur – Bloque B", "Los Cristianos", "Av. Habana 6", ""],
  ] },
  { name: "Bodegas Valle Verde", contact: "Fernando Rodríguez", phone: "922000909", locations: [["Bodegas Valle Verde", "Tacoronte", "Ctra. Tacoronte-Tejina km 3", "industrial"]] },
  { name: "Gimnasios FitCanarias", contact: "Iván Perera", phone: "922001010", locations: [
    ["FitCanarias Santa Cruz", "Santa Cruz", "C/ Galcerán 9", ""],
    ["FitCanarias Puerto de la Cruz", "Puerto de la Cruz", "Av. Familia Bethencourt 30", ""],
  ] },
  { name: "Notaría Herrera", contact: "Mónica Herrera", phone: "922001111", locations: [["Notaría Herrera", "Santa Cruz", "C/ Castillo 41, 2º", "llaves"]] },
  { name: "Logística Güímar", contact: "Jefe de almacén: Tomás", phone: "922001212", locations: [
    ["Logística Güímar – Nave 1", "Güímar", "Polígono Valle de Güímar, Manzana 6", "industrial,maquinaria"],
    ["Logística Güímar – Oficinas", "Güímar", "Polígono Valle de Güímar, Manzana 6", ""],
  ] },
];

const loc: Record<string, { id: number; lat: number; lng: number; clientId: number }> = {};
let li = 0;
for (const c of CLIENTS) {
  const clientId = run("INSERT INTO clients (org_id, name, contact_name, contact_phone) VALUES (?, ?, ?, ?)", orgId, c.name, c.contact, c.phone);
  for (const [name, zone, address, skills, access] of c.locations) {
    const [lat, lng] = ZONES[zone];
    const la = jitter(lat, li + 11), ln = jitter(lng, li + 17);
    const id = run(
      "INSERT INTO locations (org_id, client_id, name, address, municipality, lat, lng, access_notes, required_skills) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      orgId, clientId, name, address, zone, la, ln, access ?? null, skills,
    );
    loc[name] = { id, lat: la, lng: ln, clientId };
    li++;
  }
}

// ---------- Service templates ----------
const LV = [1, 2, 3, 4, 5], LS = [1, 2, 3, 4, 5, 6], ALL = [1, 2, 3, 4, 5, 6, 7];
const TEMPLATES: [string, string, number[], string, string, string?, string?, number?][] = [
  // location, service name, weekdays, start, end, extra skills, fixed employee, headcount
  ["Hotel Mencey Plaza", "Habitaciones planta 1–3", ALL, "07:00", "11:00", "", "Yurena Díaz Hernández"],
  ["Hotel Mencey Plaza", "Habitaciones planta 4–6", ALL, "07:00", "11:00", "", undefined, 2],
  ["Hotel Mencey Plaza", "Zonas comunes", ALL, "06:00", "09:00"],
  ["Hotel Mencey Plaza", "Cocina y office", LS, "15:00", "18:00", "cocina"],
  ["Edificio Teide – Portal 1", "Escaleras y portal", LS, "12:00", "14:00", "", "Yurena Díaz Hernández"],
  ["Edificio Teide – Portal 2", "Escaleras y portal", [1, 3, 5], "09:30", "11:30"],
  ["Sonríe Santa Cruz", "Limpieza clínica", LV, "20:00", "22:00"],
  ["Sonríe La Laguna", "Limpieza clínica", LV, "07:00", "09:00"],
  ["Sonríe Adeje", "Limpieza clínica", LV, "07:00", "09:30"],
  ["Atlántida Seguros – Sede Rambla", "Oficinas", LV, "06:00", "09:00"],
  ["Atlántida Seguros – Sede Rambla", "Cristales exteriores", [3], "15:00", "19:00", "cristales,altura"],
  ["Atlántida Seguros – Oficina La Laguna", "Oficinas", LV, "14:00", "16:00", "", "Idaira Pérez Rodríguez"],
  ["Atlántida Seguros – Oficina La Laguna", "Oficinas mañana", LV, "07:00", "09:00"],
  ["Edificio Teide – Portal 2", "Garaje (fregadora)", [2, 4], "15:00", "18:00", "maquinaria"],
  ["FitCanarias Santa Cruz", "Sala de máquinas", LS, "11:00", "13:00"],
  ["Sonríe Adeje", "Limpieza clínica tarde", LV, "20:00", "22:00"],
  ["Hotel Mencey Plaza", "Lavandería", LS, "11:30", "15:30"],
  ["Bodegas Valle Verde", "Oficinas y tienda", LV, "15:00", "17:00"],
  ["Colegio Los Naranjos – Aulario", "Comedor", LV, "13:00", "15:00", "cocina"],
  ["Residencia San Roque", "Lavandería", LS, "07:00", "11:00"],
  ["Centro Comercial Costa Dorada", "Pasillos (fregadora)", ALL, "06:00", "10:00", "", undefined, 2],
  ["Centro Comercial Costa Dorada", "Aseos y zona restauración", LV, "15:00", "21:00", "", undefined, 2],
  ["Centro Comercial Costa Dorada", "Aseos fin de semana", [6, 7], "10:00", "16:00"],
  ["Residencia San Roque", "Habitaciones", ALL, "08:00", "13:00", "", undefined, 2],
  ["Residencia San Roque", "Habitaciones ala norte", LV, "08:00", "13:00", "", "Idaira Pérez Rodríguez"],
  ["Residencia San Roque", "Zonas comunes tarde", LV, "16:00", "20:00", "", undefined, 2],
  ["Colegio Los Naranjos – Aulario", "Aulas", LV, "15:00", "19:00", "", undefined, 3],
  ["Colegio Los Naranjos – Pabellón", "Pabellón y vestuarios", LV, "19:00", "21:00"],
  ["Playa Sur – Bloque A", "Apartamentos salida", LS, "10:00", "14:00", "", undefined, 2],
  ["Playa Sur – Bloque B", "Apartamentos salida", LS, "10:00", "14:00", "", undefined, 2],
  ["Playa Sur – Bloque A", "Zonas comunes y piscina", LV, "07:00", "09:30"],
  ["Bodegas Valle Verde", "Nave de elaboración", [1, 3, 5], "07:00", "11:00"],
  ["FitCanarias Santa Cruz", "Sala y vestuarios", LV, "06:00", "08:00"],
  ["FitCanarias Santa Cruz", "Vestuarios tarde", LV, "16:00", "18:00"],
  ["FitCanarias Puerto de la Cruz", "Sala y vestuarios", LV, "06:00", "08:00"],
  ["Notaría Herrera", "Despachos", LV, "15:30", "17:30"],
  ["Logística Güímar – Nave 1", "Nave (fregadora)", LV, "06:00", "10:00", "", undefined, 2],
  ["Logística Güímar – Oficinas", "Oficinas", LV, "10:30", "12:30"],
  ["Logística Güímar – Nave 1", "Limpieza en altura", [2], "12:00", "16:00", "altura"],
  ["Sonríe La Laguna", "Esterilización y aseos", [2, 4], "14:00", "16:00"],
  ["Residencia San Roque", "Cocina", ALL, "13:30", "16:00", "cocina"],
  ["FitCanarias Puerto de la Cruz", "Vestuarios tarde", LV, "17:00", "19:00"],
  ["Atlántida Seguros – Oficina La Laguna", "Cristales", [5], "09:00", "11:00", "cristales"],
];

const fits = (e: Emp, days: number[], start: string, end: string) => {
  const p = PROFILES[e.profile];
  const s = toMinutes(start), en = toMinutes(end);
  if (!days.every((d) => p.days.includes(d))) return false;
  if (s < toMinutes(p.start) || en > toMinutes(p.end)) return false;
  return !e.slots.some((x) => days.includes(x.day) && x.s < en + 30 && x.e + 30 > s);
};

type Tpl = { id: number; locationId: number; title: string; days: number[]; start: string; end: string; skills: string; employeeId: number | null };
const templates: Tpl[] = [];
for (const [locName, name, days, start, end, extra = "", fixed, headcount = 1] of TEMPLATES) for (let h = 0; h < headcount; h++) {
  const l = loc[locName];
  if (!l) throw new Error(`Unknown location ${locName}`);
  const locSkills = (get<{ required_skills: string }>("SELECT required_skills FROM locations WHERE id = ?", l.id)!.required_skills || "").split(",").filter(Boolean);
  const required = [...new Set([...locSkills, ...extra.split(",").filter(Boolean)])];
  const weekly = hoursBetween(start, end) * days.length;
  let chosen: Emp | undefined;
  if (fixed && h === 0) chosen = emps.find((e) => e.name === fixed);
  else {
    chosen = emps
      .filter((e) => required.every((r) => e.skills.includes(r)) && fits(e, days, start, end) && e.load + weekly <= e.hours - 3)
      .sort((a, b) => distanceKm(a, l) - distanceKm(b, l))[0];
  }
  if (chosen) {
    chosen.load += weekly;
    for (const d of days) chosen.slots.push({ day: d, s: toMinutes(start), e: toMinutes(end) });
  }
  if (!chosen) {
    console.warn(`  (skipped template without suitable employee: ${locName} · ${name})`);
    continue;
  }
  const id = run(
    "INSERT INTO service_templates (org_id, location_id, name, weekdays, start, end, required_skills, default_employee_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    orgId, l.id, name, days.join(","), start, end, extra, chosen?.id ?? null,
  );
  templates.push({ id, locationId: l.id, title: name, days, start, end, skills: extra, employeeId: chosen?.id ?? null });
}

// ---------- Shifts: 8 weeks of history + this week + next week ----------
const from = addDays(startOfWeek(TODAY), -56);
const to = addDays(startOfWeek(TODAY), 13);
tx(() => {
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = isoWeekday(d);
    for (const t of templates) {
      if (!t.days.includes(wd)) continue;
      run(
        "INSERT INTO shifts (org_id, template_id, location_id, title, date, start, end, required_skills, employee_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        orgId, t.id, t.locationId, t.title, d, t.start, t.end, t.skills, t.employeeId, t.employeeId ? "scheduled" : "uncovered",
      );
    }
  }
});

// Backdate helper so activity reads naturally.
const backdate = (table: string, id: number, minutesAgo: number, col = "created_at") =>
  run(`UPDATE ${table} SET ${col} = datetime('now', ?) WHERE id = ?`, `-${minutesAgo} minutes`, id);

// ---------- Past substitutions (fairness history) ----------
const byName = (n: string) => emps.find((e) => e.name.startsWith(n))!;
function pastCase(absentName: string, daysAgo: number, coverName: string, minutesToCover: number) {
  const absent = byName(absentName);
  const shift = get<{ id: number; date: string }>("SELECT id, date FROM shifts WHERE employee_id = ? AND date <= ? ORDER BY date DESC LIMIT 1", absent.id, addDays(TODAY, -daysAgo));
  if (!shift) return;
  const date = shift.date;
  const absenceId = run("INSERT INTO absences (org_id, employee_id, start_date, end_date, reason, reason_category, source, created_at) VALUES (?, ?, ?, ?, NULL, ?, 'whatsapp', datetime('now', ?))",
    orgId, absent.id, date, date, "enfermedad", `-${daysAgo} days`);
  const cover = byName(coverName);
  run("UPDATE shifts SET employee_id = ? WHERE id = ?", cover.id, shift.id);
  run("INSERT INTO coverage_cases (org_id, shift_id, absence_id, original_employee_id, status, resolved_employee_id, created_at, resolved_at) VALUES (?, ?, ?, ?, 'covered', ?, datetime('now', ?), datetime('now', ?, ?))",
    orgId, shift.id, absenceId, absent.id, cover.id, `-${daysAgo} days`, `-${daysAgo} days`, `+${minutesToCover} minutes`);
}
pastCase("Gara", 12, "Echedey", 41);
pastCase("Beatriz", 9, "Fátima", 18);
pastCase("Acerina", 6, "Mónica", 26);
pastCase("Elena", 4, "Laura", 12);
pastCase("Sonia", 2, "Fátima", 33);

// ---------- Current situation ----------
// Absence 1 (today, illness): Idaira — services today become open cases; one of them already covered this morning.
const idaira = byName("Idaira");
const a1 = registerAbsence({ orgId, employeeId: idaira.id, start: TODAY, end: TODAY, reason: null, reasonCategory: "enfermedad", rawMessage: null, source: "whatsapp", actor: "Carmen Morales", today: TODAY });
backdate("absences", a1.absenceId, 160);
// Seeded history is written directly: the live workflow (createOffer/respondToOffer) rightly refuses
// offers for services that already started, and the seed may run at any time of day.
const { offerMessage } = await import("../src/lib/messages.ts");
const { randomBytes } = await import("node:crypto");
function seedOffer(caseId: number, accepted: boolean, minutesAgo: number) {
  const c = get<{ shift_id: number; date: string; start: string; end: string; location_name: string; address: string | null }>(
    "SELECT c.shift_id, s.date, s.start, s.end, l.name AS location_name, l.address FROM coverage_cases c JOIN shifts s ON s.id = c.shift_id JOIN locations l ON l.id = s.location_id WHERE c.id = ?",
    caseId,
  )!;
  const pick = rankForShift(orgId, c.shift_id, [idaira.id]).ranked[0];
  if (!pick) return;
  const token = randomBytes(12).toString("base64url");
  const message = offerMessage({ employeeName: pick.name, date: c.date, start: c.start, end: c.end, locationName: c.location_name, address: c.address, link: `http://localhost:3000/r/${token}`, senderName: "Carmen Morales" });
  run(
    "INSERT INTO offers (org_id, case_id, employee_id, token, message, score, status, created_at, responded_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?), ?)",
    orgId, caseId, pick.employeeId, token, message, pick.score, accepted ? "accepted" : "pending", `-${minutesAgo} minutes`, null,
  );
  const ev = (type: string, summary: string, actor: string, ago: number) =>
    run("INSERT INTO activity (org_id, type, entity_type, entity_id, actor, summary, created_at) VALUES (?, ?, 'case', ?, ?, ?, datetime('now', ?))", orgId, type, caseId, actor, summary, `-${ago} minutes`);
  ev("offer.sent", `Propuesta enviada a ${pick.name} para ${c.location_name} (${formatDateShort(c.date)} ${c.start})`, "Carmen Morales", minutesAgo);
  if (accepted) {
    const respondedAgo = minutesAgo - 12;
    run("UPDATE offers SET responded_at = datetime('now', ?) WHERE token = ?", `-${respondedAgo} minutes`, token);
    run("UPDATE shifts SET employee_id = ?, status = 'scheduled' WHERE id = ?", pick.employeeId, c.shift_id);
    run("UPDATE coverage_cases SET status = 'covered', resolved_employee_id = ?, created_at = datetime('now', ?), resolved_at = datetime('now', ?) WHERE id = ?",
      pick.employeeId, `-${minutesAgo + 10} minutes`, `-${respondedAgo} minutes`, caseId);
    ev("offer.accepted", `${pick.name} acepta cubrir ${c.location_name}`, pick.name, respondedAgo);
    ev("case.covered", `Cubierto: ${pick.name} hará ${c.location_name} (${formatDateShort(c.date)} ${c.start}–${c.end}) · confirmado por la empleada/o`, "Cauce", respondedAgo);
  } else {
    run("UPDATE coverage_cases SET status = 'offering' WHERE id = ?", caseId);
  }
}
if (a1.caseIds[0]) seedOffer(a1.caseIds[0], true, 140); // this morning's service: covered via link
if (a1.caseIds[1]) seedOffer(a1.caseIds[1], false, 25); // afternoon service: waiting for an answer

// Absence 2 (next week, planned): Ruth — personal matter; case opened, nothing offered yet.
const ruth = byName("Ruth");
const nextMon = addDays(startOfWeek(TODAY), 7);
registerAbsence({ orgId, employeeId: ruth.id, start: nextMon, end: addDays(nextMon, 1), reason: null, reasonCategory: "familiar", rawMessage: null, source: "telefono", actor: "Jonay Pérez", today: TODAY });

// ---------- Incidents ----------
const shiftAt = (locName: string, daysAgo: number) =>
  get<{ id: number; employee_id: number | null }>("SELECT id, employee_id FROM shifts WHERE location_id = ? AND date <= ? ORDER BY date DESC, start DESC LIMIT 1", loc[locName].id, addDays(TODAY, -daysAgo));
const incidents: [string, string, string, string, string, string | null, string, number][] = [
  // location, type, severity, title, description, raw, status, hoursAgo
  ["Residencia San Roque", "calidad", "media", "Baños de la 2ª planta sin repasar", "La gobernanta indica que los baños de la segunda planta no se repasaron ayer por la tarde.", "Buenas, los baños de la segunda planta ayer no se repasaron, ¿pueden revisarlo?", "abierta", 3],
  ["Centro Comercial Costa Dorada", "suministros", "baja", "Faltan bolsas de basura grandes", "Piden reponer bolsas de 100 L para la zona de restauración.", null, "en_curso", 20],
  ["Atlántida Seguros – Sede Rambla", "retraso", "media", "La limpieza de oficinas empezó 40 min tarde", "Rubén comenta que a las 9:00 aún había personal limpiando cuando llegaron los empleados.", null, "abierta", 26],
  ["Playa Sur – Bloque B", "cambio_servicio", "alta", "Adelantar salida del apartamento 204 al sábado 9:00", "Recepción solicita adelantar la limpieza por entrada temprana de clientes.", "Hola! El sábado entra un grupo a las 11, ¿podéis tener el 204 listo a las 9?", "abierta", 5],
];
for (const [locName, type, severity, title, description, raw, status, hoursAgo] of incidents) {
  const s = shiftAt(locName, 0);
  const id = run(
    "INSERT INTO incidents (org_id, client_id, location_id, shift_id, employee_id, type, severity, title, description, raw_message, owner_user_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))",
    orgId, loc[locName].clientId, loc[locName].id, s?.id ?? null, s?.employee_id ?? null, type, severity, title, description, raw,
    status === "en_curso" ? carmenId : null, status, `-${hoursAgo} hours`,
  );
  run("INSERT INTO activity (org_id, type, entity_type, entity_id, actor, summary, created_at) VALUES (?, 'incident.created', 'incident', ?, 'Carmen Morales', ?, datetime('now', ?))",
    orgId, id, `Nueva incidencia: ${title}`, `-${hoursAgo} hours`);
}
// Resolved history
for (const [locName, title, resolution, daysAgo] of [
  ["Hotel Mencey Plaza", "Cristal del lobby con marcas", "Repasado el mismo día por Dácil.", 6],
  ["Notaría Herrera", "Alarma activada por error", "Recordado el código a la nueva compañera; sin coste.", 10],
  ["Bodegas Valle Verde", "Falta de desengrasante industrial", "Repuesto en la siguiente visita.", 15],
] as const) {
  const s = shiftAt(locName, daysAgo);
  run("INSERT INTO incidents (org_id, client_id, location_id, shift_id, employee_id, type, severity, title, status, resolution, owner_user_id, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, 'calidad', 'baja', ?, 'resuelta', ?, ?, datetime('now', ?), datetime('now', ?))",
    orgId, loc[locName].clientId, loc[locName].id, s?.id ?? null, s?.employee_id ?? null, title, resolution, carmenId, `-${daysAgo} days`, `-${daysAgo - 1} days`);
}

// Order activity naturally: seeded events that were created "now" get spread over the last hours.
const recent = all<{ id: number }>("SELECT id FROM activity WHERE created_at >= datetime('now', '-1 minute') ORDER BY id");
recent.forEach((r, i) => backdate("activity", r.id, (recent.length - i) * 7 + 5));

const counts = Object.fromEntries(
  ["employees", "clients", "locations", "service_templates", "shifts", "absences", "coverage_cases", "offers", "incidents", "activity"].map((t) => [t, get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n]),
);
console.log(`Demo data created in ${path} (today = ${TODAY})`);
console.table(counts);
console.log("Unassigned templates:", templates.filter((t) => !t.employeeId).length);
console.log("Login: demo@cauce.app / demo1234");
