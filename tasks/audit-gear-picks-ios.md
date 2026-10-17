# Audit: UA gear picks (iOS) — 2026-10-16

**MVP verdict:** SOURCE-READY — a participant can open the cycle, shop their fit, save a draft, and submit. An Xcode build on a Mac is still required.
**Ship bar:** someone on this year's list can pick Under Armour gear on iPhone up to their allowance, and an admin still runs the roster on the web.
**Audit type:** static source (no Xcode build)

Scope: `GearPicksView` and `GET`/`PUT /api/gear-picks/me`.

## P0 — blocks MVP

- [x] [Flows] Browse shows UA Gear to students, staff, and admins. Collaborators do not get the row, because `gear_picks` refuses them.
      `ios/Wisconsin/Views/BrowseView.swift`.
- [x] [Flows] The screen follows the web cycle: nothing to open until an admin launches it, then one fit, then read-only after the deadline. Someone who is not on the roster gets an explanation and no admin tools.
- [x] [Hardening] Saves replace the whole list with the version last read. A stale list asks for a reload and keeps the unsaved lines. A closed cycle locks editing and keeps the list on screen.

## P1 — polish before ship

- [x] [Flows] Standard issue is described as covered by the department. The first add of a style already in standard issue or the core kit asks before it counts against the allowance.
- [x] [Flows] Sizes, duplicates, and the allowance are checked before save, in the same language the server uses. Icon Lo stays an explicit catalog size.
- [x] [Hardening] A failed refresh keeps a list that was already open. Leaving with unsaved picks asks first.

## Deferred

- Roster, allowance edits, deadline, launch, CSV, and the equipment spreadsheet stay on the web.
- iPhone 18 Pro Max build and a signed-in walkthrough remain a Mac gate.
