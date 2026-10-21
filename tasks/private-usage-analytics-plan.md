# Private Usage Analytics Plan - 2026-08-12

## Goal
- Count privacy-light web, iOS, and kiosk product usage without collecting content, search text, record identifiers, device fingerprints, or replay data.
- Give only the explicitly configured product owner access to the usage report. ADMIN status alone must never grant access.

## Route
- Owner area: Reports & Analytics
- Secondary areas: Mobile, Privacy, API, Schema
- Ledger: `tasks/private-usage-analytics-plan.md`
- Existing references: `docs/AREA_REPORTS.md`, `docs/AREA_MOBILE.md`, `src/app/privacy/page.tsx`

## Source Checks
- Operational reports currently aggregate durable business records and do not answer cross-platform product-usage questions.
- Web/server Sentry is diagnostics infrastructure, while native iOS explicitly has no generic tap analytics or session replay.
- `INTERNAL_OPERATOR_EMAILS` can grant hidden-user privileges to more than one person, so usage analytics requires a separate default-deny owner allowlist.
- Badge awards remain server-authoritative and separate from product telemetry.

## Stop Conditions
- Stop if analytics access can be obtained from role alone or if the owner allowlist is absent and access fails open.
- Stop if an event property can contain free-form user content, URLs, search terms, record identifiers, or scanned values.
- Stop if telemetry failure can block an operational mutation or signed-in app workflow.
- Stop if the current migration chain or Prisma schema contradicts the planned append-only event model.

## Slices
- [x] Slice 1: Add the append-only, bounded `ProductEvent` schema and migration.
- [x] Slice 2: Add an authenticated allowlisted ingestion service and owner-only aggregate report endpoint.
- [x] Slice 3: Add shared web instrumentation for app opens and normalized surface views, plus native iOS app-open and tab-view events.
- [x] Slice 4: Add a private web Usage report discoverable only by the configured owner.
- [x] Slice 5: Add focused authorization, validation, aggregation, source-contract, privacy, and documentation coverage.

## Follow-up: Owner App Activity & Client Report - 2026-08-21

### Goal
- Give the configured product owner a Settings report that answers which roster users have opened the app, which iOS clients they have used, their coarse device and OS identity, installed marketing/build version, and best-effort TestFlight versus App Store channel.
- Keep the existing `/reports/usage` aggregate report unchanged. This is an explicit owner-only named-support/adoption view, not a broad behavioral analytics expansion.

### Contracts
- Add a durable `UserAppInstallation` record keyed by a secret-scoped server-HMAC of a client-generated installation key; never store UDID, serial number, IDFA, receipt contents, or raw installation keys. Keep it stable across annual event-identity rotation so one installation does not become duplicate rows every January.
- Store only allowlisted app identity fields: platform, marketing version, build, OS version, coarse hardware model, release channel, and first/last/last-opened timestamps.
- Compare iOS freshness against `IOS_LATEST_APP_VERSION` / `IOS_LATEST_APP_BUILD` when set; otherwise use the live App Store version and the newest build reported for it, then the newest App Store build seen. The page labels which source it used. Xcode (development) builds are never "behind". (Updated 2026-10-21.)
- Owner access remains the separate `USAGE_ANALYTICS_OWNER_EMAILS` allowlist. Role, `ADMIN` status, and hidden-user access must not grant this report.
- Telemetry remains best effort: an app-activity write failure must not block the existing product event or signed-in workflow. Channel classification may be `unknown` when the receipt signal is unavailable.

### Slices
- [x] Add `UserAppInstallation` schema/migration and update the ingestion allowlist.
- [x] Send installation/build/device/OS/channel metadata from web and native iOS app-open events.
- [x] Add the owner-only Settings report, navigation/search/breadcrumb guards, and focused tests.
- [x] Update the Settings, Reports, Mobile, Privacy, decision, and risk contracts.

### Verification
- [x] Focused service, route, Settings authorization, telemetry source-contract, and iOS source-contract tests.
- [x] `npx prisma format`, `npx prisma validate`, migration checks, TypeScript, lint, docs verification, and `npm run build:app`.
- [x] Wisconsin build for the available `platform=iOS Simulator,OS=26.5,name=iPhone 16 Pro` destination; the unpinned destination resolves as unavailable in this Xcode install.
- [ ] Authenticated owner/non-owner Settings proof after migration and owner configuration; report TestFlight/App Store classification on a real signed build remains a separate acceptance gate.

### Review
- Verified locally: 44 focused web/report tests, 49 native/API contract tests, Prisma validation, migration-prefix checks, TypeScript, lint, codemap/docs checks, web build, iOS project/drift checks, and the pinned iPhone 16 Pro simulator build.
- Deferred: The local browser redirected to sign-in and the deployed host does not yet contain `/settings/app-activity`; no credentials, migration, owner environment configuration, or production data were changed.
- Remaining acceptance: Apply migration `0129_app_activity_report`, configure `IOS_LATEST_APP_VERSION` / `IOS_LATEST_APP_BUILD` and the owner allowlist, then verify owner/non-owner access in an authenticated deployment and channel classification on signed App Store/TestFlight builds.

## Verification
- [x] Focused Vitest route, service, UI-contract, and iOS source-contract tests.
- [x] `npx prisma format`
- [x] `npx prisma validate`
- [x] `npm run db:migrate:check`
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [x] `npm run codemap`
- [x] `npm run verify:docs`
- [x] `npm run build:app`
- [x] `npm run drift:ios`
- [x] `npm run audit:ios:gaps`
- [ ] Wisconsin build for `platform=iOS Simulator,name=iPhone 16 Pro`
- [ ] Authenticated browser smoke for owner access, role-only denial, and event ingestion, or record why unavailable.
- [x] `git diff --check`

## Review
- Shipped: Local schema/migration, strict ingestion, yearly-pseudonymous identity/session storage, owner-only aggregate API and Usage page, web app/surface counts, native app/tab counts, privacy disclosure, and nightly 90-day retention.
- Verified: Focused Vitest suites, Prisma format/validate/generate, migration-prefix check, TypeScript, ESLint, codemap/docs checks, production app build, iOS project consistency, drift, audit-gap inventory, and whitespace checks.
- Deferred: Production migration deployment, owner environment configuration, deployment, and data-backed runtime inspection were not authorized.
- Blocked: Exact iPhone 16 Pro build is blocked by pre-existing Swift 6 Sendable errors in `ios/Wisconsin/Views/ReportsView.swift`; the new analytics Swift compiled without a reported error. Authenticated browser proof requires the migration plus explicit owner environment configuration.
- Proof artifacts: Vitest 11/11 focused tests plus 40/40 native/API source tests; `npm run build:app` includes `/api/product-events`, `/api/reports/usage`, and `/reports/usage`.
- Next slice or stop: Configure `USAGE_ANALYTICS_OWNER_EMAILS` for Erik only, apply migration `0112`, deploy compatible server/web/native clients, then perform owner and non-owner authenticated acceptance proof.
