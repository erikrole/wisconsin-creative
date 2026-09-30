# Web and iOS performance results — 2026-09-27

Local implementation and benchmark pass. Existing user changes were retained; nothing was staged, committed, pushed, deployed, or distributed.

[Open the visual review](review.html) · [Active owner ledger](../../../performance-web-ios-plan-2026-09-27.md)

## Web: less startup work

The shared query provider changed its component hierarchy after mounting, remounting the signed-in subtree and repeating requests. It now keeps one provider through cache restoration. Server-side clients also avoid 24-hour garbage-collection timers. Browser cache retention and the dashboard/booking-only persistence allowlist are unchanged.

Production React with real server rendering/hydration, real query persistence, and synthetic 100 ms loopback responses was measured five times for each of four scenarios:

| Scenario | Before | After |
| --- | --- | --- |
| Cold or corrupt cache | 2 mounts, 2 query requests, 2 effect requests | 1 mount, 1 query request, 1 effect request |
| Fresh persisted dashboard | 1 premature query request | 0 query requests |
| Storage access denied | Subtree errors | Usable in-memory queries |

All 20 final browser trials passed, including button state and no remount/cancellation. Request counts are fixture evidence, not a production request-total or load-time claim. [Before samples](query-provider-before.json) · [After samples](query-provider-after.json).

The profile form and badge artwork now load when needed. Six before/after browser scenarios passed manual opening, automatic prompting, quiet Home, failed-save input retention, snooze and reopening. Both the opened form and settled error state have byte-identical PNG pairs, with matching capture receipts. The fixture uses the actual production form with synthetic identity and intercepted save responses; it does not establish authenticated saving. [Browser evidence](profile-browser.json) · [Source provenance](capture-source-provenance.json).

## Web: production initial JavaScript

Matched app-only production builds, each route plus all parent layouts, each unique JS file counted once, gzip applied per file. These are initial build assets, not network transfer sizes, LCP, or response latency. Optional dialogs load later when used; the byte reduction is most relevant to returning users whose profile does not require an immediate prompt.

| Route | Before gzip bytes | After gzip bytes | Reduction |
| --- | ---: | ---: | ---: |
| `/` | 407,302 | 369,116 | 9.4% |
| `/items` | 469,998 | 438,744 | 6.6% |
| `/bookings` | 448,614 | 417,592 | 6.9% |
| `/schedule` | 503,026 | 484,684 | 3.6% |
| `/reservations/new` | 433,233 | 416,509 | 3.9% |
| `/users` | 408,250 | 376,924 | 7.7% |
| `/resources` | 451,201 | 421,605 | 6.6% |
| `/signatures` | 386,076 | 368,064 | 4.7% |

[Before manifest measurements](web-bundles-before.json) · [After manifest measurements](web-bundles-after.json) · [Comparison](web-bundle-comparison.json).

## iOS: shared thumbnail work

In a cold-cache fixture, 24 simultaneous rows requesting one 44-point image at 3× scale previously produced 24 downloads and 24 decoded image objects. They now share one download and one decoded image: **95.8% less duplicated work in this scenario**. A faithful extraction of the old sequence failed the new contract before the implementation changed.

The cache remains bounded. URL, target pixel size and scale identify entries. Cancellation of one row preserves other consumers; cancellation of every consumer stops the request. Failed requests can retry. Sign-out cancels pending work and rejects results from the old session. Six native tests cover these contracts. The URLProtocol fixture supplies a PNG after 50 ms without contacting a server. Single-run elapsed times are retained but do not support a latency percentage. [Raw counts](ios-thumbnails.json).

## iOS: response decoding off the UI thread

Successful responses now decode concurrently with a fresh decoder per response. The client rechecks account ownership and cancellation after that work, including the decoding-error path. Tests verify thread placement, snake-case keys, ISO dates, invalid payload errors and concurrent independence.

Seven alternating samples per dataset used the real Asset model and identical former decoder settings:

| Synthetic response | Payload bytes | Before: main-actor median | After: total worker-hop median |
| --- | ---: | ---: | ---: |
| 30 assets | 12,121 | 0.259 ms | 0.296 ms |
| 300 assets | 122,071 | 2.457 ms | 2.590 ms |
| 3,000 assets (stress) | 1,229,671 | 23.967 ms | 25.290 ms |

The gain is keeping decoding off the UI thread; total CPU time and network latency do not decrease. The stress dataset is ten times the normal 300-row list cap. [All raw samples](ios-response-decoding.json).

## iOS: broad regression measurements

The existing WisconsinPerformance harness ran before and after on **iPhone 18 Pro Max / iOS 27.0, Debug**. Launch and 300-item scrolling have five samples each; equipment search/selection has three. Fixtures bypass API decoding and have no thumbnail images, so they do not directly measure those changes.

| Metric | Before median | After median |
| --- | ---: | ---: |
| Cold launch to first responsive frame | 2.212 s | 2.166 s |
| Items scrolling CPU | 1.028 s | 1.020 s |
| Equipment search/selection CPU | 0.931 s | 0.944 s |
| Items peak physical memory | 39.520 MB | 39.619 MB |
| Equipment peak physical memory | 59.525 MB | 59.525 MB |

Ranges overlap; these measurements do **not** establish a broad launch/scroll speedup. All three interaction tests passed. [All 26 metric sets with individual samples](ios-ui-benchmarks.json).

## Verification

- Full Vitest suite: **5,019 passed**, one existing gated skip, 702 passing files plus one skipped file.
- Production app-only builds passed before and after; final TypeScript check passed after generated build types were stable.
- Every changed web source, test and benchmark script passed focused lint. Full repository lint remains blocked by the existing error in unchanged `public/qrcode/vendor/jsQR.js:23`; existing warnings also remain.
- Final iOS unit run: **93 XCTest + 93 Swift Testing cases passed**. Native source-contract checks also passed in the full Vitest suite; the final decoding-error ownership guard passed 25 focused source-contract checks afterward.
- Final unsigned generic-iOS **Release build passed**; simulator build and performance tests passed. XcodeGen consistency check passed.
- Docs/reference verification, native drift/audit inventory, migration-directory check and final diff check passed.
- Review captures were inspected and PNG-pair equality verified. Images are synthetic Staff fixtures, 1440×1000 CSS pixels, light appearance, en-US, America/Chicago, fixed clock, reduced motion and disabled capture animations.

Raw build/test logs and result bundles remain in `.tmp/performance-2026-09-27/`. Its retained source snapshots include the original dirty state; capture receipts declare provenance and bind image bytes, without claiming independent runtime attestation.

## Remaining measurement boundaries and next slice

The initial local pass did not run external setup because automatic approval review required explicit authorization for preview provisioning. The user supplied that authorization on 2026-09-28. A pinned isolated preview, encrypted Claude/Codex handoff, normal sign-in and all three file stores are now verified. The [shared-preview continuation](shared-preview.md) records 55 rendered cold/warm/narrow checks and repeated timings from eight real APIs against synthetic data. That is a new after-only local baseline, not a matched before/after latency claim.

The next bounded slice is profiling the shared asset-list and Dashboard APIs, which have the largest median costs in this baseline, then repeating matched measurements. Realistic photo-heavy device scrolling, physical iPhone 16 Pro Release traces, native preview routing, hosted latency, populated Signature rosters and client-side link transitions remain unverified. Nothing in either report establishes production acceptance.

## Repeatable commands

See [testing guidance](../../../../docs/TESTING.md) for the normal build and native gates. Run the bundle measurement after each controlled production app build, preserving the pre-edit output first:

```sh
npm run build:app
node scripts/benchmark-web-bundles.mjs .tmp/web-bundles.json
node scripts/benchmark-query-provider.mjs --verify .tmp/query-provider.json
node scripts/benchmark-profile-completion.mjs --output .tmp/profile-performance
```

Use `--baseline /path/to/saved/pre-edit/ProfileCompletionWizard.tsx` for a real form comparison. Never reset the working tree to manufacture a baseline. The native decoder benchmark and image tests are included in WisconsinTests; the existing UI metrics use the WisconsinPerformance scheme.
