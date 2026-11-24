// Employee self-report (T-020) against an in-memory database. Far-future dates keep it clock-independent.
process.env.CAUCE_DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";

const { run, get, all, db, migrate, newReportToken } = await import("./db.ts");
const sr = await import("./self-report.ts");
const admin = await import("./admin.ts");
const { importEmployeesCsv } = await import("./import.ts");

const NOW = new Date("2030-01-07T09:00:00Z"); // Monday; Atlantic/Canary = UTC+0 in winter → today = 2030-01-07
const TODAY = "2030-01-07";

const org = run("INSERT INTO organizations (name) VALUES ('Limpiezas Test')");
const otherOrg = run("INSERT INTO organizations (name) VALUES ('Otra empresa')");
const site = (o: number, name: string) => {
  const client = run("INSERT INTO clients (org_id, name) VALUES (?, ?)", o, name);
  return run("INSERT INTO locations (org_id, client_id, name, address, access_notes) VALUES (?, ?, ?, 'Calle Secreta 1', 'Alarma 1234')", o, client, name);
};
const emp = (name: string, o = org, active = 1) => {
  const token = newReportToken();
  const id = run("INSERT INTO employees (org_id, name, active, report_token) VALUES (?, ?, ?, ?)", o, name, active, token);
  return { id, token };
};
const shift = (o: number, locationId: number, employeeId: number, date: string, start = "07:00", end = "11:00") =>
  run("INSERT INTO shifts (org_id, location_id, title, date, start, end, employee_id) VALUES (?, ?, 'Limpieza', ?, ?, ?, ?)", o, locationId, date, start, end, employeeId);

const hotel = site(org, "Hotel Test");
const ana = emp("Ana Pérez");
const baja = emp("Berta Inactiva", org, 0);
const foreign = emp("Dora OtraEmpresa", otherOrg);
shift(org, hotel, ana.id, "2030-01-08");
shift(org, hotel, ana.id, "2030-01-09", "13:00", "17:00");
const foreignShift = shift(otherOrg, site(otherOrg, "Hotel Ajeno"), foreign.id, "2030-01-08");

test("token lookup finds the active employee; unknown or malformed tokens find nothing", () => {
  const r = sr.findReporter(ana.token)!;
  assert.equal(r.id, ana.id);
  assert.equal(r.orgId, org);
  assert.equal(r.orgName, "Limpiezas Test");
  assert.equal(sr.findReporter("x".repeat(24)), undefined);
  assert.equal(sr.findReporter(""), undefined);
  assert.equal(sr.findReporter("short"), undefined);
});

test("tokens are unique and unguessable", () => {
  const a = newReportToken(), b = newReportToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{24}$/);
  assert.throws(() => run("INSERT INTO employees (org_id, name, report_token) VALUES (?, 'Dup', ?)", org, ana.token));
});

test("deactivated employees cannot use their link", () => {
  assert.equal(sr.findReporter(baja.token), undefined);
  const res = sr.submitSelfReport(baja.token, { start: "2030-01-08", end: "2030-01-08", reason: "otro" }, NOW);
  assert.deepEqual([res.ok, !res.ok && res.error], [false, "not_found"]);
});

test("cross-org isolation: a token only ever touches its own employee's org", () => {
  const res = sr.submitSelfReport(foreign.token, { start: "2030-01-08", end: "2030-01-08", reason: "familiar" }, NOW);
  assert.ok(res.ok);
  // Their own service was opened…
  assert.equal(res.services.length, 1);
  assert.equal(get<{ status: string }>("SELECT status FROM shifts WHERE id = ?", foreignShift)!.status, "uncovered");
  // …and nothing in the other organisation was touched, nor activity written there.
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM absences WHERE org_id = ?", org)!.n, 0);
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM activity WHERE org_id = ?", org)!.n, 0);
  assert.equal(get<{ org_id: number }>("SELECT org_id FROM absences WHERE id = ?", res.absenceId)!.org_id, otherOrg);
  // The outcome screen is also bound to the token's own employee.
  assert.equal(sr.selfReportOutcome(ana.token, res.absenceId), undefined);
  assert.ok(sr.selfReportOutcome(foreign.token, res.absenceId));
});

test("validation: past dates, reversed ranges, too long, too far, unknown reason", () => {
  const t = ana.token;
  const err = (start: string, end: string, reason = "enfermedad") => {
    const r = sr.previewSelfReport(t, { start, end, reason }, NOW);
    return r.ok ? "ok" : r.error;
  };
  assert.equal(err("2030-01-06", "2030-01-08"), "past");
  assert.equal(err("2030-01-10", "2030-01-09"), "invalid_dates");
  assert.equal(err("2030-02-30", "2030-02-30"), "invalid_dates");
  assert.equal(err("nonsense", "2030-01-09"), "invalid_dates");
  assert.equal(err("2030-01-10", "2030-02-20"), "too_long");
  assert.equal(err("2030-01-10", "2030-02-09"), "ok"); // exactly 31 days
  assert.equal(err("2030-06-01", "2030-06-02"), "too_far");
  assert.equal(err("2030-01-10", "2030-01-10", "vacaciones"), "invalid_reason");
  assert.equal(err("2030-01-10", "2030-01-10", "<script>"), "invalid_reason");
});

test("preview lists date, time and site only — and writes nothing", () => {
  const p = sr.previewSelfReport(ana.token, { start: "2030-01-08", end: "2030-01-09", reason: "enfermedad" }, NOW);
  assert.ok(p.ok);
  assert.deepEqual(p.services, [
    { date: "2030-01-08", start: "07:00", end: "11:00", locationName: "Hotel Test" },
    { date: "2030-01-09", start: "13:00", end: "17:00", locationName: "Hotel Test" },
  ]);
  assert.ok(!JSON.stringify(p).includes("Alarma"));
  assert.ok(!JSON.stringify(p).includes("Calle Secreta"));
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM absences WHERE employee_id = ?", ana.id)!.n, 0);
});

test("submit registers a self-reported absence, opens cases and logs the origin", () => {
  const res = sr.submitSelfReport(ana.token, { start: "2030-01-08", end: "2030-01-09", reason: "enfermedad" }, NOW);
  assert.ok(res.ok);
  assert.equal(res.services.length, 2);

  const a = get<{ source: string; reason: string | null; raw_message: string | null; reason_category: string; employee_id: number }>(
    "SELECT * FROM absences WHERE id = ?", res.absenceId)!;
  assert.equal(a.source, "self_report");
  assert.equal(a.reason_category, "enfermedad");
  assert.equal(a.employee_id, ana.id);

  const cases = all<{ status: string; original_employee_id: number }>("SELECT * FROM coverage_cases WHERE absence_id = ?", res.absenceId);
  assert.equal(cases.length, 2);
  assert.ok(cases.every((c) => c.status === "open" && c.original_employee_id === ana.id));
  assert.equal(all("SELECT id FROM shifts WHERE employee_id = ? AND status = 'scheduled' AND date >= ?", ana.id, TODAY).length, 0);

  const ev = get<{ summary: string; actor: string }>("SELECT summary, actor FROM activity WHERE entity_type = 'absence' AND entity_id = ?", res.absenceId)!;
  assert.match(ev.summary, /aviso de la propia persona/);
  assert.equal(ev.actor, "Ana Pérez");
  assert.equal(all("SELECT id FROM activity WHERE type = 'case.opened' AND org_id = ?", org).length, 2);

  const out = sr.selfReportOutcome(ana.token, res.absenceId)!;
  assert.equal(out.services.length, 2);
  assert.equal(sr.sourceLabel("self_report"), "Aviso de la propia persona");
  assert.equal(sr.sourceLabel("manual"), null);
});

test("no free text is ever stored", () => {
  const dave = emp("Dave");
  const res = sr.submitSelfReport(dave.token, { start: "2030-03-01", end: "2030-03-01", reason: "otro", note: "tengo cáncer", raw: "mi médico dice" } as never, NOW);
  assert.ok(res.ok);
  const a = get<Record<string, unknown>>("SELECT * FROM absences WHERE id = ?", res.absenceId)!;
  assert.equal(a.reason, null);
  assert.equal(a.raw_message, null);
  const dump = JSON.stringify(all("SELECT * FROM activity WHERE org_id = ?", org)) + JSON.stringify(a);
  assert.ok(!dump.includes("cáncer") && !dump.includes("médico"));
});

test("overlapping active absence is refused with a friendly duplicate result", () => {
  for (const [s, e] of [["2030-01-08", "2030-01-08"], ["2030-01-09", "2030-01-12"], ["2030-01-07", "2030-01-08"]] as const) {
    const r = sr.submitSelfReport(ana.token, { start: s, end: e, reason: "personal" }, NOW);
    assert.ok(!r.ok && r.error === "duplicate", `${s}..${e}`);
    assert.match((r as { message: string }).message, /Ya tienes un aviso/);
  }
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM absences WHERE employee_id = ?", ana.id)!.n, 1);
  // Non-overlapping days are fine; a cancelled absence frees its days.
  assert.ok(sr.submitSelfReport(ana.token, { start: "2030-01-13", end: "2030-01-13", reason: "personal" }, NOW).ok);
});

test("rate limit: at most 5 reports per link per day", () => {
  const eve = emp("Eva Limite");
  const days = ["2030-02-01", "2030-02-03", "2030-02-05", "2030-02-07", "2030-02-09"];
  for (const d of days) assert.ok(sr.submitSelfReport(eve.token, { start: d, end: d, reason: "otro" }, NOW).ok, d);
  const sixth = sr.submitSelfReport(eve.token, { start: "2030-02-11", end: "2030-02-11", reason: "otro" }, NOW);
  assert.ok(!sixth.ok && sixth.error === "rate_limited");
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM absences WHERE employee_id = ?", eve.id)!.n, 5);
});

test("regenerating invalidates the old link and logs activity", () => {
  const fran = emp("Fran Nuevo");
  assert.equal(sr.regenerateReportToken(otherOrg, fran.id, "Otra"), null); // not their org → untouched
  assert.equal(sr.findReporter(fran.token)?.id, fran.id);
  const next = sr.regenerateReportToken(org, fran.id, "Carmen")!;
  assert.notEqual(next, fran.token);
  assert.equal(sr.findReporter(fran.token), undefined);
  assert.equal(sr.findReporter(next)?.id, fran.id);
  const ev = get<{ actor: string; entity_id: number }>("SELECT actor, entity_id FROM activity WHERE type = 'employee.report_link_regenerated'")!;
  assert.deepEqual(ev, { actor: "Carmen", entity_id: fran.id });
});

test("resolveWhen maps the quick choices to dates", () => {
  assert.deepEqual(sr.resolveWhen("hoy", TODAY), { start: TODAY, end: TODAY });
  assert.deepEqual(sr.resolveWhen("manana", TODAY), { start: "2030-01-08", end: "2030-01-08" });
  assert.deepEqual(sr.resolveWhen("otras", TODAY, "2030-01-10", "2030-01-12"), { start: "2030-01-10", end: "2030-01-12" });
  assert.deepEqual(sr.resolveWhen("otras", TODAY, "2030-01-10", ""), { start: "2030-01-10", end: "2030-01-10" });
  assert.equal(sr.resolveWhen("otras", TODAY, "", ""), null);
  assert.equal(sr.resolveWhen("ayer", TODAY), null);
});

test("new employees (admin form, CSV import) get a token; migration is idempotent and backfills", () => {
  const id = admin.createEmployee(org, {
    name: "Gala Admin", phone: null, email: null, zone: { name: null, lat: null, lng: null }, weeklyHours: 30,
    skills: [], notes: null, availability: [{ weekday: 1, start: "06:00", end: "14:00" }],
  }, "Carmen");
  assert.match(get<{ report_token: string }>("SELECT report_token FROM employees WHERE id = ?", id)!.report_token, /^[A-Za-z0-9_-]{24}$/);

  const res = importEmployeesCsv(org, "nombre;horas\nHugo Csv;20\nIria Csv;25", "Carmen");
  assert.equal(res.created, 2);
  const csv = all<{ report_token: string }>("SELECT report_token FROM employees WHERE name LIKE '% Csv'");
  assert.equal(new Set(csv.map((r) => r.report_token)).size, 2);
  assert.ok(csv.every((r) => r.report_token?.length === 24));

  // Employees inserted without a token (older rows) are backfilled; running again changes nothing.
  const legacy = run("INSERT INTO employees (org_id, name) VALUES (?, 'Legacy')", org);
  migrate(db());
  const t = get<{ report_token: string }>("SELECT report_token FROM employees WHERE id = ?", legacy)!.report_token;
  assert.equal(t.length, 24);
  migrate(db());
  assert.equal(get<{ report_token: string }>("SELECT report_token FROM employees WHERE id = ?", legacy)!.report_token, t);
});

test("migration upgrades a database created before T-020", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const old = new DatabaseSync(":memory:");
  old.exec("CREATE TABLE employees (id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1)");
  old.exec("INSERT INTO employees (org_id, name) VALUES (1, 'A'), (1, 'B')");
  old.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'coordinator')");
  old.exec("INSERT INTO users (org_id, role) VALUES (1, 'coordinator'), (1, 'coordinator')");
  migrate(old);
  migrate(old);
  const rows = old.prepare("SELECT report_token FROM employees").all() as { report_token: string }[];
  assert.equal(new Set(rows.map((r) => r.report_token)).size, 2);
  // T-012 part of the same migration: the oldest user of an org without admin becomes admin, once.
  const users = old.prepare("SELECT role, active FROM users ORDER BY id").all() as { role: string; active: number }[];
  assert.deepEqual(users.map((u) => [u.role, u.active]), [["admin", 1], ["coordinator", 1]]);
});

test("reportLinkMessage is addressed by first name with the link", () => {
  const m = sr.reportLinkMessage({ employeeName: "Ana Pérez", senderName: "Carmen Morales", link: "https://x.test/a/abc" });
  assert.match(m, /^Hola Ana, soy Carmen\./);
  assert.match(m, /Tu enlace para avisar si no puedes ir: https:\/\/x\.test\/a\/abc/);
});
