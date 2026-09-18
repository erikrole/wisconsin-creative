# Kits as named gameday templates

Created: 2026-09-16
Updated: 2026-09-17
Status: Implemented locally
Owner: AREA_KITS / AREA_RESERVATIONS / AREA_KIOSK / AREA_MOBILE

## Outcome

Staff can name the gear and batteries each gameday position uses (Slow 1, Slow 2, Bench, Roam 1–4), then anyone who can create a reservation can call that kit from web, native iOS, or kiosk checkout. The booking stores the expanded cameras, lenses, and item families — not only a kit label. The reservation title stays the event name.

## Bounded steps

- [x] Expand kit memberships inside `createBooking` when `kitId` is set and the client sent no equipment. Keep an edited client list as the source of truth.
- [x] Apply the same expansion in the reservation wizard so Step 2 and review show the full item list.
- [x] Duplicate kits and location-safe member add/remove so Jacob can author many similar football gameday kits.
- [x] Keep kit name as booking context. Lists and detail continue to render serialized/bulk lines as the gear.
- [x] Optional kit sport and exclusive serialized membership within the same sport.
- [x] Camp Randall and Camp Randall Stadium share kit pickup.
- [x] Native iOS reservation create lists, expands, and submits a kit without renaming the event.
- [x] Direct kiosk checkout can pick a kit as the scan checklist and `kitId` provenance.
- [x] Football kits own Slow 1, Slow 2, Bench, or Roam 1–4 at a pickup; calling surfaces hide empty kits and suggest last week’s job.

## Verification

- [x] Focused kit service, list, pickup-alias, wizard, native, and kiosk source tests (65 passing)
- [x] Generic iOS Simulator `Wisconsin` and `WisconsinKiosk` Debug builds
- [x] `npm run verify:docs` / `git diff --check`
- [ ] Full `npx tsc --noEmit` and `npm run build:app` — blocked by unrelated `src/lib/services/blasts.ts` payload typing already in the dirty tree
- [ ] Authenticated browser proof on `/kits` and `/reservations/new`
- [ ] iPhone 16 Pro reservation-create runtime proof
- [ ] Managed-iPad kiosk checkout proof

## Remaining

- Authenticated browser, iPhone 16 Pro interaction, and physical kiosk proof.
- Apply migrations `0149_kit_sport_code` and `0150_kit_gameday_role` in the controlled deploy environment.
- Do not commit unless asked.
