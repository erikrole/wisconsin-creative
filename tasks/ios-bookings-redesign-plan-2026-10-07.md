# iOS Bookings (Gear tab) redesign — October 7, 2026

Scope: the internal iOS Bookings tab (`Views/BookingsView.swift`) and then Booking detail (`Views/BookingDetailView.swift`). The user picked this as the next native refresh after the Schedule redesign (`ios-schedule-redesign-plan-2026-09-23.md`). The design direction is the one already chosen for Schedule: **minimal native**. That means plain rows in rounded day groups under pinned date headers, an 8pt state dot instead of an edge rail, the time on the right, and a blue tint for your own rows.

Sequencing: slice 1 is the list; slice 2 is Booking detail. Each slice ships with its own before/after review.

## Contracts to preserve

- `/api/bookings` request shape: status filter → `activeOnly`/`pastOnly`/`status`/`filter`, sort keys from `BOOKING_SORT_MAP`, `requester_id` for Mine, 30-row pages.
- Merged reservation + checkout list, ordered by next operational handoff (reservation pickup, checkout due) when the sort is the default; server order otherwise.
- Status filter and sort menu, the Mine toggle (hidden for collaborators), persisted `@AppStorage` preferences, and the collaborator `.mine` pin.
- Search visibility rule, debounced search, pagination with page-error retry, pull-to-refresh, reconnection refetch, skeleton, error, and empty states with their recovery actions.
- The toolbar New Reservation button hides only for the true empty default state.
- Swipe actions (Edit and Transfer leading, Extend and Cancel trailing, no full swipe), the matching context menu, and server `allowedActions` gating.
- Deep links: pending scope, pending booking detail, App Intents, tab-reset.
- Overdue and pending-pickup derivation (`status == .open && endsAt < now`, a booked reservation past `startsAt`), status tones, and the combined VoiceOver row label.
- The Gear Live Activity reconcile and the GearStore seed of the default list.

## Slice 1 — list

- [ ] Add a `staff-bookings` fixture scenario covering:
  - an overdue checkout and a missed reservation pickup;
  - a checkout due today, and a reservation picking up today;
  - a pending-pickup checkout whose pickup is today and whose due date is later in the week;
  - rows for tomorrow and later in the week.

  Two of the rows belong to the signed-in user. Dates are built from the start of the day plus a day offset and a fixed hour, so the day groups don't shift with the capture time. Capture the baseline with the current view before any visual edit.
- [ ] Give the row one `nextHandoff` that drives the local sort, the day group, and the time text. It is `startsAt` for anything not yet picked up (a booked reservation, any pending pickup, a booked checkout) and `endsAt` once the gear is out. Today a pending-pickup checkout sorts by its due time but reads "Pickup <start>"; day groups would expose that mismatch.
- [ ] Group rows by the day of their next handoff under pinned date headers, reusing `ScheduleDateHeader`, `EventRowBackground`, and `EventRowGroupPosition`. Overdue checkouts and missed pickups collect in a leading **Needs attention** group. Grouping applies only to the default handoff sort on non-terminal filters; title sorts, Completed, and Cancelled stay one flat group.
- [ ] Restyle `BookingRow` to minimal native:
  - The requester avatar stays, at a smaller 32pt. It was a deliberate earlier decision, and on a gear list the person matters in the way the venue does on Schedule. It replaces the state dot.
  - A semibold title and one secondary meta line: requester · item count, with a status word only for the odd statuses.
  - A trailing time column, with the time on top and the action word (Due / Pickup) underneath in the state's tone: red overdue, orange pickup, purple reserved, blue out.
  - In **Needs attention**, the top line is the relative day ("Yesterday", "Oct 5") and the line underneath says "Was due" or "Pickup missed", in red or orange.
  - The card, shadow, rail, and chevron are removed. Your own bookings get the `myShiftSurface` tint.
  - The minute `TimelineView` stays, because overdue flips at a time of day, not at midnight. So does the accessibility-size layout branch.
- [ ] `ScheduleDateHeader` gains a count noun so a Bookings day header doesn't say "events".
- [ ] Update the source-contract tests that pin the old row (rail, avatar, card surface) and the screenshot test. Add staff captures in light and dark mode.
- [ ] Before/after review page via `gt-ui-review`.

## Slice 2 — Booking detail

- [ ] To be planned after slice 1 lands, using the same header, group, and dot language.

## Out of scope

- Server, schema, and permission changes.
- Status chips replacing the filter menu, which is a possible follow-up.
- Accessibility sizes beyond SwiftUI basics.
- Authenticated device acceptance and TestFlight, which are not claimed.
