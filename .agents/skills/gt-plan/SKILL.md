---
name: gt-plan
description: Wisconsin Creative planning and execution-routing workflow. Use when the user runs /gt-plan, asks to plan a feature/slice/fix/audit follow-up, asks what to do next, or starts any non-trivial Wisconsin Creative task that needs repo-grounded docs, schema, task-ledger, stop-condition, and verification sequencing before implementation.
---

# /gt-plan

Use this before non-trivial Wisconsin Creative work. The output is a practical execution route and, when needed, a plan file. Optimize for trustworthy future work: current source facts, narrow slices, explicit blockers, and closeout evidence.

## Inputs

- Feature, route, area, bug, or slice name.
- If no name is supplied, infer from the user's request and current diff.
- Whether the user wants planning only, implementation after planning, or a deferred ledger update.

## Required Reads

1. `AGENTS.md`
2. `docs/NORTH_STAR.md`
3. `tasks/README.md`
4. `tasks/INDEX.md`
5. `tasks/todo.md`
6. `tasks/lessons.md`
7. Relevant `docs/AREA_*.md`
8. Relevant `docs/BRIEF_*.md`
9. `docs/DECISIONS.md`
10. `docs/GAPS_AND_RISKS.md`
11. `prisma/schema.prisma` when data, permissions, lifecycle, or API shape is touched
12. Related active plans, follow-up ledgers, and archived plans under `tasks/`
13. Current source files and tests for the target area

Read only the relevant area docs and plan files, but read selected files completely before editing them.

## Routing

1. Check `git status --short` before planning so dirty work is not mistaken for shipped state.
2. Map the request to one owner area and any secondary areas.
3. Decide where the work belongs:
   - Update an existing active `tasks/*-plan.md` when it already owns the work.
   - Update `tasks/todo.md`, `DESLOPPIFY.md`, or a follow-up ledger when the user only wants tracking or deferral.
   - Create `tasks/<feature>-plan.md` only for a new active implementation slice.
   - Move completed plans to the current completed-plan archive bucket named in `tasks/INDEX.md` when closeout is complete and references are updated.
4. If the user explicitly says "defer", "mark the plan", or similar, update the ledger and stop. Do not start implementation from directional approval alone.

## Workflow

1. State the owner area, source facts, and current task-ledger destination.
2. Write or update the plan or ledger before implementation.
3. Keep the first slice small, dependency-aware, and independently testable:
   - Schema or migration
   - API or service
   - UI or iOS wiring
   - Tests
   - Docs and hardening
4. Add stop conditions for any source, docs, schema, API response, live data, browser, or build state that can contradict the plan.
5. Add a verification section with exact commands and proof artifacts.
6. Before client work reads API data, inspect the route's `return ok(...)` or equivalent response shape.
7. For UI work, use existing shadcn/ui primitives and local patterns before adding custom controls.
8. For web flow work, include authenticated browser smoke unless credentials/session/runtime are genuinely unavailable.
9. For iOS work, include the current project, drift, gap-audit, source-contract, build, and runtime gates from `package.json` and `AGENTS.md`.

## Plan File Shape

```markdown
# <Feature> Plan - <YYYY-MM-DD>

## Goal
- <user-facing outcome>

## Route
- Owner area:
- Ledger:
- Existing plan/archive references:

## Source Checks
- <doc/source/schema facts with paths>

## Stop Conditions
- Stop if <contract mismatch or missing source truth>.

## Slices
- [ ] Slice 1: <independently testable unit>
- [ ] Slice 2: <independently testable unit>

## Verification
- [ ] <focused tests>
- [ ] `npx tsc --noEmit --pretty false`
- [ ] `npm run verify:docs` when source, docs, route maps, codemaps, or shared ownership changed
- [ ] `npm run db:migrate:check`
- [ ] `git diff --check`
- [ ] `npm run build:app` for app-only compile proof
- [ ] `npm run build` only when migration deploy behavior is in scope and approved
- [ ] Authenticated browser smoke for touched web routes, or record why blocked
- [ ] iOS drift/audit/build gates for native or shared API-contract changes

## Review
- Shipped:
- Verified:
- Deferred:
- Blocked:
- Proof artifacts:
- Next slice or stop:
```

## Rules

- Do not edit implementation files until the plan or ledger has a coherent first slice.
- Prefer `npm run build:app` for app-only compile checks. `npm run build` runs the Prisma/Neon migration deploy wrapper first, so use it only when deploy behavior is intentionally in scope.
- For commit-ready shipping work, include full `npm run build` in the plan when migration deploy preflight is safe and approved; if it cannot run, record the blocker and the local compile proof used instead.
- Run `npm run codemap` before `npm run verify:docs` when shared source, routes, schema, or codemap-owned files changed.
- If `npm run verify:docs` fails from codemap drift, either regenerate codemaps in scope or stop explicitly at the docs gate.
- Tests and builds do not replace authenticated browser proof for user-facing web work.
- Stop instead of improvising when a plan's explicit contract does not exist in source, schema, API response, or live data.
- Close every slice by updating the plan/ledger review with shipped, verified, deferred, blocked, and next-slice/stop notes.
- Sync relevant `docs/AREA_*.md` and `docs/GAPS_AND_RISKS.md` when functionality ships.
- Preserve unrelated dirty work. Do not rewrite active task ledgers or plans outside the selected slice.
