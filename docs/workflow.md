# Workflow — how humans and agents work on Cauce

Condensed from the founder's operating prompt (private) (the APOS). This file is the operational
version; the master prompt is reference only.

## 1. Thread architecture (T3 Code project "cauce")

| Thread | Type | Why it exists |
|---|---|---|
| **Cauce HQ** | persistent | Priorities, decisions, task definition, delegation, review/integration. May do small tasks itself. |
| **Producto & Negocio** | persistent, *optional* — create when customer interviews/pricing work starts | Pilot customer research, pricing, positioning, sales material. Distinct, recurring, non-code. |
| `T-xxx <task>` | temporary execution | One bounded task with acceptance criteria; closed after handoff. |

Not created on purpose: separate frontend/backend/test/devops threads (one-person,
one-repo product — they would only fragment context). Technical architecture stays in
HQ until design work becomes recurring.

Lifecycle: create an execution thread when a task is bigger than ~1h or benefits from
isolation; reuse it for tightly related follow-ups; settle it after its handoff is in
the task board (private). Replace a thread (fresh one + handoff) when its context is stale or
overloaded, or when switching provider.

Completed work becomes visible to other threads **only** through the repo:
commits + the task board (private) handoff + `docs/decisions.md`.

## 2. Agent protocol (full)

Before: identify your role/task → read `AGENTS.md` → read your task row in
the task board (private) and only the docs it needs → `git status` / branch → inspect code →
confirm scope and acceptance criteria → escalate conflicting decisions.

During: stay in scope; no unrelated edits; preserve uncommitted work of others; use a
worktree when another agent edits the same area; keep the task status current;
record approved durable decisions.

After: verify (typecheck, lint, tests, build; run the app for UI work) → update the
task row with a handoff:

```
TASK HANDOFF
Task ID / Objective:
Completed:
Files changed / Branch:
Verification:
Decisions:
Limitations / Remaining:
Next action:
```

## 3. Task board
the task board (private). Statuses: Backlog → Ready → In Progress → Review → Done · Blocked.
A task is Done only when verified. One owner per task.

## 4. Delegation & model routing
- Default: HQ executes small tasks directly. Delegate when the task is bounded,
  parallelisable, or needs context isolation. Max 1–3 concurrent workers.
- Every brief is self-contained: objective, files/docs to read, scope, constraints,
  workspace (worktree if overlapping), acceptance criteria, verification, handoff target.
  Children never inherit chat history.
- Routing heuristics (provisional, re-evaluate with evidence):
  bounded low-risk edits → efficient model / low effort;
  routine features → balanced model / medium effort;
  architecture, tricky debugging, security review → most capable / high effort.
  Use a different provider for an independent review only when risk justifies it.
- Available providers are discovered via T3 `orchestrator_capabilities` at setup and when
  something changes (2026-11-23: Claude [Opus/Sonnet/Fable/Haiku 5.x] and Codex [GPT-6.x]
  enabled; others disabled).

## 5. Quota & billing guardrails
- Claude Pro and ChatGPT Plus are separate quotas. Neither exposes agent-readable usage
  telemetry in this setup → status `Claude 5h: UNKNOWN`, `Codex weekly: UNKNOWN`.
- No `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in the dev environment (checked 2026-11-23),
  so agent runs use subscription routes. Never add API keys or enable extra usage
  without approval.
- The **product's** optional AI calls (`ANTHROPIC_API_KEY` in `.env.local`) are billed
  API usage — off by default; the app falls back to deterministic parsing.

## 6. Ralph Loop (opt-in, never default)
Time-boxed autonomous backlog execution only after explicit approval of: objective &
eligible tasks, max duration, iteration/retry/concurrency caps, allowed operations,
spending/provider limits, and whether to continue into further Ready tasks.
Because quota telemetry is UNKNOWN, fallback caps apply (proposed default: ≤ 2h,
≤ 6 iterations, ≤ 2 concurrent workers, 2 retries per task). Continuation across turns
is possible via T3 scheduled tasks / delegated threads, but unverified for long runs —
run a short preflight session first. Stop at the earliest of: time cap, backlog done,
blocker, failure, cancellation.

## 7. Starter template for a new execution thread
```
Role: execution thread for Cauce, task T-xxx.
Read AGENTS.md, then the T-xxx row in the task board (private) and only the docs it references.
Objective: …   Scope: …   Out of scope: …
Acceptance criteria: …
Verify with: npm run typecheck && npm run lint && npm test && npm run build (+ manual check of …)
Finish by updating T-xxx in the task board (private) with a TASK HANDOFF and reporting branch/commit.
```

Starter for **Producto & Negocio** thread:
```
Role: Producto & Negocio thread for Cauce. Read AGENTS.md and docs/product-spec.md
(sections 6–7). Own customer-validation plan, interview scripts, pricing and pilot
offer. Record decisions in docs/decisions.md; propose product-scope changes to HQ.
```
