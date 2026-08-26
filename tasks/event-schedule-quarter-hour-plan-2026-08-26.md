# Event and Schedule Quarter-Hour Plan — 2026-08-26

## Goal

Make timed Event and Schedule authoring use forward-only 15-minute increments across manual event creation/editing and Student call-window editing, without changing all-day semantics, imported-calendar ownership, working-copy publication behavior, or linked gear reservation windows.

## Source checks

- Manual event creation is owned by `NewEventSheet`; manual event timing correction is owned by Event detail.
- Imported event timing remains read-only and calendar-source-owned.
- Event timing mutations already move live/private/published crew windows through the audited event service; linked gear reservation windows remain independent.
- Schedule call windows are edited in both the shared live `CallWindowEditor` and the private `WorkingCrewEditor`.
- The shared booking return-time slice already provides forward quarter-hour helpers in `src/lib/quarter-hour.ts`.

## Bounded slices

- [x] Add 15-minute native input steps and forward normalization to timed manual event creation.
- [x] Add the same behavior to manual timed-event correction without moving untouched legacy off-grid events.
- [x] Add the same behavior to live and working-copy Student call-window editors.
- [x] Add focused helper/source-contract regression coverage.
- [x] Sync `AREA_EVENTS.md` and `GAPS_AND_RISKS.md` with the source-verified behavior and remaining runtime proof.

## Stop conditions

- Stop if the change requires accepting mutations for imported event times.
- Stop if it changes all-day inclusive/exclusive date storage.
- Stop if it changes linked booking or checkout reservation windows.
- Stop if call-window normalization would bypass the existing live/working-copy mutation paths.

## Verification

- [x] Focused Event/Schedule quarter-hour tests: 4 passing.
- [x] Existing Event timing and Schedule working-copy/source-truth tests: 25 passing.
- [ ] `npx tsc --noEmit --pretty false`: passed once with this slice present; a later parallel dirty edit now blocks the current shared-worktree gate at `BookingEquipmentTab.tsx:273` and `:275` because `Button` is not defined.
- [ ] `npm run lint`: this slice passes targeted ESLint; the full command is blocked by unrelated dirty-file error `BookingEquipmentTab.tsx:273:12` (`Button` is not defined).
- [ ] `npm run build:app`: application compilation succeeds, then the same unrelated full-lint error blocks completion.
- [x] `npm run codemap` and `npm run verify:docs`.
- [x] `git diff --check` and final scoped diff inspection.
- [ ] Authenticated Event detail and Schedule matched before/after review: blocked because no isolated Playwright target/credentials are available in this checkout. Do not use production identity or fabricate visual proof.
