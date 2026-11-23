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

