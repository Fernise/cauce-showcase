// Employees / clients / locations: validation, zone coordinates, org isolation, activity log. In-memory DB.
process.env.CAUCE_DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";

const { run, get, all } = await import("./db.ts");
const admin = await import("./admin.ts");
const { NotFoundError, ValidationError, rawValues } = await import("./validation.ts");
const { findZone, ZONES, ZONE_OTHER } = await import("./zones.ts");

const org = run("INSERT INTO organizations (name) VALUES ('Test')");
const otherOrg = run("INSERT INTO organizations (name) VALUES ('Other')");
const foreignEmp = run("INSERT INTO employees (org_id, name) VALUES (?, 'Dora')", otherOrg);
const foreignClient = run("INSERT INTO clients (org_id, name) VALUES (?, 'Ajeno')", otherOrg);
const foreignLoc = run("INSERT INTO locations (org_id, client_id, name) VALUES (?, ?, 'Ajeno Centro')", otherOrg, foreignClient);

const form = (fields: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};
const errorsOf = (fn: () => unknown): string[] => {
  try { fn(); } catch (e) { assert.ok(e instanceof ValidationError, String(e)); return e.errors; }
  return [];
};
const weekdays = (days: number[], start = "06:00", end = "15:00") =>
  Object.fromEntries(days.flatMap((d) => [[`av_${d}_on`, "on"], [`av_${d}_start`, start], [`av_${d}_end`, end]]));
const employeeForm = (over: Record<string, string | string[]> = {}) => ({
  name: "Ana Pérez", phone: "600 111 222", email: "ANA@Ejemplo.es", zone: "La Laguna", weeklyHours: "30,5",
  skills: ["cristales", "llaves"], notes: "Sin coche", ...weekdays([1, 2, 3, 4, 5]), ...over,
});

test("zones table covers the seed zones and resolves aliases", () => {
  for (const z of ["Santa Cruz", "La Laguna", "Taco", "Tacoronte", "La Orotava", "Puerto de la Cruz", "Los Realejos", "Candelaria", "Güímar", "Adeje", "Los Cristianos", "San Isidro"]) {
    assert.ok(findZone(z), z);
  }
  assert.equal(findZone("santa cruz de tenerife")?.name, "Santa Cruz");
  assert.equal(findZone("GUIMAR")?.name, "Güímar");
  assert.equal(findZone("Marte"), null);
  assert.ok(ZONES.some((z) => z.island === "Gran Canaria") && new Set(ZONES.map((z) => z.name)).size === ZONES.length);
  assert.ok(ZONES.every((z) => z.lat > 27 && z.lat < 29 && z.lng > -17 && z.lng < -15));
});

test("employee form: valid input is normalised, zone gets coordinates", () => {
  const e = admin.parseEmployeeForm(form(employeeForm()));
  assert.equal(e.email, "ana@ejemplo.es");
  assert.equal(e.weeklyHours, 30.5);
  assert.deepEqual(e.skills, ["cristales", "llaves"]);
  assert.deepEqual([e.zone.name, e.zone.lat, e.zone.lng], ["La Laguna", 28.4874, -16.3159]);
  assert.equal(e.availability.length, 5);
});

test("employee form: free-text zone keeps lat/lng null; a known name typed as free text still resolves", () => {
  const free = admin.parseEmployeeForm(form(employeeForm({ zone: ZONE_OTHER, zoneOther: "Urbanización Los Pinos" })));
  assert.deepEqual([free.zone.name, free.zone.lat, free.zone.lng], ["Urbanización Los Pinos", null, null]);
  const typed = admin.parseEmployeeForm(form(employeeForm({ zone: ZONE_OTHER, zoneOther: "adeje" })));
  assert.deepEqual([typed.zone.name, typed.zone.lat !== null], ["Adeje", true]);
  const none = admin.parseEmployeeForm(form(employeeForm({ zone: "" })));
  assert.deepEqual([none.zone.name, none.zone.lat], [null, null]);
});

test("employee form validation messages (Spanish, all at once)", () => {
  const bad = errorsOf(() => admin.parseEmployeeForm(form({
    name: "", phone: "12", email: "no-email", weeklyHours: "0", skills: ["magia"], ...weekdays([1], "10:00", "09:00"),
  }))).join("\n");
  assert.match(bad, /nombre es obligatorio/);
  assert.match(bad, /teléfono no es válido/);
  assert.match(bad, /email no es válido/);
  assert.match(bad, /horas semanales .* entre 1 y 60/);
  assert.match(bad, /Cualificación desconocida: magia/);
  assert.match(bad, /Disponibilidad del lunes: la hora de fin debe ser posterior/);
  assert.match(errorsOf(() => admin.parseEmployeeForm(form(employeeForm({ weeklyHours: "61" })))).join(), /entre 1 y 60/);
  assert.match(errorsOf(() => admin.parseEmployeeForm(form(employeeForm({ weeklyHours: "abc" })))).join(), /entre 1 y 60/);
  assert.match(errorsOf(() => admin.parseEmployeeForm(form({ ...employeeForm(), av_1_on: "on", av_1_start: "", av_1_end: "" }))).join(), /Disponibilidad del lunes: indica hora/);
  const noDays = Object.fromEntries(Object.entries(employeeForm()).filter(([k]) => !k.startsWith("av_")));
  assert.match(errorsOf(() => admin.parseEmployeeForm(form(noDays))).join(), /al menos un día de disponibilidad/);
});

test("create → edit employee round trip; coordinates survive an unchanged zone", () => {
  const id = admin.createEmployee(org, admin.parseEmployeeForm(form(employeeForm())), "Coord");
  assert.deepEqual(admin.employeeAvailability(id).map((a) => a.weekday), [1, 2, 3, 4, 5]);
  // Pretend a more precise position was stored (e.g. by a future geocoder).
  run("UPDATE employees SET lat = 28.5, lng = -16.3 WHERE id = ?", id);

  admin.updateEmployee(org, id, admin.parseEmployeeForm(form(employeeForm({ name: "Ana P. Luis", notes: "", ...weekdays([6, 7], "08:00", "12:00"), av_1_on: "", av_2_on: "" }))), "Coord");
  let e = admin.getEmployee(org, id)!;
  assert.deepEqual([e.name, e.notes, e.lat, e.lng, e.zone], ["Ana P. Luis", null, 28.5, -16.3, "La Laguna"]);
  assert.deepEqual(admin.employeeAvailability(id).map((a) => [a.weekday, a.start]), [[3, "06:00"], [4, "06:00"], [5, "06:00"], [6, "08:00"], [7, "08:00"]]);

  admin.updateEmployee(org, id, admin.parseEmployeeForm(form(employeeForm({ zone: "Adeje" }))), "Coord");
  e = admin.getEmployee(org, id)!;
  assert.deepEqual([e.zone, e.lat, e.lng], ["Adeje", 28.1227, -16.726]);
  assert.deepEqual(all<{ type: string }>("SELECT type FROM activity WHERE entity_type = 'employee' AND entity_id = ? ORDER BY id", id).map((a) => a.type), [
    "employee.created", "employee.updated", "employee.updated",
  ]);

  const values = admin.employeeFormValues(e);
  assert.deepEqual([values.zone, values.weeklyHours, values.skills], ["Adeje", "30.5", ["cristales", "llaves"]]);
  assert.equal(admin.employeeFormValues({ ...e, zone: "Urb. X" }).zoneOther, "Urb. X");
});

test("deactivate / reactivate are logged and idempotent", () => {
  const id = admin.createEmployee(org, admin.parseEmployeeForm(form(employeeForm({ name: "Bea" }))), "Coord");
  admin.setEmployeeActive(org, id, false, "Coord");
  assert.equal(admin.getEmployee(org, id)!.active, 0);
  admin.setEmployeeActive(org, id, false, "Coord"); // no-op
  admin.setEmployeeActive(org, id, true, "Coord");
  assert.equal(admin.getEmployee(org, id)!.active, 1);
  assert.deepEqual(all<{ type: string }>("SELECT type FROM activity WHERE entity_id = ? AND type LIKE 'employee.%activ%' ORDER BY id", id).map((a) => a.type), [
    "employee.deactivated", "employee.reactivated",
  ]);
});

test("client form validation and create → edit", () => {
  assert.match(errorsOf(() => admin.parseClientForm(form({ name: "", contactPhone: "1", contactEmail: "x" }))).join("\n"), /nombre es obligatorio[\s\S]*teléfono[\s\S]*email/);
  const id = admin.createClient(org, admin.parseClientForm(form({ name: "Hotel Sol", contactName: "Marta", contactEmail: "M@Sol.es" })), "Coord");
  admin.updateClient(org, id, admin.parseClientForm(form({ name: "Hotel Sol & Mar", contactPhone: "922 000 000", notes: "Facturar a fin de mes" })), "Coord");
  const c = admin.getClient(org, id)!;
  assert.deepEqual([c.name, c.contact_name, c.contact_phone, c.notes], ["Hotel Sol & Mar", null, "922 000 000", "Facturar a fin de mes"]);
  assert.equal(admin.clientFormValues(c).name, "Hotel Sol & Mar");
});

test("location form: municipality → coordinates, skills, create → edit", () => {
  const clientId = admin.createClient(org, admin.parseClientForm(form({ name: "Clínica" })), "Coord");
  assert.match(errorsOf(() => admin.parseLocationForm(form({ name: "", skills: ["x"] }))).join("\n"), /nombre es obligatorio[\s\S]*Cualificación desconocida/);
  const id = admin.createLocation(org, clientId, admin.parseLocationForm(form({ name: "Sede", address: "C/ Mayor 1", zone: "Telde", skills: ["sanitario"], accessNotes: "Timbre 2" })), "Coord");
  let l = admin.getLocation(org, id)!;
  assert.deepEqual([l.municipality, l.lat, l.lng, l.required_skills, l.client_id], ["Telde", 27.992, -15.419, "sanitario", clientId]);

  const back = admin.updateLocation(org, id, admin.parseLocationForm(form({ name: "Sede central", zone: ZONE_OTHER, zoneOther: "Polígono Arinaga", skills: ["sanitario", "llaves"] })), "Coord");
  assert.equal(back, clientId);
  l = admin.getLocation(org, id)!;
  assert.deepEqual([l.name, l.municipality, l.lat, l.lng, l.required_skills], ["Sede central", "Polígono Arinaga", null, null, "sanitario,llaves"]);
  assert.equal(get<{ type: string }>("SELECT type FROM activity WHERE org_id = ? ORDER BY id DESC LIMIT 1", org)!.type, "location.updated");
});

test("ids from another organization are rejected on every admin write", () => {
  const emp = admin.parseEmployeeForm(form(employeeForm()));
  assert.throws(() => admin.updateEmployee(org, foreignEmp, emp, "Coord"), NotFoundError);
  assert.throws(() => admin.setEmployeeActive(org, foreignEmp, false, "Coord"), NotFoundError);
  assert.throws(() => admin.updateClient(org, foreignClient, admin.parseClientForm(form({ name: "X" })), "Coord"), NotFoundError);
  const loc = admin.parseLocationForm(form({ name: "X" }));
  assert.throws(() => admin.createLocation(org, foreignClient, loc, "Coord"), NotFoundError);
  assert.throws(() => admin.updateLocation(org, foreignLoc, loc, "Coord"), NotFoundError);
  assert.equal(admin.getEmployee(org, foreignEmp), undefined);
  assert.equal(admin.getClient(org, foreignClient), undefined);
  assert.equal(admin.getLocation(org, foreignLoc), undefined);
  assert.equal(get<{ name: string; active: number }>("SELECT name, active FROM employees WHERE id = ?", foreignEmp)!.active, 1);
  assert.equal(get<{ name: string }>("SELECT name FROM clients WHERE id = ?", foreignClient)!.name, "Ajeno");
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM locations WHERE client_id = ?", foreignClient)!.n, 1);
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM activity WHERE org_id = ?", otherOrg)!.n, 0, "no activity written in the other org");
});

test("rawValues echoes strings (arrays for repeated keys) and drops action internals", () => {
  const fd = form({ name: "A", skills: ["x", "y"], $ACTION_ID_1: "zz" });
  assert.deepEqual(rawValues(fd), { name: "A", skills: ["x", "y"] });
});
