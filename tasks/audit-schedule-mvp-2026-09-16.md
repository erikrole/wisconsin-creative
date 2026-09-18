# Audit: schedule — 2026-09-16 MVP trust pass

**Verdict after fix:** SOURCE READY for the bounded P0/P1 slice. Authenticated web, iPhone 16 Pro runtime, deployment, GAP-60 timer, and live combined-event proof remain open.

**Ship bar:** fast, trustworthy, simple. Students and staff see the same published truth; staff can recover failed past corrections; iOS does not crash on multi-area assignments.

## Findings closed in this slice

- [x] P0 Native same-event multi-shift crash (`Dictionary(uniqueKeysWithValues:)`).
- [x] P1 Contextual Claim offered during private crew edits.
- [x] P1 Ended-event mutate+publish left a draft with no Apply control.
- [x] P1 Native Publish now missing after Staff `shift.publish_now`.
- [x] P1 Combined events listed as two independent iOS rows.

## Intentionally not treated as MVP blockers

- Week view, assignment grid, auto-assign, combine authoring: web control-room.
- Native Undo/Redo remains native-only; web keeps Revert / Publish now.
- GAP-60 exact-version timer acceptance proof.
- Multi-day all-day list placement vs Week/Calendar (P2).
- Personal "Your Shift" still shows the earliest of multiple same-event shifts.

## Proof

- Focused source contracts and calendar-event route tests.
- Native combined-window unit test in `ScheduleDateMathTests.swift`.
- Remaining: TypeScript, ESLint, `build:app`, iPhone 16 Pro xcodebuild, authenticated browser.

See `tasks/schedule-mvp-parity-plan-2026-09-16.md`.
