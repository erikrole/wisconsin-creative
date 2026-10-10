# Kiosk Check-In/Out Fixes — Implementation Plan

> **Closed 2026-10-06** in the open-task audit: remaining boxes are stale (work shipped in source or superseded). Evidence is in the audit report; nothing here is open.

Source: `tasks/kiosk-checkin-checkout-audit.md` (2026-04-29)

## Slice 1 — Quick Wins (no schema change)
- [x] QW1: Location-scope `kiosk/users` (User.locationId nullable; include null OR == kiosk.locationId so unassigned students still appear)
- [x] QW2: `checkout/complete` requires `user.active = true`
- [x] QW3: `checkout/complete` distinguishes `Booking.refNumber` P2002 (retry) from items P2002 (409 unavailable)
- [x] QW4: `checkin/[id]/scan` wraps update + updateMany in one Serializable transaction
- [x] QW5: `checkin/[id]/complete` 404s on bad actorId (no STUDENT fallback)
- [x] QW6: `heartbeat` exports both POST and GET (additive — keeps iOS working)
- [x] QW7: `withKiosk` requires Origin on mutating requests (matching `withAuth`)
- [x] QW8: `kiosk_checkin` audit gets `before` (returnedItems pre-state)
- [x] QW9: Extract `findAssetByScanValue` helper → replace 4 duplicates
- [x] QW10: `checkout/complete` refNumber regex narrowed to `/^CO-/`

## Slice 2 — Bigger Bet: nextBookingRef centralization
- [x] Service `src/lib/services/booking-ref.ts` with advisory-lock + retry
- [x] Wire kiosk `checkout/complete` to use it
- [x] Grep for other CO-/RV- generators; wire them too

## Slice 3 — Bigger Bet: Zod at kiosk boundary
- [x] `src/lib/schemas/kiosk.ts` covers: scanValue body, actorId+items body, complete body
- [x] Apply to all `/api/kiosk/*` mutating routes
- [x] Bad bodies → 400 not 500

## Slice 4 — Bigger Bet: Unify check-in under bookings-checkin.ts
- [x] Add `kioskCheckinScan` and `kioskCheckinComplete` services (or extend existing) that:
  - run inside Serializable
  - handle bulk items
  - close scan sessions
  - auto-mark lost bulk units
  - call `maybeAutoComplete` semantics
- [x] Kiosk routes delegate to services
- [x] Audit shape preserved

## Slice 5 — Schema
- [x] App-side P2002 catch in `bookings-lifecycle.createBooking` → 409 "no longer available"
- [x] kiosk `checkout/complete` already P2002-aware (Slice 1 QW3)
- [ ] Migration `0048_unique_active_asset_allocation/migration.sql` — staged in
      `tasks/migration-0048-unique-active-allocation.sql`. **The user must move
      it into `prisma/migrations/0048_unique_active_asset_allocation/migration.sql`**
      because the agent's permission profile blocks writes under `prisma/migrations/`.
- [ ] Pre-flight check is embedded in the migration (PL/pgSQL DO block — fails loudly
      if any asset already has multiple active allocation rows). To dry-run before
      applying: `psql $DATABASE_URL -f tasks/migration-0048-unique-active-allocation.sql`
      against a recent restore, or run only the SELECT to count duplicates.

## Slice 6 — Location scoping policy
- [x] Decision in `docs/DECISIONS.md`: kiosk operates within `locationId`
- [x] `student/[userId]` validates location match
- [x] `dashboard` filters by `kiosk.locationId`
- [x] Update AREA_KIOSK.md
