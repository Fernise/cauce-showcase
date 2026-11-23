import { test } from "node:test";
import assert from "node:assert/strict";
import { rankCandidates, type Candidate, type TargetShift } from "./ranking.ts";

const target: TargetShift = {
  id: 1,
  date: "2026-11-24", // Tuesday
  start: "07:00",
  end: "11:00",
  locationId: 100,
  locationName: "Hotel Mencey",
  point: { lat: 28.468, lng: -16.26 },
  requiredSkills: [],
};
const settings = { travelBufferMin: 30, maxWeeklyHours: 40 };
const fullWeek = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "06:00", end: "22:00" }));

function cand(over: Partial<Candidate>): Candidate {
  return {
    id: 1, name: "A", active: true, home: { lat: 28.47, lng: -16.27 }, zone: "Santa Cruz",
    weeklyHours: 30, skills: [], availability: fullWeek, absentDates: [], weekShifts: [],
    visitsToLocation60d: 0, substitutionsLast30d: 0, ...over,
  };
}

test("hard filters exclude with reasons", () => {
  const r = rankCandidates(target, [
    cand({ id: 1, name: "Absent", absentDates: ["2026-11-24"] }),
    cand({ id: 2, name: "Busy", weekShifts: [{ id: 9, date: "2026-11-24", start: "10:30", end: "14:00", locationId: 2, locationName: "Oficinas", point: null }] }),
    cand({ id: 3, name: "Weekend", availability: [{ weekday: 6, start: "06:00", end: "22:00" }] }),
    cand({ id: 4, name: "Unskilled" }),
    cand({ id: 5, name: "Full", weekShifts: [{ id: 8, date: "2026-11-23", start: "00:00", end: "23:00", locationId: 2, locationName: "X", point: null }, { id: 7, date: "2026-11-25", start: "05:00", end: "23:00", locationId: 2, locationName: "X", point: null }] }),
  ], settings);
  const reasons = Object.fromEntries(r.excluded.map((e) => [e.name, e.reason]));
  assert.match(reasons.Absent, /Ausente/);
  assert.match(reasons.Busy, /Coincide/);
  assert.match(reasons.Weekend, /disponibilidad/);
  assert.match(reasons.Full, /máximo/);
  assert.equal(r.ranked.map((c) => c.name).join(), "Unskilled");
});

test("required skills are enforced", () => {
  const r = rankCandidates({ ...target, requiredSkills: ["sanitario"] }, [cand({ id: 1, name: "No" }), cand({ id: 2, name: "Yes", skills: ["sanitario"] })], settings);
  assert.deepEqual(r.ranked.map((c) => c.name), ["Yes"]);
  assert.match(r.excluded[0].reason, /Centros sanitarios/);
});

test("closer, familiar, no-overtime candidate ranks first", () => {
  const far = cand({ id: 1, name: "Far", home: { lat: 28.08, lng: -16.73 }, zone: "Adeje" });
  const near = cand({ id: 2, name: "Near", visitsToLocation60d: 4 });
  const overtime = cand({ id: 3, name: "Overtime", weeklyHours: 18, visitsToLocation60d: 4, weekShifts: [{ id: 5, date: "2026-11-23", start: "07:00", end: "15:00", locationId: 3, locationName: "X", point: null }, { id: 6, date: "2026-11-25", start: "07:00", end: "15:00", locationId: 3, locationName: "X", point: null }] });
  const r = rankCandidates(target, [far, near, overtime], settings);
  assert.equal(r.ranked[0].name, "Near");
  assert.equal(r.ranked.at(-1)!.name, "Far");
  const ot = r.ranked.find((c) => c.name === "Overtime")!;
  assert.equal(ot.overtimeHours, 2);
  assert.ok(ot.reasons.some((x) => x.kind === "con" && x.text.includes("Horas extra")));
});

test("proximity uses previous shift location when nearer than home", () => {
  const c = cand({
    id: 1, name: "Chain", home: { lat: 28.08, lng: -16.73 }, zone: "Adeje",
    weekShifts: [{ id: 5, date: "2026-11-24", start: "04:00", end: "06:30", locationId: 7, locationName: "Oficinas Puerto", point: { lat: 28.469, lng: -16.25 } }],
  });
  const r = rankCandidates(target, [c], settings);
  assert.ok(r.ranked[0].distanceKm! < 3);
  assert.ok(r.ranked[0].reasons[0].text.includes("Oficinas Puerto"));
});

test("absent employee is excluded by id", () => {
  const r = rankCandidates(target, [cand({ id: 1, name: "Original" }), cand({ id: 2, name: "Other" })], settings, [1]);
  assert.deepEqual(r.ranked.map((c) => c.name), ["Other"]);
  assert.equal(r.excluded.length, 0);
});

test("cannot reach the next service in time", () => {
  const c = cand({
    id: 1, name: "Rush",
    weekShifts: [{ id: 5, date: "2026-11-24", start: "11:45", end: "14:00", locationId: 7, locationName: "Playa Sur", point: { lat: 28.051, lng: -16.716 } }],
  });
  const r = rankCandidates(target, [c], settings);
  assert.equal(r.ranked.length, 0);
  assert.match(r.excluded[0].reason, /No llegaría a Playa Sur/);
});
