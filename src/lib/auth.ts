import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { get, run } from "./db.ts";

const scryptAsync = promisify(scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>;

export type SessionUser = { id: number; orgId: number; name: string; email: string; role: string; orgName: string };

export const SESSION_COOKIE = "cauce_session";
const SESSION_DAYS = 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
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

export async function login(email: string, password: string, source = "unknown", now = Date.now()): Promise<LoginResult> {
  const keys = [`e:${email.trim().toLowerCase()}`, `s:${source}`];
  if (keys.some((k) => recentFailures(k, now).length >= MAX_FAILS)) return { ok: false, reason: "throttled" };
  const user = get<{ id: number; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE email = ?",
    email.trim().toLowerCase(),
  );
  // Hash even for unknown emails so response time doesn't reveal which accounts exist.
  const valid = await verifyPasswordAsync(password, user?.password_hash ?? "00:00");
  if (!user || !valid) {
    keys.forEach((k) => recentFailures(k, now).push(now));
    return { ok: false, reason: "invalid" };
  }
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", token, user.id, expires.toISOString());
  keys.forEach((k) => failures.delete(k));
  return { ok: true, token, expires };
}

export function logout(token: string): void {
  run("DELETE FROM sessions WHERE token = ?", token);
}

export function userForToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = get<SessionUser & { expires_at: string }>(
    `SELECT u.id, u.org_id AS orgId, u.name, u.email, u.role, o.name AS orgName, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN organizations o ON o.id = u.org_id
      WHERE s.token = ?`,
    token,
  );
  if (!row || new Date(row.expires_at) < new Date()) return null;
  return { id: row.id, orgId: row.orgId, name: row.name, email: row.email, role: row.role, orgName: row.orgName };
}
