# Audit: event detail (iOS) — 2026-05-08

**MVP verdict (pre-fix):** ships, but two raw-color drifts (`CoveragePill` and `workerTypeColor`) escaped today's token sweep, `EditShiftTimesSheet` has no in-flight UI / no discard confirm / no haptic, and a few a11y gaps remain.
**Ship bar:** student-friendly, fully functional for core flows, zero hiccups in front of a class.
**Audit type:** static source (no build/run/UI tests).

Scope: `EventDetailSheet` + `EventDetailViewModel` + `CoveragePill` + `AreaBlock` + `ShiftRow` + `EditShiftTimesSheet` in `ios/Wisconsin/Views/EventDetailSheet.swift`. Slice 8 (2026-05-07) shipped status-token migration on the embedded "Pending" pill + Approve/Decline mini buttons; this is the focused follow-up.

## 2026-10-18 Travel roster

- [x] Away games with a sport show the read-only travel roster from `GET /api/calendar-events/:id/travel` for students, staff, and admins. Home games and collaborators do not request it.
- [x] The list names each person and their area. The row opens that person's profile. A failed refresh keeps the previous list.
- [x] Adding and removing travelers stays on the website. An Xcode build on a Mac is still required.

## 2026-07-18 Full-screen Redesign Follow-up

- [x] `EventDetailSheet` presentation was refactored into reusable `EventDetailView` and now uses the parent navigation stack with standard Back behavior.
- [x] A compact classification hero leads into role-adaptive assignment, gear, open-shift, or staffing actions.
- [x] `MyShift.gear.bookings` now drives direct booking rows without fetching the dashboard payload.
- [x] Unassigned students get one explicit Open Shifts claim surface; duplicate Claim controls are suppressed in crew rows.
- [x] Staff assignment, unassignment, approval, duplication, deletion, call-time editing, and trade controls remain in the existing row/context flows.
- [x] Action failures use mutation-specific titles and Try Again while preserving the current detail state.

## 2026-07-18 Staff Authoring Follow-up

- [x] Add Shift receives event identity from Event detail and separates area, worker class, and inherited or custom call-window decisions.
- [x] Custom shift timing uses 15-minute options, omits the current year, validates end after call, and keeps submission state visible.
- [x] Assign Person receives event title, slot class, area, and call-window context from the selected open shift.
- [x] Existing candidate scores now order Best Fits before review candidates and explain the strongest fit or warning signal.
- [x] Hard conflicts are disabled; advisory availability conflicts retain staff override through an explicit Assign Anyway confirmation.
- [x] Initial loading uses candidate-shaped skeletons and assignment failure keeps the candidate plus a Retry action.

## 2026-07-18 Edit Times and Post Trade Follow-up

- [x] Edit Shift Times now carries event, area, and worker-class context and shares Add Shift's 15-minute Call and End controls.
- [x] Current-year dates stay compact, invalid windows explain themselves inline, and one purple Save action is guarded against duplicates.
- [x] Failed saves keep the edited times visible with a named Retry action.
- [x] Event detail replaces its bare trade confirmation with the shared Post to Trade Board sheet, including optional notes and explicit assignment consequences.
- [x] Existing role gates, shift mutation, trade mutation, and crew-row context menus remain unchanged.

## 2026-08-19 Temporal Continuity and Crew Resilience

- [x] `ScheduleEvent.timeState` shared with the Schedule list so both surfaces answer "is this under way" identically.
- [x] Header eyebrow states NOW or Ended; the time line takes the live accent. Cancelled suppresses both.
- [x] A failed staff working-copy fetch no longer blanks the loaded published roster; it degrades to a non-blocking notice with Retry.
- [x] Covered by `tests/ios-event-detail-temporal-state.test.ts` and captured in both states by `EventDetailScreenshotUITests`.
- [ ] [Polish] Open crew slots still offer Assign on an event that has already ended. The primary action bar is gated on `eventHasEnded`; the inline row actions are not. Deliberate for backfilling records, or a gap — needs a product call.

**Surrounding context:** event detail is the schedule's primary touchpoint — students see "what's the event, what's the call time, can I request a slot," staff see "who's pending, approve/decline, add/remove shifts." Reachable from `ScheduleView` (with `myShift` populated) and `HomeView` (with `myShift` nil — prep gear button hidden). Action handlers all share a single `actionError` alert.

## P0 — blocks MVP

_None._ Auth/role gating is correct (`canManageShifts` for STAFF/ADMIN, `isStudent && isStudentSlot` for student request flow). Confirmation dialogs exist for unassign, request, and delete (with explicit "shift has someone assigned" messaging when applicable). Haptics fire on every action handler (request, unassign, approve, decline, delete, edit-times, duplicate). Pending-request approve/decline appears both in context menu AND inline mini-buttons.

## P1 — polish before ship

- [x] [UI polish] **`CoveragePill` uses raw `.green` / `.orange` / `.red`.** Drifts from the `StatusTone` token system established across the rest of the app today. `pillColor` returns raw `.green/.orange/.red` literals based on coverage percentage.
      `ios/Wisconsin/Views/EventDetailSheet.swift:514-532`.
      Suggested fix: replace `pillColor` with `StatusTone` lookup (`.green` / `.orange` / `.red`) and route through `Color.statusText(_:)` and `Color.statusBackground(_:)` for the foreground + background pair. Mirrors the kiosk + booking-detail status-token sweep.

- [x] [UI polish] **`workerTypeColor` uses raw `.blue` for student slots.** Same family of drift.
      `ios/Wisconsin/Views/EventDetailSheet.swift:808-810`.
      Suggested fix: `Color.statusText(.blue)` for `ST`, keep `.secondary` for `FT` (intentional muted treatment for staff slots).

- [x] [Hardening] **`EditShiftTimesSheet.Save` dismisses synchronously while the parent's API call is mid-flight.** The `onSave` closure takes `Date, Date -> Void`; the sheet's Save button does `isSaving = true; onSave(...); dismiss()` with no await. The parent's `updateShiftTimes(...)` is `async`, so the API call lands AFTER the sheet has dismissed. User sees zero loading state; `isSaving` is set but never rendered visually.
      `ios/Wisconsin/Views/EventDetailSheet.swift:815-863, 300-309`.
      Why it matters: sheet dismisses → user sees "back to event detail" → 1-2 s later the row updates (or not, if the call failed). Unclear whether the change took.
      Suggested fix: change `onSave` signature to `(Date, Date) async -> Void`. Inside the sheet, `await onSave(start, end)` then dismiss. Render `ProgressView` inside the Save button while `isSaving`. Match the inline-spinner pattern shipped today.

- [x] [Flows] **`EditShiftTimesSheet` has no discard confirm if the user has changed times.** A user edits the call time, taps Cancel, the change is lost without warning.
      `ios/Wisconsin/Views/EventDetailSheet.swift:847-849`.
      Suggested fix: track the initial values, compare on Cancel, show a `confirmationDialog("Discard changes?", ...)` when there's a delta. Mirrors `EditBookingSheet` / `EditAssetSheet` / `ExtendBookingSheet`.

- [x] [Flows] **`EditShiftTimesSheet` has no haptic.** Save success and error fire haptics on the parent (`updateShiftTimes`), but the sheet itself dismisses with no tactile signal — and after my P1 fix above, the Save button can fire its own success haptic before the parent's redundant one.
      Suggested fix: drop the parent-handler haptic; let the sheet's awaited Save fire `Haptics.success()` on its way to dismiss, `Haptics.warning()` on a thrown error. Consistent with every other edit-sheet pattern shipped today.

- [x] [A11y] **My-shift indicator dot has no accessibility label.** A 7-pt accent-tinted dot at the right edge of the row signals "this is yours" visually; VoiceOver users hear nothing.
      `ios/Wisconsin/Views/EventDetailSheet.swift:644-648`.
      Suggested fix: `.accessibilityLabel("Your shift")` on the dot — paired with combining the row into a single VO element so the label flows into the row's announcement.

- [x] [A11y] **`ShiftRow` is not a combined accessibility element.** VoiceOver walks each piece (call time, end time, worker type pill, assigned person, status pill, my-shift dot) when a single combined "Call time {time}, {worker type}, {assigned person}" announcement is friendlier.
      `ios/Wisconsin/Views/EventDetailSheet.swift:614-655`.
      Suggested fix: `.accessibilityElement(children: .combine)` + explicit row label that puts the most important fact first.

- [x] [A11y] **Approve / Decline mini buttons in `assignedPersonView` have no explicit accessibility label.** Their text is "Approve" / "Decline" but VO doesn't know WHICH assignment they target without context.
      `ios/Wisconsin/Views/EventDetailSheet.swift:744-758`.
      Suggested fix: `.accessibilityLabel("Approve \(assignment.user.name)")` / `.accessibilityLabel("Decline \(assignment.user.name)")`. Mirrors the context-menu treatment.

- [x] [A11y] **Sport pill ("VFB" / "MBB" / etc.) has no accessibility label.** VO reads the abbreviation char-by-char; a fuller label like "Sport: Football" would be more useful, but for parity with how other pills work just announce the visible text.
      `ios/Wisconsin/Views/EventDetailSheet.swift:349-358`.
      Decision: **Skip.** Sport codes are intentionally short tokens; a wider lookup would conflict with other surfaces that don't have it.

## P2 — post-MVP

- [x] [Polish] Prep-gear creation retains the new booking ID, opens Booking Detail, and leaves a persistent Gear reserved route on return.
- [x] [Polish] Action-error alerts use mutation-specific titles.
- [x] [Polish] Mutation failures offer Try Again and retain the current Event detail state.
- [ ] [Polish] **Deferred.** Race-protection on rapid taps of Approve/Decline mini buttons. Server enforces idempotency; the second tap's API call returns 409 and surfaces. Acceptable.
- [ ] [Polish] **Deferred.** "Replace…" assign-someone flow needs to surface the current assignee for context — today the picker just shows the roster; the staffer has to remember who they're replacing.

## Acceptance criteria status

Per `AREA_SHIFTS.md` and the prior schedule audit:

- [x] AC: event header (sport, home/away, date, time, location, weather).
- [x] AC: per-area shift blocks with coverage pill.
- [x] AC: open-slot Assign/Request affordance respects role + worker type.
- [x] AC: pending-request approve/decline both in context menu AND inline.
- [x] AC: shift CRUD for STAFF (add, duplicate, edit times, delete).
- [x] AC: my-shift indicator visible.
- [x] AC: token discipline aligned with cross-app status taxonomy — **closed by P1 fix.**
- [x] AC: edit-times sheet feels like every other edit sheet — **closed by P1 fix.**
- [x] AC: VoiceOver users can navigate the row context — **closed by P1 a11y fixes.**

## Lenses checked
- [x] Gaps
- [x] Flows
- [x] UI polish
- [x] Hardening
- [x] Parity (web has same shape; aligned post-fix)
- [x] Accessibility
