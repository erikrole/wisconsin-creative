# Schedule MVP parity — 2026-09-16

Outcome: make Schedule fast, trustworthy, and simple on web and iOS. Fix evidenced P0/P1 bugs and required-workflow parity; do not add Week view, combine authoring, or auto-assign to native.

Owner: AREA_SHIFTS; secondary: AREA_MOBILE, AREA_EVENTS.

## Source facts
- Native `shiftsByEventId` uses `Dictionary(uniqueKeysWithValues:)` and can crash when one person has two shifts on one event (now allowed for Staff).
- Contextual Claim still offers during private crew edits; Open Work already pauses.
- Ended-event mutate then publish is not atomic; Publish now is hidden after a failed past correction.
- Native Event detail has Undo/Redo/Revert but no Publish now after the 2026-09-15 Staff permission expansion.
- Combined events collapse on web; iOS still lists source rows independently (GAP-75 read half).

## Bounded steps
1. [x] Native: unique-key crash + keep earliest personal shift.
2. [x] Student-safe `claimsPaused` on shift-group reads; gate web ClaimShiftAction and native Event detail.
3. [x] Ended-event: return committed draft if auto-publish fails; show Apply correction now.
4. [x] Native Publish now / Apply correction now against existing `/publish`.
5. [x] Exclude combined secondaries from calendar-event list queries; collapse + span on iOS.
6. [x] Tests, docs, focused verification.
7. [x] UI polish: one crew-level claims-paused notice, native combined-row and multi-area cues, Publish now above Undo/Redo, trade-count failures no longer write 0.

Local verification: focused web tests, TypeScript, ESLint, `build:app`, iPhone 16 Pro XCTest for combined/all-day math. Authenticated browser and signed-in native runtime remain open.

## Not in this slice
Week view on iOS, combine/undo authoring, auto-assign wizard, GAP-60 timer acceptance, authenticated production proof.
