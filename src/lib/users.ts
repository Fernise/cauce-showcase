// Team management (T-012): roles, invites, password reset links, deactivation. See docs/decisions.md D-015.
//
// Every function takes the acting user and re-checks in the DB that they are an active admin of the org
// (never trusts the caller), and every query is scoped by org_id. Invite/reset tokens are random 256-bit
// values; only their sha256 is stored, they are single-use and expire. No email is sent: the admin copies the link.

import { checkCurrentPassword, createSession, deleteSessions, hashPassword, hashToken, newToken } from "./auth.ts";
import { all, get, run, tx } from "./db.ts";
import { logActivity } from "./activity.ts";

export const ROLES = ["admin", "coordinator"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { admin: "Administración", coordinator: "Coordinación" };

export const MIN_PASSWORD = 10;
const MAX_PASSWORD = 200; // scrypt on a megabyte-long "password" would be a cheap DoS
export const INVITE_DAYS = 7;
export const RESET_HOURS = 24;

export class UserError extends Error {
  code: "forbidden" | "invalid" | "not_found" | "conflict";
  constructor(code: UserError["code"], message: string) {
    super(message);
    this.name = "UserError";
    this.code = code;
  }
}

export type Actor = { id: number; orgId: number };

export const isAdminRole = (role: string | null | undefined): boolean => role === "admin";
export const roleLabel = (role: string): string => ROLE_LABEL[role as Role] ?? role;

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
  if (password.length > MAX_PASSWORD) return `La contraseña no puede superar ${MAX_PASSWORD} caracteres.`;
  return null;
}

const normEmail = (email: string) => email.trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UserRow = { id: number; org_id: number; name: string; email: string; role: string; active: number };

/** The acting user, verified as an active admin of `actor.orgId` against the DB. */
function assertAdmin(actor: Actor): UserRow {
  const row = get<UserRow>("SELECT id, org_id, name, email, role, active FROM users WHERE id = ? AND org_id = ?", actor.id, actor.orgId);
  if (!row || !row.active || row.role !== "admin") throw new UserError("forbidden", "Solo la administración puede gestionar el equipo.");
  return row;
}

function targetUser(orgId: number, userId: number): UserRow {
  const row = get<UserRow>("SELECT id, org_id, name, email, role, active FROM users WHERE id = ? AND org_id = ?", userId, orgId);
  if (!row) throw new UserError("not_found", "Esa persona no existe en tu equipo.");
  return row;
}

/** An org must always keep one active admin: refuse anything that would remove the last. */
function assertNotLastAdmin(target: UserRow): void {
  if (target.role !== "admin" || !target.active) return;
  const others = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND role = 'admin' AND active = 1 AND id <> ?",
    target.org_id, target.id,
  )!.n;
  if (others === 0) throw new UserError("conflict", "Debe quedar al menos un administrador activo.");
}

// ---------- Team listing ----------

export type TeamMember = { id: number; name: string; email: string; role: string; active: boolean; lastLoginAt: string | null };

export function listTeam(actor: Actor): TeamMember[] {
  assertAdmin(actor);
  return all<{ id: number; name: string; email: string; role: string; active: number; last_login_at: string | null }>(
    "SELECT id, name, email, role, active, last_login_at FROM users WHERE org_id = ? ORDER BY active DESC, name COLLATE NOCASE",
    actor.orgId,
  ).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active, lastLoginAt: u.last_login_at }));
}

export type PendingInvite = { id: number; email: string; role: string; expiresAt: string };

export function listPendingInvites(actor: Actor, now = Date.now()): PendingInvite[] {
  assertAdmin(actor);
  return all<{ id: number; email: string; role: string; expires_at: string }>(
    `SELECT id, email, role, expires_at FROM user_tokens
      WHERE org_id = ? AND kind = 'invite' AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      ORDER BY id DESC`,
    actor.orgId, new Date(now).toISOString(),
  ).map((t) => ({ id: t.id, email: t.email, role: t.role, expiresAt: t.expires_at }));
}

// ---------- Invites ----------

export function createInvite(
  actor: Actor,
  input: { email: string; name?: string; role?: string },
  now = Date.now(),
): { token: string; email: string; expiresAt: string } {
  const admin = assertAdmin(actor);
  const email = normEmail(input.email);
  if (!EMAIL_RE.test(email) || email.length > 200) throw new UserError("invalid", "El email no es válido.");
  const role = input.role ?? "coordinator";
  if (!(ROLES as readonly string[]).includes(role)) throw new UserError("invalid", "Rol no válido.");
  const nameHint = (input.name ?? "").trim().slice(0, 100) || null;
  return tx(() => {
    if (get("SELECT 1 FROM users WHERE email = ?", email)) throw new UserError("conflict", "Ya existe un usuario con ese email.");
    // A newer invite for the same address replaces the older one.
    run(
      "UPDATE user_tokens SET revoked_at = ? WHERE org_id = ? AND kind = 'invite' AND email = ? AND used_at IS NULL AND revoked_at IS NULL",
      new Date(now).toISOString(), actor.orgId, email,
    );
    const token = newToken();
    const expiresAt = new Date(now + INVITE_DAYS * 86_400_000).toISOString();
    run(
      "INSERT INTO user_tokens (org_id, kind, token_hash, email, name_hint, role, created_by, expires_at) VALUES (?, 'invite', ?, ?, ?, ?, ?, ?)",
      actor.orgId, hashToken(token), email, nameHint, role, admin.id, expiresAt,
    );
    logActivity(actor.orgId, "user.invited", `Invitación enviada a ${email} (${roleLabel(role)})`, { type: "org", id: actor.orgId }, admin.name);
    return { token, email, expiresAt };
  });
}

export type TokenStatus = "ok" | "expired" | "used" | "revoked" | "invalid";

type TokenRow = {
  id: number; org_id: number; kind: string; user_id: number | null; email: string | null; name_hint: string | null;
  role: string | null; expires_at: string; used_at: string | null; revoked_at: string | null; org_name: string;
  issuer_ok: number;
};

function findToken(kind: "invite" | "reset", token: string): TokenRow | undefined {
  if (!token || token.length > 200) return undefined;
  return get<TokenRow>(
    `SELECT t.id, t.org_id, t.kind, t.user_id, t.email, t.name_hint, t.role, t.expires_at, t.used_at, t.revoked_at, o.name AS org_name,
            EXISTS (SELECT 1 FROM users i WHERE i.id = t.created_by AND i.org_id = t.org_id AND i.active = 1 AND i.role = 'admin') AS issuer_ok
       FROM user_tokens t JOIN organizations o ON o.id = t.org_id
      WHERE t.kind = ? AND t.token_hash = ?`,
    kind, hashToken(token),
  );
}

function statusOf(row: TokenRow | undefined, now: number): TokenStatus {
  if (!row) return "invalid";
  if (row.used_at) return "used";
  // A link is only as good as the admin who issued it: losing admin access voids their pending links.
  if (row.revoked_at || !row.issuer_ok) return "revoked";
  if (new Date(row.expires_at).getTime() <= now) return "expired";
  return "ok";
}

export type InviteInfo = { status: TokenStatus; orgName?: string; email?: string; nameHint?: string | null; role?: string };

export function getInvite(token: string, now = Date.now()): InviteInfo {
  const row = findToken("invite", token);
  const status = statusOf(row, now);
  if (!row || status === "invalid") return { status: "invalid" };
  return status === "ok"
    ? { status, orgName: row.org_name, email: row.email ?? "", nameHint: row.name_hint, role: row.role ?? "coordinator" }
    : { status, orgName: row.org_name };
}

/** Consumes the invite, creates the user and a session for them. */
export function acceptInvite(
  token: string,
  input: { name: string; password: string },
  now = Date.now(),
): { userId: number; session: { token: string; expires: Date } } {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new UserError("invalid", "Escribe tu nombre.");
  const pwError = validatePassword(input.password);
  if (pwError) throw new UserError("invalid", pwError);
  // Cheap read-only check first, so unknown tokens never take SQLite's write lock.
  if (statusOf(findToken("invite", token), now) !== "ok") throw new UserError("invalid", "Esta invitación ya no es válida. Pide una nueva a tu administrador.");
  return tx(() => {
    const row = findToken("invite", token);
    const status = statusOf(row, now);
    if (!row || status !== "ok") throw new UserError("invalid", "Esta invitación ya no es válida. Pide una nueva a tu administrador.");
    const email = row.email ?? "";
    if (get("SELECT 1 FROM users WHERE email = ?", email)) throw new UserError("conflict", "Ya existe una cuenta con ese email.");
    const role = row.role === "admin" ? "admin" : "coordinator";
    const userId = run(
      "INSERT INTO users (org_id, name, email, password_hash, role, last_login_at) VALUES (?, ?, ?, ?, ?, ?)",
      row.org_id, name, email, hashPassword(input.password), role, new Date(now).toISOString(),
    );
    run("UPDATE user_tokens SET used_at = ? WHERE id = ?", new Date(now).toISOString(), row.id);
    logActivity(row.org_id, "user.joined", `${name} se ha unido al equipo (${roleLabel(role)})`, { type: "user", id: userId }, name);
    return { userId, session: createSession(userId, now) };
  });
}

/** Revokes a pending invite or reset link of the actor's org. */
export function revokeToken(actor: Actor, tokenId: number, now = Date.now()): void {
  const admin = assertAdmin(actor);
  tx(() => {
    const row = get<{ id: number; kind: string; email: string | null; user_id: number | null }>(
      "SELECT id, kind, email, user_id FROM user_tokens WHERE id = ? AND org_id = ? AND used_at IS NULL AND revoked_at IS NULL",
      tokenId, actor.orgId,
    );
    if (!row) throw new UserError("not_found", "Ese enlace ya no está pendiente.");
    run("UPDATE user_tokens SET revoked_at = ? WHERE id = ?", new Date(now).toISOString(), row.id);
    if (row.kind === "invite") {
      logActivity(actor.orgId, "user.invite_revoked", `Invitación a ${row.email} cancelada`, { type: "org", id: actor.orgId }, admin.name);
    }
  });
}

/** Voids unused invite/reset links issued by this user (called when they lose admin access). */
function revokeIssuedBy(orgId: number, userId: number, now: number): void {
  run(
    "UPDATE user_tokens SET revoked_at = ? WHERE org_id = ? AND created_by = ? AND used_at IS NULL AND revoked_at IS NULL",
    new Date(now).toISOString(), orgId, userId,
  );
}

// ---------- Roles & deactivation ----------

export function setRole(actor: Actor, userId: number, role: string, now = Date.now()): void {
  const admin = assertAdmin(actor);
  if (!(ROLES as readonly string[]).includes(role)) throw new UserError("invalid", "Rol no válido.");
  tx(() => {
    const target = targetUser(actor.orgId, userId);
    if (target.role === role) return;
    if (role !== "admin") assertNotLastAdmin(target);
    run("UPDATE users SET role = ? WHERE id = ? AND org_id = ?", role, target.id, actor.orgId);
    if (role !== "admin") revokeIssuedBy(actor.orgId, target.id, now);
    logActivity(actor.orgId, "user.role_changed", `${target.name}: ${roleLabel(target.role)} → ${roleLabel(role)}`, { type: "user", id: target.id }, admin.name);
  });
}

export function deactivateUser(actor: Actor, userId: number, now = Date.now()): void {
  const admin = assertAdmin(actor);
  tx(() => {
    const target = targetUser(actor.orgId, userId);
    if (!target.active) return;
    assertNotLastAdmin(target);
    run("UPDATE users SET active = 0 WHERE id = ? AND org_id = ?", target.id, actor.orgId);
    deleteSessions(target.id);
    run(
      "UPDATE user_tokens SET revoked_at = ? WHERE user_id = ? AND kind = 'reset' AND used_at IS NULL AND revoked_at IS NULL",
      new Date(now).toISOString(), target.id,
    );
    revokeIssuedBy(actor.orgId, target.id, now);
    logActivity(actor.orgId, "user.deactivated", `${target.name} desactivado/a (sin acceso)`, { type: "user", id: target.id }, admin.name);
  });
}

export function reactivateUser(actor: Actor, userId: number): void {
  const admin = assertAdmin(actor);
  tx(() => {
    const target = targetUser(actor.orgId, userId);
    if (target.active) return;
    run("UPDATE users SET active = 1 WHERE id = ? AND org_id = ?", target.id, actor.orgId);
    logActivity(actor.orgId, "user.reactivated", `${target.name} reactivado/a`, { type: "user", id: target.id }, admin.name);
  });
}

// ---------- Password: reset link (admin) and change (own) ----------

/** Admin-generated one-time link. Returns the raw token once; it cannot be recovered later. */
export function createResetLink(actor: Actor, userId: number, now = Date.now()): { token: string; userName: string; expiresAt: string } {
  const admin = assertAdmin(actor);
  return tx(() => {
    const target = targetUser(actor.orgId, userId);
    if (!target.active) throw new UserError("conflict", "Reactiva a esta persona antes de generar un enlace.");
    run(
      "UPDATE user_tokens SET revoked_at = ? WHERE user_id = ? AND kind = 'reset' AND used_at IS NULL AND revoked_at IS NULL",
      new Date(now).toISOString(), target.id,
    );
    const token = newToken();
    const expiresAt = new Date(now + RESET_HOURS * 3_600_000).toISOString();
    run(
      "INSERT INTO user_tokens (org_id, kind, token_hash, user_id, created_by, expires_at) VALUES (?, 'reset', ?, ?, ?, ?)",
      actor.orgId, hashToken(token), target.id, admin.id, expiresAt,
    );
    logActivity(actor.orgId, "user.reset_link", `Enlace para restablecer la contraseña de ${target.name}`, { type: "user", id: target.id }, admin.name);
    return { token, userName: target.name, expiresAt };
  });
}

export type ResetInfo = { status: TokenStatus; orgName?: string; userName?: string; email?: string };

export function getReset(token: string, now = Date.now()): ResetInfo {
  const row = findToken("reset", token);
  const status = statusOf(row, now);
  if (!row || status === "invalid") return { status: "invalid" };
  if (status !== "ok") return { status, orgName: row.org_name };
  const user = get<{ name: string; email: string; active: number }>(
    "SELECT name, email, active FROM users WHERE id = ? AND org_id = ?", row.user_id ?? 0, row.org_id,
  );
  if (!user || !user.active) return { status: "revoked", orgName: row.org_name };
  return { status, orgName: row.org_name, userName: user.name, email: user.email };
}

/** Consumes the reset link, sets the new password and signs the user out everywhere. */
export function completeReset(token: string, password: string, now = Date.now()): void {
  const pwError = validatePassword(password);
  if (pwError) throw new UserError("invalid", pwError);
  if (statusOf(findToken("reset", token), now) !== "ok") throw new UserError("invalid", "Este enlace ya no es válido. Pide uno nuevo a tu administrador.");
  tx(() => {
    const row = findToken("reset", token);
    if (!row || statusOf(row, now) !== "ok") throw new UserError("invalid", "Este enlace ya no es válido. Pide uno nuevo a tu administrador.");
    const user = get<{ id: number; name: string; active: number }>(
      "SELECT id, name, active FROM users WHERE id = ? AND org_id = ?", row.user_id ?? 0, row.org_id,
    );
    if (!user || !user.active) throw new UserError("invalid", "Este enlace ya no es válido. Pide uno nuevo a tu administrador.");
    run("UPDATE users SET password_hash = ? WHERE id = ? AND org_id = ?", hashPassword(password), user.id, row.org_id);
    run("UPDATE user_tokens SET used_at = ? WHERE id = ?", new Date(now).toISOString(), row.id);
    deleteSessions(user.id);
    logActivity(row.org_id, "user.password_reset", `${user.name} ha restablecido su contraseña`, { type: "user", id: user.id }, user.name);
  });
}

/** Own password change: needs the current password, keeps only the current session. */
export async function changePassword(
  actor: Actor,
  input: { current: string; next: string; keepSessionToken?: string },
  now = Date.now(),
): Promise<void> {
  const user = get<{ id: number; name: string; password_hash: string }>(
    "SELECT id, name, password_hash FROM users WHERE id = ? AND org_id = ? AND active = 1", actor.id, actor.orgId,
  );
  if (!user) throw new UserError("forbidden", "Sesión no válida.");
  const pwError = validatePassword(input.next);
  if (pwError) throw new UserError("invalid", pwError);
  const check = await checkCurrentPassword(user.id, input.current, now);
  if (check === "throttled") throw new UserError("invalid", "Demasiados intentos. Espera unos minutos y vuelve a probar.");
  if (check === "invalid") throw new UserError("invalid", "La contraseña actual no es correcta.");
  tx(() => {
    // The check above is async: if a reset (or another change) committed meanwhile, don't overwrite it.
    const current = get<{ password_hash: string; active: number }>("SELECT password_hash, active FROM users WHERE id = ?", user.id);
    if (!current || !current.active || current.password_hash !== user.password_hash) {
      throw new UserError("conflict", "Tu contraseña ha cambiado mientras tanto. Vuelve a entrar e inténtalo de nuevo.");
    }
    if (input.keepSessionToken && !get("SELECT 1 FROM sessions WHERE token = ? AND user_id = ?", input.keepSessionToken, user.id)) {
      throw new UserError("forbidden", "Sesión no válida.");
    }
    run("UPDATE users SET password_hash = ? WHERE id = ? AND org_id = ?", hashPassword(input.next), user.id, actor.orgId);
    deleteSessions(user.id, input.keepSessionToken);
    run(
      "UPDATE user_tokens SET revoked_at = ? WHERE user_id = ? AND kind = 'reset' AND used_at IS NULL AND revoked_at IS NULL",
      new Date(now).toISOString(), user.id,
    );
    logActivity(actor.orgId, "user.password_changed", `${user.name} ha cambiado su contraseña`, { type: "user", id: user.id }, user.name);
  });
}
