# Student Availability local proof — 2026-10-29

Open [the review](review-index.html). Scope and pending acceptance: [active ledger](../../../student-availability-roundout-2026-10-29.md).

## Provenance

Baseline is the preserved Claude paint-roller checkout at `dc4f328735da42911c6301708b8c1eababc09c05`. Source snapshots retain the relevant original/edited files and baseline untracked demo. The paint component itself is identical. `fixture.json` is synthetic. Web captures use actual components and CSS with API responses intercepted locally, a fixed 2026-10-29 noon Central clock, en-US/light/default text, deviceScaleFactor 1, and the listed viewports. Each pair has a hash-bound receipt. Build/capture scripts retain the exact original source-root paths; revise those paths if replaying from another checkout.

Native images come from the final `WisconsinPerformance` DeviceSweepScreenshotUITests/testSweep offline Availability scenario, iPhone 18 Pro Max UDID `795AB4E9-3E4A-4C13-9D4F-27FD822C190B`, iOS 27.0. The fixture intercepts every API request; unmapped calls return local 404. Native captures are after-only and use the capture day's relative fixture dates. The attachment manifest records timestamps. These prove presentation and decoding, not authenticated persistence or delivery. The xcresult remains at `/tmp/availability-final-native.xcresult` for this session.

## Initial visual-slice checks

73 focused + 63 sibling tests passed (136 unique); five native contract tests rerun after the final Swift change also passed. TypeScript, changed-file lint, build:app and repository web performance fixture checks passed. Required native build and final native screenshot test passed. iOS drift/target checks and migration-prefix validation passed. Logs are retained here. The full deploy-shaped build was not run because there is no controlled database environment; build:app does not deploy migrations.

Docs verification and diff/reference checks are recorded in `docs.log` and `final-checks.json`. Initial docs verification detected stale generated maps; regeneration fixed the relevant helper entries and one pre-existing BrandAssetLibrary line count without editing that component.

## Current follow-up

The duplicate-save gap is fixed with durable actor/request receipts and retained client UUIDs. All 19 disposable PostgreSQL tests and 8,475 unit tests passed; coverage gates passed. Web captures named `preview-*` reflect the current retry fix and 40px approval controls. `preview-source-snapshot.tar.gz` and its manifest record their source; native captures retain the earlier visual-slice provenance. The PR-owned managed preview and authenticated student/staff acceptance are being prepared.

Optional retry/version checks protect clients that send them. Closing and reopening a create form starts a new save. Native distribution, real push delivery and production deployment remain unverified.

The self-contained `review.html` remains local because it exceeds the repository file-size limit. `review-index.html` uses the same PNGs alongside it and is included in the PR. Retry follow-up proof is in `retry/`; the original logs above remain historical evidence for the visual slice.
