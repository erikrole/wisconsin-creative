# Web and iOS performance benchmark and improvement pass

Date: 2026-09-27
Status: local implementation, reusable pinned preview and authenticated local baseline complete; shared API profiling and physical-device measurements remain open
Owner: current Codex chat

## Authorized scope

The user requested major benchmarking and speed/performance improvements, with a balanced web and iOS pass. Implement evidenced improvements locally and preserve the existing dirty checkout. No staging, commit, push, deployment, production data mutation, or distribution is authorized by this request.

### 2026-09-28 shared preview authorization

The user explicitly approved creating the preview with durable reuse and Claude access in mind. Provision the isolated resources for `claude/kiosk-multi-lens`, retain the encrypted handoff, and pin the environment. This supersedes the earlier provisioning approval blocker. Production/review changes and source-control shipping remain outside this slice.

Bounded continuation: inspect current local/hosted state and provider access; run the existing branch-bound setup; verify signed database identity and migrations; pin and confirm repeat setup preserves resource identity; verify an authenticated handoff can retrieve the same environment; start the local server and run signed-in browser/performance checks; leave non-secret reuse instructions for both agents. Owners are `scripts/preview.mjs`, `scripts/lib/preview-*.mjs`, the D-063 preview contract, this ledger and the preview runbook. Avoid new infrastructure machinery unless a verified failure requires it.

## Measurement contract

- Baseline is the current working tree, including pre-existing Dashboard, reservation, API, fixture, and test-audit work. The pre-existing patch and status are saved privately under `.tmp/performance-2026-09-27/`.
- Web: production app build, route bundle sizes, representative authenticated loading/navigation, request counts and browser timings where isolated authenticated access is available. Keep server/network latency separate from browser work.
- iOS: required iPhone 18 Pro Max simulator, fixed fixture datasets, launch/Items/equipment interaction metrics, plus focused native computation measurements for evidenced hotspots. Simulator numbers do not establish physical-device performance.
- Repeat the same scenario and configuration before/after; record raw samples, median/range, dataset size and limitations. Do not infer runtime wins from source changes or mock timings.
- Keep permissions, cache privacy, custody, payloads, loading/error behavior, and user-visible output stable. Choose changes only after inspecting owners and consumers.

## Work sequence

- [x] Inventory existing instrumentation and contracts; capture available web/iOS baselines.
- [x] Rank current bottlenecks with evidence, including overlap with active work.
- [x] Implement bounded web and native slices; record files and contracts before editing each slice.
- [x] Repeat benchmarks and relevant functional/source-contract checks.
- [x] Run TypeScript, lint, app-only build, native target builds/tests, docs and diff checks; retain the existing full-lint failure separately.
- [x] Save a local review of measured results and reconcile affected area acceptance/remaining boundaries.
- [x] Provision and pin the approved isolated preview; verify shared handoff, reuse, migration health, authentication and storage.
- [x] Measure authenticated route/API behavior and retain a reusable benchmark command.
- [ ] Capture realistic photo-heavy Release traces on the physical iPhone 16 Pro.

## Measured bottlenecks

- Web shared query provider changed its hierarchy after mount, remounting the authenticated subtree and repeating work in the browser fixture.
- Web shared shell imported optional profile/badge surfaces eagerly; controlled production builds showed lower initial JavaScript after deferral.
- iOS successful-response decoding occupied the UI actor, and concurrent image consumers duplicated requests and image allocations. The broad existing UI scenarios remained within observed variance.

## Selected implementation slices

- Web cache lifecycle: shared provider + persistence options; real SSR/browser regression owns mount, request, cache restore and denied-storage behavior. Passed all 20 after trials; cold query/effect requests 2 -> 1, warm query requests 1 -> 0.
- Web optional UI loading: `ProfileCompletionWizard` becomes a lightweight gate, with the original form moved to `ProfileCompletionDialog`; load only on a required automatic prompt or retained manual-open request. Lazy-load badge artwork only when a reward exists. Preserve fields, validation, snooze, form state, prompt policy, and focus behavior. Verify manual/automatic opening and compare production route bundles.
- iOS response decoding: `APIClient.swift` success decoder runs concurrently with Sendable response envelopes; recheck session ownership and cancellation after the worker hop. Keep API keys, dates, failure handling and payloads unchanged. Native tests own off-main execution, malformed payloads, concurrent isolation and 30/300/3,000-asset samples; the existing request-ownership source test guards the caller's post-await boundary. At 300 rows baseline decoding is about 2.5 ms; the 3,000-row stress fixture occupies the main actor for about 24 ms. This removes UI blocking, not total decoding CPU or network latency.
- iOS shared thumbnail loading: `ThumbnailLoader.swift`, its direct consumers, and new native `ThumbnailLoadingTests`. First extract the existing load sequence unchanged to a cache-owned method and reproduce duplicate concurrent loads. Then coalesce by URL/size/scale, preserve bounded caches, retry failures, and reject downloads crossing sign-out. Test authoring gate: actual download count, shared image allocation, scale correctness and sign-out isolation are observable contracts; URLSession's protocol fixture supplies bytes only, not the behavior under test. Register native tests in the explicit project without replacing its existing changes.

## Evidence and remaining boundaries

- Web slice 1 owns `src/components/QueryProvider.tsx`, `src/lib/query-client.ts`, and the real-browser lifecycle benchmark. In five cold and corrupt-cache trials the existing provider mounted twice, issued two effect requests and two query requests, and cancelled the first effect request. Warm cache still issued a premature query. Denied local storage crashed the subtree. Keep one provider through hydration, complete restoration before query fetching, and degrade to in-memory queries when storage is denied. Preserve the dashboard/booking-only persistence allowlist and sign-out clearing.
- Server-side rendering also created 24-hour GC timers for request-local query clients. Disable those server timers using the library's Infinity setting; retain the browser's 24-hour persistence retention.
- Test authoring gate: the browser benchmark protects observable mount/request/cache-hydration behavior, fails on the original implementation, exercises the real provider without production seams, and covers a boundary absent from the existing pure query-client tests.
- Production web build baseline passed. Initial shared-layout-plus-route JavaScript is measured for eight routes. The three existing iOS performance scenarios passed on iPhone 18 Pro Max / iOS 27.0, Debug, with raw samples retained.
- The initial automatic approval rejection was resolved by the user's explicit 2026-09-28 authorization. Provisioning then succeeded through the signed preview workflow; no production or review credentials were used.
- Physical-device, production, and deployment claims remain outside local proof.

## Final results and acceptance

- [Visual review](archive/proofs/performance-web-ios-2026-09-27/review.html) and [full measurement summary](archive/proofs/performance-web-ios-2026-09-27/summary.md) include raw-data links, scope, repeatable commands and exact limits. Review opened in a browser, all four images loaded, no horizontal overflow, and the rendered review was inspected. Both normal and settled-error screenshot pairs are byte-identical; receipts bind image bytes to matching capture settings and declared source snapshots.
- Home initial route-plus-layout gzip JavaScript: **407,302 -> 369,116 bytes (9.4%)**. Seven other routes improved **3.6–7.7%**. Count every unique initial route and ancestor-layout JS chunk; do not substitute Next's page-only summary or claim a load-time percentage.
- Real-provider SSR/browser regression: **20/20 trials passed**, one mount, cold queries **2 -> 1**, fresh persisted queries **1 -> 0**, denied storage usable. Real-form before/after fixture: **6/6 scenarios passed**, including manual/automatic opening, failed-save input retention, snooze and reopen.
- Native cold thumbnail fixture: **24 -> 1 requests and image objects**, with cancellation, sign-out, scale and retry contracts verified. Response decoding runs off the main thread; seven alternating samples at each of 30/300/3,000 assets retain both baseline main-actor duration and new total duration. Total CPU is not reduced.
- Native broad UI measurements: before/after median launch **2.212/2.166 s**, Items CPU **1.028/1.020 s**, equipment CPU **0.931/0.944 s**. Ranges overlap, so no broad speedup claim. Existing fixtures bypass the optimized API/image paths.

### Final gates

| Gate | Result |
| --- | --- |
| Full Vitest | 5,019 passed, one existing gated skip; 702 passing files and one skipped file |
| Production web app build | Passed before and after, no database deployment |
| TypeScript | Passed after build-generated types settled |
| Focused lint | Passed for every changed web source, test and benchmark script |
| Full lint | Existing unchanged `public/qrcode/vendor/jsQR.js:23` error; unrelated warnings remain |
| Final native unit run | 93 XCTest + 93 Swift Testing cases passed |
| Native interaction performance | All three before/after scenarios passed; iPhone 18 Pro Max / iOS 27.0, Debug |
| Final native Release build | Unsigned generic-iOS build passed; no installed-device claim |
| XcodeGen project consistency | Passed; new tests registered with generated IDs, pre-existing HomeAgenda registration retained |
| Native drift and audit gaps | Passed |
| Migration directory check | Passed, local filesystem check only |
| Docs/reference and diff checks | Passed; codemaps current and local report links valid |
| Shared preview | Provisioned, pinned, signed identity verified, migration `0155` applied; no pending migrations; setup/attach reuse and encrypted handoff verified |
| Preview storage and authentication | All three stores passed upload/readback/cleanup; both private stores denied anonymous access; stored synthetic credentials signed in and `/api/me` returned 200 |
| Authenticated route/server measurement | Passed: 55 page checks, eight APIs with five measured reads each plus warmups, no runtime/API/partial-data failures or horizontal overflow; stable current-source production build and synthetic dataset |
| Physical-device and production proof | Not performed |

Raw logs/result bundles and pre-existing-work snapshots remain in `.tmp/performance-2026-09-27/`. No source changes after the final build affect production web behavior; later edits only complete native fixture waits, project registration, captures and documentation. The final unit/Release runs cover the final native source, including account/cancellation checks on both successful and failed response decoding.

### Next bounded slice

The shared preview is ready: `claude/kiosk-multi-lens` owns `br-raspy-sun-au47wnog` and endpoint `ep-bold-dew-aue5cozq`. [Reuse instructions for Claude and Codex](../docs/PREVIEW_ENVIRONMENTS.md#reusable-performance-preview--2026-09-28) point to the existing setup/auth commands and the new `scripts/benchmark-authenticated-preview.mjs`. Benchmark ownership is limited to this new script, documentation and non-secret proof; it reuses the existing signed-environment, migration and process-lock contracts.

[The completed authenticated baseline](archive/proofs/performance-web-ios-2026-09-27/shared-preview.md) retains 55 rendered checks, 40 measured API reads, eight warmups, ten captures, source/build identity and raw request timing. Dataset: 34 users, 160 assets, 20 bookings and 30 calendar events. Signatures is empty. Fresh-browser heading medians range from 181–425 ms; this is after-only local proof, not a before/after or production speedup. Full-network idle was unsuitable for acknowledged background POSTs; data-read settling is explicitly separated. API reads use the browser session because the separate API client did not apply Chromium's secure-cookie exception for loopback.

The 50-item asset list is the largest sampled shared API cost (1,208.7 ms median), followed by Dashboard (663.7 ms). Inspect those query/aggregation paths next, then repeat matched comparisons before editing further. Physical-device Release traces, native preview routing, client-side link transitions and hosted measurements remain separate. The reusable development server remains on its recorded loopback port; the benchmark's separate server and process locks were released. The checkout remains unstaged and uncommitted with unrelated work preserved.
