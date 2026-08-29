# iOS Shift Widgets And Calendar Integration Plan - 2026-06-12

## Goal
- Make upcoming shifts visible where students already look: iOS widgets, Apple Calendar, and the first screen of the native app.
- Harden the Apple Calendar integration so it carries strong Wisconsin Creative metadata and can be reconciled, while Wisconsin Creative remains the authoritative schedule system.
- Add a Gotham Black/Ultra-style greeting and quick summary line to the iOS Home/AFM surface.

## Source Checks
- `docs/AREA_MOBILE.md`: native Home is action-first and already prioritizes My upcoming shift in the queue. iOS Schedule has first-class list/calendar modes, push tap-through, and current shift/gear context.
- `docs/AREA_SHIFTS.md`: Schedule owns shifts, call windows, assignment status, student availability conflicts, trade board, and schedule readiness. The source concept is `ShiftAssignment` tied to `Shift` and `CalendarEvent`.
- `docs/AREA_EVENTS.md`: Calendar source sync is already hardened, daily `morning-refresh` refreshes sources, and missing/stale external event data must not block non-event operations.
- `docs/AREA_NOTIFICATIONS.md`: shift assignment, approval, removal, call-time changes, and personal call-time changes already create notifications with push and event routing context.
- `tasks/archive/completed-2026-06/sprint-april-plan-2026-04-17.md`: older planning deferred iCal shift subscription to iOS EventKit, but current source now ships an ICS token/feed path from iOS. Treat this plan as a reconciliation of that drift.
- `src/app/api/my-shifts/route.ts`: `/api/my-shifts` returns upcoming direct/approved assignments with event, call window, area, worker type, and linked gear status.
- `src/app/api/shifts/ics-token/route.ts`: users can fetch or rotate an ICS token; rotation is rate-limited and audited.
- `src/app/api/shifts/ics/[token]/route.ts`: current ICS feed exposes assigned/approved shifts for an active user, one month back through one year forward, but only includes basic UID, DTSTART, DTEND, SUMMARY, LOCATION, and optional notes.
- `ios/Wisconsin/Views/ScheduleView.swift`: iOS opens `webcal://wisconsincreative.com/api/shifts/ics/{token}` via `AppEnvironment.webcalURL(path:)` in Apple Calendar from the Schedule toolbar.
- `ios/Wisconsin/Core/APIClient.swift`: native API client already exposes `icsToken()`, `generateICSToken()`, and `myShifts(limit:)`.
- `ios/Wisconsin/Core/Brand.swift` and `Info.plist`: Gotham Black and Gotham Bold are bundled on iOS. Gotham Ultra is not currently bundled.
- `prisma/schema.prisma`: `User.icsToken`, `ShiftAssignment`, `Shift`, `ShiftGroup`, `CalendarEvent`, and `ShiftTrade` provide the current schedule model.

## Product Themes

### 1. iOS Widgets For Upcoming Shifts

Working name: **Shift Glance Widgets**.

Problem:
- Most students will not open Wisconsin Creative just to check "when do I work next?"
- The current Schedule tab is useful, but the fastest answer belongs on the Lock Screen, Home Screen, and Smart Stack.

Product direction:
- Add WidgetKit widgets backed by a small, stable "my shift snapshot" read model.
- Widgets should use cached data from the app or an App Group store, not depend on fragile live auth work inside the widget.
- Tapping a widget deep-links to the specific event or Schedule tab.

Likely V1 scope:
- Small widget: next shift, call time, area, sport/event title.
- Medium widget: next two shifts plus gear status if linked gear exists.
- Lock Screen accessory: next call time or "Clear".
- StandBy-compatible summary if the WidgetKit target supports it cleanly.
- Shared snapshot writer in the app after dashboard/schedule refresh and on foreground.
- Widget refresh after push tap-through or background refresh when possible.

Key data questions:
- Snapshot source should be `/api/my-shifts` or a thinner `/api/my-shifts/summary` endpoint, not the full dashboard payload.
- Store only non-sensitive shift facts in the App Group cache: assignment id, event id, title, call start, shift start/end, area, location, gear status.
- Do not expose staff-only coverage or trade details in a widget.

First slice:
- Add a server summary contract and native cached snapshot writer before adding WidgetKit UI.

### 2. Apple Calendar Integration Hardening

Working name: **Calendar Trust**.

Problem:
- The current Apple Calendar action opens a `webcal://` subscription with a user token. That is useful, but it is still mostly one-way and metadata-light.
- Students will treat Apple Calendar as their source for shifts, so the feed needs stable identity, useful metadata, and a recovery path when the calendar is stale, missing, duplicated, or manually changed.

Product direction:
- Keep Wisconsin Creative authoritative for assignments and times.
- Harden the ICS feed immediately with strong metadata, stable UIDs, sequence/last-modified, URL deep links, call-window fields, area, role, event id, shift id, assignment id, and gear status.
- Add a native EventKit-managed-calendar path only if we need true local reconciliation beyond what a subscription can provide.

Likely V1 scope:
- ICS event metadata:
  - Stable `UID` based on assignment id.
  - `LAST-MODIFIED`, `SEQUENCE`, and `DTSTAMP` from assignment/shift/event update times.
  - `URL` deep link into the app or web event.
  - `DESCRIPTION` with call time, shift time, area, role, gear status, and "managed by Wisconsin Creative" copy.
  - `CATEGORIES` for area/sport if Apple Calendar preserves them well enough.
  - Custom `X-GEAR-TRACKER-*` fields for assignment id, event id, shift id, sport, area, call window, gear status, and source version.
- Native Calendar status screen:
  - Shows subscribed/not subscribed, token exists, last opened Calendar, and "Rotate feed link".
  - Explains that Wisconsin Creative changes update the calendar feed and Apple Calendar refresh timing is controlled by iOS.
- Server tests for ICS escaping, token auth, active-user gating, rate limits, event window, and metadata fields.

Two-way metadata model:
- V1: two-way context, not two-way schedule authority. Wisconsin Creative writes strong identifiers and links into the calendar feed, and the app can explain whether a user has opened/subscribed to the feed.
- V2: EventKit managed mode. The app writes Wisconsin Creative-owned events into a dedicated local calendar, stores `EKEvent` identifiers locally, reads them back, and reports sync state to Wisconsin Creative. User local edits can be detected and shown as "calendar differs from Wisconsin Creative", but should not mutate official shift assignments without a separate product decision.
- Do not let Apple Calendar edits change shift assignment times or attendance. That would bypass staff/admin workflow, conflict review, trade approval, and audit.

First slice:
- Harden the current ICS feed and subscription UX. Do not jump to EventKit writes until the current subscription path is metadata-complete and tested.

### 3. Gotham Greeting And Quick Summary

Working name: **Home Greeting**.

Problem:
- Native Home is already an action queue, but it opens with utility content. A branded greeting can make the app feel more personal and make the next action obvious.
- The greeting should summarize shift state in one line without adding another dashboard card.

Product direction:
- Add a compact header to iOS Home/AFM using Gotham Black. If Gotham Ultra is desired, bundle the licensed `Gotham-Ultra.ttf` first; otherwise use existing `Font.gothamBlack`.
- Summary line should be generated from the same shift/booking facts as the action queue, so it never contradicts the cards below.
- The header should remain useful when the user has no shifts or active gear.

Candidate copy states:
- `Good morning, Erik`
- `You have two shifts this week, with the next on Wednesday.`
- `Your shift starts at 7:00 PM tonight.`
- `Your calendar is clear.`
- `You're on the clock.`
- `Gear is ready for your next shift.`
- `You have one pickup before tonight's shift.`

Likely V1 scope:
- Time-of-day greeting: morning, afternoon, evening.
- First-name display from current user.
- Shift summary priority:
  1. Active shift now: "You're on the clock."
  2. Shift today: "Your shift starts at 7:00 PM tonight."
  3. Shifts this week: "You have two shifts this week, with the next on Wednesday."
  4. No shifts: "Your calendar is clear."
  5. Gear urgency can override or append if pickup/overdue state is stronger.
- Accessibility label should combine greeting and summary once, not announce decorative typography separately.

First slice:
- Pure summary helper tests from dashboard/my-shifts data, then wire Home header.

## Slices
- [ ] Slice 1: Define shared "my shift summary" contract for Home, widgets, calendar status, and Apple Calendar metadata.
- [x] Slice 2: Harden ICS feed metadata and subscription UX, with tests for token, active-user gating, UID stability, escaping, and custom metadata.
- [x] Slice 3: Add native Calendar status/management screen with subscribe/open, rotate token, and plain-language refresh expectations.
- [ ] Slice 4: Add iOS Home/AFM greeting summary helper and Gotham Black header.
- [ ] Slice 5: Add App Group cached shift snapshot writer.
- [ ] Slice 6: Add WidgetKit small/medium/Lock Screen widgets backed by cached shift snapshots.
- [ ] Slice 7: Evaluate EventKit managed-calendar mode only after V1 ICS metadata and widgets are proven.

## Verification
- [ ] API tests for `/api/my-shifts` or summary payload shape, week boundary, active assignment statuses, and linked gear status.
- [ ] ICS route tests for UID, URL, DESCRIPTION, X-GEAR-TRACKER fields, escaping, rate limiting, active-user token gating, and sequence/last-modified changes.
- [ ] iOS source tests or focused unit tests for greeting summary copy priority.
- [ ] iOS drift audit: `npm run drift:ios`.
- [ ] iOS gap audit: `npm run audit:ios:gaps`.
- [ ] Xcode simulator build for app plus widget target.
- [ ] Widget screenshot checks for small, medium, Lock Screen, light/dark, and no-shifts states.
- [ ] `npx tsc --noEmit`.
- [ ] `git diff --check`.
- [ ] `npm run build` before any schema or production route commit.

## Stop Conditions
- Stop if widget data requires live sign-in from the widget process instead of a cached App Group snapshot.
- Stop if Apple Calendar edits are treated as authoritative shift changes without staff/admin workflow and audit.
- Stop if ICS events lack stable identifiers or deep links, because duplicates and stale calendar entries will erode trust.
- Stop if the Home greeting contradicts the action queue below it.
- Stop if Gotham Ultra is referenced in native UI before the font file is actually bundled and licensed for the app target.

## Review
- Shipped: Calendar Trust V1 is complete. The ICS feed carries stable assignment identity, effective personal call windows, deep links, update metadata, matchup context, and trade state. Native Shift Calendar management reports private-feed readiness and the app's last Calendar handoff, opens Apple Calendar, rotates the private link with an invalidation warning, and explains that Wisconsin Creative remains authoritative while Apple controls refresh timing.
- Verified: Server ICS and token contracts, focused native calendar-management contracts, shared-host routing, iOS audits, and Wisconsin simulator/device builds are recorded in the implementation ledgers.
- Deferred: Shared shift summary, Home greeting, App Group snapshot writer, WidgetKit surfaces, and any EventKit-managed reconciliation mode remain future slices.
