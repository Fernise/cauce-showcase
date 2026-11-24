// Integration test of the primary workflow against an in-memory database.
process.env.CAUCE_DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";

const { run, get, all } = await import("./db.ts");
const cov = await import("./coverage.ts");

const TODAY = "2030-01-07"; // Monday, far future so "already started" checks never trigger
const org = run("INSERT INTO organizations (name) VALUES ('Test')");
const otherOrg = run("INSERT INTO organizations (name) VALUES ('Other')");
const loc = (name: string, lat: number, lng: number, o = org) => {
  const client = run("INSERT INTO clients (org_id, name) VALUES (?, ?)", o, name);
  return run("INSERT INTO locations (org_id, client_id, name, lat, lng) VALUES (?, ?, ?, ?, ?)", o, client, name, lat, lng);
};
const emp = (name: string, lat: number, lng: number, o = org) => {
  const id = run("INSERT INTO employees (org_id, name, lat, lng, weekly_hours, phone) VALUES (?, ?, ?, ?, 30, '600000000')", o, name, lat, lng);
  for (let d = 1; d <= 7; d++) run("INSERT INTO availability (employee_id, weekday, start, end) VALUES (?, ?, '06:00', '22:00')", id, d);
  return id;
};
const hotel = loc("Hotel", 28.468, -16.26);
const absent = emp("Ana Ausente", 28.47, -16.26);
const near = emp("Bea Cerca", 28.469, -16.261);
const far = emp("Carla Lejos", 28.05, -16.71);
const foreign = emp("Dora OtraEmpresa", 28.468, -16.26, otherOrg);
const shift = run(
  "INSERT INTO shifts (org_id, location_id, title, date, start, end, employee_id) VALUES (?, ?, 'Habitaciones', '2030-01-08', '07:00', '11:00', ?)",
  org, hotel, absent,
);

test("absence opens one case per affected shift and unassigns it", () => {
  const { caseIds } = cov.registerAbsence({
    orgId: org, employeeId: absent, start: "2030-01-08", end: "2030-01-08", reason: "fiebre",
    reasonCategory: "enfermedad", rawMessage: null, source: "test", actor: "Coord", today: TODAY,
  });
  assert.equal(caseIds.length, 1);
  const s = get<{ employee_id: number | null; status: string }>("SELECT employee_id, status FROM shifts WHERE id = ?", shift)!;
  assert.equal(s.employee_id, null);
  assert.equal(s.status, "uncovered");
});

test("ranking excludes the absent employee and other tenants, nearest first", () => {
  const r = cov.rankForShift(org, shift, [absent]);
  const ids = r.ranked.map((c) => c.employeeId);
  assert.deepEqual(ids, [near, far]);
  assert.ok(!ids.includes(foreign));
});

test("first acceptance wins; later acceptances are too late", () => {
  const caseId = get<{ id: number }>("SELECT id FROM coverage_cases WHERE shift_id = ?", shift)!.id;
  const o1 = cov.createOffer(org, caseId, near, "Coord", 90);
  const o2 = cov.createOffer(org, caseId, far, "Coord", 40);
  const t1 = get<{ token: string }>("SELECT token FROM offers WHERE id = ?", o1)!.token;
  const t2 = get<{ token: string }>("SELECT token FROM offers WHERE id = ?", o2)!.token;
  assert.equal(cov.getCase(org, caseId)!.status, "offering");

  assert.equal(cov.respondToOffer(t1, true), "accepted");
  assert.equal(cov.respondToOffer(t2, true), "too_late");
  assert.equal(cov.respondToOffer(t1, true), "already_answered");

  const c = cov.getCase(org, caseId)!;
  assert.equal(c.status, "covered");
  assert.equal(c.resolved_employee_id, near);
  assert.equal(get<{ employee_id: number }>("SELECT employee_id FROM shifts WHERE id = ?", shift)!.employee_id, near);
  const types = all<{ type: string }>("SELECT type FROM activity WHERE entity_type = 'case' AND entity_id = ? ORDER BY id", caseId).map((a) => a.type);
  assert.deepEqual(types, ["case.opened", "offer.sent", "offer.sent", "offer.accepted", "case.covered"]);
});

test("cross-tenant access is rejected", () => {
  const caseId = get<{ id: number }>("SELECT id FROM coverage_cases WHERE shift_id = ?", shift)!.id;
  assert.equal(cov.getCase(otherOrg, caseId), undefined);
  assert.throws(() => cov.assignDirectly(otherOrg, caseId, foreign, "x"));
});

test("cancelling an absence gives open services back", () => {
  const s2 = run(
    "INSERT INTO shifts (org_id, location_id, title, date, start, end, employee_id) VALUES (?, ?, 'Zonas comunes', '2030-01-09', '07:00', '09:00', ?)",
    org, hotel, near,
  );
  const { absenceId, caseIds } = cov.registerAbsence({
    orgId: org, employeeId: near, start: "2030-01-09", end: "2030-01-09", reason: null,
    reasonCategory: "otro", rawMessage: null, source: "test", actor: "Coord", today: TODAY,
  });
  cov.cancelAbsence(org, absenceId, "Coord");
  assert.equal(get<{ employee_id: number }>("SELECT employee_id FROM shifts WHERE id = ?", s2)!.employee_id, near);
  assert.equal(cov.getCase(org, caseIds[0])!.status, "cancelled");
});

// ---------- Regression tests for review T-015 ----------

function openCase(employeeId: number, date: string, start: string, end: string, title: string) {
  const s = run("INSERT INTO shifts (org_id, location_id, title, date, start, end, employee_id) VALUES (?, ?, ?, ?, ?, ?, ?)", org, hotel, title, date, start, end, employeeId);
  const { caseIds } = cov.registerAbsence({ orgId: org, employeeId, start: date, end: date, reason: null, reasonCategory: "otro", rawMessage: null, source: "test", actor: "C", today: TODAY });
  return { shiftId: s, caseId: caseIds[0] };
}
const tokenOf = (offerId: number) => get<{ token: string }>("SELECT token FROM offers WHERE id = ?", offerId)!.token;

test("T-015#2: a stale offer cannot double-book someone who already accepted an overlapping service", () => {
  const sub = emp("Eli Suplente", 28.469, -16.261);
  const a = openCase(far, "2030-01-10", "08:00", "12:00", "A");
  const b = openCase(near, "2030-01-10", "09:00", "11:00", "B");
  const oa = cov.createOffer(org, a.caseId, sub, "C", null);
  const ob = cov.createOffer(org, b.caseId, sub, "C", null);
  assert.equal(cov.respondToOffer(tokenOf(oa), true), "accepted");
  assert.equal(cov.respondToOffer(tokenOf(ob), true), "unavailable");
  assert.equal(cov.getCase(org, b.caseId)!.status, "open");
  assert.throws(() => cov.assignDirectly(org, b.caseId, sub, "C"), /no puede cubrirlo/);
});

test("T-015#5: links for services that already started expire", () => {
  const sub = emp("Fran Tarde", 28.469, -16.261);
  const owner = emp("Gema", 28.469, -16.261);
  const s = run("INSERT INTO shifts (org_id, location_id, title, date, start, end, employee_id) VALUES (?, ?, 'Pasado', '2020-01-06', '07:00', '09:00', ?)", org, hotel, owner);
  const caseId = run("INSERT INTO coverage_cases (org_id, shift_id, original_employee_id, status) VALUES (?, ?, ?, 'offering')", org, s, owner);
  run("UPDATE shifts SET employee_id = NULL, status = 'uncovered' WHERE id = ?", s);
  run("INSERT INTO offers (org_id, case_id, employee_id, token, message) VALUES (?, ?, ?, 'old-token', 'x')", org, caseId, sub);
  assert.equal(cov.respondToOffer("old-token", true), "expired");
  assert.equal(get<{ employee_id: number | null }>("SELECT employee_id FROM shifts WHERE id = ?", s)!.employee_id, null);
  assert.throws(() => cov.createOffer(org, caseId, sub, "C", null), /ya ha empezado/);
});

test("T-015#6: cancelling one of two overlapping absences keeps the service uncovered", () => {
  const h = emp("Hilda Doble", 28.469, -16.261);
  const { shiftId } = openCase(h, "2030-01-11", "07:00", "09:00", "Doble");
  // Overlaps are now rejected (T-021 #7); databases from before that rule may still contain them.
  const second = run("INSERT INTO absences (org_id, employee_id, start_date, end_date, reason_category) VALUES (?, ?, '2030-01-11', '2030-01-11', 'otro')", org, h);
  const first = get<{ id: number }>("SELECT id FROM absences WHERE employee_id = ? AND id != ? ORDER BY id LIMIT 1", h, second)!.id;
  cov.cancelAbsence(org, first, "C");
  assert.equal(get<{ employee_id: number | null }>("SELECT employee_id FROM shifts WHERE id = ?", shiftId)!.employee_id, null);
});

test("T-015#6: cancelling an absence also restores a service closed as 'sin cobertura'", () => {
  const i = emp("Inés", 28.469, -16.261);
  const { shiftId, caseId } = openCase(i, "2030-01-14", "07:00", "09:00", "Unres");
  cov.closeCase(org, caseId, "unresolved", "", "C");
  const absenceId = get<{ absence_id: number }>("SELECT absence_id FROM coverage_cases WHERE id = ?", caseId)!.absence_id;
  cov.cancelAbsence(org, absenceId, "C");
  assert.equal(get<{ employee_id: number }>("SELECT employee_id FROM shifts WHERE id = ?", shiftId)!.employee_id, i);
});

test("T-015#10: direct assignment closes that person's pending offer as accepted", () => {
  const j = emp("Juana", 28.469, -16.261);
  const k = emp("Kati", 28.469, -16.261);
  const { caseId } = openCase(j, "2030-01-15", "07:00", "09:00", "Direct");
  const o = cov.createOffer(org, caseId, k, "C", null);
  cov.assignDirectly(org, caseId, k, "C");
  assert.equal(get<{ status: string }>("SELECT status FROM offers WHERE id = ?", o)!.status, "accepted");
});

test("T-015#12: impossible calendar dates are rejected", () => {
  assert.throws(() => cov.registerAbsence({ orgId: org, employeeId: near, start: "2030-02-30", end: "2030-02-30", reason: null, reasonCategory: "otro", rawMessage: null, source: "t", actor: "C", today: TODAY }), /no válida/);
});

test("T-015#1: access notes are only released to the confirmed assignee", () => {
  run("UPDATE locations SET access_notes = 'Código alarma 1234' WHERE id = ?", hotel);
  const l = emp("Lola", 28.469, -16.261);
  const m = emp("Marta", 28.469, -16.261);
  const n = emp("Nuria", 28.469, -16.261);
  const { caseId } = openCase(l, "2030-01-16", "07:00", "09:00", "Notes");
  const om = cov.createOffer(org, caseId, m, "C", null);
  const on = cov.createOffer(org, caseId, n, "C", null);
  assert.equal(cov.accessNotesForToken(tokenOf(om)), null); // pending
  cov.respondToOffer(tokenOf(om), true);
  assert.equal(cov.accessNotesForToken(tokenOf(om)), "Código alarma 1234");
  assert.equal(cov.accessNotesForToken(tokenOf(on)), null); // withdrawn, never confirmed
});

test("D-012: absences store only the reason category (no message, no health detail)", () => {
  const p = emp("Paula", 28.469, -16.261);
  const { absenceId } = cov.registerAbsence({ orgId: org, employeeId: p, start: "2030-02-04", end: "2030-02-04", reason: "fiebre alta", reasonCategory: "enfermedad", rawMessage: "Hola, tengo fiebre", source: "mensaje", actor: "C", today: TODAY });
  const a = get<{ reason: string | null; raw_message: string | null; reason_category: string }>("SELECT reason, raw_message, reason_category FROM absences WHERE id = ?", absenceId)!;
  assert.deepEqual([a.reason, a.raw_message, a.reason_category], [null, null, "enfermedad"]);
});

// ---------- T-021 review fixes ----------

const reg = (employeeId: number, start: string, end: string, extra: Record<string, unknown> = {}) =>
  cov.registerAbsence({ orgId: org, employeeId, start, end, reason: null, reasonCategory: "otro", rawMessage: null, source: "t", actor: "C", today: TODAY, ...extra } as Parameters<typeof cov.registerAbsence>[0]);

test("T-021#7: an overlapping absence for the same person is rejected and points to the existing one", () => {
  const p = emp("Paula Solape", 28.469, -16.261);
  const { absenceId } = reg(p, "2030-02-04", "2030-02-06");
  assert.throws(() => reg(p, "2030-02-06", "2030-02-08"), (e: unknown) => e instanceof cov.AbsenceOverlapError && e.existingId === absenceId);
  assert.doesNotThrow(() => reg(p, "2030-02-07", "2030-02-08"), "adjacent new days are fine");
});

test("T-021#5: only the fixed reason categories can be stored", () => {
  const q = emp("Queta Motivo", 28.469, -16.261);
  assert.throws(() => reg(q, "2030-02-11", "2030-02-11", { reasonCategory: "gripe y fiebre alta" }), /Motivo no válido/);
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM absences WHERE employee_id = ?", q)!.n, 0);
});

test("T-021#3: services of today that already ended are not reopened by a late 'hoy'", () => {
  const r = emp("Rosa Tarde", 28.469, -16.261);
  const loc = get<{ id: number }>("SELECT id FROM locations WHERE org_id = ? LIMIT 1", org)!.id;
  const morning = run("INSERT INTO shifts (org_id, location_id, title, date, start, end, employee_id) VALUES (?, ?, 'M', '2030-02-12', '08:00', '10:00', ?)", org, loc, r);
  const evening = run("INSERT INTO shifts (org_id, location_id, title, date, start, end, employee_id) VALUES (?, ?, 'E', '2030-02-12', '18:00', '21:00', ?)", org, loc, r);
  const { caseIds } = reg(r, "2030-02-12", "2030-02-12", { today: "2030-02-12", nowTime: "20:00" });
  assert.equal(caseIds.length, 1, "only the evening service (in progress) is opened");
  assert.equal(get<{ employee_id: number }>("SELECT employee_id FROM shifts WHERE id = ?", morning)!.employee_id, r);
  assert.equal(get<{ shift_id: number }>("SELECT shift_id FROM coverage_cases WHERE id = ?", caseIds[0])!.shift_id, evening);
});

test("T-021#6: cancelling an absence does not hand services back to a deactivated employee", () => {
  const s = emp("Sara Baja", 28.469, -16.261);
  const { shiftId } = openCase(s, "2030-02-13", "07:00", "09:00", "Gone");
  const absenceId = get<{ id: number }>("SELECT id FROM absences WHERE employee_id = ? ORDER BY id DESC LIMIT 1", s)!.id;
  run("UPDATE employees SET active = 0 WHERE id = ?", s);
  cov.cancelAbsence(org, absenceId, "C");
  assert.equal(get<{ employee_id: number | null }>("SELECT employee_id FROM shifts WHERE id = ?", shiftId)!.employee_id, null);
});
