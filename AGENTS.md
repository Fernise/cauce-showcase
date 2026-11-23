# AGENTS.md — Cauce

Canonical instructions for every agent (Claude Code, Codex, T3 Code threads, subagents).
`CLAUDE.md` only points here. Keep this file short; details live in `docs/`.

## Project
Cauce: AI-native operations coordinator for cleaning companies (Spain, Canarias first).
Solo founder, minimal infra budget (one small Hetzner VPS), Spanish-first UI.

## Sources of truth
| What | Where |
|---|---|
| Product scope, business rules | `docs/product-spec.md` |
| Approved technical/product decisions | `docs/decisions.md` |
| Collaboration workflow, threads, model routing, Ralph Loop policy | `docs/workflow.md` |
| Implementation | the code |

If sources conflict, report it; don't silently overwrite a recorded decision.

## Stack & commands
Next.js (App Router, server actions) · TypeScript · Tailwind CSS · SQLite via built-in
`node:sqlite` (no ORM) · Node ≥ 22.13. See `docs/decisions.md`.

```
npm install
npm run demo:reset   # (re)create data/cauce.db with the demo company
npm run dev          # http://localhost:3000  — demo@cauce.app / demo1234
npm test             # unit tests (node --test)
npm run typecheck && npm run lint && npm run build
```

## Code conventions
- UI text in Spanish; code, identifiers and docs in English.
- Every query is scoped by `org_id` (multi-tenant from day one).
- Business logic in `src/lib/` (pure, tested); pages/actions stay thin.
- Ranking is deterministic and explainable; AI is used for language only and must have
  a deterministic fallback so the app runs with no API key and no cost.
- Append an `activity` event for every operational state change.
- No new runtime dependencies without a reason recorded in `docs/decisions.md`.

## Agent protocol (short form — full version in `docs/workflow.md`)
**Before:** read this file + the task's row in the task board (private); check `git status`;
inspect relevant code; don't redo Done/owned work.
**During:** stay in scope; preserve others' changes; record durable decisions;
separate assumptions from facts.
**After:** run typecheck, lint, tests and build as relevant; update the task board (private)
(status + handoff); never mark unverified work Done; report what's not integrated.

## Authorization boundaries (always ask the human first)
Production deploys, purchases/new paid services or API billing, contacting third
parties, sending real emails/messages, destructive git (force-push, reset, branch
deletion), changing data destinations or AI providers, major architecture changes,
starting a Ralph Loop session.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
