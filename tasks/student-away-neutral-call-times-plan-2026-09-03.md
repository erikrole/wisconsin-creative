# Student away/neutral call-time policy — 2026-09-03

## Goal

Remove Student call times from worker-facing schedule surfaces when the assignment belongs to an Away/road game or a Neutral-site game. Home games and non-game work retain the existing Student call-time behavior. Stored shift and assignment windows remain intact for conflict detection, readiness, publication state, and staff operations.

## Contract audit

- `src/lib/venue-tone.ts` is the existing event venue authority, including explicit `site` and neutral-site handling.
- `src/lib/shift-call-windows.ts` is the existing effective Student call-window authority.
- `docs/AREA_SHIFTS.md` and decision D-046 already establish Student-only call times and Away-template defaults for neutral games with opponents; this request closes the remaining road/neutral display and notification leakage.
- Current generation/sync deliberately stores Student shift windows for every game; this slice does not alter that storage contract.

## Implementation slices

- [x] Add one venue-aware Student call-time policy helper and apply it to API, calendar export, published schedule, and notification projections.
- [x] Apply the policy to web Schedule, assignment, Event detail, side-panel, Dashboard, and Trade Board surfaces without removing staff scheduling controls for eligible Home/non-game work.
- [x] Apply the policy to native Schedule, Home, Profile, Event detail, and Trade Board models/views; retain event timing where a call time is suppressed.
- [x] Add focused behavioral/source-contract coverage for Home/non-game versus Away/Neutral and preserve all-day behavior.
- [x] Sync area/decision/task documentation and record the focused tests, TypeScript, lint, build, authenticated browser, and UI-review gates.

## Verification gates

- Source: focused tests, `npx tsc --noEmit --pretty false`, lint, and `npm run build:app`.
- Native: affected source-contract tests and the required iPhone 16 Pro Xcode build.
- Runtime: authenticated web proof for a Home, Away, and Neutral event if local auth/data permits; otherwise report the exact unavailable gate.
- Visual: matched before/after captures and a `gt-ui-review` page showing only the call-time change.

## Evidence — 2026-09-03

- [x] Focused Vitest: 11 files, 107 tests passed.
- [x] `npx tsc --noEmit --pretty false` passed.
- [x] `npm run lint` passed.
- [x] Required iPhone 16 Pro Debug Xcode build passed.
- [x] `git diff --check` passed.
- [x] `npm run build:app` — compiled successfully, type-checked, generated all 257 static pages, and finalized the production-shaped route build.
- [ ] Authenticated browser proof — not completed; local authenticated runtime/data remains unverified.
- [ ] Matched before/after UI review — not completed; CoreSimulatorService was unavailable and no artifact publisher was exposed.
- [ ] Deployment, production read-back, and physical-device acceptance — not requested or verified.

## Closeout

Keep this plan active until authenticated runtime, visual, and rollout gates are separately closed. Do not stage, commit, or push unrelated work.
