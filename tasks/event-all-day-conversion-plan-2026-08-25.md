# Manual Event All-Day Conversion Plan - 2026-08-25

## Goal

- Let staff/admin convert a manually authored Schedule event between an all-day date span and an explicit timed window from Event detail.
- Preserve event-date semantics, move existing crew windows atomically, and notify published assignees when the conversion changes their schedule.
- Convert the live Veterans Plaza Ceremony on 2026-08-25 to 4:30–5:30 PM Central only after identifying the exact row and confirming its current source, dates, crew, and publication state.

## Route

- Owner area: Events/Schedule (`docs/AREA_EVENTS.md`)
- Primary surface: `/events/[id]` edit dialog
- Primary mutation: `PATCH /api/calendar-events/[id]`
- Existing propagation authority: `src/lib/services/manual-event-time.ts`
- Ledger: this plan; do not rewrite unrelated active `tasks/todo.md` entries
- Existing reference: completed manual event date/time correction in `tasks/todo.md` and `GAPS_AND_RISKS.md`

## Source Checks

- `CalendarEvent.allDay` already exists and all-day boundaries are canonical UTC-midnight encoded dates.
- Manual event date/time PATCH already uses a SERIALIZABLE transaction, audit entry, and `shiftManualEventScheduleTx` to move live/private/published crew state.
- Imported event times remain calendar-source-owned and must continue to reject manual timing/conversion edits.
- Published worker notifications are sent after commit through the existing shift-group notification helpers; all-day conversion must use that same path.
- The current edit dialog hides time controls for all-day events and does not submit `allDay`.

## Stop Conditions

- Stop the live update if the exact Veterans Plaza Ceremony cannot be uniquely identified, is imported/source-owned, is already ended, or its current date/time is not today in the app timezone.
- Stop if the event has an unpublished working copy or crew state that the existing propagation service cannot reconcile safely.
- Stop if the API response, schema, or production read-back contradicts the manual-event contract.
- Do not send a notification by inserting ad hoc rows; use the existing published schedule notification path and read back its durable result.

## Slices

- [x] Slice 1: Extend the manual event PATCH contract with `allDay`, canonicalize boundaries based on the target mode, and audit the mode change.
- [x] Slice 2: Add an explicit All-day event control to Event detail; preserve date fields, expose times when converting to timed, validate the target window, and explain that crew moves while gear reservations do not.
- [x] Slice 3: Add focused route/service/UI regression coverage for all-day → timed and timed → all-day, imported-event rejection, invalid windows, propagation, audit, and published assignee notification.
- [x] Slice 4: Sync Events/Gaps/task review docs and run the web verification matrix.
- [x] Slice 5: Identify, update, and read back Veterans Plaza Ceremony for today 4:30–5:30 PM Central; verify crew/notification evidence separately.

## Verification

- [x] Focused calendar-event route, manual-event-time, all-day, and Event detail source-contract tests; 45 adjacent tests pass.
- [x] `npx tsc --noEmit --pretty false`
- [x] Focused/full ESLint and `npm run build:app`
- [x] `npm run codemap` followed by `npm run verify:docs` when source/docs maps are affected.
- [x] `npm run db:migrate:check` (schema remained unchanged).
- [x] `git diff --check`
- [x] Authenticated local Admin browser proof of the Event detail conversion control.
- [x] Live event read-back: exact id/title, source ownership, Central date/time, `allDay`, crew window, publication version, and audit/notification rows.

## Review

- Shipped: Manual event all-day ↔ timed conversion in the API and Event detail editor; the live Veterans Plaza Ceremony record is now timed for 4:30–5:30 PM Central today.
- Verified: `allDay=false`, UTC window `2026-08-25T21:30:00.000Z`–`2026-08-25T22:30:00.000Z`, manual `sourceId=null`, published group version 2, one direct assignee (Cole Ahlgren), two audit entries, and one durable `Schedule updated` notification for that assignee.
- Deferred: Production deployment of the new editor/API source change; no commit, push, or deployment was requested, and the working tree contains unrelated parallel changes. Production data and notification read-back are complete.
- Blocked: None for the requested data update.
- Proof artifacts: `tasks/event-all-day-conversion-review-2026-08-25/index.html`, focused tests, TypeScript/lint/build/docs gates, authenticated local browser proof, and production read-back.
- Next slice or stop: Stop here unless the user wants the source change committed/deployed; if deployed, repeat authenticated production UI proof because the current production editor still shows the pre-conversion UI.
