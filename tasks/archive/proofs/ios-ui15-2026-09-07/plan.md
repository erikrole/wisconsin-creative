# Native Items and Bookings UI batch

Scope: Wisconsin native target, ItemsView.swift and BookingsView.swift. Preserve unrelated Home, Schedule, notifications, project and harness edits. No API, permission, custody, migration or live mutation changes.

1. Show an Items refresh failure above retained rows with Retry.
2. Show Items refresh progress while old rows remain visible.
3. Keep the prior pagination cursor until an Items refresh succeeds.
4. Stop the loading-more spinner if Items returns an empty page.
5. Distinguish filtered/search-empty Items from an empty favorites collection.
6. Offer Reset Filters from status-filtered empty Items.
7. Clearing Items search launches one refresh instead of two.
8. Hide Copy Asset Tag for empty tags in the context menu.
9. Guard concurrent favorite toggles for the same item.
10. Zero-availability item families use neutral rather than available-green tone.
11. Item VoiceOver announces the actual due date/time instead of rounded days.
12. Keep Bookings search mounted during refresh of existing rows.
13. Retain the explicit server sort after installing an updated booking.
14. Booking VoiceOver uses the same pickup/due wording as the visible row.
15. Booking item counts include all planned bulk quantities.

Verification: before/after native build; iPhone 16 Pro iOS 26.5 existing fixtures; affected web source-contract tests; focused runtime checks where available; docs and diff checks. Existing fixture API intercepts all /api paths and returns local 404 for unmapped routes. Do not claim live API writes, physical hardware, distribution, or authenticated production verification.

## Acceptance — local implementation complete

Both simulator builds passed. Source-contract tests: 33 across 10 files. Native unit tests: 4 BookingModels plus 18 ScheduleVenueName tests passed. Native UI tests: Items long-press and Bookings filter/swipe passed (2). Repaired two outdated Schedule test fixture initializers to unblock compilation; no Schedule production code changed.

The delayed Items refresh was captured with retained rows. Review: [review.html](review.html). Evidence is after-only for that transition: no matched pre-change delayed-refresh capture exists. Normal baseline PNGs and before/after source snapshots are retained. Failure/empty payload variants, favorite concurrency, bulk counts, zero-availability family rendering and VoiceOver playback still need end-to-end runtime verification. Physical device, authenticated live service, and distribution gates remain open. All changes are local and uncommitted.
