# iOS entry-point hardening — 2026-09-16

Outcome: every common way into the app — quick actions, Control Center, widgets, Spotlight, APNs, the in-app inbox, browser push, custom URLs, and calendar/mail links — lands on one capability-gated destination. Unknown notification families open the inbox instead of appearing to do nothing.

Owner: AREA_MOBILE; secondary: AREA_NOTIFICATIONS.

## Source facts
- Home Screen shortcuts, App Intents, and widgets already existed, but `wisconsin://` only handled booking/schedule/bookings and APNs only read `blastId` / `bookingId` / `eventId`.
- License, firmware, item, badge, low-stock, and href-only families could tap with no native destination.
- Browser push looked at `payload.url` while producers wrote `href`.
- AASA published `webcredentials` only, so Calendar ICS `https://wisconsincreative.com/events/:id` opened Safari.

## Bounded steps
1. Shared destination map: `src/lib/notification-destination.ts` and `ios/Wisconsin/Core/GearTrackerRoute.swift`.
2. Wire `AppState.apply`, `onOpenURL`, APNs, inbox, and web inbox/push through that map.
3. Control Center Scan / My Gear / New Reservation open the same URLs.
4. AASA `applinks` for operational paths; no settings/API claim.
5. Tests, docs, XcodeGen, focused verification.

## Not in this slice
Camera Control hardware capture, interactive widget mutations, email CTA buttons, physical APNs/Calendar/Control Center proof, AASA CDN cache after deploy.

## Verification
- [x] Focused Vitest: `tests/notification-destination.test.ts`, `tests/ios-deep-link-routing.test.ts`, plus existing tap-through/widget/passkey contracts (8 files / 49 tests).
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run ios:project:check` after `xcodegen generate`
- [x] Wisconsin iPhone 16 Pro build + `GearTrackerRouteTests` (5 tests, 0 failures)
- [x] Docs: AREA_MOBILE, AREA_NOTIFICATIONS
