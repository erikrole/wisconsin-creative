# Bulk Battery (Numbered Unit) Hardening — 2026-07-06

Context: kiosk north star = lightning-fast, trustworthy pickups/returns.
Sony batteries are the highest-traffic numbered-unit family.

## Findings

### H1 — Orphaned CHECKED_OUT flags scan as available but can't be claimed (HIGH, live)
Every read path uses `effectiveBulkUnitStatus`, which treats a raw
`CHECKED_OUT` flag with no active allocation as AVAILABLE (Battery Ops counts
it available, kiosk scan accepts it into the cart, pickup staging accepts it).
But all three claim paths guard on RAW status:
- `POST /api/kiosk/checkout/complete` (`status !== AVAILABLE` + guarded
  `updateMany where status: AVAILABLE`)
- `POST /api/kiosk/checkout/[id]` add-item (guarded updateMany)
- `createBooking` `bulkUnitItems` binding (added 2026-07-06)

Student experience: battery scans fine, checkout completion 409s "no longer
available", and nothing heals until staff manually runs repair-stale. Exactly
the Cheqroom-style trust break the kiosk exists to avoid.

**Fix:** claim = "not LOST/RETIRED AND no active allocation". Guarded update
becomes `status IN (AVAILABLE, CHECKED_OUT) AND allocations none active`,
inside the existing SERIALIZABLE transactions — atomicity preserved, orphaned
flags self-heal on the next checkout instead of dead-ending it.

### H2 — Found-battery repair can brick a unit as phantom checked-out (MED, live)
If a LOST unit still has an open allocation from a COMPLETED booking (historic
data from H3's path), Battery Ops' PATCH LOST→AVAILABLE flips raw status but
the open allocation makes effective status CHECKED_OUT "on another booking" —
unscannable, and repair-stale can't fix it (it only handles flag-without-
allocation, not allocation-without-open-booking).

**Fix:** units PATCH closes active allocations whose booking is no longer
OPEN/PENDING_PICKUP when transitioning a unit to AVAILABLE.

### H3 — `markCheckoutCompleted` auto-LOST corrupts balance + allocations (latent)
Marks unreturned units LOST but (a) restores bulk stock for them (CHECKIN for
full outstanding quantity → onHand inflated; `checkBulkShortages` uses onHand
even for numbered SKUs, so reservations over-promise), and (b) leaves their
allocations open (source of H2's bad data). Currently dead code — its only
caller `completeCheckinScan` has no callers since D-040 gated web check-in —
but it is exported, tested, and one re-wire away from corrupting again.

**Fix:** exclude auto-LOST unit quantities from the stock restore and close
their allocations at completion. Loss attribution survives: the bulk-losses
report reads the latest allocation regardless of open/closed.

### H4 — Stale comment
`kioskCompleteCheckin` doc comment claims `maybeAutoComplete` handles "LOST
bulk units" — it doesn't (only `markCheckoutCompleted` does). Correct it.

### Verified clean
- `pending-pickup-expiry`: closes allocations, restores exactly the original
  decrement, frees units, SERIALIZABLE per booking. No change.
- Reservation pickup staging holds nothing (scan events only) — no unit leak
  if a staged pickup is abandoned.
- `forceCompleteCheckout`: returns everything AVAILABLE symmetrically.
- Derived QR parsing: normalization is thorough (control bytes, unicode
  dashes, URL wrappers, legacy `qr-`).

## Slices
- [x] S1: shared claimable-unit helper + three claim sites effective-status
      aware (H1)
- [x] S2: units PATCH stale-allocation close on →AVAILABLE (H2)
- [x] S3: markCheckoutCompleted LOST fixes (H3) + comment (H4)
- [x] S4: tests, build, doc sync

## Review (2026-07-06)
- `CLAIMABLE_BULK_UNIT_WHERE` / `ACTIVE_BULK_UNIT_ALLOCATION_WHERE` live in
  `src/lib/bulk-unit-status.ts` next to `effectiveBulkUnitStatus` so the claim
  rule and the read rule stay one definition apart. Typed as Prisma where
  inputs (`as const` readonly types broke `BulkSkuUnitWhereInput`).
- All claim relaxations stay inside pre-existing SERIALIZABLE transactions
  with guarded `updateMany` count checks — atomicity unchanged, only the
  guard's definition of "available" now matches `effectiveBulkUnitStatus`.
- Verified: targeted suites 74/74 green, full run 1765 passed with only the
  4 pre-existing iOS guides/licenses/tabbar failures, `next build` green.
- Deliberately not done: extending repair-stale beyond battery families
  (self-healing claims reduce its urgency), and touching quantity-tracked
  (non-numbered) restore semantics — no defect found there.
