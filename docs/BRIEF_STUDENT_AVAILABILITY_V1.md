# Student Availability V1 Brief

## Document Control
- Owner: Wisconsin Athletics Creative Product
- Area: AREA_SHIFTS / AREA_USERS
- Status: Shipped
- Last Updated: 2026-08-21

## Problem

Staff need to know when students are predictably unavailable before assigning shifts. The most common case is recurring class blocks during a semester, not one-off PTO-style exceptions.

## V1 Scope

Student-scheduling-class users and staff can maintain recurring class unavailability blocks and one-off days away on the user profile Availability tab. A block records a weekday or inclusive date range, local start/end time when timed, an all-day flag when appropriate, and an optional label such as a class name.

This is intentionally an availability-warning system. It does not prevent staff/admin overrides, because operations may still need to assign a conflicted student after direct confirmation.

## Shipped Behavior

- `StudentAvailabilityBlock` stores recurring weekly blocks tied to a user.
- `/staff/[id]` includes an Availability tab.
- Student-role users can manage only their own blocks.
- Staff-role users can manage their own blocks when their Scheduling class is Student.
- Staff and admins can view and manage blocks for any Student-scheduling-class user.
- `GET /api/users/[id]/availability` returns the user's blocks.
- `POST /api/users/[id]/availability` creates a block after validating weekday/date shape, date-range order, and start/end time order.
- Ad hoc blocks preserve legacy single-date timed rows while also supporting inclusive `dateEndsOn` ranges and `allDay` time-away rows.
- The shared conflict helper treats all-day rows as overlapping any call window on any covered date, while timed ranges still use local wall-clock overlap.
- `DELETE /api/users/[id]/availability/[blockId]` removes a block after ownership validation.
- Assignment pickers call `GET /api/shifts/[id]/conflicts` and show conflict indicators for overlapping blocks.
- Auto-assign and trade-swap flows carry conflict flags/notes forward instead of silently ignoring class conflicts.

## Shipped Follow-Up (2026-06-03)

- Weekly class blocks can now be bounded by semester start/end dates.
- Students can add one-time ad hoc conflicts, such as exams.
- Students can edit and delete their own blocks on the web Availability tab.
- Staff/admin can view and manage student blocks from student profiles.
- Shift conflict checks, direct assignment, auto-fill, and trade swaps use the effective call window plus one shared weekly/ad hoc overlap helper.
- Availability remains advisory and does not automatically change slot or personal call windows.
- Staff/admin assignment review now filters `/schedule/assign` by conflict/open/clean states, surfaces assigned-person conflict notes in the grid, filters loaded candidates by conflict state, and keeps personal call-window adjustment beside the conflict context.

## Shipped Follow-Up (2026-06-18)

- `StudentAvailabilityBlock` now supports an `intent`: cannot work, prefer, dislike, or time off.
- Existing weekly and ad hoc rows remain compatible and default to approved cannot-work advisory conflicts.
- Time-off rows support pending, approved, and denied status with staff/admin review metadata.
- Student-created time-off requests default to pending; staff/admin-created or reviewed time off can be approved or denied.
- Candidate scoring now rewards preferred windows, warns on dislikes and pending time off, and marks approved time off as blocking.
- Direct assignment, pickup, trade swap, request approval, and personal call-window updates now reject approved time off while preserving advisory behavior for other availability signals.
- Staff approval or denial of a time-off request creates an in-app notification for the student.

## Shipped Follow-Up (2026-06-30)

- Availability ownership now follows `User.staffingType = ST` rather than app permission role.
- Staff-access users who still work Student shifts can own availability, preference, and time-off blocks.
- Web profile Availability tab visibility and native iOS My Availability entry use the same Student scheduling-class contract.
- Staff-scheduling-class users are rejected from availability creation so availability does not attach to workers outside the Student scheduling pool.

## Shipped Follow-Up (2026-06-30 Profile Impact)

- The web profile Availability tab now summarizes scheduling impact before the raw blocks.
- Approved time off is counted separately because it blocks assignment, pickup, trade, and personal call-window changes.
- Cannot-work, dislike, and pending time-off signals are grouped as advisory conflicts for staff review, auto-fill, Open Work, and Trade Board context.
- Preferred windows are counted separately as positive candidate-fit signals.
- Weekly and dated buckets now use broader labels so class conflicts, preferences, and time-off requests do not get mislabeled as only class schedule or only conflicts.

## Shipped Follow-Up (2026-06-30 Auto-Fill Clarity)

- Auto-fill preview skipped rows now explain the strongest skip reason instead of using one generic fallback.
- Skipped rows distinguish no active candidates, no scheduling-class match, no area fit, approved time off, overlapping assignments, and candidates already proposed for another open slot.
- Shift Detail and Event detail preview dialogs show concise supporting counts so staff can trust why a slot stayed open before applying proposed assignments.

## Shipped Follow-Up (2026-06-30 Open Work Context)

- Open Work rows now expose availability context before the user acts.
- Open Student shift rows distinguish approved time off, advisory availability, pending time off, and preferred windows.
- Trade Board rows show the viewer's availability context for claimable trades and the claimed worker's context for staff-review trades.
- Approved time off moves claimable trades into Waiting or Blocked and blocks trade claims before they enter staff review.

## Shipped Follow-Up (2026-06-30 iOS Parity)

- Native iOS My Availability now displays weekly, ad hoc, preference, dislike, and time-off records instead of only weekly class conflicts.
- The native editor can create weekly or one-time cannot-work, prefer, dislike, and time-off signals through the existing availability API.
- iOS summarizes blocking approved time off, advisory signals, and preferred windows before listing raw records.
- New iOS decoded fields are optional so older production payloads and older saved blocks remain safe during rollout.

## Shipped Follow-Up (2026-06-30 Conflict Refresh)

- Availability create, update, review, and delete now recompute future active assignment conflict state.
- Recompute uses the effective assignment call window, including personal assignment overrides before shift-level call windows.
- Approved time off approved after assignment now surfaces as a persisted Schedule conflict instead of staying invisible until the assignment is touched.
- Changed or deleted availability clears stale `hasConflict` and `conflictNote` values from affected future active assignments.

## Shipped Follow-Up (2026-08-21 Availability Experience)

- Web and native iOS now lead with recurring class schedules as the common cannot-work path, with clearer weekly and one-off sections and distinct add actions.
- One-off entries can cover one date or an inclusive `From`/`Through` range, with an explicit `All day` option for travel, visitors, and other full-day unavailability.
- Native iOS adds optional class-term bounds alongside the existing 15-minute time controls and keeps new range/all-day response fields optional for rollout safety.
- The additive schema/API contract preserves legacy single-date and timed rows; no availability policy changes were introduced for advisory signals or approved time off.

## Acceptance Criteria

- [x] AC-1: A student can add a recurring weekly unavailability block for themselves.
- [x] AC-2: A student cannot view or modify another student's blocks.
- [x] AC-3: Staff/admin can view and modify a user's blocks from that user's profile.
- [x] AC-4: Blocks validate `startsAt < endsAt` and day-of-week range.
- [x] AC-5: Shift assignment UI surfaces conflicting students without blocking override.
- [x] AC-6: Auto-assignment and trade swaps preserve conflict notes when an assigned worker overlaps an availability block.
- [x] AC-7: Students can request time off and staff/admin can approve or deny the request.
- [x] AC-8: Prefer/dislike/time-off signals feed candidate scoring and scheduling conflict checks without breaking existing weekly/ad hoc blocks.
- [x] AC-9: Availability ownership follows Student scheduling class, not only app permission role.
- [x] AC-10: Profile Availability summarizes blocking time off, advisory conflicts, preferences, and the next dated exception before listing saved blocks.
- [x] AC-11: Auto-fill skipped rows explain availability, scheduling-class, area-fit, overlap, and already-proposed blockers before staff apply the preview.
- [x] AC-12: Open Work and Trade Board rows surface availability blockers, advisory context, and preferred windows before claim, request, or approval actions.
- [x] AC-13: Native iOS My Availability can display and create weekly, one-time, preference, dislike, and time-off signals without breaking older payloads.
- [x] AC-14: Availability mutations refresh persisted future assignment conflict state so Schedule queues, exports, and assignment review do not show stale conflicts.
- [x] AC-15: Web and native iOS can add recurring class windows plus one-off single-date, inclusive-range, and all-day cannot-work entries without breaking legacy availability rows.

## Out Of Scope

- Student-facing calendar overlay.
- Email or push notifications for availability conflicts.
- Automatic conflict notifications to students.
- Staff conflict digest outside Schedule health queues.
- Hard prevention of ordinary conflicted assignment.

## Follow-Up Options

1. Add a profile-level visual weekly grid if the list of blocks becomes hard to scan.
2. Add student-facing calendar overlay only if students need a read-only schedule preview.
3. Add cross-event conflict digesting only if staff need a separate summary outside the assignment workflow.
4. Add push/email delivery for time-off review outcomes only after the notification policy needs that extra channel.
