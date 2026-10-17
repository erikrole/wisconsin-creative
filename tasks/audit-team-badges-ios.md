# Audit: team badges (iOS) — 2026-10-16

**MVP verdict:** SOURCE-READY — a read-only staff catalog against `GET /api/badges?manualOnly=true`. An Xcode build on a Mac is still required.
**Ship bar:** staff can open the same manual badge shelf the website shows, without a way to award.
**Audit type:** static source (no Xcode build)

Scope: `TeamBadgesView`, opened from Browse for staff and admins.

## P0 — blocks MVP

- [x] [Flows] The row is staff and admin only. Students already see their own badges on Profile. Collaborators do not get the row.
      `BrowseView` appends `.badges` inside `isStaffOrAdmin`, after the shared internal rows and before Reports.
- [x] [Hardening] The list reads `GET /api/badges?manualOnly=true`, the same catalog `/badges` uses. Hidden catch-alls that the route keeps for awarding stay in that payload. The phone does not call `/api/badges/award` or `/api/badges/award/bulk`.
- [x] [Flows] View report pushes the existing read-only badge report. Awarding a group stays on the web.

## P1 — polish before ship

- [x] [Flows] Loading, first-load failure, a failed refresh that keeps the last list, an empty catalog, a search with no matches, and the turned-off feature each have their own copy.
- [x] [UI polish] Rows use the shared badge artwork and the purple status tokens. Category appears only when the visible list has more than one.

## Deferred

- Group award, custom badge creation, and the people picker stay on the web.
- iPhone 18 Pro Max build and a signed-in staff walkthrough remain a Mac gate.
