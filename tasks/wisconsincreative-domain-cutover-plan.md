# Wisconsin Creative Domain Cutover Plan - 2026-07-01

## Goal
- Move Wisconsin Creative's public identity from the personal `gear.erikrole.com` host to `wisconsincreative.com` before App Store submission and broad onboarding, without stranding native app, kiosk, calendar, notification, or account-recovery flows.

## Route
- Owner area: Mobile Operations, with Kiosk and Notifications as secondary owners.
- Ledger: `tasks/todo.md`.
- Existing plan/archive references:
  - `tasks/archive/completed-2026-06/internal-public-beta-launch-readiness-2026-06-08.md` records production currently aliased to `https://gear.erikrole.com`.
  - `docs/AREA_MOBILE.md` owns native app launch and account-recovery surfaces.
  - `docs/AREA_KIOSK.md` owns kiosk session persistence and activation behavior.
  - `docs/AREA_NOTIFICATIONS.md` owns email sender and generated action links.
  - `docs/BRIEF_ONBOARDING_V1.md` keeps first-time registration web-owned and invite-gated.

## Source Checks
- The app deploys on Vercel with Node serverless runtime and Vercel Cron; `vercel.json` defines only cron paths, not domains.
- `src/lib/env.ts` uses `APP_URL` for generated app links and falls back to `VERCEL_URL` or localhost. `.env.example` now documents `APP_URL=https://wisconsincreative.com`, and `EMAIL_FROM` defaults to `Wisconsin Creative <noreply@wisconsincreative.com>` under the new domain.
- Initial audit found native `APIClient` hard-coded `https://gear.erikrole.com` as the API base and mutating-request `Origin`; Slice 1 moved it to `AppEnvironment.baseURL` and `AppEnvironment.origin`.
- Initial audit found native `KioskAPIClient` hard-coded both the API base URL and cookie host as `gear.erikrole.com`; Slice 1 moved both to the shared `AppEnvironment` canonical host.
- Initial audit found native web handoffs hard-coded `gear.erikrole.com` for forgot-password, register, manage-account, licenses, and personal shift calendar subscription; Slice 1 moved those to `AppEnvironment`.
- D-039 says kiosk sessions intentionally survive reinstalls through Keychain. A host-only flip can make the saved token fail cookie rehydration unless the rollout either keeps the old host alive or provides an explicit migration path.
- D-040 keeps app/web reservation-first and kiosk-owned for custody; no domain cutover work should change custody routes or authentication policy.
- Prisma schema does not need a data model change for this slice; the relevant runtime settings are environment variables and native constants.

## Stop Conditions
- Stop if `wisconsincreative.com` is not configured as a Vercel production domain before live smoke.
- Stop if Cloudflare proxy mode or DNS setup prevents Vercel certificate issuance or produces a redirect loop.
- Stop if native mutating requests fail CSRF origin checks after switching the base URL.
- Stop if kiosk Keychain cookie restoration cannot support a transition without forced reactivation, unless explicit reactivation is accepted as the rollout cost.
- Stop if App Store Connect, APNs, or associated production env settings reveal a second hard-coded production URL outside the repo.
- Stop if authenticated browser smoke cannot prove login, registration, forgot-password, and core protected routes on the new host before onboarding.

## Slices
- [x] Slice 1: Centralize native production host constants.
  - Add one Swift app-host configuration used by `APIClient`, `KioskAPIClient`, Login, Profile, Licenses, and Schedule calendar subscription.
  - Keep `gear.erikrole.com` as an explicit legacy host constant for transition notes, not scattered literals.
  - Add source-contract tests that fail on new `https://gear.erikrole.com` literals outside the transition allowlist.
- [x] Slice 2: Web environment and docs cleanup.
  - Update `.env.example`, `docs/AREA_NOTIFICATIONS.md`, `docs/AREA_MOBILE.md`, `docs/AREA_KIOSK.md`, and `ios/README.md` to name `wisconsincreative.com`.
  - Document required Vercel production env changes: `APP_URL`, `EMAIL_FROM`, and any Resend sender-domain setup if email delivery is enabled.
  - Add a launch runbook checklist for Vercel domain alias, Cloudflare DNS, old-domain redirect/alias, and smoke routes.
- [x] Slice 3: Transition-safe kiosk rollout.
  - Decide whether the first App Store build targets only `wisconsincreative.com` while keeping `gear.erikrole.com` aliased, or whether kiosk clients should attempt legacy cookie rehydration then reissue against the new host.
  - Prefer the simpler approach if we are pre-onboarding: keep both hosts live through first rollout, accept any development kiosk reactivation if needed, and avoid complex dual-cookie code unless a live kiosk fleet already depends on it.
- [ ] Slice 4: Live cutover proof after DNS is ready.
  - Add `wisconsincreative.com` to Vercel and point Cloudflare DNS at Vercel.
  - Verify `https://wisconsincreative.com/login`, `/register`, `/forgot-password`, protected-route redirect, and a signed-in smoke path.
  - Verify iOS simulator sign-in and one mutating request against the new host.
  - Verify kiosk activation or kiosk session continuity on a device/simulator.
  - Keep `gear.erikrole.com` redirecting or aliased until the App Store build is live and known invite links have aged out.

## Verification
- [x] Focused source-contract tests for native host centralization and no stray old-domain literals.
- [x] `npx tsc --noEmit --pretty false`.
- [x] `npm run drift:ios`.
- [x] `npm run audit:ios:gaps`.
- [x] `npm run ios:project:check`.
- [x] Codemap check current; no regeneration needed.
- [x] `npm run verify:docs`.
- [x] `npm run db:migrate:check`.
- [x] `git diff --check`.
- [x] `npm run build:app`.
- [x] XcodeBuildMCP `build_sim` for `Wisconsin`.
- [x] XcodeBuildMCP `build_sim` for `WisconsinKiosk`.
- [x] Public route smoke on `wisconsincreative.com` for `/login`, `/register`, `/forgot-password`, and protected-route redirect.
- [x] In-app browser unauthenticated smoke on the new production domain.
- [x] Native simulator build/install/launch reaches the Wisconsin Creative sign-in screen.
- [ ] Authenticated browser smoke on the new production domain.
- [x] Native simulator sign-in against `wisconsincreative.com`.
- [x] Native authenticated read path shows real production data.
- [ ] Native non-login mutating request against `wisconsincreative.com`.
- [ ] Kiosk activation/session proof against `wisconsincreative.com`.
- [x] Old-domain debt cleanup for active docs and runtime defaults.
- [x] Archive/export signing proof that the App Store build uses production APNs entitlement, not the checked-in Debug/development entitlement.
- [ ] Remove or retire `AppEnvironment.legacyHost` and the default `https://gear.erikrole.com` trusted-origin fallback after the App Store build is live and old invite/account-recovery links have aged out.

## Review
- Shipped: Slice 1 centralizes native production host configuration in `ios/Wisconsin/Shared/AppEnvironment.swift`, switches the main app, kiosk API client, account links, license web handoff, and personal calendar subscription to `wisconsincreative.com`, and includes the shared source in the `WisconsinKiosk` target. Slice 2 updates `.env.example`, iOS README, Mobile, Kiosk, and Notifications docs with the new canonical host and production env guidance. Slice 3 keeps the rollout simple: the first App Store build targets `wisconsincreative.com`, the legacy host stays aliased during rollout, and development kiosk devices can be reactivated instead of adding dual-cookie migration code. Follow-up cleanup aligned the runtime `EMAIL_FROM` fallback, manual iOS walkthrough links, active audit notes, and Slack planning docs with the new canonical host and `APP_URL` contract.
- Verified: Focused native domain source-contract Vitest passed across 5 files and 22 tests. TypeScript, iOS drift, iOS gap audit, Xcode project consistency, docs/codemap check, migration-prefix check, whitespace, `npm run build:app`, and XcodeBuildMCP simulator builds passed for both `Wisconsin` and `WisconsinKiosk`. Public production smoke outside sandbox DNS returned 200 for `/login`, `/register`, and `/forgot-password`, and `/bookings` redirected to `/login`. In-app browser smoke loaded `/login`, `/register`, and `/forgot-password` with no console errors and confirmed `/bookings` redirects to `/login`. XcodeBuildMCP `build_run_sim` installed and launched the main app; runtime UI snapshot first showed the Wisconsin Creative sign-in screen, then after user sign-in showed the authenticated Home dashboard for Erik with live counts and `Dashboard synced now`. User also confirmed the app builds and runs with real production data.
- Deferred: Authenticated browser smoke, native non-login mutating request, kiosk activation/session proof, App Store archive/export signing proof, and eventual legacy host/trusted-origin removal remain for Slice 4 or post-rollout cleanup because they require live credentials, explicit approval for a safe production mutation, a safe kiosk device/session, or a release/archive lane.
- Blocked: No code blocker. Sandbox DNS still cannot resolve `wisconsincreative.com`, but the same route checks pass outside the sandbox and the user's browser can reach the site.
- Proof artifacts: `npx vitest run tests/ios-domain-cutover-source.test.ts tests/ios-login-recovery-links.test.ts tests/ios-licenses-native-page.test.ts tests/ios-tabbar-stability.test.ts tests/ios-guides-native-page.test.ts`; `npx tsc --noEmit --pretty false`; `npm run drift:ios`; `npm run audit:ios:gaps`; `npm run ios:project:check`; `npm run verify:docs`; `npm run db:migrate:check`; `npm run build:app`; XcodeBuildMCP `build_sim` for `Wisconsin` and `WisconsinKiosk`; XcodeBuildMCP `build_run_sim` for `Wisconsin`; XcodeBuildMCP `snapshot_ui` before and after native sign-in; `curl -I https://wisconsincreative.com/login`; `curl -I https://wisconsincreative.com/register`; `curl -I https://wisconsincreative.com/forgot-password`; `curl -I https://wisconsincreative.com/bookings`; in-app browser route smoke.
- Next slice or stop: Finish Slice 4 with authenticated browser smoke, one approved native non-login mutating request, and kiosk activation/session proof.
- 2026-07-08: Independent re-verification for App Store launch readiness. `dig` confirmed `wisconsincreative.com` resolves; `openssl s_client` showed a valid Let's Encrypt cert (issued 2026-07-01, expires 2026-09-29) for `CN=wisconsincreative.com`. Unauthenticated WebFetch smoke confirmed `/login`, `/register`, `/forgot-password`, and `/privacy` all render correctly with no errors, and `/bookings` correctly redirects unauthenticated requests to sign-in. `gear.erikrole.com/login` still serves its own login page (aliased, not yet redirecting), matching the Slice 3 decision to keep both hosts live through first rollout. Extracted the still-on-disk build 18 export (`/private/tmp/Wisconsin-18-export/Wisconsin Creative.ipa`) and ran `codesign -d --entitlements :-` directly against the signed app bundle: confirmed `aps-environment=production`, `get-task-allow=false`, `application-identifier=T26T3G8C7Q.com.erikrole.Wisconsin`, closing the archive/export signing proof checkbox with cryptographic evidence rather than a recorded note. Remaining opens are all credential/hardware-gated: authenticated browser smoke, one approved native non-login mutating request, kiosk activation/session proof, and eventual legacy-host retirement once old invite links age out.
