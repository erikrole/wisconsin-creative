# PR #620 security review results

Reviewed 2026-10-23. PR: https://github.com/erikrole/wisconsin-creative/pull/620

## Native follow-up update — 2026-10-23

The user subsequently authorized the native invite-link implementation. The known compatibility finding below is now addressed in the local, uncommitted follow-up: trusted HTTPS link intake, token-aware discovery/registration, native resend and stale-link recovery, and explicit signed-in account switching. The email's primary/browser fallback includes an AASA-excluded `web=1` flag; updated-app setup is a separate explicit action. This preserves a browser-owned path for installed 1.4 clients while the new native binary awaits a later release. See [native implementation and verification](../../tasks/archive/native-invite-pr620-2026-10-23.md). Local verification now includes 29 Swift tests, four native UI scenarios, 861 native/companion/email contracts and simulator/unsigned iOS release builds. Live inbox, database and physical association remain separate gates. No merge, deployment or release occurred. The original review below remains as historical evidence of the pre-follow-up source.

## Original review verdict

Keep this draft out of the production onboarding rollout until the native invite-link contract is coordinated. One known, high-confidence P1 compatibility blocker remains. The small fixes below are local and uncommitted on `claude/project-thread-wz96o0`; nothing was pushed, merged or deployed.

Reviewed head: `7bf5f38658611eb7da72a71c482f1514b7e03bc8` (the handoff's `eb22fc0` predates the docs handoff commit). Base: `ab9aa36bc8899aaa500ab94fc1a134518284a386`. GitHub still reported the same head at closeout. CI run 39967195880 passed on that head; the iOS build was skipped. Hosted checks do not contain these uncommitted fixes.

## Historical compatibility finding (pre-follow-up source)

### P1 — Released iOS 1.4 (36) cannot complete native account creation after this backend change

Trigger: a student with a pending invitation enters their email in the native app, continues to account creation and submits a name/password.

- The new server guard at [register/route.ts:64](../../src/app/api/auth/register/route.ts#L64) requires `inviteToken`.
- [APIClient+Auth.swift:33](../../ios/Wisconsin/Core/APIClient+Auth.swift#L33) sends only name, email and password. Discovery also sends no invite token.
- [AuthDiscoveryResult:158](../../ios/Wisconsin/Core/APIClient.swift#L158) ignores the new `inviteLink` field. [LoginView.swift:98](../../ios/Wisconsin/Views/LoginView.swift#L98) therefore still opens native registration for `flow: onboarding`, including `inviteLink: required`.
- Emailed `/login?email=...&invite=...` links stay in the browser: the app's associated-domain paths and native route parser do not accept this auth route. The relevant native files match released build 36's source at `84586e71f`.

Result: every such registration returns `403 INVITE_LINK_REQUIRED`; retrying cannot add the missing proof. The 403 decoder reads the server message ([APIClient.swift:511](../../ios/Wisconsin/Core/APIClient.swift#L511)), SessionStore catches it ([SessionStore.swift:163](../../ios/Wisconsin/Core/SessionStore.swift#L163)), and the form displays it ([NativeAuthViews.swift:199](../../ios/Wisconsin/Views/NativeAuthViews.swift#L199)). This is source evidence for graceful error handling, not an executed device/no-crash test.

This gap was already acknowledged in the PR/handoff. The note saying to fix it “before build 36” is stale because 1.4 (36) is already released. Coordinate an invite-aware native update and its release before enabling this backend contract for native onboarding. Completing account creation through the secure emailed web link, then signing in natively, is a source-supported operational workaround; it does not restore the native sign-up flow. Do not remove the inbox-proof check to accommodate the old client. At the original review boundary, a native auth implementation/release exceeded the small-bug slice. The implementation was subsequently authorized and is addressed locally in the follow-up above; a released native update is still required.

## Small bugs fixed locally

| Finding | Before | Local correction |
| --- | --- | --- |
| P2: rotated or newly expired token accepted by an in-flight registration | Token was checked before bcrypt; the transaction later claimed the invitation by ID alone. A resend during hashing could retire the link, yet the old request still created an account. | Claim uses the exact validated hash and issue timestamp, `claimedAt: null`, and the live 30-day cutoff. A failed conditional update throws inside the user-creation transaction. The transaction is Serializable with the existing bounded serialization retry. |
| P3: resend could restore a token after a claim | A caller could read a pending invite, lose a race to registration, then issue a token with an unconditional update. | Token issuance updates only an unclaimed invitation and returns null otherwise; no misleading sign-up email is sent. |
| P2: invite preparation errors escaped the delivery-status contract | A token-write/render exception escaped a helper documented to never throw, potentially returning a request failure after the invitation had already been created. | Preparation and send failures return `failed`; logging contains no address, raw token or exception payload. |
| P3: email recovery falsely said “Link sent” | An unconfigured provider response displayed an unavailable message while the disabled button still claimed delivery. Malformed 200 responses could also appear successful. | Unconfigured email displays “Email unavailable”; missing/invalid confirmation remains retryable with a clear error. |

Independent schema/concurrency review confirmed that the conditional claim and conditional issuance close the two races. External session/email effects remain outside the retried transaction. The tests exercise controlled storage boundaries; actual PostgreSQL conflict/rollback behavior was not executed.

## Requested security checks

| Area | Result and evidence boundary |
| --- | --- |
| Inbox proof / lifecycle | Route/service tests cover missing, wrong, actually expired and cleared tokens, valid registration, clearing on claim, resend invalidation, rotation during bcrypt and expiry during bcrypt. The registration tests now call the actual token matcher rather than mocking its decision. |
| Collaborator and hiring paths | Registration retains the allowlist/unclaimed/existing-account checks and ACTIVE collaborator policy requirement before token validation. Hiring passes the `AllowedEmail` ID, not the application ID. Add/resend/hiring call sites supply the ID; reminders do not mint tokens. |
| Public responses | Unknown and existing addresses use the same password discovery flow and failed-login response. Pending-invite `flow`/`inviteLink` and the token-required registration 403 are the documented D-037 exceptions, not proof of a registered account. Resend keeps a generic response for unknown, claimed, existing and inactive-policy targets, with no email sent. Provider-unconfigured disclosure is global. |
| Abuse controls | Email is schema-normalized before the per-email key; resend uses shared `getClientIp`, 3/hour/email and 20/15 min/IP. Limiter tests pass. Redis failure uses bounded per-process memory: this is availability fallback, not a cluster-wide limit guarantee. |
| Audit / mail | Public resend records target invitation ID, IP and delivery status without the email/raw token. The mail helper renders an encoded inbox-token URL. No real email was sent during review. |
| Wiscard visibility | Serialized responses omit the restricted keys for another student, preserving self/staff/admin access. Native directory decoding and profile-completion consumers tolerate omission; no relevant menu bar client dependency was found. |
| Admin reset | Source and route tests verify deletion of sessions, passkeys and pending reset links inside the existing transaction; audit records counts, not the temporary password. Companion revocation failure still reports the existing actionable 503. |
| Failed-login cost | Both unknown-email and wrong-password paths perform one cost-10 bcrypt comparison and return the same 401 text. A local comparison-only benchmark is recorded below; it does not establish identical full-request timings. |
| Migration | Two nullable columns and a nullable unique hash index are additive. Prefix validation passed for 208 migrations. No migration was applied and no database was contacted. |

## Verification

- Focused security suite: **115 tests passed across 17 files**. Includes register/token/email/resend/discovery, Allowed Emails/hiring, Wiscard/reset, companion/login, rate-limit and public-route contracts, email-first UI source and release-note checks.
- Regression evidence: the new bug cases failed against the pre-fix source, then passed after the fixes. Token-test mock typing was subsequently corrected; that file's 3 tests and lint passed again.
- `npx tsc --noEmit --pretty false --incremental false`: passed.
- ESLint on all changed production/test files: passed.
- `build:app` through `scripts/run-next.mjs`, with the repository DB-free environment and production mode: passed. Database, integration and email credentials were explicitly blanked; the full migration-running `npm run build` was not used.
- Build warnings are pre-existing unused variables in utilization charts, kiosk dashboard and bookings-checkin, plus the Sentry import deprecation. No build error.
- Production-build Chromium fixtures at 390×844: **8 scenarios passed**, no page errors. Covers missing/stale/valid invite, hidden credentials/remember-me, one resend, Change reset, token forwarding, generic failed-login hint, unconfigured provider and malformed response recovery. All auth responses and welcome navigation were intercepted; no real registration, persistence or inbox delivery was exercised.
- [Matched local UI review](../../tasks/archive/proofs/security-pr620-2026-10-23/review.html): both images and the generated page were rendered and inspected; no horizontal overflow. The receipts bind image hashes to revision/local patch and matched capture settings. The preliminary dev-server multi-scenario runs were interrupted by Fast Refresh; the complete passing run uses the stable production build.
- Local bcrypt benchmark: 10 samples/path after warmup, unknown-hash median **52.51 ms**, known/wrong-password median **52.57 ms**. Database/HTTP/network time excluded.
- `npm run verify:docs` after regenerating affected codemaps, plus `git diff --check`: passed.

Proof folder: [security-pr620-2026-10-23](../../tasks/archive/proofs/security-pr620-2026-10-23/). `browser-results.json`, `password-comparison-timing.json`, source patches/capture receipts and the repeatable `login-fixture-qa.mjs` are retained there. Fixture script assumes the DB-free local app on port 3131.

## Scope and handoff

The original checkout and unrelated onboarding worktree were preserved. No production data, Neon integration, preview database, student invitations, release settings or existing App Store release were changed. The PR body states that the six arriving students have not yet been invited; production invitation inventory was deliberately not queried. This review does not change the status of the already released 1.4 app against today's production backend.

Local edit size (before generated docs/evidence): production **43 added / 14 removed**, tests **125 added / 6 removed**. New coverage protects the two token races and preparation failures at their owning boundaries; no production-only test seams were added. No tests were deleted.

Original next slice: native invite-link intake/token forwarding/recovery. The local implementation is now prepared as described above; coordinated backend/app rollout and real inbox/device proof remain pending. Preserve the inbox-proof requirement. Erik retains merge authority.
