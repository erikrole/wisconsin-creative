# Codex handoff: review PR #620 (security pass fixes)

Repo: erikrole/wisconsin-creative. PR: #620 (draft), branch `claude/project-thread-wz96o0`, head `eb22fc0`. Review for correctness and security regressions; fix only small, clear bugs on this branch and report everything else. Do not merge (Erik merges). Do not touch production data or the Neon integration.

Background: a full security review (web, API, iOS, kiosk, menu bar app, static tools, dependencies, deploy config) found one high finding and a few mediums. All fixes are in this one PR. The high finding: invite sign-up only checked that an email was on the allowlist and unclaimed, so anyone who learned an invited campus address could claim that account and its role. Erik chose "token in the invite link".

## What changed

Invite link required to claim an account:
- `prisma/schema.prisma` AllowedEmail: `inviteTokenHash` (unique, nullable) and `inviteTokenIssuedAt`. Migration `0203_allowed_email_invite_token` (two nullable columns plus a unique index, additive).
- `src/lib/services/invite-token.ts`: `issueInviteToken` mints a 32-byte random token, stores its HMAC hash on the invite row, returns the raw token; `inviteTokenMatches` compares the HMAC hash (plain string compare of hashes, the same pattern sessions use) and the 30-day life.
- `src/lib/services/invite-email.ts`: `sendInviteEmail({ email, name, kind, allowedEmailId })` mints a fresh token when `allowedEmailId` is given and appends `&invite=` to the login link. Every invite path passes it: Allowed Emails add (`/api/allowed-emails`), Resend (`/api/allowed-emails/[id]/resend`), Hiring invite (`/api/hiring/applications/[id]/invite`). Setup reminders do not mint tokens.
- `POST /api/auth/register`: refuses with `403 { code: "INVITE_LINK_REQUIRED" }` unless `inviteToken` matches. Claiming clears the token.
- `POST /api/auth/discover`: accepts optional `invite`; for an unclaimed invite returns `{ flow: "onboarding", inviteLink: "valid" | "required" }`. Any address without a pending invite still returns `{ flow: "password" }` so the page never reveals who is invited.
- New public route `POST /api/auth/invite/resend` (`src/app/api/auth/invite/resend/route.ts`): limits `invite-resend:ip` (20 per 15 min) and `invite-resend:email` (3 per hour); same response whether or not the address is invited; says when `RESEND_API_KEY` is missing; audits `invite_link_requested` without the address. Registered in `tests/api-route-wrapper-contract.test.ts` and `tests/public-route-abuse-contract.test.ts`.
- `src/app/login/LoginForm.tsx`: reads `?invite=` from the URL, sends it with discover and register; new step `invite` ("Check your email") with an **Email me my invite link** button; after a failed sign-in on the password step a static hint says to double-check the address or open the invite link.
- `src/lib/validation.ts`: `inviteTokenSchema`, `inviteResendSchema`, `invite`/`inviteToken` fields.

Other fixes:
- `GET /api/users/[id]`: `wiscardNumber`, `wiscardCardNumber`, `wiscardIssueCode` only for self, STAFF and ADMIN (`undefined` otherwise). `UserInfoTab.tsx` hides the Wiscard row for read-only viewers.
- `POST /api/users/[id]/reset-password`: the transaction now also deletes `passkeyCredential` and `passwordResetToken` rows; the audit entry records the counts.
- `POST /api/auth/login`: one bcrypt comparison runs even for an unknown email (fixed dummy hash), and the 401 message is now "Wrong email or password." (was "Invalid credentials"; iOS shows the server text).

Docs: D-037 amendment in `docs/DECISIONS.md`, security requirement 11 in `docs/BRIEF_ONBOARDING_V1.md`, regenerated codemaps, release note `pr: 620` in `src/lib/releases.json`.

## Things worth a second pair of eyes
- Token comparison and expiry in `invite-token.ts`: hash compare, 30-day window measured from `inviteTokenIssuedAt`, token cleared on claim. Confirm a token cannot be reused after a claim and that a reissue invalidates the previous link (single hash column, so the old link must fail).
- Enumeration: `discover`, `register` and `invite/resend` must answer the same for unknown, invited and existing addresses apart from the documented `flow` values. Check error codes and timing.
- Rate limit keys on the resend route use the normalized email; confirm the limiter falls back safely without Redis (in-memory) and that the IP helper is the shared `getClientIp`.
- `register` still runs the existing checks (allowlist, unclaimed, existing user, collaborator policy ACTIVE) before the token check; make sure the token check cannot be bypassed by a collaborator or hiring path.
- The hiring invite path passes `allowedEmailId: inviteId`; confirm that id is the AllowedEmail id, not the application id.
- The Wiscard filter returns `undefined` rather than omitting keys; check nothing downstream (iOS decoding, CSV export) treats `null` and missing differently.
- Reset-password transaction order: user update, sessions, passkeys, reset tokens. Confirm the audit `after` block never includes the temporary password.
- LoginForm: the `invite` step hides password fields and `rememberMe`; make sure Change returns to the identity step and clears `inviteResendMessage`, and that a visit with a stale `?invite=` lands on the `invite` step (not `onboarding`).

## How to run it
- `npm run review 620` (worktree beside your checkout, DB-free: this branch has no preview database and none should be created). `/login` works DB-free; mock `/api/auth/discover`, `/api/auth/login` and `/api/auth/invite/resend` in the browser devtools or Playwright to drive the steps. Screenshots of every step are in the project files folder `security-review/`.
- The real invite -> link -> register flow needs a database. Erik found local Postgres too heavy; rely on the tests unless you already have a working setup.

## QA checklist
- [ ] Register without `inviteToken` -> 403 `INVITE_LINK_REQUIRED`; with the right token -> 201 and the invite row's `inviteTokenHash` is null afterwards; reusing the same token -> 403.
- [ ] Token older than 30 days -> 403; a Resend issues a new token and the old link fails.
- [ ] `discover` with no `invite` for an invited address -> `inviteLink: "required"`; with the right token -> `"valid"`; uninvited address -> `flow: "password"`.
- [ ] `invite/resend`: pending invite -> email sent with a fresh link, audit `invite_link_requested` without the address; claimed invite, unknown address and existing user -> identical 200 body, no email; 4th call in an hour for one address -> 429; missing `RESEND_API_KEY` -> `inviteEmailConfigured: false`.
- [ ] Allowed Emails add with "Email the invite now", Resend, and Hiring invite all produce a link containing `invite=`; setup reminders do not.
- [ ] Login page: `/login?invite=<token>` + invited email -> name/password form; invited email without token -> "Check your email" step, button sends once then reads "Link sent"; Change goes back; uninvited email -> password step; wrong password -> "Wrong email or password." plus the hint line; 390px width has no horizontal scroll.
- [ ] `GET /api/users/[id]` as a student for another student: no Wiscard keys; as self, staff, admin: present. Staff page hides the Wiscard row for read-only viewers.
- [ ] Admin reset-password: sessions, passkeys and pending reset links gone; audit `after.revoked` has the counts.
- [ ] Login with an unknown email and with a wrong password take about the same time; both return the new message.
- [ ] iOS: native register now gets 403 `INVITE_LINK_REQUIRED`. Not fixed in this PR (follow-up: open the invite link in the app before build 36). Confirm the app shows the server message rather than crashing.

## Validation already run
- ✅ `npx vitest run` on the auth, invite, allowed-email, hiring, route-contract and release-note tests (83) plus the Wiscard, reset and login tests (46); CI `validate` (full vitest, build:app) and `postgres-integrity` green on `eb22fc0`.
- ✅ `npx eslint` on changed files; `npx tsc --noEmit`; `npm run verify:docs`; `git diff --check`; migration prefix check.
- ⚠️ Not run: the real invite -> register flow in a browser; iOS build against the new register response.
