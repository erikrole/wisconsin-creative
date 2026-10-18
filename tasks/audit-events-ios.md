# Audit: events (iOS) — 2026-10-16

**MVP verdict:** Source-complete, read-only. Authenticated iPhone 18 Pro Max proof is still open under GAP-89. xcodebuild was not run in the environment that added this surface.
**Ship bar:** a calm directory a student or staff member can open from Browse without a second way to edit the schedule.
**Audit type:** static source (no build, no signed-in device)

Scope: `EventsView` (upcoming and past 30 days) and `EventCatalogDetailView` (identity, bookings, gear, Open in Schedule). Reachable from Browse for every role except collaborator.

## What shipped

- Browse adds Events after Scoreboard for internal roles. Collaborators do not get the row, because `/api/calendar-events` refuses them.
- The list reads `GET /api/calendar-events`. Upcoming uses the server's still-current window. Past 30 days sends an explicit overlap window plus `includePast`, so it does not page the whole archive.
- Detail reads `GET /api/calendar-events/:id`. A combined secondary follows `combinedInto` once and shows the primary. Separating events stays on the web.
- Staff and admin then read `GET /api/calendar-events/:id/command-center` for team bookings. Students skip that call. A 403 would also refresh the signed-in session, and the route refuses students on purpose.
- Personal bookings come from `GET /api/my-shifts?eventId=`. Item lines come from `GET /api/bookings/:id`, capped at 24.
- The one action is Open in Schedule, which pushes the existing `EventDetailView`.
- Status color is `StatusPill` only. The list row does not reuse the colored venue dot.

## P0 — blocks MVP

- None in source. Device proof is GAP-89, not a code defect found here.

## P1 — polish before ship

- [ ] [Flows] Authenticated iPhone 18 Pro Max still has to show the upcoming list, the past-30-days list, a staff detail with linked bookings and gear, a student detail limited to that person's bookings, Open in Schedule, and a collaborator Browse menu without Events. Tracked as GAP-89.

## Acceptance criteria status

AREA_MOBILE.md:
- [x] Events is in the Browse contract for internal roles and hidden from collaborators.
- [x] The screen is read-only. Create, edit, hide, and remove stay on the web (GAP-81).

AREA_EVENTS.md:
- [x] Native browse uses the existing calendar, command-center, my-shifts, and booking reads. No new API route.

## Lenses checked

- [x] Gaps — GAP-89 records the missing device proof.
- [x] Flows — list paging retries a failed next page; detail keeps the event when only the links fail.
- [x] UI polish — one main action on detail; the list's only control is the When menu. Color is status-only.
- [x] Hardening — no POST, PATCH, or DELETE from these views. Students do not call the staff gear route.
- [x] Breaking — Users copy and the Users destination are unchanged.
