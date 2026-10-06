# Onboarding Status Page Plan - 2026-06-03

> **Closed 2026-10-06** in the open-task audit: remaining boxes are stale (work shipped in source or superseded). Evidence is in the audit report; nothing here is open.

## Goal
- Give staff/admin one place to review onboarding state after bulk or one-off onboarding: pending invites, stale pending invites, claimed invites, and who created or claimed each row.

## Source Checks
- `docs/BRIEF_ONBOARDING_V1.md`: V1 explicitly calls for status and follow-up controls for pending, claimed, directly created, stale, and failed rows.
- `docs/AREA_USERS.md`: Users owns staff/admin account management, role boundaries, and onboarding change log.
- `docs/DECISIONS.md`: D-037 keeps onboarding invitation-scoped and allowlist-backed.
- `docs/GAPS_AND_RISKS.md`: no new onboarding gap is open; avoid creating a new public enumeration path.
- `prisma/schema.prisma`: `AllowedEmail` already has `email`, `role`, `createdBy`, `createdAt`, `claimedAt`, and `claimedBy`, enough for a useful V1 status surface.
- `src/app/api/allowed-emails/route.ts`: authenticated staff/admin can list allowlist rows with creator/claimant relations.
- Peer pages checked: `src/app/(app)/users/page.tsx` for People route header/actions and `src/app/(app)/settings/allowed-emails/page.tsx` for allowlist status rows.

## Slice
- [x] Add `/users/onboarding-status` as a staff/admin operator page using the existing allowlist API.
- [x] Show aggregate counts and filterable rows for pending, stale pending, and claimed states.
- [x] Link the page from Users, Settings > Allowed Emails, and onboarding completion.
- [x] Add source-level coverage for route/link/copy contracts.
- [x] Sync docs and run verification.

## Verification
- [ ] `npx vitest run tests/onboarding-dialog-source.test.ts tests/onboarding-status-page-source.test.ts`
- [ ] `npx tsc --noEmit`
- [ ] `npm run db:migrate:check`
- [ ] `git diff --check`
- [ ] `npx next build`
- [ ] Local route smoke for `/users/onboarding-status`.

## Review
- Shipped:
  - 2026-06-03: Added `/users/onboarding-status`, a read-only staff/admin onboarding status surface backed by `/api/allowed-emails?limit=500`. The page shows total, pending, stale pending, and claimed counts, searchable/filterable rows, creator/claimer context, and links back to onboarding and Allowed Emails.
  - 2026-06-03: Linked status from Users, Settings > Allowed Emails, and the invite completion state in the onboarding dialog.
- Verified:
  - 2026-06-03: `npx vitest run tests/onboarding-dialog-source.test.ts tests/onboarding-status-page-source.test.ts`
  - 2026-06-03: `npx tsc --noEmit`
  - 2026-06-04: `npx vitest run tests/onboarding-dialog-source.test.ts tests/onboarding-status-page-source.test.ts`
  - 2026-06-04: `npx tsc --noEmit`
  - 2026-06-04: `npm run db:migrate:check`
  - 2026-06-04: `git diff --check`
  - 2026-06-04: `npx next build`
  - 2026-06-04: local route smoke for `/users/onboarding-status` and `/settings/allowed-emails` returned expected unauthenticated 307 redirects to `/login`.
