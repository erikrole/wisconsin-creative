# Audit: kits (iOS) — 2026-10-16

**MVP verdict:** SOURCE-READY — read-only list and detail compile against the shared kit routes. An Xcode build on a Mac is still required.
**Ship bar:** anyone who can reserve can see whether a gameday kit is on the shelf, then start a reservation for an event.
**Audit type:** static source (no Xcode build)

Scope: `KitsView` and `KitDetailView`.

## P0 — blocks MVP

- [x] [Flows] Students and collaborators who can reserve reach Kits from Browse. Battery Ops and Reports stay staff-only.
      `ios/Wisconsin/Views/BrowseView.swift` gates `.kits` with `RESERVATION_CREATE` for collaborators and shows it for students, staff, and admins.
- [x] [Hardening] The list uses `GET /api/kits` and detail uses `GET /api/kits/[id]`. Archived kits are requested only by staff and admins, matching the route.
- [x] [Flows] Reserve for an event is the one primary action, and it is hidden for empty or archived kits. The composer prefills the kit and pickup through the existing calling path.

## P1 — polish before ship

- [x] [Flows] Shelf status uses Ready, "2 out", Out, Empty, and Archived with `StatusPill` tones. Color is not used as decoration.
- [x] [Flows] Serialized rows open item detail and show the current holder. Item-family rows open family detail.
- [x] [Hardening] A failed refresh keeps the last list or detail and offers Retry.

## Deferred

- Kit create, edit, membership, and archive mutations stay on the web.
- iPhone 18 Pro Max build and signed-in runtime proof remain a Mac gate.
