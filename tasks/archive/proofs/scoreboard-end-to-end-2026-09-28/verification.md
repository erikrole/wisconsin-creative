# Scoreboard pass verification

Completed September 28, 2026 (America/Chicago). Changes remain local and uncommitted in the existing dirty checkout. See [review.html](review.html) for matched comparisons and explicitly labeled after-only recovery states; see the [completed plan](../../completed-2026-09-28/scoreboard-end-to-end-pass-2026-09-28.md) for scope.

## Results

| Gate | Result and evidence |
| --- | --- |
| Focused web/API/source contracts | **123 passed in 13 files.** [focused-tests.txt](focused-tests.txt) covers Scoreboard services, routes, URL filters, native wiring/ownership, and recorded-worker dependencies. |
| Actual PostgreSQL | **3 Scoreboard + 8 existing custody checks passed.** [postgres-tests.txt](postgres-tests.txt). Disposable local cluster with strict temporary socket/database guard; no external database. Scoreboard cases cover SQL NULL title semantics, unofficial exclusions, hidden workers, canonical dimensions, deterministic pagination, and team/person/profile agreement. |
| Native builds and XCTest | **17 model tests + 3 UI workflows passed.** [native-tests.txt](native-tests.txt). Wisconsin and WisconsinPerformance built for iPhone 18 Pro Max on iOS 27.0. Workflows cover states/clear, all four team filters carrying into the named person, and failed Away read retaining the old record then recovering on Retry. |
| Authenticated local browser | **Six check groups passed; zero page errors.** [browser-checks.json](browser-checks.json). Existing managed Preview, hidden Admin session, synthetic data. Real reads cover navigation/context, result-less history, parameter validation and matching work. Controlled failure/paging HTTP responses cover recovery, deduplication and terminal cursors. Tablet 834px and phone 390px documents fit without horizontal overflow. |
| TypeScript | `tsc --noEmit --pretty false` passed. |
| Lint | Changed TypeScript files passed. Whole-repository lint still fails on the existing `public/qrcode/vendor/jsQR.js:23` `@next/next/no-assign-module-variable` error; unrelated warnings remain. |
| App build | `node scripts/run-next.mjs build:app` passed after the final retry-banner adjustment. This app-only build does not run shared database deployment steps. |
| Documentation | Generated codemaps are current; docs verification and `git diff --check` passed. |
| Visual proof | Four hash-bound matched pairs: desktop team, tablet team, desktop person and native season overview. Every selected image was inspected. Failure/context states without matching baselines are labeled after-only. |

## Reproduction

Node 22 was used because the shell's default Node differs from the project's runtime. The following commands assume Node 22 is on PATH.

```sh
node node_modules/vitest/vitest.mjs run tests/scoreboard*.test.ts tests/team-scoreboard*.test.ts tests/game-record.test.ts tests/ios-scoreboard-wiring.test.ts tests/ios-async-request-ownership.test.ts tests/event-worker*.test.ts --reporter=dot
node scripts/test-custody-postgres.mjs
node node_modules/typescript/bin/tsc --noEmit --pretty false
node scripts/run-next.mjs build:app
node scripts/generate-codemaps.mjs --check
git diff --check
```

Native commands use the required device, with a separate temporary derived-data directory:

```sh
xcodebuild test -project ios/Wisconsin.xcodeproj -scheme Wisconsin -destination 'platform=iOS Simulator,name=iPhone 18 Pro Max' -derivedDataPath .tmp/scoreboard-pass/native-build -only-testing:WisconsinTests/ScoreboardModelsTests
xcodebuild test -project ios/Wisconsin.xcodeproj -scheme WisconsinPerformance -destination 'platform=iOS Simulator,name=iPhone 18 Pro Max' -derivedDataPath .tmp/scoreboard-pass/native-build -only-testing:WisconsinUITests/ScoreboardScreenshotUITests
```

Local browser scripts and full build/XCTest logs are under `.tmp/scoreboard-pass/`; authentication state stays there and is intentionally excluded from this proof directory. The browser test was rerun successfully after a transient local Next development route returned 404 during rebuilding. Final recovery captures include the corrected alert description placement.

## Evidence boundaries

- The web matched pairs use the same Preview dataset, role, route, viewport, appearance, fixed clock and scroll position. The native pair uses the original 27-game fixture and optional-field compatibility fallback, at the same device/appearance/text size/scroll position. Source declarations are retained separately from runtime test receipts.
- Native fixtures isolate the API response path. They do not prove authenticated production totals, Student/Collaborator access, iPad layout, notifications or physical-device behavior.
- GAP-71 owns production Student/Collaborator reads, authenticated native totals and regular-width iPad acceptance. No commit, push, deployment or distribution was performed.
- No schema or ESPN integration was introduced. Official results still originate from Wisconsin calendar W/L/T markers; participation comes from Schedule assignments and recorded workers.
- Shared dirty files were edited only for the required Scoreboard additions. The sole shared AppShell change is `min-w-0` on the header search button to fix the observed tablet overflow.
