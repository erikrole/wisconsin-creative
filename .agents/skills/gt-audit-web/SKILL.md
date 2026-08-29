---
name: gt-audit-web
description: Canonical read-only Wisconsin Creative web readiness audit. Use when the user runs /gt-audit-web, asks to audit a route or page, asks whether a web surface is ready to ship, or wants prioritized findings before deciding what to fix. Do not implement during the audit.
---

# GT Audit Web

Audit one route or tightly related route family from current source and runtime evidence. Do not fix findings during the audit.

## Orient

1. Read `AGENTS.md`, `docs/NORTH_STAR.md`, `docs/DESIGN_LANGUAGE.md`, the owning area and brief docs, decisions, gaps, active ledger, and prior audit.
2. Read the target route and affected siblings completely. Trace every referenced component, hook, API route, service, test, and Prisma model needed to evaluate behavior.
3. Inspect `git status --short` and distinguish shipped source from unrelated or active dirty work.
4. Map routes to their real owner area. A route name does not need a same-named `AREA_*.md`; flag missing documentation only when no accepted owner exists.

## Audit lenses

- Contracts: acceptance criteria, decisions, gaps, and current API response shapes.
- Flows: every meaningful action, role, state transition, confirmation, recovery path, URL state, and destructive path.
- UI: Wisconsin Creative design language, installed primitives, copy, density, accessibility, wrapping, and responsive desktop/tablet behavior.
- Hardening: authentication, authorization, validation, transaction boundaries, stale/concurrent writes, audit entries, query shape, and bounded bulk/export work.
- Failure cases: slow or partial data, expired session, role changes, empty data, long values, invalid pagination, retries, and duplicate submissions.
- Parity: report web/iOS differences only when relevant; block readiness only when a required workflow is missing.

## Evidence and severity

- P0: security boundary failure, data loss, broken required workflow, common crash/500, or no accepted product owner for a shipping surface.
- P1: material trust, recovery, accessibility, or visible workflow defect that should be fixed before the stated release.
- P2: worthwhile non-blocking improvement.

Confirm every finding against current source. Cite exact paths and lines. Mark uncertainty explicitly instead of promoting it to a finding.

## Runtime proof

Use authenticated browser inspection when the user asks for launch or runtime readiness and a session is available. Check the golden interaction, console, network, and relevant viewport. Use these verdicts:

- `READY`: no P0/P1 blockers and required runtime proof passed.
- `SOURCE READY`: source audit is clean, but required runtime proof is unavailable.
- `NOT READY`: one or more evidenced P0/P1 blockers remain.

## Record and response

Create or update `tasks/audit-<route>-web.md` when the user requests a durable audit record or the active repository workflow requires one. For an answer-only request, keep the audit read-only and return the evidence in chat. Preserve useful unresolved history; do not blindly overwrite prior evidence. Include verdict, scope, findings, acceptance status, runtime proof, files read, and known limits.

Lead chat with the verdict and record path, then list findings by severity. End with a recommended bounded fix order. Ask for fix, defer, or skip decisions only when the user requested diagnosis rather than implementation.

Do not commit, push, open a PR, or implement findings unless the user separately authorizes that work.
