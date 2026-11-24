// Team management (T-012): invites, resets, roles, deactivation, org isolation. In-memory DB.
process.env.CAUCE_DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { run, get, all, SCHEMA, openDb } = await import("./db.ts");
const { hashPassword, hashToken, login, userForToken, createSession } = await import("./auth.ts");
const users = await import("./users.ts");

const DAY = 86_400_000;
const PW = "una-contraseña-larga";

const orgA = run("INSERT INTO organizations (name) VALUES ('A')");
const orgB = run("INSERT INTO organizations (name) VALUES ('B')");
const mk = (org: number, name: string, email: string, role: string, active = 1) =>
  run("INSERT INTO users (org_id, name, email, password_hash, role, active) VALUES (?, ?, ?, ?, ?, ?)", org, name, email, hashPassword(PW), role, active);
const adminA = mk(orgA, "Carmen", "carmen@a.es", "admin");
const coordA = mk(orgA, "Jonay", "jonay@a.es", "coordinator");
const adminB = mk(orgB, "Boss B", "boss@b.es", "admin");
const coordB = mk(orgB, "Coord B", "coord@b.es", "coordinator");
const A = { id: adminA, orgId: orgA };
const COORD_A = { id: coordA, orgId: orgA };
const B = { id: adminB, orgId: orgB };

const fails = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e) => e instanceof users.UserError && e.code === code, `expected UserError(${code})`);
const sessionsOf = (userId: number) => get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", userId)!.n;
const activity = (type: string) => all<{ summary: string; org_id: number }>("SELECT summary, org_id FROM activity WHERE type = ?", type);

test("invite → accept: creates the user with the invited role, logs them in, single use", async () => {
  const inv = users.createInvite(A, { email: " Ana@Nueva.es ", name: "Ana", role: "coordinator" });
  assert.equal(inv.email, "ana@nueva.es");
  // Only the hash is stored, never the raw token.
  const stored = all<{ token_hash: string }>("SELECT token_hash FROM user_tokens WHERE kind = 'invite'");
  assert.deepEqual(stored.map((r) => r.token_hash), [hashToken(inv.token)]);
  assert.ok(!JSON.stringify(all("SELECT * FROM user_tokens")).includes(inv.token));

  const info = users.getInvite(inv.token);
  assert.deepEqual([info.status, info.email, info.role, info.nameHint, info.orgName], ["ok", "ana@nueva.es", "coordinator", "Ana", "A"]);

  assert.throws(() => users.acceptInvite(inv.token, { name: "Ana", password: "corta" }), /al menos 10/);
  assert.throws(() => users.acceptInvite(inv.token, { name: "  ", password: PW }), /nombre/);
  assert.equal(users.getInvite(inv.token).status, "ok"); // failed attempts do not consume it

  const done = users.acceptInvite(inv.token, { name: "Ana Gil", password: PW });
  const u = get<{ org_id: number; role: string; name: string; email: string }>("SELECT org_id, role, name, email FROM users WHERE id = ?", done.userId)!;
  assert.deepEqual([u.org_id, u.role, u.name, u.email], [orgA, "coordinator", "Ana Gil", "ana@nueva.es"]);
  assert.equal(userForToken(done.session.token)?.id, done.userId);
  assert.equal((await login("ana@nueva.es", PW, "t-invite")).ok, true);

  // single use
  assert.equal(users.getInvite(inv.token).status, "used");
  fails(() => users.acceptInvite(inv.token, { name: "Otra", password: PW }), "invalid");
  assert.equal(activity("user.invited").length >= 1 && activity("user.joined").length >= 1, true);
});

test("invite expiry (7 days), revocation, replacement, unknown token, duplicate email", () => {
  const t0 = Date.parse("2026-12-01T10:00:00Z");
  const inv = users.createInvite(A, { email: "tarde@x.es" }, t0);
  assert.equal(inv.expiresAt, new Date(t0 + 7 * DAY).toISOString());
  assert.equal(users.getInvite(inv.token, t0 + 7 * DAY - 1).status, "ok");
  assert.equal(users.getInvite(inv.token, t0 + 7 * DAY).status, "expired");
  fails(() => users.acceptInvite(inv.token, { name: "Tarde", password: PW }, t0 + 8 * DAY), "invalid");
  assert.equal(get("SELECT 1 FROM users WHERE email = 'tarde@x.es'"), undefined);

  // a newer invite for the same address replaces the older one
  const first = users.createInvite(A, { email: "dos@x.es" }, t0);
  const second = users.createInvite(A, { email: "dos@x.es" }, t0);
  assert.equal(users.getInvite(first.token, t0).status, "revoked");
  assert.equal(users.getInvite(second.token, t0).status, "ok");

  // revocation
  const pending = users.listPendingInvites(A, t0).find((p) => p.email === "dos@x.es")!;
  users.revokeToken(A, pending.id, t0);
  assert.equal(users.getInvite(second.token, t0).status, "revoked");
  fails(() => users.revokeToken(A, pending.id, t0), "not_found");
  assert.equal(users.listPendingInvites(A, t0).some((p) => p.email === "dos@x.es"), false);

  assert.equal(users.getInvite("no-existe").status, "invalid");
  assert.equal(users.getInvite("").status, "invalid");
  fails(() => users.createInvite(A, { email: "carmen@a.es" }), "conflict"); // existing user
  fails(() => users.createInvite(A, { email: "boss@b.es" }), "conflict"); // existing user in another org (email is globally unique)
  fails(() => users.createInvite(A, { email: "no-es-email" }), "invalid");
  fails(() => users.createInvite(A, { email: "ok@x.es", role: "owner" }), "invalid");
});

test("an admin invite creates an admin", () => {
  const inv = users.createInvite(A, { email: "otroadmin@x.es", role: "admin" });
  const done = users.acceptInvite(inv.token, { name: "Otro Admin", password: PW });
  assert.equal(get<{ role: string }>("SELECT role FROM users WHERE id = ?", done.userId)!.role, "admin");
});

test("reset link: 24 h expiry, single use, sets the password and deletes all that user's sessions", async () => {
  const t0 = Date.parse("2026-12-01T10:00:00Z");
  const victim = mk(orgA, "Olvidadiza", "olvido@a.es", "coordinator");
  createSession(victim);
  createSession(victim);
  assert.equal(sessionsOf(victim), 2);
  const reset = users.createResetLink(A, victim, t0);
  assert.equal(reset.expiresAt, new Date(t0 + 24 * 3_600_000).toISOString());
  assert.ok(!JSON.stringify(all("SELECT * FROM user_tokens")).includes(reset.token));
  assert.deepEqual([users.getReset(reset.token, t0).status, users.getReset(reset.token, t0).userName], ["ok", "Olvidadiza"]);

  assert.throws(() => users.completeReset(reset.token, "corta", t0), /al menos 10/);
  users.completeReset(reset.token, "nueva-contraseña-1", t0 + 1000);
  assert.equal(sessionsOf(victim), 0);
  assert.equal((await login("olvido@a.es", PW, "t-reset-1")).ok, false);
  assert.equal((await login("olvido@a.es", "nueva-contraseña-1", "t-reset-2")).ok, true);
  // single use
  assert.equal(users.getReset(reset.token, t0 + 2000).status, "used");
  fails(() => users.completeReset(reset.token, "otra-contraseña-2", t0 + 2000), "invalid");
  assert.equal(activity("user.password_reset").length, 1);

  // expiry
  const late = users.createResetLink(A, victim, t0);
  assert.equal(users.getReset(late.token, t0 + 24 * 3_600_000).status, "expired");
  fails(() => users.completeReset(late.token, "otra-contraseña-2", t0 + 25 * 3_600_000), "invalid");
  // a newer link revokes the older one
  const newer = users.createResetLink(A, victim, t0);
  assert.equal(users.getReset(late.token, t0).status, "revoked");
  assert.equal(users.getReset(newer.token, t0).status, "ok");
  // an invite token is not a reset token and vice versa
  assert.equal(users.getReset(users.createInvite(A, { email: "zz@x.es" }).token).status, "invalid");
});

test("password change: needs the current password, keeps only the current session", async () => {
  const me = mk(orgA, "Cambia", "cambia@a.es", "coordinator");
  const keep = createSession(me).token;
  createSession(me);
  await assert.rejects(users.changePassword({ id: me, orgId: orgA }, { current: "mal-mal-mal-mal", next: "nueva-contraseña-1", keepSessionToken: keep }), /actual no es correcta/);
  assert.equal(sessionsOf(me), 2);
  await assert.rejects(users.changePassword({ id: me, orgId: orgA }, { current: PW, next: "corta", keepSessionToken: keep }), /al menos 10/);
  await users.changePassword({ id: me, orgId: orgA }, { current: PW, next: "nueva-contraseña-1", keepSessionToken: keep });
  assert.equal(sessionsOf(me), 1);
  assert.equal(userForToken(keep)?.id, me);
  assert.equal((await login("cambia@a.es", PW, "t-chg-1")).ok, false);
  assert.equal((await login("cambia@a.es", "nueva-contraseña-1", "t-chg-2")).ok, true);
  assert.equal(activity("user.password_changed").length, 1);
});

test("deactivation: sessions die, login rejected; reactivation restores access", async () => {
  const u = mk(orgA, "Baja", "baja@a.es", "coordinator");
  const s = createSession(u).token;
  assert.equal(userForToken(s)?.id, u);
  users.deactivateUser(A, u);
  assert.equal(sessionsOf(u), 0);
  assert.equal(userForToken(s), null);
  assert.deepEqual(await login("baja@a.es", PW, "t-deact-1"), { ok: false, reason: "invalid" });
  fails(() => users.createResetLink(A, u), "conflict");
  users.reactivateUser(A, u);
  assert.equal((await login("baja@a.es", PW, "t-deact-2")).ok, true);
  assert.equal(activity("user.deactivated").length >= 1 && activity("user.reactivated").length >= 1, true);

  // a session that survives (e.g. inserted before deactivation by another path) still stops working once inactive
  const s2 = createSession(u).token;
  run("UPDATE users SET active = 0 WHERE id = ?", u);
  assert.equal(userForToken(s2), null);
  run("UPDATE users SET active = 1 WHERE id = ?", u);
});

test("a deactivated user's pending reset link stops working", () => {
  const u = mk(orgA, "Reset Baja", "resetbaja@a.es", "coordinator");
  const r = users.createResetLink(A, u);
  users.deactivateUser(A, u);
  assert.equal(users.getReset(r.token).status, "revoked");
  fails(() => users.completeReset(r.token, "nueva-contraseña-1"), "invalid");
});

test("last active admin cannot be demoted or deactivated (self or by another admin)", () => {
  // org B has exactly one admin
  fails(() => users.setRole(B, adminB, "coordinator"), "conflict");
  fails(() => users.deactivateUser(B, adminB), "conflict");
  assert.equal(get<{ role: string; active: number }>("SELECT role, active FROM users WHERE id = ?", adminB)!.role, "admin");
  // with a second admin, either can step down, but not both
  users.setRole(B, coordB, "admin");
  users.setRole(B, adminB, "coordinator"); // allowed: coordB is still admin
  fails(() => users.setRole(B, coordB, "coordinator"), "forbidden"); // adminB is no longer admin → cannot manage
  const B2 = { id: coordB, orgId: orgB };
  fails(() => users.setRole(B2, coordB, "coordinator"), "conflict"); // last one standing
  fails(() => users.deactivateUser(B2, coordB), "conflict");
  // inactive admins do not count
  users.setRole(B2, adminB, "admin");
  users.deactivateUser(B2, adminB); // fine: coordB still active admin
  fails(() => users.setRole(B2, coordB, "coordinator"), "conflict");
  assert.ok(activity("user.role_changed").length >= 3);
});

test("coordinators cannot call any admin function", () => {
  const target = coordA;
  fails(() => users.listTeam(COORD_A), "forbidden");
  fails(() => users.listPendingInvites(COORD_A), "forbidden");
  fails(() => users.createInvite(COORD_A, { email: "x@x.es" }), "forbidden");
  fails(() => users.createResetLink(COORD_A, target), "forbidden");
  fails(() => users.setRole(COORD_A, coordA, "admin"), "forbidden"); // no self-promotion
  fails(() => users.deactivateUser(COORD_A, adminA), "forbidden");
  fails(() => users.reactivateUser(COORD_A, adminA), "forbidden");
  fails(() => users.revokeToken(COORD_A, 1), "forbidden");
  assert.equal(get<{ role: string }>("SELECT role FROM users WHERE id = ?", coordA)!.role, "coordinator");
  // a deactivated admin loses admin powers immediately, even with a still-valid actor object
  const gone = mk(orgA, "Ex Admin", "ex@a.es", "admin");
  users.deactivateUser(A, gone);
  fails(() => users.listTeam({ id: gone, orgId: orgA }), "forbidden");
  // a forged orgId does not make someone an admin of another org
  fails(() => users.listTeam({ id: adminA, orgId: orgB }), "forbidden");
});

test("org isolation: an admin never sees or acts on users and tokens of another org", () => {
  const teamA = users.listTeam(A).map((m) => m.id);
  assert.ok(teamA.includes(adminA) && !teamA.includes(coordB) && !teamA.includes(adminB));
  const teamB = users.listTeam({ id: coordB, orgId: orgB }).map((m) => m.id);
  assert.ok(teamB.every((id) => ![adminA, coordA].includes(id)));

  const before = get<{ role: string; active: number }>("SELECT role, active FROM users WHERE id = ?", coordB)!;
  fails(() => users.setRole(A, coordB, "admin"), "not_found");
  fails(() => users.deactivateUser(A, coordB), "not_found");
  fails(() => users.reactivateUser(A, coordB), "not_found");
  fails(() => users.createResetLink(A, coordB), "not_found");
  assert.deepEqual(get("SELECT role, active FROM users WHERE id = ?", coordB), before);

  // invites of org B are invisible and unrevocable from org A
  const invB = users.createInvite({ id: coordB, orgId: orgB }, { email: "nuevo@b.es" });
  const row = get<{ id: number }>("SELECT id FROM user_tokens WHERE email = 'nuevo@b.es'")!;
  assert.ok(!users.listPendingInvites(A).some((p) => p.email === "nuevo@b.es"));
  fails(() => users.revokeToken(A, row.id), "not_found");
  assert.equal(users.getInvite(invB.token).status, "ok");
  // a person invited into B lands in B
  const joined = users.acceptInvite(invB.token, { name: "Nuevo B", password: PW });
  assert.equal(get<{ org_id: number }>("SELECT org_id FROM users WHERE id = ?", joined.userId)!.org_id, orgB);

  // activity is written to the right org and carries no secrets
  for (const row of all<{ summary: string; org_id: number; type: string }>("SELECT summary, org_id, type FROM activity WHERE type LIKE 'user.%'")) {
    assert.ok(!/[A-Za-z0-9_-]{43}/.test(row.summary), row.summary);
    assert.ok(!row.summary.includes(PW));
  }
  assert.ok(activity("user.joined").some((a) => a.org_id === orgB));
});

test("migration: legacy users table gets active/last_login_at and an admin per org; idempotent", () => {
  // Build a pre-T-012 database file shape in memory, then run the real openDb() migration on it.
  const dir = mkdtempSync(join(tmpdir(), "cauce-t012-"));
  const path = join(dir, "legacy.db");
  const legacy = new DatabaseSync(path);
  legacy.exec(SCHEMA.split("-- T-012")[0].replace("PRAGMA foreign_keys = ON;", ""));
  legacy.exec("INSERT INTO organizations (name) VALUES ('Vieja'), ('Sin owner')");
  legacy.exec(`INSERT INTO users (org_id, name, email, password_hash, role) VALUES
    (1, 'Dueña', 'owner@v.es', 'x:y', 'owner'), (1, 'Coord', 'c@v.es', 'x:y', 'coordinator'),
    (2, 'Primera', 'p@v.es', 'x:y', 'coordinator'), (2, 'Segunda', 's@v.es', 'x:y', 'coordinator')`);
  legacy.close();
  for (let i = 0; i < 2; i++) {
    const db = openDb(path);
    const rows = db.prepare("SELECT email, role, active, last_login_at FROM users ORDER BY id").all();
    assert.deepEqual(rows.map((r) => [r.email, r.role, r.active, r.last_login_at]), [
      ["owner@v.es", "admin", 1, null], ["c@v.es", "coordinator", 1, null],
      ["p@v.es", "admin", 1, null], ["s@v.es", "coordinator", 1, null],
    ]);
    db.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

// ---------- T-021 review fixes ----------

test("T-021#2: links issued by an admin die when that admin loses admin access", () => {
  const o = run("INSERT INTO organizations (name) VALUES ('Issuers')");
  const boss = mk(o, "Boss", "boss@iss.es", "admin");
  const second = mk(o, "Second", "second@iss.es", "admin");
  const third = mk(o, "Third", "third@iss.es", "admin");
  const S = { id: second, orgId: o };
  const reset = users.createResetLink(S, boss);
  const invite = users.createInvite(S, { email: "new@iss.es", name: "New", role: "admin" });
  assert.equal(users.getReset(reset.token).status, "ok");
  users.setRole({ id: boss, orgId: o }, second, "coordinator");
  assert.equal(users.getReset(reset.token).status, "revoked");
  assert.equal(users.getInvite(invite.token).status, "revoked");
  fails(() => users.completeReset(reset.token, "otra-contraseña-larga"), "invalid");

  // Issuer deactivated: same effect.
  const T = { id: third, orgId: o };
  const r2 = users.createResetLink(T, boss);
  users.deactivateUser({ id: boss, orgId: o }, third);
  assert.equal(users.getReset(r2.token).status, "revoked");
});

test("T-021#1: a login whose password was reset while scrypt ran gets no session", async () => {
  const o = run("INSERT INTO organizations (name) VALUES ('Race')");
  const u = mk(o, "Racer", "racer@race.es", "admin");
  const pending = login("racer@race.es", PW, "race-test"); // verifying the old password (async)…
  run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword("nueva-contraseña-larga"), u); // …reset commits
  const r = await pending;
  assert.equal(r.ok, false);
  assert.equal(sessionsOf(u), 0);
});

test("T-021#1: a password change does not overwrite a reset that committed meanwhile", async () => {
  const o = run("INSERT INTO organizations (name) VALUES ('Race2')");
  const u = mk(o, "Changer", "changer@race.es", "admin");
  const p = users.changePassword({ id: u, orgId: o }, { current: PW, next: "cambio-contraseña-larga" });
  const resetHash = hashPassword("reset-contraseña-larga");
  run("UPDATE users SET password_hash = ? WHERE id = ?", resetHash, u);
  await assert.rejects(p, (e) => e instanceof users.UserError && e.code === "conflict");
  assert.equal(get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", u)!.password_hash, resetHash);
});
