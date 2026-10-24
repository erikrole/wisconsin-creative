# Crash and Error Reporting Area

## Document Control
- Area: Crash and error reporting, Issues triage, Report a problem
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-10-21
- Status: Active. Web and server shipped in #547. iPhone, kiosk and Mac capture is in #557.

## Direction
All crashes, errors and problem reports go through one first-party pipeline in Neon. There is no paid service: Sentry is wired in code but has no DSN in production. Each report carries what's needed to reproduce it: the version, device, person, screen, request id and recent actions. Reports are grouped by cause so a repeat problem is fixed once. Admins triage them at `/issues`.

## Core Rules
1. **Grouping.** `error_issues` has one row per fingerprint. The fingerprint is sha256 over platform, kind, name, the normalized message, the culprit, and `groupingParts`. Normalization strips URLs, emails, ids, hex and numbers. Web culprits are route templates. MetricKit groups by bundle id plus the top app binary, never by offsets, so a crash keeps one issue across builds.
2. **Bounded storage.** At most 20 stored occurrences per issue per hour (the count still increments), the newest 50 kept per issue, and 90-day retention. Problem reports are kept 365 days. Pruning runs in `morning-refresh`.
3. **Regression.** A fixed issue reopens only for an occurrence that happened after `resolvedAt`. That stops late MetricKit deliveries from reopening it.
4. **Privacy.** Reports never include typed text, request bodies, query strings or passwords. Breadcrumbs keep the method, path template and status. Kiosk screens record only the screen's case name. Erasing an account unlinks its error events and deletes its problem reports.
5. **Never fail the request.** Server capture runs after the response with `waitUntil`. Clients send best-effort and throttle themselves.

## Sources
| Source | Path | Person |
| --- | --- | --- |
| API 500s | `failRequest` in `src/lib/api-handler.ts` | Signed-in user |
| Render and server-action failures | `onRequestError` in `src/instrumentation.ts` (skips `route` and expected 4xx) | From the browser report with the same digest |
| Browser errors and error boundaries | `src/lib/error-reporting/client.ts` → `POST /api/errors` | Signed-in user |
| iPhone MetricKit | `AppMetricMonitor` → `POST /api/diagnostics` | Signed-in user |
| iPhone unreadable responses | `APIClient.reportDecodingFailure` → `POST /api/errors` (once per endpoint per launch) | Signed-in user |
| Kiosk MetricKit | `KioskMetricMonitor` → `POST /api/kiosk/diagnostics` (`withKiosk`) | None; carries kiosk name and location |
| Mac menu bar MetricKit | `GearOpsMetricMonitor` → `POST /api/companion/diagnostics` (companion bearer) | Companion's user |
| Report a problem | Web account menu, crash screen, iPhone Settings → `POST /api/support-reports` | Signed-in user |

## Native Recent Actions
`ios/Wisconsin/Shared/DiagnosticBreadcrumbs.swift` is compiled into the iPhone app, the kiosk, and the Mac app (via `macos/project.yml`). It keeps the last 30 actions of a run on disk under `session-<pid>.json`, for the last five runs. MetricKit reports a crash on a later launch, so uploads send the recent runs. The server attaches the matching run's actions to each diagnostic by `diagnosticMetaData.pid` (`parseMetricKitPayload`). A crash from a run the app no longer remembers gets no actions rather than the wrong ones.

## Cost
Everything lives in Neon tables (`error_issues`, `error_events`, `support_reports`), with caps on every route. `/api/companion/diagnostics` is the only companion route that writes to Neon, and it only runs after a crash, at most once a day.

## Triage
`/issues` (admin, `diagnostics.manage`) has two tabs, crashes and errors and problem reports. Issue detail shows the occurrence browser, the "What happened before" timeline, the stack with `atos` commands for native frames, versions, people, and notes. Mark fixed, Ignore and Reopen are audited. Admins get an inbox notification for new and regressed issues and for new problem reports.

## App Store
App Privacy should declare Crash Data and Performance Data (hang and slow-launch reports), both linked to the user, for App Functionality, and not used for tracking. See `tasks/app-privacy-data-inventory.md`.
