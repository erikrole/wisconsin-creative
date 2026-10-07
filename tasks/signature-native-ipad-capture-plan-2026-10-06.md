# Native iPad Signature Capture — Plan (2026-10-06)

## Goal

Move Apple Pencil signature capture into the iPad version of the Wisconsin iOS app (Erik, 2026-10-06), so capture reads Pencil samples from UIKit directly instead of through Safari's coalesced Pointer Events. The 2026-27 web captures recorded about half of their samples twice (see `docs/AREA_SIGNATURES.md`, 2026-10-06), which motivated the move.

## Contract

- iPad only (`userInterfaceIdiom == .pad`), STAFF/ADMIN only, main `Wisconsin` target (not Kiosk, not `Shared/`).
- Same server contract as the web client: bootstrap `GET /api/signatures/collections/{id}/members/{memberId}`, save `POST /api/signatures/collections/{id}/capture/{memberId}` with `{requestId, expectedCaptureVersion, settingsVersion, strokes:[{points:[{x,y}]}]}`. Coordinates are in points (the web uses CSS px, the same scale), so the server's crop limits apply unchanged. No server change in slice 1.
- Pencil-only drawing (`UITouch.type == .pencil`); touch stays available for controls. Samples come from `coalescedTouches(for:)`; `predictedTouches` are display-only and never saved. Exact consecutive duplicates and exact repeated runs are dropped (same rule as `src/lib/signatures/capture.ts`).
- No clipped signatures (Erik, 2026-10-07): a stroke that reaches within 1pt of the canvas edge (the clamp flattens anything past it) blocks Save, with a warning haptic and an inline message, until Undo or Clear removes it.
- Signing-session pass (Erik, 2026-10-07): the capture screen is signer-facing — big Gotham Black name and Wisconsin-font jersey number, a signing line with an X and a faint edge margin drawn in logical canvas space, Undo / Redo / Clear / Replay / Done (a staff menu was tried and dropped the same day), clipped strokes drawn red with a red border, and a 1.6 s Saved card showing the ink cropped close to `computeSignatureCropBounds` (it skips the server's stray-mark removal and width resolution). The roster is a grid of whole-card targets (unsigned → capture, signed → Quick Look; players keep the prominent red prompt), group headers show only `n/m signed`, and a Jersey # pad finds who wears a number and opens their capture. Unsigned-first sorting was declined.
- Polish pass (Erik, 2026-10-07): saved previews cache by revision ID in memory and in Caches/SignaturePreviews (no expiry, revisions are immutable), share one download per revision, prefetch a roster four at a time, and show a placeholder while loading. The roster has nav-bar search, a Jersey # toolbar button, a header with the sport name in Gotham Black, big readiness counts, a progress bar, and a segmented group filter; fixed 4/3/2-column grids; pinned group headers; even-height cards with signed cards dimmed. The collections grid groups Teams and Staff and other, with sport marks, season chips, big counts, and green finished rosters. The capture header and canvas share one card.
- Uniform line, no pressure/tilt/taper (unchanged product direction). On-screen ink uses the same midpoint-quadratic curve the server renders.
- Request ID rule matches the web: keep the same `requestId` on 425, 429, 5xx, and network failures; mint a new one after any other failure; a successful save ends the capture.

## Slices

| Slice | Scope | Status |
| --- | --- | --- |
| 1. Native capture | Models + API methods, pure Pencil stroke recorder, UIKit canvas, web-matched collections → roster (readiness, search, group filter, collapsible groups, saved-signature previews with Quick Look/Replace) → capture flow from Browse (iPad + staff/admin only); Undo/Redo/Clear/Replay bar (Clear undoable, replay at the signer's Pencil pace), keyboard and Pencil double-tap/squeeze undo, deferred edge gestures, no sleep; landscape canvas with a portrait rotate prompt (iPadOS refuses programmatic rotation for the multitasking app, Erik chose the prompt 2026-10-07); save → brief confirmation → roster (no auto-advance, Erik 2026-10-06), unit + source-contract tests, docs | Implemented locally 2026-10-07; physical iPad + Pencil save open |
| 2. Pen timing | Optional per-point time on the wire and in stored strokes so animated signatures can replay each signer's real pen speed and lifts | Not started; needs a schema/contract decision |
| 3. Web capture | Retired 2026-10-07 (Erik): web keeps everything but capture; capture route redirects to the roster | Implemented locally 2026-10-07 |

## Verification (slice 1)

`xcodebuild` for the Wisconsin scheme (iPhone 18 Pro Max default destination) plus an iPad simulator build, `WisconsinTests` for the recorder, focused `tests/ios-*` source-contract tests, the iOS audit inventory test, and a review capture of the iPad screens. Real Pencil input cannot be simulated; a physical iPad + Pencil save is the acceptance gate.
