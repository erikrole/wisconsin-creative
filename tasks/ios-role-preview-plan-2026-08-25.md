# Native iOS Student Role Preview Plan — 2026-08-25

## Goal

Give the signed-in Admin a native iOS Student presentation view for personal QA and the student kickoff meeting, while preserving the existing server-owned preview boundary. The native control must not grant access to Students, change the Admin identity, or create a second impersonation/session system.

## Accepted contracts

- Reuse `POST`/`DELETE /api/admin/role-preview` with the existing shared cookie session.
- The native entry point exposes only `STUDENT`; the server remains the authority for Admin authorization and supported preview roles.
- `/api/me` is the source of truth after each start/stop request. The returned `preview` metadata drives the native preview marker and shell remount.
- Preview requests remain read-only server-side. Native background writes, push registration, badge app-open writes, and product telemetry are suppressed while the preview is active.
- The preview preserves the Admin identity and is not a person-level Student simulation; it is the effective Student shell and read models available to the Admin session.

## Bounded slices

- [x] Inspect the web preview route, signed cookie contract, native cookie/session client, shell, and Settings navigation.
- [x] Add rollout-tolerant native `preview` decoding and dedicated start/stop API methods.
- [x] Add the Admin-only Student preview control, exit action, persistent read-only indicator, and shell/task remount boundary.
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

## Follow-up: Quieter Preview Chrome — 2026-08-26

The persistent preview marker is context, not an operational warning. Keep real
network and error banners unchanged, remove the top preview banner, and use a
very thin orange screen-edge accent. The preview ends from Settings →
Presentation so the edge marker stays quiet and non-interactive.

- [x] Replace the preview banner with a thin orange screen-edge accent without changing warning/error callers.
- [x] Keep the Admin-owned Student preview exit action in Settings and preserve accessibility copy there.
- [x] Capture matched before/after native screenshots and record the measured visual difference.
- [x] Run focused contracts, the iPhone 16 Pro build, and docs/diff checks.

### Follow-up review

- **Shipped locally:** The urgent preview pill and its in-banner Exit action are removed. Active Student preview now uses a one-point orange screen-edge accent; the preview remains read-only and is ended from Settings → Presentation.
- **Verified:** Focused source contracts, fixture-driven matched UI captures, the Wisconsin Debug iPhone 16 Pro / iOS 26.5 simulator build, and `git diff --check` pass.
- **UI review:** `tasks/ios-role-preview-chrome-review-2026-08-26/review.html` records the committed before state, the after state, and the measured 44-point warning surface removed from the top of the screen.
- **Boundary:** Network and error banners were left unchanged. Authenticated physical-device start/exit and deployment remain separate acceptance gates.
