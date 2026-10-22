# Audit: damage cases (iOS) — 2026-10-21

**MVP verdict:** Source-complete. Built and unit-tested on an iPhone 18 Pro Max simulator against canned fixtures. No signed-in device or deployed-server proof yet.
**Ship bar:** staff can see every open damaged or missing case, open one, and close it with an outcome without leaving the phone.
**Audit type:** simulator build with DEBUG fixtures (`damage-queue-*` scenarios), no live network

Scope: `DamageCasesView` (Open/Closed, All/Missing/Damaged filter), `DamageCaseDetailView`, and the shared `RecordOutcomeSheet`. Reachable from Browse for staff and admins, with an open-case count on the row.

## What shipped

- Browse adds "Damage and loss" under Equipment for staff and admins only. `GET /api/damage-cases` refuses everyone else.
- Open and Closed show the server's counts. The type filter is applied on the phone to the loaded list.
- A row shows the photo (or item picture), tag, a Missing / Damaged pill (neutral outcome once closed), who had it, and a relative date. A missing item still listed as available says so.
- A case opens a detail screen: evidence photo, note, reporter, time, checkout, and Record outcome. Closed cases show the outcome, time, and note.
- Batteries and counted stock appear in the queue and can be closed. Their item pages stay on the web, so only serialized items offer View item.

## P1 — polish before ship

- [ ] [Flows] Authenticated device proof against the deployed routes: close a missing case as Found and a damaged case as Repaired, and check the item status afterward.
- [ ] [Scale] The route returns at most 200 rows. The phone does not page.
