process.env.CAUCE_DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";

const { run, all } = await import("./db.ts");
const { importEmployeesCsv, parseAvailability } = await import("./import.ts");
const org = run("INSERT INTO organizations (name) VALUES ('A')");

test("T-015#14: invalid hours and times are rejected per row; blank hours default to 30", () => {
  const csv = "nombre;horas;disponibilidad\nAna;-5;L-V 06:00-15:00\nBea;0;\nCris;;L-V 99:00-99:59\nDani;25,5;L,X 07:00-13:00";
  const r = importEmployeesCsv(org, csv, "test");
  assert.equal(r.created, 2);
  assert.ok(r.errors.some((e) => e.includes("Ana")));
  assert.ok(r.errors.some((e) => e.includes("Bea")));
  assert.ok(r.errors.some((e) => e.includes("99:00")));
  const rows = all<{ name: string; weekly_hours: number }>("SELECT name, weekly_hours FROM employees ORDER BY name");
  assert.deepEqual(rows.map((r) => [r.name, r.weekly_hours]), [["Cris", 30], ["Dani", 25.5]]);
});

test("availability parser", () => {
  assert.deepEqual(parseAvailability("L,X 07:00-13:00").map((a) => a.weekday), [1, 3]);
  assert.equal(parseAvailability("L-V 15:00-07:00").length, 0);
});
