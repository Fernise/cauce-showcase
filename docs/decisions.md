# Decisions log

Short records of durable decisions. Newest last. Status: Accepted / Provisional / Superseded.

### D-001 · Lightweight operating model (APOS) — Accepted 2026-11-23
One persistent HQ thread + temporary task threads; optional Producto & Negocio thread.
Repo docs are the shared memory (`AGENTS.md`, `docs/*`). See `docs/workflow.md`.

### D-002 · Stack: Next.js + TypeScript + Tailwind + SQLite (`node:sqlite`) — Provisional 2026-11-23
Why: single process, single file DB, trivially deployable on a small Hetzner VPS
(no Postgres/Redis to operate), zero native build deps (built-in `node:sqlite`),
one language end-to-end, server actions keep the code small.
Revisit when: > ~20 tenants or concurrent writes become a problem → Postgres
(queries are plain SQL scoped by `org_id`, so migration is mechanical).
Founder may override; chosen by HQ because no stack was specified.

### D-003 · Deterministic ranking, AI for language only — Accepted 2026-11-23
Replacement ranking is rule-based and explained factor by factor (auditable, free,
predictable). LLMs parse free-text messages and draft communications.
Every AI feature has a deterministic fallback so the product runs with no API key.

### D-004 · Optional AI provider: Anthropic API via official SDK — Provisional 2026-11-23
Enabled only if `ANTHROPIC_API_KEY` is set (off by default: rules parser, zero cost).
Default model `claude-opus-5-5` at `effort: "low"`, structured output validated with zod; override with
`CAUCE_AI_MODEL` (e.g. `claude-haiku-5-5` as the low-cost option — founder's call after a quality check
on real messages). Any API error or refusal falls back to the rules parser. Code: `src/lib/ai.ts`.
Enabling it in production is a billing and data-sharing decision for the founder (messages contain
employee names and health reasons → mention in the pilot's data-processing terms).

### D-005 · Staff communication via response links + `wa.me` deep links — Accepted 2026-11-23
No WhatsApp Business API in v1. Offers carry a unique token link (`/r/<token>`) the
employee opens on their phone; manager sends it via WhatsApp deep link, copy, or email.
Email sending is not implemented in v1 (the `outbox` table is reserved for it); no real messages are sent.

### D-006 · Simple session auth — Accepted 2026-11-23
Email + password (scrypt, `node:crypto`), httpOnly session cookie, sessions table.
No third-party auth provider in v1.

### D-007 · Ranking includes travel-time feasibility — Accepted 2026-11-23
Besides the fixed buffer between services, a candidate is excluded if the estimated drive
(road km ≈ straight line × 1.3, 45 km/h + 5 min) to/from neighbouring services doesn't fit the gap.

### D-008 · No overnight services in v1 — Accepted 2026-11-23
Every service must end after it starts on the same day (`end > start`); entry points reject anything else.
Review T-015 #4 showed overnight shifts would break overlap, weekly-hours and absence logic. Cleaning
contracts in the pilot segment are day/evening work; revisit with dated intervals if a customer needs night shifts.

### D-009 · Offer acceptance re-validates everything at the moment of acceptance — Accepted 2026-11-23
Accepting (or assigning directly) re-runs the hard ranking rules inside a write-locked transaction
(`BEGIN IMMEDIATE`) and only succeeds if the case is still open and the service hasn't started.
Stale or late links return a clear message instead of double-booking (review T-015 #2, #3, #5).

### D-010 · Admin screens: zone table instead of geocoding; templates detach from shifts on removal — Accepted 2026-11-23
Employees/locations pick a zone from `src/lib/zones.ts` (≈60 Tenerife/Gran Canaria municipalities and areas, town-centre coordinates)
so proximity ranking works without a geocoding service or API cost; free text is allowed but has no coordinates.
Removing a recurring service cancels future case-less shifts and sets `template_id = NULL` on its shifts (FK, no schema change) so history survives.
Shift generation window is today → end of next ISO week; shifts with coverage cases or in the past are never modified. Code: `src/lib/services.ts`.

### D-011 · Visual identity «Cal y picón» — Accepted 2026-11-23 (founder approved)
Warm whitewash paper + volcanic-black ink, almagre for gaps, azufre for waiting, mar for covered;
status always glyph + word. Fonts Archivo (UI, width axis) + Newsreader (people's words), self-hosted
via `next/font/google` — no new runtime dependency. Legacy Tailwind colour scales are remapped onto
the palette in `globals.css`. Details and "we never do" list: `docs/design.md`.

### D-012 · Absences store only the reason category (RGPD data minimisation) — Accepted 2026-11-23 (founder)
Absence messages often contain health data (special category, art. 9 RGPD). Cauce parses the pasted
message in memory to fill the form, but stores only the category (enfermedad / familiar / transporte /
personal / otro) — never the raw message or a free-text detail. Enforced in `registerAbsence`.
Client incident messages are still stored (needed to handle the complaint); coordinators should avoid
adding health details there.


### D-014 · Employee self-report via a permanent personal link — Accepted 2026-11-24 (founder)
Each employee has one permanent unguessable link (`/a/<report_token>`, 144 bits, unique column on `employees`) where they report
an absence themselves; the link is the credential (no login), same model as the offer links. Safeguards: only the reason
category is collected (D-012, no free text at all); dates validated in the org timezone and capped (≤ 31 days, ≤ 90 days ahead,
not in the past); overlapping active absences are refused; max 5 reports per employee per day; coordinators can regenerate
the link (old one dies, logged); deactivating an employee kills the link. Absences are stored with `source = 'self_report'` and
shown as "Aviso de la propia persona". Schema changes for existing databases go through `migrate()` in `db.ts`
(`addColumnIfMissing`), because `CREATE TABLE IF NOT EXISTS` never alters existing tables.

### D-015 · Roles (admin / coordinator) and password recovery without email — Accepted 2026-11-24 (founder)
Two roles: `admin` manages users (invite, role, deactivate, reset links); `coordinator` does everything operational.
Each org must always keep one active admin (enforced in `src/lib/users.ts`). Authorization is re-checked in the DB inside
every function, not just hidden in the UI. Deactivation deletes sessions; `userForToken()` and `login()` ignore inactive users.
No SMTP or paid service: an admin generates a one-time link (invite 7 days, password reset 24 h) and sends it by WhatsApp
(`wa.me` deep link) or any channel. Only the sha256 of the token is stored (new table `user_tokens`); the raw link is shown once.
Links are single-use, revocable and replaced by a newer one. A reset deletes all of that user's sessions; an own password change
needs the current password and deletes the other sessions. Passwords: 10–200 characters. Revisit with email delivery if the pilot asks.

### D-016 · In-process hourly scheduler for the shift window — Accepted 2026-11-24 (founder)
**Context:** shifts were only generated up to the end of next week (T-017); the pilot runs on one small VPS.
**Decision:** a Next.js `instrumentation.ts` hook starts an hourly in-process job (`src/lib/scheduler.ts`) that
creates missing shifts for every organisation; it never edits existing shifts. `npm run shifts:roll` does the
same for cron; `CAUCE_SCHEDULER=off` disables the in-process job (needed only if more than one process runs).
**Why:** no extra infrastructure (no cron container, no queue) and idempotent, so double runs are harmless.
**Revisit when:** more than one app process or a second server.

### D-017 · One active absence per person per day; finished services are history — Accepted 2026-11-24 (founder; from review T-021)
`registerAbsence` rejects an absence that overlaps an active one of the same person (checked in the write
transaction), so a self-report and a coordinator can't both register the same notice; extra days are registered
separately. Absences never reopen services that already ended today, and direct assignment is refused for a
finished service (a service in progress can still be assigned: the replacement arrives late). Offers keep the
stricter D-009 rule (not after the start).
