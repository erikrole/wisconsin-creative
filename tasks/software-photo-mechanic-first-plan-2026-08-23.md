# Software Page Photo Mechanic First Plan - 2026-08-23

## Goal
- Make Photo Mechanic the default Software landing and the visual primary of `/licenses`, with Shared logins as the secondary cabinet.

## Route
- Owner area: Licenses (primary) / Software (secondary)
- Ledger: this plan
- Existing plan/archive references: `tasks/software-vault-plan-2026-08-19.md`, D-052, GAP-69

## Source Checks
- `/licenses` currently defaults to Shared logins; Photo Mechanic is `?tab=photo-mechanic`.
- `src/app/(app)/licenses/page.tsx` restates a Photo Mechanic heading, staff add actions, custody card, capacity rail, and pool in one 419-line client file.
- Shared logins vault repeats its tab title as an in-panel heading.
- D-052 currently says Shared logins is the default. User direction: Photo Mechanic is the most important.
- Collaborators still cannot use Photo Mechanic and must remain on Shared logins.
- Claim, masking, two-slot, expiry, and vault encryption contracts stay unchanged.

## Stop Conditions
- Stop if claim, masking, or vault secret contracts would need to change to support the layout.
- Stop if collaborator policy no longer has a Shared logins landing.

## Slices
- [x] Slice 1: Default tab + extract `PhotoMechanicLicenses.tsx` + Photo Mechanic-first layout (hero code, claim prompt, no nested heading).
- [x] Slice 2: Quiet Shared logins chrome, search copy, D-052 amendment, area docs, focused tests.
- [ ] Slice 3: Authenticated browser proof and matched visual review — blocked on local login. `/licenses` redirects to `/login`.

## Verification
- [x] Focused Software and licenses UI contract tests
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint` on touched files
- [x] `npm run verify:docs` after codemap
- [x] `git diff --check`
- [x] `npm run build:app` — `/licenses` compiled at 29 kB
- [ ] Authenticated browser smoke on `/licenses` and `?tab=shared-logins`
- [ ] `gt-ui-review` matched captures
