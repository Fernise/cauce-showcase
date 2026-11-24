import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";

export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Atlantic/Canary',
  travel_buffer_min INTEGER NOT NULL DEFAULT 30,
  max_weekly_hours REAL NOT NULL DEFAULT 40,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'coordinator'
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  zone TEXT,
  lat REAL,
  lng REAL,
  weekly_hours REAL NOT NULL DEFAULT 30,
  skills TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL, -- 1 = Monday … 7 = Sunday
  start TEXT NOT NULL,
  end TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  address TEXT,
  municipality TEXT,
  lat REAL,
  lng REAL,
  access_notes TEXT,
  required_skills TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS service_templates (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  weekdays TEXT NOT NULL, -- csv of 1..7
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  required_skills TEXT NOT NULL DEFAULT '',
  default_employee_id INTEGER REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  template_id INTEGER REFERENCES service_templates(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  required_skills TEXT NOT NULL DEFAULT '',
  employee_id INTEGER REFERENCES employees(id),
  status TEXT NOT NULL DEFAULT 'scheduled' -- scheduled | uncovered | cancelled
);
CREATE INDEX IF NOT EXISTS shifts_org_date ON shifts(org_id, date);
CREATE INDEX IF NOT EXISTS shifts_employee_date ON shifts(employee_id, date);

CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  reason_category TEXT NOT NULL DEFAULT 'otro',
  raw_message TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'active', -- active | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coverage_cases (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  absence_id INTEGER REFERENCES absences(id),
  original_employee_id INTEGER REFERENCES employees(id),
  status TEXT NOT NULL DEFAULT 'open', -- open | offering | covered | unresolved | cancelled
  resolved_employee_id INTEGER REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  case_id INTEGER NOT NULL REFERENCES coverage_cases(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  token TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL,
  score REAL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined | withdrawn
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  client_id INTEGER REFERENCES clients(id),
  location_id INTEGER REFERENCES locations(id),
  shift_id INTEGER REFERENCES shifts(id),
  employee_id INTEGER REFERENCES employees(id),
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'media', -- baja | media | alta
  title TEXT NOT NULL,
  description TEXT,
  raw_message TEXT,
  owner_user_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'abierta', -- abierta | en_curso | resuelta
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  actor TEXT,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS activity_org ON activity(org_id, id DESC);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'logged',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- T-020 (employee self-report links)
-- employees.report_token is added by migrate() below (ALTER TABLE ADD COLUMN + unique index), not here,
-- because CREATE TABLE IF NOT EXISTS never alters a database that already exists.
-- Column additions to existing tables go in migrate().

-- T-012: one-time invite / password-reset links (only the sha256 of the token is stored).
CREATE TABLE IF NOT EXISTS user_tokens (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL, -- invite | reset
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, -- reset: the user whose password is reset
  email TEXT, -- invite: address the new user will log in with
  name_hint TEXT, -- invite: optional suggested name
  role TEXT, -- invite: role the new user gets
  created_by INTEGER REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS user_tokens_org ON user_tokens(org_id, kind);
`;

export function dbPath(): string {
  const p = process.env.CAUCE_DB_PATH ?? "./data/cauce.db";
  return p === ":memory:" ? p : resolve(/*turbopackIgnore: true*/ p);
}

/** Unguessable URL-safe token (144 bits) for personal links. */
export function newReportToken(): string {
  return randomBytes(18).toString("base64url");
}

/**
 * Idempotent `ALTER TABLE … ADD COLUMN`. SCHEMA only uses CREATE TABLE IF NOT EXISTS, so columns added after the
 * first release must be added here. `table`, `column` and `definition` are code constants, never user input.
 */
export function addColumnIfMissing(d: DatabaseSync, table: string, column: string, definition: string): void {
  const has = () => d.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (has()) return;
  try {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (e) {
    if (!has()) throw e; // another process added it between the check and the ALTER
  }
}

/** Gives every employee without a personal report link a fresh token. */
export function backfillReportTokens(d: DatabaseSync): void {
  const missing = d.prepare("SELECT id FROM employees WHERE report_token IS NULL").all() as { id: number }[];
  const set = d.prepare("UPDATE employees SET report_token = ? WHERE id = ? AND report_token IS NULL");
  for (const { id } of missing) set.run(newReportToken(), id);
}

/** Schema upgrades for databases created by earlier versions. Safe to run on every start. */
export function migrate(d: DatabaseSync): void {
  // One write transaction: a crash mid-way leaves the old schema, never a half-migrated one.
  d.exec("BEGIN IMMEDIATE");
  try {
    migrateSteps(d);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

function migrateSteps(d: DatabaseSync): void {
  // T-020: personal link for employees to report an absence themselves.
  addColumnIfMissing(d, "employees", "report_token", "TEXT");
  d.exec("CREATE UNIQUE INDEX IF NOT EXISTS employees_report_token ON employees(report_token)");
  backfillReportTokens(d);

  // T-012: users.active / users.last_login_at and the role model (admin | coordinator).
  addColumnIfMissing(d, "users", "active", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(d, "users", "last_login_at", "TEXT");
  // Every org needs an active admin. Legacy 'owner' → admin; an org with users but no active admin (older DBs,
  // or a partial state) gets its oldest active user promoted. The app never lets the last admin go, so on a
  // healthy DB this matches nothing.
  d.exec("UPDATE users SET role = 'admin' WHERE role = 'owner'");
  d.exec(`UPDATE users SET role = 'admin' WHERE id IN (
    SELECT MIN(u.id) FROM users u
     WHERE u.active = 1
       AND NOT EXISTS (SELECT 1 FROM users a WHERE a.org_id = u.org_id AND a.role = 'admin' AND a.active = 1)
     GROUP BY u.org_id)`);
}

export function openDb(path = dbPath()): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

const globalForDb = globalThis as unknown as { __cauceDb?: DatabaseSync };

/** Process-wide connection (survives dev hot reloads). */
export function db(): DatabaseSync {
  if (!globalForDb.__cauceDb) globalForDb.__cauceDb = openDb();
  return globalForDb.__cauceDb;
}

type Param = string | number | null;

// node:sqlite returns null-prototype rows; copy them into plain objects so they can be
// passed to React client components and compared with deepEqual.
export function all<T>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...params).map((r) => ({ ...r }) as T);
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  const row = db().prepare(sql).get(...params);
  return row ? ({ ...row } as T) : undefined;
}

export function run(sql: string, ...params: Param[]): number {
  const r = db().prepare(sql).run(...params);
  return Number(r.lastInsertRowid);
}

let txDepth = 0;

/**
 * Runs fn in a write transaction. BEGIN IMMEDIATE takes the write lock up front, so state read
 * inside fn cannot be changed by another connection/process before we write (no lost updates).
 * Nested calls join the outer transaction.
 */
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  txDepth++;
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  } finally {
    txDepth--;
  }
}
