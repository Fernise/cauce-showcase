# Cauce — Product Specification (v0.1)

> Source of truth for product requirements and business rules.
> Derived from the founder's product brief (2026-11-23). Changes to scope or business
> rules are recorded here and in `docs/decisions.md`.

**One-liner:** Cauce is an AI-native operations coordinator for cleaning companies:
when someone can't make it to a service, Cauce finds, ranks, contacts and confirms
the replacement — and leaves a clean record of what happened.

Name: *cauce* = river channel; "dar cauce" = to channel/route something. Spanish-first.

---

## 1. Smallest compelling MVP

**"De la ausencia a la cobertura confirmada en menos de 5 minutos."**

One end-to-end workflow, polished:

1. A manager pastes (or types) the employee's message — e.g. a WhatsApp text
   *"Buenas, soy Yurena, mañana no puedo ir, tengo al niño con fiebre"*.
2. Cauce extracts employee, dates and reason; flags anything ambiguous.
3. Manager confirms → Cauce lists the **affected services** and opens one
   **coverage case** per service.
4. For each case Cauce shows a **ranked shortlist** of replacements with a
   plain-Spanish explanation and trade-offs (distance, extra hours, knows the site,
   gaps in their day).
5. Manager clicks **"Ofrecer"** → Cauce prepares the message and a personal
   response link. Delivery: one-tap WhatsApp (`wa.me` deep-link, no API needed),
   copy-to-clipboard or email.
6. The employee opens the link on their phone and taps **Acepto / No puedo**.
7. First acceptance wins: the assignment is updated, other open offers are
   withdrawn, the case closes, the timeline records everything.
8. Dashboard shows coverage status for today/tomorrow and what still needs attention.

Secondary (thin but working): **client incidents** — register (also from a pasted
message), link to client/location/service/employee, assign owner, track status to
resolution, timeline.

Everything else in the release exists only to make those two flows credible:
planning view, employees, clients/locations, settings, CSV import.

**Value metric to measure in pilots:** minutes from absence reported → coverage
confirmed, and number of manual messages/calls per absence (target: from ~6–10 calls
to 1–3 taps).

## 2. Domain entities

| Entity | Purpose | Key fields |
|---|---|---|
| Organization | Tenant | name, settings (travel buffer min, max weekly hours default, offer expiry) |
| User | Manager/coordinator login | org, name, email, password hash, role (owner/coordinator) |
| Employee | Cleaning staff | name, phone, email, home zone + lat/lng, contracted weekly hours, skills[], active |
| Availability | Weekly windows an employee can work | employee, weekday, start, end |
| Client | Contract holder | name, contact name/phone/email, notes |
| Location | Service site | client, name, address, municipality, lat/lng, access notes, required skills[] |
| ServiceTemplate | Recurring contract slot | location, weekdays[], start, end, headcount, required skills[], default employee(s) |
| Shift (service occurrence) | A concrete service on a date | template, location, date, start, end, employee (nullable = uncovered), status |
| Absence | Employee can't work | employee, start date, end date, reason category only (D-012: no message/health detail stored), source, status |
| CoverageCase | One uncovered shift needing a replacement | shift, absence (nullable), original employee, status (open → offering → covered / unresolved / cancelled), resolved by |
| Offer | Replacement proposal to one candidate | case, employee, token, channel, message text, status (pending/accepted/declined/withdrawn/expired), score snapshot, timestamps |
| Incident | Client-side problem | client, location, shift?, employee?, type, severity, description, raw message, owner, status (open/in_progress/resolved), resolution note |
| ActivityEvent | Operational timeline (append-only) | org, type, entity ref, actor, summary (es), created_at |

Skills (fixed vocabulary for v1): `cristales`, `industrial`, `sanitario` (clinics),
`altura`, `maquinaria` (floor machines), `cocina`, `llaves` (has keys/alarm code
clearance). Configurable later.

### Business rules — replacement ranking (deterministic, explainable)

**Hard filters** (candidate excluded, reason shown on request):
- Is the absent employee, inactive, or absent on that date.
- Has an overlapping shift (including the travel buffer, default 30 min).
- Shift falls outside their declared availability for that weekday.
- Can't drive there in time from the previous service / to the next one (D-007).
- Missing a required skill of the location/service.
- Would exceed the legal/contract ceiling (default 40 h/week, configurable).

**Soft score** (0–100, weighted, every factor rendered as a reason):
- Proximity to site (home or previous/next shift location) — 35%.
- Spare contracted hours this week (prefer completing part-timers' hours, avoid overtime) — 25%.
- Knows the site (has worked there in the last 60 days) — 20%.
- Fairness (fewer substitutions accepted in last 30 days) — 10%.
- Fits neighbouring shifts without long dead gaps — 10%.

Trade-offs are surfaced explicitly, e.g. *"Más cercana, pero pasaría a 38 h esta
semana (contrato 30 h → horas extra)"*.

AI is **not** the ranking authority: ranking is deterministic and auditable; AI
handles language (parsing messages, drafting communications, summaries).

## 3. Key screens and user journeys

| Screen | Route | Job |
|---|---|---|
| Panel | `/` | "What needs me now?" Uncovered services today/tomorrow, open cases, open incidents, quick "Registrar aviso" box, recent activity |
| Registrar aviso | `/avisos/nuevo` | Paste a message → AI classifies (absence vs incident) and extracts fields → confirm |
| Coberturas | `/coberturas`, `/coberturas/[id]` | Case list; case detail with ranked candidates, offers, responses, assign |
| Planificación | `/planificacion` | Day / week grid of services per location, gaps highlighted |
| Ausencias | `/ausencias` | Absence register and their affected services |
| Incidencias | `/incidencias`, `/incidencias/[id]` | Incident list and lifecycle |
| Personal | `/personal`, `/personal/[id]` | Directory, skills, availability, week load |
| Clientes | `/clientes`, `/clientes/[id]` | Clients, locations, service templates |
| Actividad | `/actividad` | Operational timeline |
| Ajustes | `/ajustes` | Org rules, CSV import, AI/notification status |
| Respuesta | `/r/[token]` | Public mobile page for the employee to accept/decline |

**Journey A (primary):** Panel → "Registrar aviso" → paste message → confirm absence →
affected services → open case → ranked candidates → Ofrecer (WhatsApp) → employee
accepts on `/r/…` → case covered → panel turns green.

**Journey B:** Panel → incident from client message → assign owner → add note →
resolve → timeline.

All screens must be usable on a 375 px phone (bottom navigation on mobile).

## 4. First end-to-end demonstration

Fictional company **Limpiezas Atlántico S.L.** (Santa Cruz de Tenerife):
35 employees, 12 clients, 20 locations across Tenerife (Santa Cruz, La Laguna,
Adeje, Los Cristianos, Puerto de la Cruz, La Orotava, Güímar…), ~39 recurring services,
8 weeks of history + current and next week of shifts, a today absence (one service already
covered, one waiting for an answer), a planned absence next week (2 open cases),
5 past substitutions, 4 open + 3 resolved incidents.

Demo script (≈4 minutes):
1. Log in (`demo@cauce.app` / `demo1234`) → Panel shows tomorrow has 2 uncovered services.
2. Paste: *"Hola Carmen, soy Yurena Díaz. Mañana no voy a poder ir a trabajar, el
   peque tiene fiebre. Lo siento."* → Cauce recognises Yurena, tomorrow, reason
   "familiar", and shows her 2 affected services.
3. Confirm → open case for *Hotel Mencey – habitaciones 07:00–11:00*.
4. Ranking: top 3 with reasons and trade-offs; excluded candidates collapsible.
5. Ofrecer to #1 via WhatsApp link → open the response link (simulating the employee
   on a phone) → "Acepto".
6. Case closes, planning shows the new assignment, timeline shows 5 events,
   panel coverage goes up.
7. Bonus: paste a client complaint → incident created and linked to the location
   and the employee who did the service.

`npm run demo:reset` restores the dataset (dates are relative to "today").

## 5. Explicitly excluded from the first release

- Payroll, invoicing, quotes, contracts/legal documents, HR files, vacation accrual.
- Time clock / GPS check-in (integrate later instead of building).
- Native mobile apps (responsive web + response links are enough).
- WhatsApp Business API, SMS gateways (use `wa.me` deep links + email first).
- Automatic schedule optimisation / full roster generation.
- Client portal (clients report via their usual channel; manager pastes).
- Inventory/supplies management (incidents can mention supplies, nothing more).
- Fine-grained permissions, SSO, audit exports, multi-language UI (structure ready for EN).
- Autonomous AI actions without human confirmation (v1 = AI proposes, human disposes).

## 6. Assumptions requiring customer validation

1. Absences reach managers mostly via WhatsApp text/voice, and pasting the text is
   acceptable friction until WhatsApp integration.
2. Managers trust a ranked shortlist enough to offer from it without re-checking Excel.
3. Employees will open a link and tap a button (vs. preferring a call).
4. "Proximity + spare hours + knows the site" are the dominant replacement criteria;
   missing ones (language, gender for certain sites, client vetoes, car availability).
5. Companies will maintain employee availability windows and skills (or we infer them
   from history).
6. Willingness to pay a monthly subscription for coordination alone, alongside existing software.
7. Coordinators are the daily user; owners buy on "hours saved + fewer uncovered services".
8. Data import from Excel/existing tools is feasible in < 1 day onboarding.
9. Labour-law constraints (descanso entre jornadas 12 h, máx. horas) matter at
   scheduling time and must be enforced, not just shown.

## 7. Differentiation vs. existing cleaning-management software

- **Execution, not records:** competitors store the schedule; Cauce closes the loop
  (detect → rank → contact → confirm → update) with a measurable time-to-cover.
- **Message-in, structure-out:** works from the WhatsApp messages managers already
  receive; no form-filling required from employees.
- **Explainable recommendations:** every suggestion states *why* and *what it costs*
  (overtime, travel, unfamiliar site).
- **Zero-install for staff:** response links instead of an employee app.
- **Complement, don't replace:** CSV in/out; can sit next to the existing ERP during a pilot.
- **Coordinator-first mobile UX:** designed for a coordinator in a car between sites.

## Roadmap after v1 (demand-driven)

WhatsApp Business inbound/outbound · auto-offer cascades with timeouts · daily
morning briefing email · client-facing incident updates · voice-note transcription ·
sync with existing management software · labour-rule engine (rest periods).
