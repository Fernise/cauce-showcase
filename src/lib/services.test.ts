// Recurring services: shift regeneration rules, org isolation, validation. In-memory DB.
process.env.CAUCE_DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";

const { run, get, all } = await import("./db.ts");
const svc = await import("./services.ts");
const { NotFoundError, ValidationError } = await import("./validation.ts");

const TODAY = "2026-11-25"; // Wednesday. Window: 25 Nov … 6 Dec (end of next ISO week)
const clock = { today: TODAY };

const org = run("INSERT INTO organizations (name) VALUES ('Test')");
const otherOrg = run("INSERT INTO organizations (name) VALUES ('Other')");
const client = run("INSERT INTO clients (org_id, name) VALUES (?, 'Hotel')", org);
const loc = run("INSERT INTO locations (org_id, client_id, name, required_skills) VALUES (?, ?, 'Hotel Centro', 'llaves')", org, client);
const otherClient = run("INSERT INTO clients (org_id, name) VALUES (?, 'Ajeno')", otherOrg);
const otherLoc = run("INSERT INTO locations (org_id, client_id, name) VALUES (?, ?, 'Ajeno Centro')", otherOrg, otherClient);

const emp = (name: string, o = org, skills = "llaves", hours = 30) => {
  const id = run("INSERT INTO employees (org_id, name, weekly_hours, skills) VALUES (?, ?, ?, ?)", o, name, hours, skills);
  for (let d = 1; d <= 5; d++) run("INSERT INTO availability (employee_id, weekday, start, end) VALUES (?, ?, '06:00', '15:00')", id, d);
  return id;
};
const ana = emp("Ana");
const bea = emp("Bea");
const foreign = emp("Dora", otherOrg);

const input = (over: Partial<import("./services.ts").TemplateInput> = {}) => ({
  name: "Habitaciones", weekdays: [1, 3, 5], start: "07:00", end: "11:00", skills: [], defaultEmployeeId: ana, ...over,
});
const shiftsOf = (templateId: number) =>
  all<{ id: number; date: string; start: string; end: string; employee_id: number | null; status: string; title: string }>(
    "SELECT * FROM shifts WHERE template_id = ? ORDER BY date", templateId,
  );
const form = (fields: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};

test("create generates shifts from today through the end of next ISO week", () => {
  const { id, clientId, generation } = svc.createTemplate(org, loc, input(), "Coord", clock);
  assert.equal(clientId, client);
  assert.deepEqual(generation, { created: 5, updated: 0, cancelled: 0, cases: 0 });
  const s = shiftsOf(id);
  assert.deepEqual(s.map((x) => x.date), ["2026-11-25", "2026-11-27", "2026-11-30", "2026-12-02", "2026-12-04"]);
  assert.ok(s.every((x) => x.employee_id === ana && x.status === "scheduled" && x.start === "07:00" && x.end === "11:00"));
  assert.equal(get<{ type: string }>("SELECT type FROM activity WHERE org_id = ? ORDER BY id DESC LIMIT 1", org)!.type, "template.created");
});

test("a template without default employee generates uncovered shifts", () => {
  const { id } = svc.createTemplate(org, loc, input({ name: "Sin titular", defaultEmployeeId: null, weekdays: [2] }), "Coord", clock);
  const s = shiftsOf(id);
  assert.deepEqual(s.map((x) => [x.date, x.status, x.employee_id]), [["2026-12-01", "uncovered", null]]);
  assert.equal(svc.regenerateShifts(org, id, clock).created, 0, "regenerating twice is idempotent");
});

test("update changes only future case-less scheduled/uncovered shifts", () => {
  const { id } = svc.createTemplate(org, loc, input({ name: "Mixto", weekdays: [1, 2, 3, 4, 5] }), "Coord", clock);
  const byDate = (d: string) => shiftsOf(id).find((x) => x.date === d)!;

  // Past shift (yesterday), shift with a coverage case, a cancelled shift, and one beyond the window.
  const past = run("INSERT INTO shifts (org_id, template_id, location_id, title, date, start, end, employee_id) VALUES (?, ?, ?, 'Mixto', '2026-11-24', '07:00', '11:00', ?)", org, id, loc, ana);
  const withCase = byDate("2026-11-26");
  run("UPDATE shifts SET employee_id = NULL, status = 'uncovered' WHERE id = ?", withCase.id);
  run("INSERT INTO coverage_cases (org_id, shift_id, original_employee_id) VALUES (?, ?, ?)", org, withCase.id, ana);
  const cancelled = byDate("2026-11-27");
  run("UPDATE shifts SET status = 'cancelled' WHERE id = ?", cancelled.id);
  const beyond = run("INSERT INTO shifts (org_id, template_id, location_id, title, date, start, end, employee_id) VALUES (?, ?, ?, 'Mixto', '2026-12-10', '07:00', '11:00', ?)", org, id, loc, ana);

  const r = svc.updateTemplate(org, id, input({ name: "Mixto v2", weekdays: [1, 2, 3, 4, 5], start: "08:00", end: "12:00", defaultEmployeeId: bea }), "Coord", clock);
  assert.equal(r.clientId, client);

  const row = (sid: number) => get<{ title: string; start: string; employee_id: number | null; status: string }>("SELECT * FROM shifts WHERE id = ?", sid)!;
  assert.deepEqual([row(past).title, row(past).start, row(past).employee_id], ["Mixto", "07:00", ana], "past untouched");
  assert.deepEqual([row(beyond).title, row(beyond).start], ["Mixto", "07:00"], "outside the window untouched");
  assert.deepEqual([row(withCase.id).title, row(withCase.id).employee_id, row(withCase.id).status], ["Mixto", null, "uncovered"], "shift with a case untouched");
  assert.deepEqual([row(cancelled.id).title, row(cancelled.id).status], ["Mixto", "cancelled"], "cancelled untouched");
  for (const d of ["2026-11-25", "2026-11-30", "2026-12-01"]) {
    const s = byDate(d);
    assert.deepEqual([s.title, s.start, s.end, s.employee_id, s.status], ["Mixto v2", "08:00", "12:00", bea, "scheduled"]);
  }
});

test("removed weekdays cancel case-less shifts, new weekdays create shifts", () => {
  const { id } = svc.createTemplate(org, loc, input({ name: "Dias", weekdays: [1, 3] }), "Coord", clock);
  const withCase = shiftsOf(id).find((s) => s.date === "2026-12-02")!;
  run("INSERT INTO coverage_cases (org_id, shift_id) VALUES (?, ?)", org, withCase.id);
  const { generation } = svc.updateTemplate(org, id, input({ name: "Dias", weekdays: [4] }), "Coord", clock);
  // Thu 26 Nov + Thu 3 Dec created; Wed 25 and Mon 30 cancelled; Wed 2 Dec has a case → kept as is.
  assert.deepEqual(generation, { created: 2, updated: 0, cancelled: 2, cases: 0 });
  assert.deepEqual(shiftsOf(id).map((s) => [s.date, s.status]), [
    ["2026-11-25", "cancelled"], ["2026-11-26", "scheduled"], ["2026-11-30", "cancelled"], ["2026-12-02", "scheduled"], ["2026-12-03", "scheduled"],
  ]);
});

test("shifts that already ended today are past; later today is future", () => {
  const { id } = svc.createTemplate(org, loc, input({ name: "Hoy", weekdays: [3], start: "07:00", end: "09:00" }), "Coord", { today: TODAY, time: "10:00" });
  assert.deepEqual(shiftsOf(id).map((s) => s.date), ["2026-12-02"], "today's 07–09 shift is already over at 10:00, not created");
  const r = svc.updateTemplate(org, id, input({ name: "Hoy", weekdays: [3], start: "07:00", end: "12:00" }), "Coord", { today: TODAY, time: "10:00" });
  assert.deepEqual(r.generation, { created: 1, updated: 1, cancelled: 0, cases: 0 }, "today's now ends at 12:00 → created as it's still future; Dec 2 updated");
});

test("remove cancels future case-less shifts, keeps history, deletes the template", () => {
  const { id } = svc.createTemplate(org, loc, input({ name: "Borrable", weekdays: [1, 2, 3, 4, 5] }), "Coord", clock);
  const past = run("INSERT INTO shifts (org_id, template_id, location_id, title, date, start, end, employee_id) VALUES (?, ?, ?, 'Borrable', '2026-11-23', '07:00', '11:00', ?)", org, id, loc, ana);
  const withCase = shiftsOf(id).find((s) => s.date === "2026-11-30")!;
  run("INSERT INTO coverage_cases (org_id, shift_id) VALUES (?, ?)", org, withCase.id);
  const total = shiftsOf(id).length;

  const r = svc.removeTemplate(org, id, "Coord", clock);
  assert.equal(r.clientId, client);
  assert.equal(r.cancelled, total - 2); // all but the past shift and the one with a case
  assert.equal(get("SELECT id FROM service_templates WHERE id = ?", id), undefined);
  const rows = all<{ id: number; status: string; template_id: number | null }>("SELECT id, status, template_id FROM shifts WHERE title = 'Borrable'");
  assert.equal(rows.length, total, "no shift deleted");
  assert.ok(rows.every((s) => s.template_id === null));
  assert.equal(rows.find((s) => s.id === past)!.status, "scheduled");
  assert.equal(rows.find((s) => s.id === withCase.id)!.status, "scheduled");
  assert.equal(rows.filter((s) => s.status === "cancelled").length, total - 2);
  assert.equal(get<{ type: string }>("SELECT type FROM activity WHERE org_id = ? ORDER BY id DESC LIMIT 1", org)!.type, "template.removed");
});

test("ids from another organization are rejected", () => {
  const mine = svc.createTemplate(org, loc, input({ name: "Mio" }), "Coord", clock).id;
  const theirs = svc.createTemplate(otherOrg, otherLoc, input({ name: "Suyo", defaultEmployeeId: foreign }), "Otro", clock).id;
  const before = shiftsOf(theirs).length;

  assert.throws(() => svc.createTemplate(org, otherLoc, input(), "Coord", clock), NotFoundError);
  assert.throws(() => svc.createTemplate(otherOrg, loc, input({ defaultEmployeeId: foreign }), "Otro", clock), NotFoundError);
  assert.throws(() => svc.createTemplate(org, loc, input({ defaultEmployeeId: foreign }), "Coord", clock), ValidationError);
  assert.throws(() => svc.updateTemplate(org, mine, input({ defaultEmployeeId: foreign }), "Coord", clock), ValidationError);
  assert.throws(() => svc.updateTemplate(org, theirs, input({ name: "Hackeado" }), "Coord", clock), NotFoundError);
  assert.throws(() => svc.removeTemplate(org, theirs, "Coord", clock), NotFoundError);
  assert.throws(() => svc.regenerateShifts(org, theirs, clock), NotFoundError);
  assert.equal(svc.getTemplate(org, theirs), undefined);
  assert.equal(get<{ name: string }>("SELECT name FROM service_templates WHERE id = ?", theirs)!.name, "Suyo");
  assert.equal(shiftsOf(theirs).length, before);
  assert.equal(svc.templateFit(org, { employeeId: foreign, weekdays: [1], start: "07:00", end: "08:00", skills: [], locationId: loc }).length, 0, "no info leaks about other orgs");
});

test("an inactive employee cannot be chosen as default (unless already the default)", () => {
  const retired = emp("Retirada");
  run("UPDATE employees SET active = 0 WHERE id = ?", retired);
  assert.throws(() => svc.createTemplate(org, loc, input({ defaultEmployeeId: retired }), "Coord", clock), ValidationError);
  assert.ok(!svc.assignableEmployees(org, null).some((e) => e.id === retired));
  const { id } = svc.createTemplate(org, loc, input({ name: "Pre-baja" }), "Coord", clock);
  run("UPDATE service_templates SET default_employee_id = ? WHERE id = ?", retired, id);
  assert.doesNotThrow(() => svc.updateTemplate(org, id, input({ name: "Pre-baja", defaultEmployeeId: retired }), "Coord", clock));
  assert.ok(svc.assignableEmployees(org, retired).some((e) => e.id === retired));
});

test("template form validation reports Spanish errors", () => {
  const errs = (fields: Record<string, string | string[]>) => {
    try { svc.parseTemplateForm(form(fields)); return []; } catch (e) { assert.ok(e instanceof ValidationError); return e.errors; }
  };
  const ok = { name: "X", weekdays: ["1"], start: "07:00", end: "09:00" };
  assert.deepEqual(errs(ok), []);
  assert.match(errs({ ...ok, name: " " }).join(), /nombre del servicio es obligatorio/);
  assert.match(errs({ ...ok, weekdays: [] }).join(), /al menos un día/);
  assert.match(errs({ ...ok, weekdays: ["9", "0"] }).join(), /al menos un día/);
  assert.match(errs({ ...ok, start: "7am" }).join(), /hora de inicio y de fin/);
  assert.match(errs({ ...ok, start: "10:00", end: "09:00" }).join(), /posterior/);
  assert.match(errs({ ...ok, skills: ["magia"] }).join(), /Cualificación desconocida/);
  assert.match(errs({ ...ok, defaultEmployeeId: "abc" }).join(), /titular no es válida/);
  assert.equal(errs({ name: "", weekdays: [], start: "", end: "" }).length >= 3, true, "all errors are reported at once");
  const parsed = svc.parseTemplateForm(form({ ...ok, weekdays: ["5", "1", "1"], skills: ["altura", "cristales"], defaultEmployeeId: "7" }));
  assert.deepEqual([parsed.weekdays, parsed.skills, parsed.defaultEmployeeId], [[1, 5], ["cristales", "altura"], 7]);
});

test("templateFit warns about availability, skills, overlaps and contract hours", () => {
  const picky = emp("Pili", org, "", 8);
  const tpl = svc.createTemplate(org, loc, input({ name: "Existente", weekdays: [1, 2], start: "08:00", end: "10:00", defaultEmployeeId: picky }), "Coord", clock).id;
  const w = svc.templateFit(org, { employeeId: picky, weekdays: [1, 6], start: "09:00", end: "13:00", skills: ["cristales"], locationId: loc }).join("\n");
  assert.match(w, /no está disponible de 09:00 a 13:00 el sábado\./);
  assert.match(w, /le falta: Llaves \/ alarma, Cristales|le falta: Cristales, Llaves/);
  assert.match(w, /Se solapa con «Existente»/);
  assert.match(w, /por encima de su contrato \(8 h\)/);
  // Editing the template itself doesn't count it against itself.
  const self = svc.templateFit(org, { employeeId: picky, weekdays: [1, 2], start: "08:00", end: "10:00", skills: ["llaves"], locationId: loc, excludeTemplateId: tpl });
  assert.deepEqual(self, ["A Pili le falta: Llaves / alarma."], "only the location skill she lacks; no overlap/hours warning against itself");
  const fresh = emp("Fresca", org, "llaves", 30);
  assert.deepEqual(svc.templateFit(org, { employeeId: fresh, weekdays: [1], start: "06:30", end: "07:00", skills: [], locationId: loc }), [], "a fitting employee gets no warnings");
});

// ---------- T-017: rolling window · T-018: absence-aware generation ----------

test("rollShiftWindow only adds missing shifts as the window moves and leaves existing ones alone", () => {
  const o = run("INSERT INTO organizations (name) VALUES ('Roll')");
  const c = run("INSERT INTO clients (org_id, name) VALUES (?, 'C')", o);
  const l = run("INSERT INTO locations (org_id, client_id, name) VALUES (?, ?, 'Oficina')", o, c);
  const e = emp("Eva", o, "");
  const { id } = svc.createTemplate(o, l, input({ weekdays: [1, 2, 3, 4, 5], defaultEmployeeId: e }), "test", clock);
  const before = shiftsOf(id);
  assert.equal(before.at(-1)!.date, "2026-12-04"); // Friday of next week

  // Hand-edited shift (e.g. time moved) must survive a roll.
  run("UPDATE shifts SET start = '08:00' WHERE id = ?", before[0].id);
  const g = svc.rollShiftWindow(o, { today: "2026-12-01" }); // Tuesday of the following week
  assert.equal(g.created, 5); // 7–11 Dec
  const after = shiftsOf(id);
  assert.equal(after.at(-1)!.date, "2026-12-11");
  assert.equal(after.find((s) => s.id === before[0].id)!.start, "08:00");
  assert.equal(svc.rollShiftWindow(o, { today: "2026-12-01" }).created, 0, "idempotent");
  assert.ok(get("SELECT 1 FROM activity WHERE org_id = ? AND type = 'shifts.rolled'", o));
});

test("rollShiftWindow never touches other organisations", () => {
  const o = run("INSERT INTO organizations (name) VALUES ('Solo')");
  const theirs = get<{ n: number }>("SELECT COUNT(*) AS n FROM shifts WHERE org_id <> ?", o)!.n;
  svc.rollShiftWindow(o, { today: "2027-01-04" });
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM shifts WHERE org_id <> ?", o)!.n, theirs);
});

test("a generated shift for someone already absent is uncovered with a case linked to the absence", () => {
  const o = run("INSERT INTO organizations (name) VALUES ('Abs')");
  const c = run("INSERT INTO clients (org_id, name) VALUES (?, 'C')", o);
  const l = run("INSERT INTO locations (org_id, client_id, name) VALUES (?, ?, 'Clínica')", o, c);
  const e = emp("Flor", o, "");
  // Absent Mon 7 – Wed 9 Dec, registered before those shifts exist.
  const absence = run(
    "INSERT INTO absences (org_id, employee_id, start_date, end_date, reason_category) VALUES (?, ?, '2026-12-07', '2026-12-09', 'enfermedad')",
    o, e,
  );
  run("INSERT INTO absences (org_id, employee_id, start_date, end_date, reason_category, status) VALUES (?, ?, '2026-12-10', '2026-12-10', 'otro', 'cancelled')", o, e);
  const { id } = svc.createTemplate(o, l, input({ weekdays: [1, 2, 3, 4, 5], defaultEmployeeId: e }), "test", clock);
  const g = svc.rollShiftWindow(o, { today: "2026-12-01" });
  assert.equal(g.cases, 3);

  const byDate = new Map(shiftsOf(id).map((s) => [s.date, s]));
  for (const d of ["2026-12-07", "2026-12-08", "2026-12-09"]) {
    const s = byDate.get(d)!;
    assert.equal(s.employee_id, null);
    assert.equal(s.status, "uncovered");
    const cs = get<{ absence_id: number; original_employee_id: number; status: string }>("SELECT * FROM coverage_cases WHERE shift_id = ?", s.id)!;
    assert.deepEqual([cs.absence_id, cs.original_employee_id, cs.status], [absence, e, "open"]);
  }
  // Cancelled absence and days outside the range: normal shifts.
  for (const d of ["2026-12-04", "2026-12-10", "2026-12-11"]) assert.equal(byDate.get(d)!.employee_id, e);
  assert.equal(svc.rollShiftWindow(o, { today: "2026-12-01" }).cases, 0, "no duplicate cases");
});

test("assigning an absent person as titular of an existing service opens cases for the absent days", () => {
  const o = run("INSERT INTO organizations (name) VALUES ('Swap')");
  const c = run("INSERT INTO clients (org_id, name) VALUES (?, 'C')", o);
  const l = run("INSERT INTO locations (org_id, client_id, name) VALUES (?, ?, 'Hotel')", o, c);
  const a = emp("Gala", o, "");
  const b = emp("Hugo", o, "");
  run("INSERT INTO absences (org_id, employee_id, start_date, end_date, reason_category) VALUES (?, ?, '2026-11-30', '2026-11-30', 'personal')", o, b);
  const { id } = svc.createTemplate(o, l, input({ weekdays: [1], defaultEmployeeId: a }), "test", clock);
  const g = svc.updateTemplate(o, id, input({ weekdays: [1], defaultEmployeeId: b }), "test", clock).generation;
  assert.equal(g.cases, 1);
  const shifts = shiftsOf(id);
  assert.equal(shifts.find((s) => s.date === "2026-11-30")!.status, "uncovered");
  assert.equal(shifts.find((s) => s.date === "2026-12-07")?.employee_id ?? b, b);
});

test("T-021#6: a deactivated titular gets no new shifts; they are generated uncovered", () => {
  const o = run("INSERT INTO organizations (name) VALUES ('Gone')");
  const c = run("INSERT INTO clients (org_id, name) VALUES (?, 'C')", o);
  const l = run("INSERT INTO locations (org_id, client_id, name) VALUES (?, ?, 'Nave')", o, c);
  const e = emp("Ida", o, "");
  const { id } = svc.createTemplate(o, l, input({ weekdays: [1], defaultEmployeeId: e }), "test", clock);
  run("UPDATE employees SET active = 0 WHERE id = ?", e);
  svc.rollShiftWindow(o, { today: "2026-12-08" });
  const added = shiftsOf(id).find((s) => s.date === "2026-12-14")!;
  assert.deepEqual([added.employee_id, added.status], [null, "uncovered"]);
});
