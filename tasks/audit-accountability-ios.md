# Audit: accountability (iOS) — 2026-10-16

**MVP verdict:** Source-complete, read-only. Authenticated iPhone 18 Pro Max proof is still open under GAP-90. xcodebuild was not run in the environment that added this surface.
**Ship bar:** a calm leaderboard a student or staff member can open from Browse, with one path from a person to the checkout.
**Audit type:** static source (no build, no signed-in device)

Scope: `AccountabilityView` (this year or all time, three sorts, name search) and `AccountabilityPersonView` (standing and incidents). Reachable from Browse for students, staff, and admins.

## What shipped

- Browse adds Accountability after Scoreboard for internal roles. Collaborators do not get the row, because `GET /api/accountability` refuses them.
- The list reads that route. This year omits `year`. All time sends `year=all`. Sort sends `events`, `time`, or `recent`.
- Search filters the loaded names on the phone. It does not send another request.
- The signed-in person's standing stays visible above the ranking. Active overdue copy is red.
- A failed change of year or sort keeps the previous list and says so. A failed first load offers Try again. Pull to refresh rereads the current year and sort.
- Person detail uses the rows already loaded. An incident opens the existing checkout screen. There is no second action.
- CSV export, location, incident-state, and active-user filters, and taking a checkout off the list stay on the web. The phone does not decode `excluded`.

## P0 — blocks MVP

- None in source. Device proof is GAP-90, not a code defect found here.

## P1 — polish before ship

- [ ] [Flows] Authenticated iPhone 18 Pro Max still has to show this year and all time, each sort, a person on the list and a person off it, opening a checkout, a failed refresh that keeps the previous list, and a collaborator Browse menu without Accountability. Tracked as GAP-90.

## Acceptance criteria status

AREA_MOBILE.md:
- [x] Accountability is in the Browse contract for students, staff, and admins, and hidden from collaborators.
- [x] The screen is read-only. Export and exclusion edits stay on the web.

AREA_REPORTS.md:
- [x] AC-23: Native browse uses `GET /api/accountability` and the server's sort and year values.

## Lenses checked

- [x] Gaps — GAP-90 records the missing device proof.
- [x] Flows — a newer request owns the screen; a failed filter change restores the previous year and sort.
- [x] UI polish — one menu on the list, one navigation on the person screen. Search does not refetch.
- [x] Hardening — no POST, PATCH, or DELETE. The query builder does not send `format`, `locationId`, `state`, or `users`.
- [x] Breaking — Users copy and the Users destination are unchanged.
