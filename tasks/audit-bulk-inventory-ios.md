# Audit: bulk inventory (iOS) — 2026-10-16

**MVP verdict:** SOURCE-READY — item-family detail is read-only. An Xcode build on a Mac is still required.
**Ship bar:** tapping an item family shows what is available, and Reserve is the one action.
**Audit type:** static source (no Xcode build)

Scope: `BulkInventoryDetailView` and `InventoryReadModels.swift`.

## P0 — blocks MVP

- [x] [Flows] Items, Search, kit detail, and Battery Ops open `GET /api/bulk-skus/[id]`.
- [x] [Flows] Collaborator responses omit units and still decode location, category, and available quantity.
- [x] [Flows] Reserve prefills one unit of that family in the existing composer. Archived families hide the button.

## P1 — polish before ship

- [x] [Flows] Unit rows use status pills. Low stock is the only extra status chip.
- [x] [Flows] Staff see a Battery Ops link on battery families. Students do not.
- [x] [Hardening] A failed refresh keeps the last family and offers Retry.

## Deferred

- Receiving, label printing, count adjustments, product edits, and QR replacement stay on the web.
- iPhone 18 Pro Max build and signed-in runtime proof remain a Mac gate.
