---
name: gt-page
description: Canonical Wisconsin Creative web page execution workflow. Use when the user runs /gt-page or asks to take a web route or tightly scoped page surface end to end through UX, UI, consistency, hardening, implementation, verification, and documentation. Use gt-audit-web instead for findings only.
---

# GT Page

Own one web route or one tightly scoped route surface through verified implementation. Keep the work operational, evidence-driven, and consistent with the best shipped peer pages.

## Orient

1. Read `AGENTS.md`, `docs/NORTH_STAR.md`, and `docs/DESIGN_LANGUAGE.md`.
2. Read the owning `docs/AREA_*.md`, relevant `docs/BRIEF_*.md`, decisions, gaps, active task ledger, and prior audits.
3. Read the target page and affected siblings completely. Trace referenced components, hooks, API routes, services, tests, and Prisma models.
4. Inspect `git status --short`. Preserve unrelated work.
5. Compare at least two shipped pages with the same workflow shape. Record the patterns worth reusing and any intentional difference.

## Own the surface

- Structure: route hierarchy, primary action, command bar, tabs, filters, scanability.
- UX: role-specific golden paths; loading, empty, filtered-empty, error, success, stale, slow-network, and expired-session states.
- UI: installed shadcn primitives, Wisconsin Creative operational components, 40px targets, restrained motion, wrapping, and semantic status colors.
- Consistency: reuse local patterns before adding abstractions. Record propagation candidates when this page establishes a better shared pattern.
- Hardening: server-side authorization, schema-boundary validation, concurrency, auditability, bounded bulk/export work, and useful failure recovery.

## Execute

1. Use `gt-plan` for a non-trivial pass. Update the existing owner plan when one already exists.
2. Implement the smallest coherent slice that does not leave a broken midpoint.
3. Keep schema/migration, API/service, UI wiring, tests, and docs independently reviewable when the change is substantial.
4. Update the task review after each slice with shipped, verified, deferred, blocked, proof, and next-slice/stop notes.
5. Use `area-doc-sync` before closeout when shipped behavior changed.

## Verify

Select the minimum proof from the `AGENTS.md` verification matrix. Add:

- Focused route/service tests for changed behavior.
- Authenticated browser proof for visible work, including console, network, the changed interaction, and relevant desktop/tablet widths.
- A recorded blocker when runtime proof is unavailable. Do not substitute build success for browser behavior.

## Stop

- Current source, API response, schema, permissions, or live data contradicts the plan.
- Peer patterns disagree and accepted product direction does not resolve ownership.
- The selected slice requires behavior outside its approved scope.
- The same approach or verification failure occurs twice without new evidence.

Close with the user-facing outcome, exact proof, remaining risk, and the next bounded slice or stop recommendation. Do not commit, push, or open a PR unless explicitly requested.
