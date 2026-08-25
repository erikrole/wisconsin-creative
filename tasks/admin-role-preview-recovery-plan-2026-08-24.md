# Admin Role Preview Recovery Plan - 2026-08-24

## Goal

- Restore the previously local-only web role preview on current `main` so an authenticated Admin can inspect Staff, Student, and Collaborator navigation, route, API, and CTA behavior without changing the Admin identity or creating a second account.
- Keep preview mode read-only at the server boundary: no mutations, uploads, notifications, protected downloads, external effects, or kiosk access.
- Audit active Codex worktrees and branches for other locally built or committed work that is not reachable from current `main`, without altering those worktrees.

## Route

- Owner area: Users / authentication and platform authorization.
- Secondary areas: Collaborators, Dashboard, Schedule, Bookings, Checkouts, Reservations.
- Ledger: this plan; update `docs/AREA_USERS.md`, `docs/AREA_COLLABORATORS.md`, `docs/GAPS_AND_RISKS.md`, and `tasks/INDEX.md` only for behavior actually recovered or a confirmed remaining gap.
- Existing local-only source: `/Users/role/.codex/worktrees/debb/wisconsin-creative`.

## Source Checks

- Current `main` is 65 commits ahead of the role-preview fork base, so the fork cannot be copied or cherry-picked wholesale.
- Current web authorization is split across `requireAuth`, `withAuth`, `withHandler`, `withKiosk`, `requirePermission`, and collaborator capability checks.
- The fork adds a signed short-lived preview cookie layered on the real Admin session, effective-role serialization, a persistent banner, a `Preview as` control, centralized read-only guards, and sanitized collaborator read paths.
- The current worktree contains unrelated dirty changes across web, schema, native, docs, and tests; all recovery edits must be narrow and additive.
- No schema or migration is expected for this slice; database access and current collaborator policy contracts must remain unchanged.

## Stop Conditions

- Stop before overwriting any current `main` file or unrelated dirty change; adapt each overlapping hunk manually.
- Stop if preview state can be client-forged, changes the durable Admin session, allows a mutation or protected download, or hides the persistent read-only indication.
- Stop if the current API response shape or collaborator privacy contract differs from the fork assumptions; reconcile the contract before editing consumers.
- Stop before commit, push, deployment, production mutation, or migration application unless separately authorized.
- Do not treat source/build proof as deployed or authenticated production proof.

## Slices

- [x] Slice 1: Inspect current contracts, dirty work, active worktrees, and fork history; classify other unmerged work.
- [x] Slice 2: Port signed preview state, effective-user projection, Admin control route, shell banner/control, and central API/kiosk guards.
- [x] Slice 3: Port collaborator preview read-path behavior and client-side CTA/polling suppression, adapting to current main rather than replacing current files.
- [x] Slice 4: Add focused source/API/RBAC tests and synchronize Users/Collaborators docs and codemaps.
- [x] Slice 5: Verify focused tests, TypeScript, lint, app build, docs, whitespace, and the production deployment; Event detail production proof is complete, while the role-preview browser matrix remains a follow-up.

## Verification

- [x] Focused role-preview, API-wrapper, RBAC, sidebar, collaborator-copy, and booking-preview source tests.
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [x] `npm run build:app`
- [x] `npm run codemap` followed by `npm run verify:docs`
- [x] `git diff --check`
- [ ] Authenticated browser smoke of Admin start/exit and Staff/Student/Collaborator read-only surfaces; the shipped production check covered the deployed Event detail surface, and no preview start/stop action was submitted during release proof.
- [x] Production migration health, deployment, and public smoke were completed after the release request authorized them.

## Review

- Shipped: Signed, short-lived, server-enforced read-only Admin role preview on current `main`, deployed in `dpl_9cFHwpSQA9QjsQTV3GF3uKf65QtE` from commit `c48dd43d`.
- Verified: focused role-preview/API/RBAC/source tests, TypeScript, lint, `npm run build:app`, codemap/docs verification, migration health, and public production smoke. Production Event detail also renders the new timing-mode editor and current Veterans Plaza Ceremony state.
- Deferred: authenticated role-preview browser matrix, native iOS preview, kiosk UI simulation, and exact person-level ownership/data simulation.
- Blocked: none; the remaining browser matrix is an intentional proof follow-up, not a source or deployment blocker.
- Proof artifacts: fork task plan and current-main focused test/build/browser output after recovery.
- Next slice or stop: stop implementation here; run the role-preview browser matrix separately if that acceptance gate is required.
