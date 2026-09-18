# Re-reserve a past booking

Created: 2026-09-16
Status: Local source complete; runtime proof remaining
Owner: AREA_RESERVATIONS

## Outcome

Staff can open last weekend’s football reservation (or its linked checkout) and start a new reservation for this weekend’s game without re-entering the person, pickup room, kit provenance, or cameras/batteries.

## Source facts

- “Reuse gear for another event” already exists, but it copies only remaining reservation lines and clears title/context.
- Kiosk pickup deletes handed-over serialized and fulfilled bulk lines from the source reservation, so a completed gameday reservation looks empty.
- Linked checkouts still hold the original equipment.
- Same-context cloning stays retired: a different event is required, and availability is rechecked before save.

## Bounded steps

- [x] Reconstruct original equipment from remaining reservation lines plus linked checkout lines.
- [x] Copy requester, shared/personal scope, pickup location, notes, kit provenance, and custom title into the composer.
- [x] Apply the source pickup/return offset when the new event is chosen.
- [x] Make **Re-reserve** the completed-booking action on web and native.
- [x] Keep create as a new reservation; do not open custody from app/web.

## Verification

- [x] Focused reuse-plan, window, action-policy, wizard, and native source tests
- [x] `npx tsc --noEmit --pretty false`
- [ ] Authenticated browser proof on a completed football reservation when a session is available
- [ ] iPhone 16 Pro runtime proof

## Remaining

- Event-level “copy every reservation from last home game” is a later slice once single-booking re-reserve is in operators’ hands.
