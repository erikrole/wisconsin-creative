---
name: gt-audit-ios
description: Canonical read-only Wisconsin Creative iOS readiness audit. Use when the user runs /gt-audit-ios, asks to audit a Wisconsin SwiftUI screen or native workflow, asks whether an iOS surface is ready, or wants prioritized native findings before deciding what to fix. Do not implement during the audit.
---

# GT Audit iOS

Audit one native screen or tightly related workflow from current source, API contracts, and simulator or build evidence. Do not fix findings during the audit.

## Orient

1. Read `AGENTS.md`, `docs/NORTH_STAR.md`, `docs/AREA_MOBILE.md`, the feature area doc, decisions, gaps, active ledger, and prior audit.
2. Read the target view completely. Trace dependent views, stores, models, API clients, services, app lifecycle, project membership, source-contract tests, and the server routes that provide its data.
3. Inspect `git status --short` and distinguish shipped source from unrelated or active dirty work.
4. Confirm the affected target and deployment baseline from the current Xcode project and mobile area doc. Do not rely on historical project-memory files.

## Audit lenses

- Product coverage: required student, staff, admin, and kiosk workflows for the selected surface.
- State and recovery: loading, empty, error, success, offline, expired-session, interruption, resume, and stale-data paths.
- Native interaction: navigation, sheets, focus, cancellation, destructive confirmation, 44pt targets, Dynamic Type, VoiceOver, reduced motion, safe areas, and supported window sizes.
- Contract safety: actual server envelopes, nullable fields, backward-compatible decoding, rollout order, authentication, and role affordances.
- Concurrency and lifecycle: actor boundaries, duplicate actions, task cancellation, scene transitions, and persisted user input.
- Parity: report web differences only when relevant; block readiness only when a required native workflow is missing.

## Evidence and severity

- P0: crash, security boundary failure, data loss, or broken required native workflow.
- P1: material trust, recovery, accessibility, or visible native defect that should be fixed before the stated release.
- P2: worthwhile non-blocking improvement.

Confirm every finding against current source. Cite exact paths and lines. Mark uncertainty explicitly.

## Build and runtime proof

Use the repository iOS scripts from `package.json` and the `AGENTS.md` verification matrix. Include relevant Swift source-contract tests. When runtime readiness is requested and a simulator is available, launch the affected flow and inspect its actual presentation and interaction.

Use these verdicts:

- `READY`: no P0/P1 blockers and required build/runtime proof passed.
- `SOURCE READY`: source audit is clean, but required build or runtime proof is unavailable.
- `NOT READY`: one or more evidenced P0/P1 blockers remain.

## Record and response

Create or update `tasks/audit-<screen>-ios.md` when the user requests a durable audit record or the active repository workflow requires one. For an answer-only request, keep the audit read-only and return the evidence in chat. Preserve useful unresolved history; do not blindly overwrite prior evidence. Include verdict, scope, findings, acceptance status, API-contract proof, build/runtime proof, files read, and known limits.

Lead chat with the verdict and record path, then list findings by severity. End with a recommended bounded fix order. Ask for fix, defer, or skip decisions only when the user requested diagnosis rather than implementation.

Do not commit, push, open a PR, or implement findings unless the user separately authorizes that work.
