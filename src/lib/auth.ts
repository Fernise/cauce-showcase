import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { get, run, tx } from "./db.ts";

const scryptAsync = promisify(scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>;

export type SessionUser = { id: number; orgId: number; name: string; email: string; role: string; orgName: string };

export const SESSION_COOKIE = "cauce_session";
const SESSION_DAYS = 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

/** One-time link tokens: the raw value goes in the URL, only this sha256 is stored. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

async function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, "hex");
  const b = await scryptAsync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

// In-memory throttle (single-process deployment): max 8 failed attempts per email and per source in 15 min.
const FAIL_WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 8;
const failures = new Map<string, number[]>();
function recentFailures(key: string, now: number): number[] {
  const list = (failures.get(key) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
  failures.set(key, list);
  return list;
}

export type LoginResult = { ok: true; token: string; expires: Date } | { ok: false; reason: "invalid" | "throttled" };

export function createSession(userId: number, now = Date.now()): { token: string; expires: Date } {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(now + SESSION_DAYS * 86_400_000);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", token, userId, expires.toISOString());
  return { token, expires };
}

/** Deletes a user's sessions (all of them, or all but `exceptToken`). */
export function deleteSessions(userId: number, exceptToken?: string): void {
  if (exceptToken) run("DELETE FROM sessions WHERE user_id = ? AND token <> ?", userId, exceptToken);
  else run("DELETE FROM sessions WHERE user_id = ?", userId);
}

export async function login(email: string, password: string, source = "unknown", now = Date.now()): Promise<LoginResult> {
  const keys = [`e:${email.trim().toLowerCase()}`, `s:${source}`];
  if (keys.some((k) => recentFailures(k, now).length >= MAX_FAILS)) return { ok: false, reason: "throttled" };
  const user = get<{ id: number; password_hash: string; active: number }>(
    "SELECT id, password_hash, active FROM users WHERE email = ?",
    email.trim().toLowerCase(),
  );
  // Hash even for unknown emails so response time doesn't reveal which accounts exist.
  const valid = await verifyPasswordAsync(password, user?.password_hash ?? "00:00");
  // Deactivated users get the same answer as a wrong password.
  if (!user || !user.active || !valid) {
    keys.forEach((k) => recentFailures(k, now).push(now));
    return { ok: false, reason: "invalid" };
  }
  // scrypt is async: a reset, password change or deactivation may have committed meanwhile. Re-check under the
  // write lock that the hash we verified is still current, so an old password can't mint a fresh session.
  const session = tx(() => {
    const now2 = get<{ password_hash: string; active: number }>("SELECT password_hash, active FROM users WHERE id = ?", user.id);
    if (!now2 || !now2.active || now2.password_hash !== user.password_hash) return null;
    run("UPDATE users SET last_login_at = ? WHERE id = ?", new Date(now).toISOString(), user.id);
    return createSession(user.id);
  });
  if (!session) return { ok: false, reason: "invalid" };
  keys.forEach((k) => failures.delete(k));
  return { ok: true, token: session.token, expires: session.expires };
}

/** Checks a logged-in user's current password (password change), sharing the login failure throttle. */
export async function checkCurrentPassword(userId: number, password: string, now = Date.now()): Promise<"ok" | "invalid" | "throttled"> {
  const key = `u:${userId}`;
  if (recentFailures(key, now).length >= MAX_FAILS) return "throttled";
  const row = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", userId);
  if (!row || !(await verifyPasswordAsync(password, row.password_hash))) {
    recentFailures(key, now).push(now);
    return "invalid";
  }
  failures.delete(key);
  return "ok";
}

export function logout(token: string): void {
  run("DELETE FROM sessions WHERE token = ?", token);
}

export function userForToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = get<SessionUser & { expires_at: string }>(
    `SELECT u.id, u.org_id AS orgId, u.name, u.email, u.role, o.name AS orgName, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN organizations o ON o.id = u.org_id
      WHERE s.token = ? AND u.active = 1`,
    token,
  );
  if (!row || new Date(row.expires_at) < new Date()) return null;
  return { id: row.id, orgId: row.orgId, name: row.name, email: row.email, role: row.role, orgName: row.orgName };
}
