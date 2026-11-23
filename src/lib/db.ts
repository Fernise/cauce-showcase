import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
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
`;

export function dbPath(): string {
  const p = process.env.CAUCE_DB_PATH ?? "./data/cauce.db";
  return p === ":memory:" ? p : resolve(/*turbopackIgnore: true*/ p);
}

export function openDb(path = dbPath()): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
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
