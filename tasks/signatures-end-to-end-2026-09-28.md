# Signatures end-to-end pass — 2026-09-28

Owner: current Signatures chat. Scope: review and fix the existing workflow sequentially, without committing or deploying. User priority: start with the main workflow.

## Contracts and boundaries

- Owners: `docs/AREA_SIGNATURES.md`, `docs/BRIEF_SIGNATURE_CAPTURE_V1.md`, D-050, existing design system.
- Staff/admin management; iPad Safari pen-only capture; committed private artifacts define completion; immutable revisions; explicit erasure; versioned and audited mutations.
- Preserve unrelated checkout changes. No schema or native client change planned. Preview is the existing signed isolated branch environment (`br-raspy-sun-au47wnog`), not production.
- Primary workflow: `gt-page`. Distinct dependencies: `gt-ui-review` for visual evidence; `gt-test-audit` for regression test authoring; `gt-api-hardening` for service lifecycle boundaries. Work was performed sequentially without delegated agents.

## Sequential owner checklist

1. **Collection discovery and import — complete locally.** Fixed stale sport/season previews, exposed individual preview members, separated background sync from manual pending actions, gave ad-hoc capture its own bounded season selector, and included retained inactive history in delete confirmation.
2. **Roster and management — complete locally.** Search reveals collapsed matches; status and removed-member views expose unfinished work/history. Management requests serialize and reconcile server state. Settings use the server lock and observed edit versions. Reset errors remain actionable in the confirmation.
3. **Capture and recovery — complete in browser simulation.** Full-height signing keeps Save visible at 1180×820. Reconnect preserves the original capture version. Unconfirmed responses and a 45-second timeout retain ink and request identity. Committed feedback precedes navigation/draft cleanup. Physical Pencil remains separate.
4. **Backend and artifacts — source and focused tests complete.** Inspected permissions, validation, idempotency, canonical shared captures, transactions, cleanup, imports, exports, and source adapters. Fixed stale lifecycle versions, inactive-member erasure, canonical blank state, cleanup retry exclusion, case-colliding ZIP names, and streaming memory budget.
5. **Final verification — local gates complete; live acceptance pending approval.** 125 tests in eight files, TypeScript, scoped lint, and controlled app build pass. Repository lint has one pre-existing vendored QR-scanner error. Review and documentation checks are recorded below as completed.

## Evidence and findings

- Initial state: substantial unrelated dirty work; Signatures source/tests/area doc are clean.
- Preview state verified: signed template ancestry valid, no pending migrations. Local app started through `scripts/preview.mjs dev` on port 3490.
- Import baseline reproduced a stale Apply button after changing season; after the fix the preview disappears. A real authenticated MHKY/2026-27 Preview/Apply produced 26 active members on preview collection `cmum36ikb001qp5qrpq8xm46z`, without saving signatures.
- Roster baseline hid a matching signer inside a collapsed group; the same query now reveals the row. Signed-empty and Clear filters checks pass. Intercepted locked-empty and failed-reset responses verify presentation/recovery, not real reset persistence.
- Capture baseline silently changed a draft's submitted capture version from 0 to 1 after reconnect. The fixed browser sends 0, keeps one stroke, and safely receives a conflict. Non-JSON 200, 503, and a client timeout all preserve the same retry ID and ink. Browser saves were intercepted.
- Eight selected regression cases fail against an isolated copy of the original service; the updated focused suite passes. The new streaming limit test separately proves cancellation at the budget instead of buffering the whole oversized file.
- `build:app` passed using Node 22 and the signed isolated preview environment: 262 generated pages. No migration deployment ran. TypeScript and scoped lint passed. Full `eslint .` reports one existing `@next/next/no-assign-module-variable` error in `public/qrcode/vendor/jsQR.js` plus existing warnings; unrelated vendor code was preserved.
- Shared `AppShell.tsx` already contained unrelated performance edits. This pass adds only the exact Signatures capture-route shell bypass, retaining role-preview feedback and parent authentication/providers.
- No Signatures native client is present or changed; Xcode acceptance does not apply to this iPad Safari workflow.
- Visual review: `tasks/archive/proofs/signatures-2026-09-28/review.html`. Capture is after-only visual evidence with a recorded behavioral baseline; roster/import comparisons retain their original screenshots.
- Live test: `tasks/archive/proofs/signatures-2026-09-28/live-test-plan.md`. The prepared runner defaults to read-only preflight and refuses an existing ADHOC/2032-33 collection or a changed preview branch. Execution has not been authorized after the automatic approval rejection.

## Completion boundaries

No commit, push, merge, deployment, production mutation or physical-device acceptance is included. Leave this ledger active until the explicitly gated isolated private-artifact test is either completed or declined. Production deployment and physical iPad pen/touch/rotation/interruption remain under GAP-65.
