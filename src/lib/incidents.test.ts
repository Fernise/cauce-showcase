process.env.CAUCE_DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";

const { run, get } = await import("./db.ts");
const inc = await import("./incidents.ts");

const org = run("INSERT INTO organizations (name) VALUES ('A')");
const other = run("INSERT INTO organizations (name) VALUES ('B')");
const client = run("INSERT INTO clients (org_id, name) VALUES (?, 'Hotel')", org);
const location = run("INSERT INTO locations (org_id, client_id, name) VALUES (?, ?, 'Hotel')", org, client);
const foreignClient = run("INSERT INTO clients (org_id, name) VALUES (?, 'Ajeno')", other);
const emp = run("INSERT INTO employees (org_id, name) VALUES (?, 'Eva')", org);
run("INSERT INTO shifts (org_id, location_id, title, date, start, end, employee_id) VALUES (?, ?, 'Hab', '2026-11-23', '07:00', '11:00', ?)", org, location, emp);

const base = { type: "calidad" as const, severity: "media" as const, title: "Sucio", description: null, rawMessage: null, ownerUserId: null, actor: "C", today: "2026-11-23" };

test("incident links client, latest service and responsible employee", () => {
  const id = inc.createIncident({ ...base, orgId: org, clientId: null, locationId: location });
  const i = inc.getIncident(org, id)!;
  assert.equal(i.client_id, client);
  assert.equal(i.employee_id, emp);
  assert.equal(i.status, "abierta");
  inc.setIncidentStatus(org, id, "resuelta", "Repasado", "C");
  assert.equal(inc.getIncident(org, id)!.status, "resuelta");
  assert.equal(inc.incidentTimeline(org, id).length, 2);
});

test("ids from another organization are dropped", () => {
  const id = inc.createIncident({ ...base, orgId: org, clientId: foreignClient, locationId: 9999 });
  const i = get<{ client_id: number | null; location_id: number | null }>("SELECT client_id, location_id FROM incidents WHERE id = ?", id)!;
  assert.equal(i.client_id, null);
  assert.equal(i.location_id, null);
  assert.equal(inc.getIncident(other, id), undefined);
});
