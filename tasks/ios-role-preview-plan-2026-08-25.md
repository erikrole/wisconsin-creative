# Native iOS Student Role Preview Plan — 2026-08-25

## Goal

Give the signed-in Admin a native iOS Student presentation view for personal QA and the student kickoff meeting, while preserving the existing server-owned preview boundary. The native control must not grant access to Students, change the Admin identity, or create a second impersonation/session system.

## Accepted contracts

- Reuse `POST`/`DELETE /api/admin/role-preview` with the existing shared cookie session.
- The native entry point exposes only `STUDENT`; the server remains the authority for Admin authorization and supported preview roles.
- `/api/me` is the source of truth after each start/stop request. The returned `preview` metadata drives the native banner and shell remount.
- Preview requests remain read-only server-side. Native background writes, push registration, badge app-open writes, and product telemetry are suppressed while the preview is active.
- The preview preserves the Admin identity and is not a person-level Student simulation; it is the effective Student shell and read models available to the Admin session.

## Bounded slices

- [x] Inspect the web preview route, signed cookie contract, native cookie/session client, shell, and Settings navigation.
- [x] Add rollout-tolerant native `preview` decoding and dedicated start/stop API methods.
- [x] Add the Admin-only Student preview control, exit action, persistent read-only banner, and shell/task remount boundary.
- [x] Suppress native background writes and push/Live Activity registration during preview.
- [x] Add focused source contracts and reconcile the Mobile area/task ledgers.
- [x] Run focused tests, the required iPhone 16 Pro build, and final diff checks.

## Verification gates

- Focused `tests/ios-role-preview-source.test.ts` and adjacent native source contracts.
- `npx tsc --noEmit --pretty false` and focused Vitest coverage for the changed source contracts.
- `xcodebuild` for `Wisconsin` on `platform=iOS Simulator,name=iPhone 16 Pro`.
- `git diff --check` and `npm run verify:docs` after docs/task updates.
- Authenticated native start/exit and presentation capture remain separate runtime acceptance gates; no account mutation or deployment is part of this slice.

## Review boundary

This slice is intentionally Admin-only and Student-only in native UI. Staff, Collaborator, student-facing preview controls, production identity changes, kiosk simulation, and a person-level data fixture remain out of scope.
