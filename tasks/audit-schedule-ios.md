# Audit: schedule (iOS) — 2026-04-27 (Pass 2)

**MVP verdict:** READY - Pass 2 P1 findings closed; simulator build verified 2026-05-11
**Ship bar:** student-friendly, fully functional for core flows, zero hiccups in front of a class
**Audit type:** static source (no build/run/UI tests)

Scope (Pass 2 additions): `EventDetailSheet` crew section + `AssignStudentSheet` + `AddShiftSheet` + `AppDelegate` push routing. Adds findings not covered in 2026-04-24 pass. Reconciled against source on 2026-05-11.

## 2026-08-20 Accessibility Capture Follow-up

First run of the light/dark/accessibility-size matrix for List and Calendar, captured on iPhone 16 Pro (iOS 26.5) through the `GT_PERFORMANCE_SCENARIO=schedule` fixture harness. Light and dark are clean. `accessibility-extra-large` is not, and the existing Dynamic Type source contract does not catch it because it asserts which font styles the row uses, not whether the layout survives them.

- [x] [P1 / Dynamic Type] **The leading time gutter clips its own value at accessibility sizes.** `.lineLimit(1)` and `.minimumScaleFactor(0.7)` sit on a hard `.frame(width: 62, alignment: .trailing)`, so past 70% scaling the text truncates: `11:00 AM` renders as `11:…` and `7:30 PM` as `7:3…`. The rail exists to make start and end times scannable, so this removes the feature exactly for the users who most need larger text.
      `ios/Wisconsin/Views/ScheduleView.swift:2353-2355`.
      Suggested fix: drive the gutter width with `@ScaledMetric` rather than a constant. Five files already use it, including `Components/CrewRow.swift`, so the pattern is in-tree.

- [x] [P2 / Dynamic Type] **`CoverageChip` wraps its fraction across two lines.** The label carries no `lineLimit` or `fixedSize`, so `4/6` breaks into `4/` above `6`. A staffing ratio split mid-token reads as a rendering fault rather than data.
      `ios/Wisconsin/Views/Components/CrewRow.swift:164`.
      Suggested fix: `.lineLimit(1).fixedSize()` on the count text, so the chip grows instead of wrapping.

- [x] [P3 / Dynamic Type] **Retired under D-053, not fixed.** Day header and venue truncate early. `Thu, A…`, `4 even…`, and `UW…` at the same text size. Lower severity because the day stays identifiable from position, but the per-day event count becomes unreadable precisely when the list is longest.
      `ScheduleDateHeader` and the `EventRow` venue line in `ios/Wisconsin/Views/ScheduleView.swift`.

- [x] [Coverage gap] **`tests/ios-schedule-dynamic-type.test.ts` cannot catch any of the above.** It asserts `.subheadline.weight(.semibold).monospacedDigit()` is present and `.font(.system(size:` is absent — both true while the row is visibly broken. Consider asserting that the gutter width is not a bare numeric constant, so a fixed frame around scaling text fails the contract.

### Fix applied 2026-08-20

The gutter width now scales with Dynamic Type (`@ScaledMetric(relativeTo: .subheadline)`, `62 * gutterScale`), matching the existing `CrewTypeLabel` treatment in the same component file, and `CoverageChip`'s ratio takes `.lineLimit(1)` plus `.fixedSize(horizontal: true, vertical: false)`. Re-captured at `accessibility-extra-large`: times read `11:00 AM`, `4:00 PM`, and `7:30 PM` in full, and ratios hold one line as `4/6`, `3/3`, `2/5`.

The contract test now guards both. Verified by reverting the gutter to its fixed width and confirming the new assertion fails, then restoring it. Default text size is unchanged: `@ScaledMetric` returns its base value at the default content size, so the frame stays exactly 62pt.

- [x] [P2 / Dynamic Type] **Accepted under D-053, not fixed.** The wider gutter squeezes the venue line out of the row at accessibility sizes. A consequence of the fix above rather than a pre-existing defect. The venue already truncated to `UW…` before the change and is now absent, leaving only the location glyph; titles also break harder (`Volley-` / `ball vs…`). Net legibility still improves, because the time is the value the column exists to carry and it is now complete, but the row is attempting side-by-side layout at a width that no longer supports it.
      Suggested fix: switch `EventRow` from `HStack` to a vertical arrangement when `\.dynamicTypeSize` reports `.isAccessibilitySize`, so time, title, venue, and coverage each get full width instead of competing for it. That is a layout change rather than a constant change, which is why it is logged here rather than bundled into this slice.

### Scope decision 2026-08-20

The owner set the boundary after reviewing these captures: Wisconsin Creative serves roughly 30-60 known staff and students, none of whom are expected to run accessibility text sizes, so **D-053** makes those sizes supported-but-not-designed-for. The proposed `EventRow` vertical-stack rewrite is cancelled, and the two items above are retired rather than carried as backlog.

What stays: the two fixes already shipped, because they cost nothing and are already verified; semantic fonts; VoiceOver labels; contrast; and 44pt tap targets. What stops: running the accessibility-size pass as part of routine visual review. Light and dark remain required.

Reopen only on a trigger named in D-053 -- a public release, a real user complaint, or an institutional accessibility requirement.

## 2026-07-18 Collaborator Published Schedule Follow-up

- [x] Published discovery is limited to current and upcoming events without weakening snapshot, hidden-event, or archive gates.
- [x] The collaborator list uses date groups and compact event cards with classification, time, venue, crew preview, and follow state.
- [x] Event selection opens a full-screen read-only published detail with crew grouped by area and no internal contact, gear, trade, availability, note, or staffing data.
- [x] Follow and mute remain hidden without `SCHEDULE_FOLLOW`, guard duplicate work, and update from server-returned truth only after success.
- [x] Event push routing uses the sanitized published-event detail API when the target is outside the loaded page.
- [x] Skeleton loading, pagination, pull-to-refresh, visible-data recovery, VoiceOver summaries, and reduced-motion handling are source-covered.

## 2026-07-18 Filters and Shift Calendar Follow-up

- [x] Filters expose a live unique-event result count and separate personal/past scope from Event Type and Sport.
- [x] Neutral games require an opponent while opponent-free Non-game events have a distinct scope in both List and Calendar.
- [x] Active filter context remains quiet in the first viewport and the sheet owns Clear plus one purple Show Events action.
- [x] Shift Calendar reports private-feed readiness and the app's last Calendar handoff without claiming Apple subscription completion.
- [x] Calendar status failures retain Retry, actions guard duplicate work, and private-link reset warns that existing subscriptions will stop updating.
- [x] Shared host routing, token rate limits, token-rotation audit history, assignment scoping, and Wisconsin Creative schedule authority remain unchanged.

## 2026-07-18 Core Redesign Follow-up

- [x] List remains the default all-events scope, with assigned events carrying a separate blue personal-work treatment and venue classification retained in the leading rail.
- [x] List and selected-day Calendar results share `EventRow`, including dedicated venue and assignment context lines.
- [x] Month cells retain venue-tone dots and add one independent blue personal-assignment marker.
- [x] Passive freshness chrome is removed; pull-to-refresh and non-blocking refresh-failure recovery remain.
- [x] Schedule, Home, and event push routes navigate to full-screen `EventDetailView`; Back preserves Schedule filters, selected day, and mode.
- [x] Student rows suppress passive crew coverage while staff/admin retain staffing context.
- [x] Focused native source contracts pass and the Wisconsin Simulator target builds successfully. Event detail runtime appearance and accessibility-size proof is recorded in the active closeout plan; List and Calendar screenshots remain lock-blocked.

## 2026-07-18 Availability and Trade Board Follow-up

- [x] My Availability uses a tappable weekday canvas with recurring-window counts and keeps dated exceptions separate.
- [x] Existing blocks open in an edit sheet backed by the shipped availability PATCH route; new and edited times use 15-minute choices.
- [x] Schedule exposes My Availability only for Student scheduling-class workers while preserving the Profile entry point.
- [x] Trade Board prioritizes immediately claimable work, keeps My Posts behind a quiet personal-scope control, and collapses blocked/history context.
- [x] Trade rows use Schedule classification rails and date-aware hierarchy; constructive Claim actions use purple while cancellation stays destructive.
- [x] Available trade rows no longer receive a cancel callback, and action buttons disable while their mutation is running.

## 2026-07-18 Staff Authoring Follow-up

- [x] Add Shift matches the redesigned Event detail hierarchy and uses one purple constructive action instead of a dense Form toolbar.
- [x] Area and worker class are explicit, event timing stays visible, and custom dates use 15-minute time options with inline ordering validation.
- [x] Assign Person consumes the existing staff-only candidate-score endpoint while retaining paginated server search and conflict fallback.
- [x] Candidate rows distinguish Best Fits, advisory review, heavy workload, and unavailable people without exposing raw enum or score values.
- [x] Assignment and creation controls guard duplicate submission, preserve state on failure, and expose action-specific recovery.

## 2026-07-03 Runtime Follow-up

- [x] [UI polish] **Add Shift showed all-day event defaults as `12:00 AM` call/end rows.** Runtime verification on Football Media Day reproduced the same all-day leak the release is removing elsewhere. The sheet now detects midnight-to-midnight default event windows and renders a single date-only `Window: All day, <range>` row unless staff intentionally enables custom timing.
      `ios/Wisconsin/Views/Schedule/AddShiftSheet.swift`

## P0 — blocks MVP (Pass 2)

*None.*

## P1 — polish before ship (Pass 2)

- [x] [Breaking] `ScheduleViewModel.isStale` is hardcoded `return true` — the `scheduleStaleAfter` constant (5 min, line 32) is defined but never used. Every `onChange(of: scenePhase)` fires a full network reload even on a 1-second app switch. Students showing the schedule in class see a loading spinner every time the phone wakes.
      `ios/Wisconsin/Views/ScheduleView.swift:46-48`
      Why it blocks ship: "zero hiccups in front of a class" — pulling out the phone mid-presentation triggers a visible reload.
      Suggested fix: add `private var lastLoadedAt: Date?`, set it after a successful load, and return `guard let t = lastLoadedAt else { return true }; return Date.now.timeIntervalSince(t) > scheduleStaleAfter`.

- [x] [Flows] `workerTypeLabel` switch checks `"STUDENT"` / `"STAFF"` but the API returns `"ST"` / `"FT"` — every worker-type label in the crew section renders the raw value ("ST", "FT"). `workerTypeColor` also checks `== "STAFF"` (never true), so all full-time slots appear in the student blue.
      `ios/Wisconsin/Views/EventDetailSheet.swift:588-598`
      Why it blocks ship: student-visible in every event's crew card; ships confusing raw API strings.
      Suggested fix: change switch cases to `"ST"` / `"FT"` and update color check accordingly.

- [x] [Hardening] `AppDelegate.didReceive` only routes `bookingId` payloads — shift assignment push notifications (the goal stated in this audit) open the app but navigate nowhere.
      `ios/Wisconsin/App/AppDelegate.swift:46-52`
      Why it blocks ship: push for shift updates is explicitly required; tapping the notification does nothing.
      Suggested fix: add an `eventId` or `shiftAssignmentId` branch that sets `appState.pendingPushEventId`; observe it in `ScheduleView` to open `EventDetailSheet` for that event, mirroring the `bookingId` → booking detail pattern.

- [x] [HIG/touch targets] Calendar day cells now keep a 44pt minimum interactive width. The visible date circle remains compact, but the Button label frame and content shape now meet the mobile tap-target baseline.
      `ios/Wisconsin/Views/ScheduleView.swift`

## P2 — post-MVP (Pass 2)

- [x] [Gaps] Staff can't create a shift group for events with no group yet — `showAddShift` is only surfaced when `vm.shiftGroup != nil`; "No crew scheduled" has no create-group affordance for staff. Web uses ShiftDetailPanel for this.
      `ios/Wisconsin/Views/EventDetailSheet.swift:339-348`

- [ ] [Parity] `AssignStudentSheet` picker shows no conflict indicators — web's `UserAvatarPicker` shows yellow dots for conflicted users. Expected V1 divergence; not a TestFlight blocker. Related mobile conflict-badge parity remains tracked in `docs/GAPS_AND_RISKS.md`.

---

# Audit: schedule (iOS) — 2026-04-24 (Pass 1, archived)

**MVP verdict:** READY - all P0 + P1 addressed plus practical niceties (Today button, swipe gesture, dot legend, success toasts, presentation detents, freshness label, trade-board prominence, time-block compaction); simulator build verified 2026-05-11.
**Ship bar:** student-friendly, fully functional for core flows, zero hiccups in front of a class
**Audit type:** static source (no build/run/UI tests)

Scope: `ScheduleView` (List + Calendar modes) + `ScheduleCalendarView` + `ScheduleViewModel` + `EventDetailSheet` (sheet) + Schedule/`PostTradeSheet` + Schedule/`TradeBoardSheet`.

## P0 — blocks MVP

- [x] [Breaking] A refresh failure blanks the entire schedule. The `Group { … }` if/else puts `else if let err = vm.error` ABOVE the events branch, so any error after a successful first load replaces the list/calendar with "Couldn't load schedule" — even though `vm.events` still holds the previous payload.
      `ios/Wisconsin/Views/ScheduleView.swift:108-115` (error branch); `:54` clears the error on each new load attempt; `:67` writes the error.
      Why it blocks ship: pull-to-refresh on a flaky network turns the schedule screen into an error screen at exactly the moment a student needs to glance at their next shift. Tapping Retry recovers, but the visible disappearance is a confidence-destroying hiccup in front of a class.
      Suggested fix: only show the error placeholder when `vm.events.isEmpty`. When events exist, surface a non-blocking inline error toast/banner (or a single-line footer row) and keep rendering the list/calendar.

## P1 — polish before ship

- [x] [Flows] `ScheduleViewModel.load()` is gated by `hasLoaded`, so coming back to the Schedule tab never refreshes — events go stale until the user pulls to refresh or kills the app.
      `ios/Wisconsin/Views/ScheduleView.swift:46-47` (`guard !hasLoaded || forceRefresh else { return }`); `WisconsinApp.swift:32-36` only refreshes `appState.refreshUnread()` on scene reactivation, not the schedule.
      Why it matters: AREA_MOBILE.md performance section calls out "stale-data detection across browser tabs or after backgrounding" — closed on web via Page Visibility, missing on iOS for this screen specifically. A staffer pulling out their phone to check who's on tonight's shift sees yesterday's data.
      Suggested fix: trigger `vm.load(forceRefresh: true)` on `scenePhase == .active` (or via a `lastLoadedAt` staleness check inside `load`). Same hook as `appState.refreshUnread`.

- [x] [Flows] In Calendar mode, navigating prev/next month does not move `selectedDate`. The grid scrolls but the bottom day-list stays anchored on today's date — users see the right month but the wrong day's events.
      `ios/Wisconsin/Views/ScheduleView.swift:301-336` (chevrons mutate `displayedMonth` only) vs `:246-251` (`selectedDayEvents` reads from `selectedDate`).
      Why it matters: a student tapping forward to next week's home game still sees today's events and assumes there's nothing to see.
      Suggested fix: when changing `displayedMonth`, also clamp `selectedDate` to the first day of that month (or the same weekday-of-month if more useful). Update the day list copy at `:345` too.

- [x] [Flows] The "My Shifts" toggle on List mode silently empties the screen when the filtered groups are empty — no empty-state message.
      `ios/Wisconsin/Views/ScheduleView.swift:85-91` (`displayedGroups` returns `[]` when filter eats everything); `eventList` then renders an empty `List` with no copy.
      Why it matters: looks broken. Student toggles "My Shifts" expecting to see only their shifts, gets a blank screen, doesn't know if it's filtered out vs. broken.
      Suggested fix: in `eventList`, if `displayedGroups.isEmpty && myShiftsOnly`, render a `ContentUnavailableView("No shifts assigned to you", systemImage: "person")`.

- [x] [Flows] PostTradeSheet `Cancel` button stays enabled while `isPosting` is true; user can dismiss mid-`postShiftTrade` and orphan the request.
      `ios/Wisconsin/Views/Schedule/PostTradeSheet.swift:53-55` (Cancel always enabled).
      Suggested fix: `.disabled(isPosting)` on Cancel; mirror the bookings/items pattern (`interactiveDismissDisabled` while posting; discard-changes confirm if `selectedShift != nil` or `notes.nonEmpty`).

- [x] [Flows] TradeBoard "My Active Posts" swipe-to-cancel destroys the post with no confirmation — one mis-swipe at the corner of the row throws away a posted shift.
      `ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift:156-165`.
      Why it matters: Cancel is destructive (the post disappears, has to be re-created). Claim has a confirmation dialog; Cancel should match.
      Suggested fix: gate the swipe action behind a `confirmationDialog` showing the shift area + time and a "Cancel Trade" destructive button.

- [x] [UI polish] EventRow uses hardcoded `Color.black.opacity(0.04)` + `0.06` shadows — invisible in dark mode; cards lose their lift.
      `ios/Wisconsin/Views/ScheduleView.swift:564-565`.
      Suggested fix: `Color.primary.opacity(0.05-0.08)` or a `Color(.separator)` border (matches the FormCard / AssetThumbnail fixes already shipped this week).

- [x] [Hardening] `PostTradeSheet.eligibleShifts` filters by string-equal `status == "ACTIVE"` instead of using a typed enum.
      `ios/Wisconsin/Views/Schedule/PostTradeSheet.swift:13-16`.
      Why it matters: any backend status rename silently empties the picker. The rest of the codebase uses Swift enums for booking/asset status.
      Suggested fix: introduce `enum MyShiftStatus: String, Codable { case active = "ACTIVE", … }` on the model and compare via `.active`.

## P2 — post-MVP

- [ ] [Parity] AREA_SHIFTS lists three view modes — List / Week / Calendar — iOS has only List + Calendar (no Week strip). Acceptable for V1.
- [ ] [Parity] **Deferred — power-user parity, not a defect.** My Hours stat strip (`GET /api/shifts/my-hours`) not on iOS. Useful for shift-totaling but not on the V1 student bar.
- [ ] [Parity] **Deferred — power-user parity, not a defect.** AREA_SHIFTS filter bar (Sport / Area / Coverage / Time / My Shifts) — iOS has only "My Shifts". Power-user surface.
- [ ] [Parity] ShiftDetailPanel (per-event admin assignment management) not on iOS — admin-only, web-first by design.
- [x] [Correctness] Calendar mode's day list rendered in API insertion order, not chronological order — `eventsByDay` was assigned unsorted while list groups sorted. Fixed 2026-08-19; guarded by `tests/ios-schedule-ui-cleanup.test.ts`.
- [ ] [UI polish] Calendar prev/next month chevrons have no bounds; tapping forward past the last event date is a dead-end with no hint. Cosmetic.
- [ ] [UI polish] Toolbar Picker `.frame(width: 150)` — only 2 segments, fine on most devices, may clip on iPhone SE in landscape with all toolbar items.

## Acceptance criteria status

AREA_MOBILE.md:
- [x] AC-2 — schedule list supports search-equivalent (My Shifts toggle) + scope (mode picker) + row→detail.
- [x] AC-3 — **Closed 2026-08-20 as not applicable.** Overdue-style red has no meaning on Schedule; the criterion belongs to custody surfaces. It was never work, so it should not have sat in an open list.
- [x] AC-5 — Trade Board UI exposes Post + Claim + Cancel; server gates remain authoritative; no admin-only affordance leaks to STUDENT.

AREA_SHIFTS.md (iOS surface only):
- [x] Trade board: students post shifts for trade.
- [x] Trade claims: instant claim flow with confirmation.
- [x] Calendar view: month grid with coverage indicators (green/orange/secondary).
- [x] List view: grouped by date, "My Shifts" filter present.
- [x] Mobile: card layout + sheet-based event detail.
- [ ] Week view: not implemented on iOS (P2 parity, deferred — duplicate of the parity entry above).
- [ ] My Hours stat strip: not implemented on iOS (P2, deferred — duplicate of the parity entry above).
- [ ] Filter bar (Sport/Area/Coverage/Time): not implemented on iOS (P2, deferred — duplicate of the parity entry above).

## Lenses checked
- [x] Gaps
- [x] Flows
- [x] UI polish
- [x] Hardening
- [x] Breaking
- [x] Parity (informational)

## Files read
- `ios/Wisconsin/Views/ScheduleView.swift`
- `ios/Wisconsin/Views/Schedule/PostTradeSheet.swift`
- `ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift`
- `ios/Wisconsin/App/WisconsinApp.swift` (scenePhase wiring)
- `docs/AREA_SHIFTS.md` (acceptance + IA)
- `docs/AREA_MOBILE.md` (no schedule-specific ACs beyond cross-cutting)

## Notes
- Static audit reconciled against source on 2026-05-11.
- Build verification now complete: `xcodebuild -scheme Wisconsin -destination 'generic/platform=iOS Simulator' -configuration Debug build` returned `BUILD SUCCEEDED`.
- The 2026-04-24 and 2026-04-27 P0/P1 findings are closed in current source. Remaining unchecked schedule entries are intentional P2 parity/polish gaps: Week view, My Hours, full web filter bar, ShiftDetailPanel, and conflict indicators.
- `EventDetailSheet` has since been covered by `tasks/audit-event-detail-ios.md`.
