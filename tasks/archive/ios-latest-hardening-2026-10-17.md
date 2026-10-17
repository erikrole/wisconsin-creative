# Latest iPhone review, hardening, and UI

Status: complete for the authorized local scope. Owner: Codex. Branch: codex/ios-latest-hardening. Date: 2026-10-17.

## Scope and product decisions

Reviewed nine iPhone feature commits in 3d8be5b6..f022d861: Events, Blasts, Reports, inventory reads, reservation actions, Accountability, Brand assets, UA Gear, and Badges. Work remains in the isolated ios-device-build worktree; the original checkout and its pre-existing next-env.d.ts edit are untouched. This ledger records local verification before the authorized branch commit and push. Deployment and release are outside this slice.

The user added a native UI pass with the Simulator visible, requested size pickers instead of custom text, and approved removing Events from Browse. Schedule is the single event destination; Bookings owns gear. Retained catalog code is no longer exposed by Browse, and legacy Events navigation redirects to Schedule. The phone disconnected after the earlier signed installation; the user explicitly chose to finish with Simulator verification.

## Completed plan

1. [x] Pin latest main, build/install the initial app, inspect physical startup logs.
2. [x] Independent read-only review of mutations, catalogs, and reports/resources; integrate confirmed findings and follow-up review.
3. [x] Fix request ownership, recoverability, decoder contracts, private previews, and first-load failures.
4. [x] Refine native hierarchy, size controls, large text, and offline navigation with visible Simulator interaction.
5. [x] Run native/source gates, retain matched captures, reconcile mobile contracts and remaining proof boundaries.

## Findings closed

- P1/P2 state integrity: UA Gear invalidates older GETs when saving; failed destructive reloads retain dirty/conflict state, and controls lock while replacement/save is pending. Item and review screens use catalog-backed size pickers with saved-size preservation. Each review control has its own system row, fixing Color intercepting Size taps.
- P2 reservation consistency: capture submitted values before awaits, lock forms while saving, advance only acknowledged plan state, and preserve event-link retry after a partial save. Collaborators skip forbidden auxiliary reads. Availability retry and view reappearance use one owned generation.
- P2 decoding: Accountability gracePeriodHours decodes as Double and preserves fractional copy. The new fractional regression fails against the original integer decoder and passes on the fix.
- P2 reporting: report generations reject late same-key pages; successful page retry clears its prior error. Scans pins the first-page date range and advances raw offsets separately from deduplication. Owned Usage 403s clear cached private data; stale errors cannot alter current access state.
- P2 private resources: pin downloads to the displayed version, use unique temporary owners, clean up at session boundaries, check actual file bytes before preview, cap SVG work, remove active/meta/base content, and restrict WebKit navigation with nonpersistent storage. A native regression exposed cached URL file-size metadata; fresh FileManager attributes fixed the actual-byte guard.
- P2 catalog lifecycle: Kits invalidates query generations and owns pagination/reset state. Inventory detail and Battery Ops reject stale reads. Initial loading state fixes screens whose EmptyView prevented their task from starting. Retained event catalog reads preserve coherent stale data and create a fallback per booking without copying a plan's aggregate status onto every booking.
- P2 visual interaction: offline status previously covered navigation buttons. It now occupies separate layout space, and Review opens while offline.
- UI: grouped Browse, compact allowance summary, visible Accountability sort context, wrapping/stacking large-text rows, folder/file sections, direct report links, catalog-first Badges, and consistent Blasts hierarchy.

## Verification

- Xcode 27.1 Simulator build on iPhone 18 Pro Max / iOS 27.0: succeeds without compiler warnings.
- Final XCTest run: 222 passed, zero failed/skipped, final-picker-tests.xcresult. Earlier 221/222 run exposed the actual-byte caching bug; this is fixed and covered by the final passing run.
- All iOS source contracts: 715 passed across 135 suites. TypeScript and changed-test ESLint pass.
- XcodeGen project check, iOS drift check (119 files), and audit inventory (76/76 surfaces) pass. Documentation generation/check and final diff check are recorded with the final verification output.
- Manual fixture proof: item size selection, local Add, Review size change L to XL, independent Color menu, and offline Review navigation. No production save was performed. Dark appearance plus Accessibility Large was inspected for Accountability, Kits, Reports, and UA Gear; no full VoiceOver audit is claimed.
- Ten matched PNG comparisons have bound receipts. The pre-UI snapshot preserves the earlier hardening edits and applies the same corrected fixtures. Source manifests were captured before later changes; reconstructed comparison patches were byte-checked against those manifests. Viewport 440x956 points, 1320x2868 pixels, scale 3; en_US, America/Los_Angeles, default Large text, status bar 9:41.
- The self-contained HTML and receipts validate successfully. All selected screenshots were inspected. Browser rendering of the local HTML was blocked by the browser's file-URL policy; no bypass was attempted. The Codex file-panel open was queued.
- Earlier signed 1.3/33 app installed/launched on physical iPhone 16 Pro / iOS 27.2; account refresh and App Group widget snapshot read-back succeeded. A later hardening device build also succeeded. Final UI installation was deferred by user direction after device disconnection.

## Evidence and remaining boundaries

[UI review](proofs/ios-latest-2026-10-17/review.html) and [capture source/steps](proofs/ios-latest-2026-10-17/README.md). Build/test/runtime logs remain under /tmp/wisconsin-ios-device-20261017/.

GAP-89 closes because the duplicate Events surface was removed, not because every retained Events flow was authenticated. GAP-90 still owns authenticated Accountability proof. Production draft/submit persistence, adversarial network ordering in live reservation flows, full permission/role walkthroughs, external share-extension completion, APNs, camera, passkeys, and a final physical UI build remain outside proven acceptance. Earlier device logs included system input/PointerUI, shared preference, zero-height render, and PDF diagnostics without an observed app crash or failed startup request; those messages are not claimed fixed.
