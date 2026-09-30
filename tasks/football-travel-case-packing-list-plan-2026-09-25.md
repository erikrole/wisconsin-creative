# Football Travel Case Packing List Plan - 2026-09-25

## Goal
Whoever packs the Football Travel Case works from one list, on the kiosk iPad, the iOS app, or the web. The list covers everything that goes in the case, including items the system doesn't track (towels, cables, cards). Tagged gear and battery lines check themselves off when scanned onto the case. Untracked lines are ticked by hand, and each tick records who packed it and when, per trip.

## Decisions (user interview, 2026-09-25)
- **Source of truth is the kit.** The Football Travel Case kit holds tagged gear, battery counts, and untracked checklist lines. The Resources guide `football-travel-case-check-list` links to the kit and stops being a second list.
- **Travel-case kits may share gear with gameday kits.** Serialized exclusivity stays among gameday kits. A travel-case kit can list FX6 1 even though SLOW1 owns it. Real double-booking is still caught by availability at reservation time.
- **Scans auto-check, untracked lines are manual.** Tagged and battery lines are derived from the trip's allocations and scans and are never ticked by hand.
- **Ticks are recorded per trip** with who and when.
- **Packing only.** Kiosk return is unchanged.
- **Sections are kept** in the guide's order: Cameras, Lenses, Batteries, Audio, Media, Accessories, Back of Case, plus a separate **Stays in case** section for fixtures (chargers) that are confirmed, not packed.
- **Anyone identified at the kiosk may tick,** with the actor recorded, matching the return rule. Web and iOS: any signed-in non-collaborator who can see the shared case (assumption, confirm before slice 2).

## Source checks
- `Kit` has serialized `KitMembership` and item-family `KitBulkMembership` only. There is no line for untracked items and no section (`prisma/schema.prisma:1120-1167`).
- Exclusivity: `assertExclusiveSerializedMembers` rejects any asset already in another active kit with the same `sportCode` (`src/lib/services/kits.ts:184`). Production FB gameday kits already own FX6 1 (SLOW1), FX6 2 (SLOW2), and FB FX6 1, FB 100-400 1, 17-28 1, FB Monitor 1 (ROAM1). That is why the live Football Travel Case kit (`cmn5857mr0001l104x2fhm3eu`) holds only batteries: Sony 10, Gold Mount 4, FX6 2, Monitor 2.
- Live trip: shared checkout `CO-0543` "FB at Penn State" holds FX6 1, FX6 2, FB FX6 1, 17-28 1, FB 100-400 1, DJI Mic 2, FB Monitor 1, Gold Mount 4, Monitor 2. The Canon 25-250 1 and 2 are accessories attached to FX6 1 and FX6 2 (D-023), so they travel on the checkout with their parents. Compared with the guide, the only gap is the 2 FX6 batteries.
- Guide lines not in the system: Type A cards, Type A card readers, Fickell & Tausch interview mic with flag, Hi-Hat with arm, TV bag, 2 XLR cords, extension cables, power strips, sling bags (inventory has generic Peak Design slings), towels, rain gear. Tripod, chargers, and "FX6 n accessories" are ambiguous and need a decision per line when seeding.

## Data model (additive, rollout-safe)
- `Kit.purpose KitPurpose @default(GAMEDAY)` with values `GAMEDAY | TRAVEL_CASE`. Exclusivity applies only when both kits are `GAMEDAY`.
- `KitMembership.section`, `KitBulkMembership.section`: nullable `KitSection`. When null, the section is derived from category for display.
- `KitChecklistItem`: `id, kitId, section, label, quantity?, note?, staysInCase, sortOrder, archivedAt?`. Cascades with the kit. Untracked lines only.
- `BookingPackingCheck`: `id, bookingId, checklistItemId, labelSnapshot, checkedById, checkedAt, source (KIOSK|WEB|IOS)`, with `@@unique([bookingId, checklistItemId])`. Ticks live on the trip's root booking: the reservation, or the checkout when there is no source reservation. They are read through `sourceReservationId` so a picked-up case keeps its ticks.
- Accessories (D-023) are never kit lines. The packing list shows them nested under their parent and checks them with the parent, e.g. FX6 1 → 25-250 1. The guide's "FX6 n Accessories" lines become the parent's attached accessories, plus untracked lines only for attachments the system doesn't track.
- `KitSection` enum: `CAMERAS, LENSES, BATTERIES, AUDIO, MEDIA, ACCESSORIES, BACK_OF_CASE, STAYS_IN_CASE`.

## Slices
- [ ] 1. **Schema and migration.** Add the enums, columns and tables above. Exclusivity respects `purpose`. Prisma format/validate and migration check. Production migration only with explicit approval.
- [ ] 2. **Packing-list service and API.** `GET /api/bookings/[id]/packing-list` derives tagged and battery lines from allocations and scans, merges ticks, and groups by section. `PUT|DELETE /api/bookings/[id]/packing-list/items/[itemId]` tick and untick, `SERIALIZABLE`, audited, P2002 treated as already ticked. The kiosk twin under `/api/kiosk/...` requires an identified `actorId`. Staff-only kit checklist CRUD under `/api/kits/[id]/checklist`.
- [ ] 3. **Web.** The kit editor gets a travel-case toggle, sections on members, and untracked lines with a stays-in-case flag. Booking detail gets a Packing list card with section progress, auto-checked rows and tickable rows. Behind a `gt-ui-review` page.
- [ ] 4. **Kiosk.** The shared-case pickup shows the packing list beside the scan stage. Scans tick tagged rows live. Untracked rows are tickable by the identified operator. TestFlight build.
- [ ] 5. **iOS app.** The booking detail Packing list mirrors web. Codable models tolerate the fields being absent.
- [ ] 6. **Seed the real kit.** Needs explicit approval to write production data. Set Football Travel Case to `TRAVEL_CASE`, add tagged gear (FX6 1/2 with their attached 25-250s, FB FX6 1, FB 100-400 1, 17-28 1, DJI Mic 2) and the untracked lines from the guide, then point the guide at the kit.

## Stop conditions
- Stop if exclusivity weakens between two gameday kits.
- Stop if a tagged or battery line can be ticked by hand instead of derived from scans.
- Stop if ticks are lost when a reservation is picked up into a checkout.
- Stop before a production migration, a production data write, or a TestFlight upload without separate authorization.

## Verification
- Migration check plus service and route tests for derivation, tick races, actor rules, and lineage through `sourceReservationId`.
- tsc, lint, `build:app`, and the full test suite.
- Xcode builds for `Wisconsin` and `WisconsinKiosk`, plus the Swift source-contract tests.
- `gt-ui-review` matched captures for the kit editor, booking card, kiosk pickup and iOS detail.
