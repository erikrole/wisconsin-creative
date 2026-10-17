# Audit: kit detail (iOS) — 2026-10-16

**MVP verdict:** SOURCE-READY — covered with the kits list audit. An Xcode build on a Mac is still required.
**Ship bar:** opening a kit shows what is in it and who has a piece out.
**Audit type:** static source (no Xcode build)

Scope: `KitDetailView`. The list audit is `tasks/audit-kits-ios.md`.

## P0 — blocks MVP

- [x] [Flows] Detail decodes derived status and `currentHolder` from `GET /api/kits/[id]`.
- [x] [Flows] The bottom action is Reserve for an event. It stays hidden when the kit is empty or archived.

## P1 — polish before ship

- [x] [Flows] Gear and item-family rows navigate to the existing item and family screens.
- [x] [Hardening] The first failure is a full-screen retry. A later failure stays inline.

## Deferred

- Membership edits stay on the web.
- iPhone 18 Pro Max build and signed-in runtime proof remain a Mac gate.
