# Radio Clip identity

Status: implemented locally on 2026-10-02; not migrated, deployed, or authenticated against a live account.

## Policy

Wisconsin Creative hosts the macOS sign-in handoff. `User.radioClipEnabled` defaults to false for every account, including Admin. Active Admin/Staff/Student accounts with explicit access may sign in; Collaborator is denied. Admin/Staff have `canPublish`; Student has draft access only. This describes policy, not an implemented publication API. Future uploads/publication must recheck the native session and action permission in their committing transaction.

Only Admin may grant/revoke access through `PATCH /api/radio-clip/access/:userId` with `{ "enabled": true|false }`. It uses browser authentication, same-origin protection, `radio_clip.manage_access`, serializable mutation and audit. Revocation removes the user's native sessions and outstanding codes. No People UI toggle or automatic account grants are included.

## Version 1 handoff

1. The Mac generates independent state and PKCE verifier, then opens `/radio-clip/authorize?state=...&codeChallenge=...` with ASWebAuthenticationSession. The verifier stays in memory. Fixed callback: `com.wisconsincreative.radioclip:/authorize`.
2. The browser page uses existing login with a validated first-party return path and explicit Continue to Radio Clip approval. Password recovery and onboarding retain existing destinations; restart native sign-in after completing them.
3. Browser `POST /api/radio-clip/authorize` rechecks the real session, denies role preview, and issues a two-minute code bound to the S256 challenge. Prior outstanding codes for the same browser session are replaced. Only a keyed hash is stored.
4. Native `POST /api/radio-clip/token` exchanges `{code, codeVerifier}`. A serializable transaction rechecks access/expiry, consumes the code and creates a scoped session. Response: `{version:1, token, expiresAt, user:{id,name,email,role,canEditDrafts,canPublish}}`. No codes/tokens in audit snapshots.
5. `GET /api/radio-clip/session` accepts only scoped Bearer tokens, rechecking account activity, forced-password state, entitlement, current role, native and parent browser expiry. Web cookies cannot authorize it; native tokens cannot authenticate existing web routes.
6. `DELETE /api/radio-clip/session` idempotently revokes the possessed token, even with the feature gate disabled. No caller-supplied session ID is accepted.

Sessions expire no later than the parent browser session (12 hours, or 30 days with Remember Me) and no later than 30 days. There is no refresh token in this slice. Deleting a parent browser session cascades to native grants/sessions, retaining existing password-reset, deactivation and session-revocation behavior. Browser signout or re-login can require native sign-in again.

## Native lifecycle

Credentials live only in Keychain, partitioned by bundle ID and server origin, with device-only accessibility. API transport requires HTTPS, shares no browser cookies/cache and refuses redirects. The app validates exact callback path/scheme, state, unique query items and code shape. Cancellation invalidates the operation; late results cannot replace newer state.

Signout records durable local intent before network work. Failed remote revocation retains the credential solely for retry when Settings reopens; it cannot restore an account or be replaced by another login. Failed Keychain cleanup stays signed out. Offline failures retain identity but remove verified status. Local projects stay available and are not silently attributed or uploaded to a signed-in account. Account-scoped caches/queues are future work.

## Rollout and verification

Migration `0163_radio_clip_sign_in` is additive, generated from local schema diff, not applied. Apply it through supported wrappers to a Radio Clip-owned preview first. Set `RADIO_CLIP_AUTH_ENABLED=true` only for that accepted target; unset/false fails closed. Grant a chosen test account through the Admin API. Native preview builds can set HTTPS `RadioClipIdentityOrigin` in Info.plist; default is `https://wisconsincreative.com`.

Verify student/staff/admin/disabled/revoked accounts, password and passkey roundtrips, cancellation/replay, PostgreSQL concurrent consumption, Keychain persistence, offline logout retry and parent-session revocation. Production migration/deployment/grants and native installation remain separately authorized actions.

Local evidence: 96 web tests across nine auth/regression files; TypeScript and compile-only Next build passed. Changed-file lint passed; full repo lint has an existing error in vendored `public/qrcode/vendor/jsQR.js`. Prisma validation/client generation/migration filename checks passed. Native full suite: 338 tests, 25 skips, no failures; release staged, not installed. Independent review found and verified the fix for cancellation during signout; final callback catch also guards stale status updates.

Conditional consume concurrency is mocked in unit tests, not PostgreSQL race proof. No migration applied, entitlement granted, or real browser-to-native account roundtrip performed. Existing preview belongs to `fix/kit-travel-case-and-battery-search`; inspected read-only, not migrated or reused. Shared sync/publication and CLI login/logout/whoami remain pending.

## Missing-page correction — 2026-10-02

Native sign-in now calls public `GET /api/radio-clip/availability` before opening a browser. It requires `{version:1,available:true}`; the endpoint returns the rollout flag without database/account access and with no-store. Missing endpoints, disabled rollout or invalid responses keep the user in Settings with an unavailable message. Cancelling a pending check invalidates its operation so a late response cannot open a browser.

Verified live production returns 404, and the isolated fixed native build visibly handled it in Settings without opening Safari. Focused verification: ten native tests and 27 backend tests passed; both release/compile-only builds and TypeScript passed. The correction is staged locally, not installed or deployed.
