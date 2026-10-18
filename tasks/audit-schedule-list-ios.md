# Audit: schedule (iOS) — 2026-05-08

**MVP verdict (pre-fix):** ships, but several **drift-detector blind spots** cluster on this surface — `EventRow.barColor` and `ScheduleCalendarView.dotInfo` are private `var: Color { switch ... }` getters returning raw `.green/.orange` (R1 misses the position, R7 explicitly excludes the explicit-return form), `LegendDot` is called with raw `.green/.orange` literals as function args (R1 misses entirely), and `DayCell` uses `.onTapGesture { selectedDate = ... }` for cell selection (R4-shaped, but R4's heuristic key is `=` and this still slips through). Plus the standard per-row VoiceOver gaps and a duplicate local-toast struct that should use the shared `Toast` component.
**Ship bar:** student-friendly, fully functional for core flows, zero hiccups in front of a class.
**Audit type:** static source (no build/run/UI tests).

**2026-07-03 simulator follow-up:** Schedule list rows now keep all-day timing
semantics in their combined accessibility label even when the row has the
signed-in user's shift. The visible row already showed `All day`; the tappable
label previously announced `Event 12:00 AM to 12:00 AM` for those my-shift
all-day rows.

Scope: `ScheduleView` + `ScheduleCalendarView` + `EventRow` + `DayCell` + `ScheduleDateHeader` + `LegendDot` + `WeatherBadge` + `TimeBlock` in `ios/Wisconsin/Views/ScheduleView.swift`. Focused follow-up to `audit-schedule-ios.md` (2026-04-24 broad / 2026-04-27 Pass 2) after today's pattern lock-in.

**Surrounding context:** today's drift detector reports 0 R1–R7 violations on this file. The drift the audit catches lives in classes the detector doesn't see: `LegendDot(color: .green, ...)` is a call-site literal (R1 only matches modifier-position); `EventRow.barColor` and `dotInfo` are explicit-return-form switch arms (R7 deliberately excludes them because explicit `return .green` is ambiguous between `Color` and `StatusTone`); `DayCell.onTapGesture` mutates `selectedDate = day` but the assignment lives across multiple lines inside a `withAnimation` closure, slipping past R4's single-expression `=` heuristic.

## P0 — blocks MVP

_None._ The schedule loads, the calendar paginates, the trade board opens, the iCal subscribe button works. No phantom-success class bugs.

## P1 — polish before ship

- [x] [Hardening] **`EventRow.barColor` returns raw `.green/.orange/Color(.systemGray4)`** from a `var: Color { switch event.isHome }` getter. Same pattern shape as ItemsView's `AssetListBadge`/`AssetStatusBadge` fix (R1's blind spot when colors are returned from a getter rather than applied to a modifier).
      `ios/Wisconsin/Views/ScheduleView.swift:935-942`.
      Suggested fix: route the home/away tone through `Color.statusText(.green)` / `Color.statusText(.orange)` and keep `.accentColor` for the my-shift case (intentional brand color).

- [x] [Hardening] **`ScheduleCalendarView.dotInfo` returns raw `.green/.orange/Color(.systemGray3)`** from an inline switch. The dots are the calendar's primary at-a-glance signal (home vs away vs my-shift) — drift here means dark-mode contrast diverges from the rest of the status surfaces.
      `ios/Wisconsin/Views/ScheduleView.swift:681-698`.
      Suggested fix: same as `barColor` — `Color.statusText(.green)` / `Color.statusText(.orange)`.

- [x] [Hardening] **`LegendDot(color: .green, label: "Home")` and `(color: .orange, label: "Away")`** call sites pass raw literals — R1's pattern only matches modifier-position colors. The legend is the user-facing key for the calendar dots, so the literal-vs-token mismatch shows visibly side-by-side.
      `ios/Wisconsin/Views/ScheduleView.swift:560-567`.
      Suggested fix: pass `Color.statusText(.green)` / `Color.statusText(.orange)`.

- [x] [Hardening] **`DayCell` uses `.onTapGesture { withAnimation(...) { selectedDate = day; displayedMonth = ... } }`** for the cell-selection action — exact R4 anti-pattern shape (mutation on tap), but the assignment lives inside a multi-line closure that R4's single-line `=` heuristic doesn't see. VoiceOver doesn't get the row's actionable role; press feedback is missing.
      `ios/Wisconsin/Views/ScheduleView.swift:513-529`.
      Suggested fix: wrap `DayCell` in a `Button { … } label: { … }.buttonStyle(.plain)`. Mirror what `eventList` already does for `EventRow` button-wrapping.

- [x] [A11y] **`EventRow` not a combined accessibility element.** Inside the existing wrapping `Button`, VoiceOver walks: title, "My Shift" pill, "Home"/"Away" capsule, weather icon + temperature, three `TimeBlock`s (CALL/EVENT/END, each with two announcements), location with `mappin` icon. That's 8-12 announcements per event row.
      `ios/Wisconsin/Views/ScheduleView.swift:857-933`.
      Suggested fix: `.accessibilityElement(children: .combine)` on the row + an explicit `rowAccessibilityLabel` that lands the most important fact first (my-shift state if applicable), then "{eventDisplayTitle}, {Home/Away}, {time-or-shift-window}, {location}, {weather summary when available}". Mirror the `BookingRow`/`AssetRow` patterns shipped today.

- [x] [A11y] **`DayCell` lacks a coherent label.** VoiceOver reads bare day numbers ("3, 4, 5, …") with no information about whether the day has events, is the user's shift, etc. The dots convey state visually but get no VO equivalent.
      `ios/Wisconsin/Views/ScheduleView.swift:724-766`.
      Suggested fix: combined element + label like "May 8, today, selected, 2 events including my shift" assembled from the existing `dots` array + `isToday`/`isSelected` flags.

- [x] [A11y] **`ScheduleDateHeader` walks weekday + day + label + count separately.** Five pieces per section header.
      `ios/Wisconsin/Views/ScheduleView.swift:770-817`.
      Suggested fix: combined element + "{Today/Tomorrow/Month}, {weekday} {day}, {N events}" label.

- [x] [A11y] **`EventRowSkeleton` placeholder list pollutes VO during initial load.** Six skeleton rows. Same fix shape as today's BookingsView + HomeView + ItemsView skeleton fixes.
      `ios/Wisconsin/Views/ScheduleView.swift:154-165`.
      Suggested fix: `.accessibilityHidden(true)` on the loading list branch.

- [x] [A11y] **`WeatherBadge` decorative icon + temperature both speak.** Inside the combined `EventRow`, the symbol name leaks ("cloud sun fill, 65°F"). Once `EventRow` becomes a combined element, the badge can `.accessibilityHidden(true)` because the row label includes a weather summary.
      `ios/Wisconsin/Views/ScheduleView.swift:972-985`.

- [x] [Polish] **Local `ScheduleToast` duplicates `Toast` shipped today.** `ScheduleView` defines its own `ScheduleToast` struct + manual overlay + auto-dismiss `Task` that mirrors the shared `Toast` + `.toast(...)` modifier exactly. Two implementations of the same UX is exactly the kind of drift the pattern lock-in is supposed to prevent.
      `ios/Wisconsin/Views/ScheduleView.swift:11-15, 235-251, 343-349`.
      Suggested fix: delete `ScheduleToast`, swap in `@State private var toast: Toast?` + `.toast($toast)`. The `success` role aligns with check-in / trade-claim / trade-post messages; `error` role for the iCal-subscribe failure.

## P2 — post-MVP

- [ ] [Polish] **Deferred.** Day-cell dot legend doesn't expose itself to VoiceOver as a coherent group ("Calendar dot legend: My Shift, Home, Away"). Low-impact — once the dot info is included in each `DayCell`'s combined label, the legend is informational decoration.
- [ ] [Polish] **Deferred.** `homeAwayFilter` segment chips in the list-mode header have raw `.white` / `.secondary` foreground colors — these are intentional capsule treatments, not status drift, and reading from `Color(.tertiarySystemFill)` for the unselected state is correct.
- [ ] [Parity] Per `AREA_SHIFTS.md` — Week strip and the full filter bar (Sport/Area/Coverage/Time) stay web-only. My Hours is on Profile as of 2026-10-18, not a Schedule strip.

## Acceptance criteria status

Per `AREA_MOBILE.md` and `AREA_SHIFTS.md`:

- [x] AC: List + Calendar view modes.
- [x] AC: My Shifts toggle, Home/Away filter, Past toggle.
- [x] AC: Section grouped by date.
- [x] AC: Skeleton + error + empty states.
- [x] AC: Trade board with post + claim + cancel.
- [x] AC: iCal subscribe.
- [x] AC: Status colors via cross-app token system — **closed by P1 `barColor` / `dotInfo` / `LegendDot` fix.**
- [x] AC: VoiceOver users hear each row as a combined element — **closed by P1 a11y fix.**
- [x] AC: All-day Schedule rows do not announce midnight event times — **closed by 2026-07-03 simulator follow-up.**
- [x] AC: Skeleton state doesn't pollute VoiceOver — **closed by P1 fix.**
- [x] AC: Cell selection uses Button semantics, not raw tap gesture — **closed by P1 R4-class fix.**

## Lenses checked
- [x] Gaps
- [x] Flows
- [x] UI polish (toast dedup)
- [x] Hardening (R1+R7+R4-class drifts caught — all detector blind spots)
- [x] Parity (week strip / hours / filters intentionally web-only)
- [x] Accessibility
