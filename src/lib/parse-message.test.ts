import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDates, parseMessageRules, type Directory } from "./parse-message.ts";

const dir: Directory = {
  employees: [
    { id: 1, name: "Yurena Díaz Hernández" },
    { id: 2, name: "María González Pérez" },
    { id: 3, name: "María Rodríguez Afonso" },
    { id: 4, name: "Carmen Delgado" },
  ],
  clients: [
    { id: 10, name: "Hotel Mencey" },
    { id: 11, name: "Clínica Dental Sonríe" },
  ],
  locations: [
    { id: 100, name: "Hotel Mencey", clientId: 10, municipality: "Santa Cruz" },
    { id: 101, name: "Clínica Sonríe La Laguna", clientId: 11, municipality: "La Laguna" },
    { id: 102, name: "Clínica Sonríe Adeje", clientId: 11, municipality: "Adeje" },
  ],
};
const TODAY = "2026-11-23"; // Monday

test("absence: name, tomorrow, family reason", () => {
  const p = parseMessageRules("Hola Carmen, soy Yurena Díaz. Mañana no voy a poder ir a trabajar, el peque tiene fiebre.", dir, TODAY);
  assert.equal(p.kind, "absence");
  assert.equal(p.employeeId, 1);
  assert.equal(p.startDate, "2026-11-24");
  assert.equal(p.endDate, "2026-11-24");
  assert.equal(p.reasonCategory, "enfermedad"); // "fiebre" wins: first category matched
});

test("absence: ambiguous first name is flagged", () => {
  const p = parseMessageRules("Soy María, hoy no puedo ir, estoy con gripe", dir, TODAY);
  assert.equal(p.employeeId, null);
  assert.deepEqual(p.employeeCandidates.sort(), [2, 3]);
  assert.equal(p.startDate, TODAY);
  assert.ok(p.warnings.some((w) => w.includes("varias personas")));
});

test("absence: missing date assumes today with warning", () => {
  const p = parseMessageRules("Carmen Delgado: no puedo ir, se me rompió el coche", dir, TODAY);
  assert.equal(p.employeeId, 4);
  assert.equal(p.dateExplicit, false);
  assert.equal(p.reasonCategory, "transporte");
});

test("dates: ranges, weekdays, N days", () => {
  assert.deepEqual(parseDates("del 25 al 27", TODAY), { start: "2026-11-25", end: "2026-11-27", explicit: true });
  assert.deepEqual(parseDates("el jueves no puedo", TODAY), { start: "2026-11-26", end: "2026-11-26", explicit: true });
  assert.deepEqual(parseDates("el lunes no puedo", TODAY), { start: "2026-11-30", end: "2026-11-30", explicit: true });
  assert.deepEqual(parseDates("manana y estare dos dias de baja", TODAY), { start: "2026-11-24", end: "2026-11-25", explicit: true });
  assert.deepEqual(parseDates("toda la semana", TODAY), { start: TODAY, end: "2026-11-29", explicit: true });
  assert.deepEqual(parseDates("pasado manana", TODAY), { start: "2026-11-25", end: "2026-11-25", explicit: true });
});

test("incident: client complaint linked to location", () => {
  const p = parseMessageRules("Buenos días, en el Hotel Mencey esta mañana no ha venido nadie a limpiar las habitaciones. Es urgente.", dir, TODAY);
  assert.equal(p.kind, "incident");
  assert.equal(p.clientId, 10);
  assert.equal(p.locationId, 100);
  assert.equal(p.incidentType, "no_realizado");
  assert.equal(p.severity, "alta");
});

test("incident: client with several locations asks which one", () => {
  const p = parseMessageRules("Desde la Clínica Sonríe: los baños estaban sucios otra vez", dir, TODAY);
  assert.equal(p.kind, "incident");
  assert.equal(p.clientId, 11);
  assert.equal(p.locationId, null);
  assert.equal(p.incidentType, "calidad");
});

// ---------- Regression tests for review T-015 ----------
const dir2: Directory = { ...dir, employees: [...dir.employees, { id: 5, name: "Nayra Pérez León" }] };

test("T-015#8: the greeted person is not the absent one; self-identification wins", () => {
  const p = parseMessageRules("Hola Yurena Díaz, soy Nayra. Mañana no puedo ir", dir2, TODAY);
  assert.equal(p.kind, "absence");
  assert.equal(p.employeeId, 5);
});

test("T-015#8: a signature at the end identifies the sender", () => {
  const p = parseMessageRules("Buenos días Carmen, me he levantado con fiebre, hoy no voy a poder ir. Nayra", dir2, TODAY);
  assert.equal(p.employeeId, 5);
});

test("T-015#8: a client reporting a no-show is an incident, with a hint to register the absence", () => {
  const p = parseMessageRules("Hoy no ha venido Nayra Pérez, nos dijo que está de baja por fiebre", dir2, TODAY);
  assert.equal(p.kind, "incident");
  assert.ok(p.warnings.some((w) => w.includes("registra también la ausencia")));
});

test("T-015#13: 'mañana por la mañana' means tomorrow; ranges roll over the year", () => {
  assert.equal(parseDates("manana por la manana no puedo", TODAY).start, "2026-11-24");
  assert.equal(parseDates("esta manana no puedo", TODAY).start, TODAY);
  assert.deepEqual(parseDates("del 30/12 al 02/01", "2026-12-20"), { start: "2026-12-30", end: "2027-01-02", explicit: true });
  assert.equal(parseDates("el 3/1 no puedo", "2026-12-20").start, "2027-01-03");
});
