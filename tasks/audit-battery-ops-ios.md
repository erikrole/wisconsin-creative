# Audit: battery ops (iOS) — 2026-10-16

**MVP verdict:** SOURCE-READY — the cockpit is read-only and staff-only. An Xcode build on a Mac is still required.
**Ship bar:** staff can see which battery families are low and who has units out.
**Audit type:** static source (no Xcode build)

Scope: `BatteryOpsView`.

## P0 — blocks MVP

- [x] [Flows] Browse, battery item detail, and battery family detail show Battery Ops only for STAFF and ADMIN. The route is `GET /api/bulk-skus/batteries`, which requires `bulk_sku:adjust`.
- [x] [Flows] The screen does not call the stale-flag repair route. Repair copy tells staff it stays on the web.

## P1 — polish before ship

- [x] [Flows] Totals, low camera compatibility, checked-out units, and family rows use status color only for status.
- [x] [Flows] A family row opens item-family detail. A checked-out row with a booking opens that booking.
- [x] [Hardening] A failed refresh keeps the last snapshot and offers Retry.

## Deferred

- Receiving, Brother label export, mark printed, and stale-flag repair stay on the web.
- iPhone 18 Pro Max build and signed-in runtime proof remain a Mac gate.
