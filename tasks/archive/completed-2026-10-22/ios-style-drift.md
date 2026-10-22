# iOS style-drift cleanup — 2026-10-22

Scope: close the 11 findings left by the recent iOS review in the existing isolated `codex/ios-review-fixes` checkout. Preserve the prior fixes, onboarding refinement, and unrelated root/branch work. The user's subsequent commit request includes this completed cleanup; push, migration, deployment, and distribution remain outside scope.

Plan:
1. Snapshot the current affected sources and built app before editing.
2. Replace literal action tints with existing semantic tokens; use native buttons for Home/Trade Board primary row actions while retaining independent quick/review controls; name formatted Trade Board area text explicitly.
3. Run drift/project/audit/source gates and the repository simulator build/test wrapper. Exercise Home routing, staff/student trade states, detail/inline decision separation, and extension failure recovery.
4. Capture matched Trade Board appearance, inspect screenshots, update local acceptance, and close with exact limits.

Owners: `BookingsView.swift`, `BookingDetailView.swift`, `ExtendBookingSheet.swift`, `Home/HomeSections.swift`, `Schedule/TradeBoardSheet.swift`. Contracts: `docs/IOS_PATTERNS.md`, `docs/COLOR_SYSTEM.md`, `docs/AREA_MOBILE.md`, existing native API/permission/action flows. Detector rules stay unchanged.

Baseline: `ecc399c3c` plus the exact combined feature and onboarding source already verified in this checkout. The current five Swift owners and initial touched test are retained in `/private/tmp/wc-ios-style-drift-20261022/before.tar.gz`, with full dirty patch, source hashes and `before.app` alongside it. Prior combined-source provenance remains in the earlier review proof folders.

Implementation:
- Seven flagged green tints use `Color.statusText(.green)`; the matching round approval glyph/action bar also use the same token (and the destructive bar uses its red token).
- Home target rows without a quick action become native buttons; quick buttons remain unnested.
- Trade Board primary details buttons are siblings of Claim/Approve/Decline. Swipe/context actions, pending ownership, and confirmation handlers stay in place. Accessibility includes full times and notices.
- The private `BoardRowModel.areaLabel` is explicitly formatted once at construction; raw API shift areas keep their existing type/name.
- Existing capture tests were stale after the already-integrated UI redesign; selectors now follow current headings, tabs, title casing, and return presets. New interaction checks use actual buttons and confirmation behavior.

Acceptance: complete locally. Unchanged drift detector: zero hits / 130 files. Project generation and audit: pass (82/82). Repository simulator verification wrapper: pass, including build and 251 native tests; generic-device compilation intentionally excluded. Focused source tests: 794 passed. UI checks: six passed across targeted runs, covering Home routing, Trade Board staff review/student waiting/student browse, details versus inline decision controls, and extension failure/retry preservation. Matched light/dark captures and test artifacts are retained in the review proof folder. Independent review found no actionable regression. Fixture proof does not imply authenticated mutations or physical-device acceptance.
