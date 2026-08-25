# Student dashboard, license, and profile visibility plan (2026-08-24)

## Scope

Restore broad authenticated Student read visibility without changing staff/admin operations or the existing Photo Mechanic claim/copy lifecycle:

- Students see team dashboard rows, totals, and Upcoming Events alongside their own work.
- Photo Mechanic students can identify active account holders, while activation keys remain masked until the student's own claim and copy flow; the management action column is staff/admin-only.
- Students can browse all visible users and open their profiles. Hidden-roster protections and collaborator field minimization remain server-owned.

The prior local pass over-constrained Students; this correction supersedes that restriction.

## Implementation slices

- [x] Restore Student team dashboard rows, totals, Upcoming Events, and the visible two-column dashboard surface.
- [x] Return safe holder identity in the student license DTO and remove student action-column rendering while preserving row claim access.
- [x] Restore Student user-list/profile reads while retaining hidden-roster and collaborator privacy boundaries.
- [x] Update Dashboard, Users, and Photo Mechanic area docs plus the task index/ledger state.

## Verification gates

- [x] Focused dashboard/license/user tests.
- [x] `npx tsc --noEmit --pretty false`.
- [x] `npm run lint -- --quiet`.
- [x] `npm run build:app` with the dev server stopped.
- [x] Authenticated local Student browser proof for Dashboard, Software > Photo Mechanic, and a non-self profile URL.
- [x] `git diff --check`, codemap/docs verification, and final dirty-worktree review.

## Boundaries

- No migration or production data change was part of the implementation request; the later release request authorized the commits, push, and production deployment.
- Keep active Photo Mechanic claim/copy/return controls working for students; only the duplicate table action column is removed.
- Keep shared Scoreboard and badge policy unchanged unless the profile route itself exposes them.

## Review

- Shipped: broad Student dashboard reads, visible Users/profile reads, and the requested Photo Mechanic holder/key/action-column behavior are deployed in `dpl_9cFHwpSQA9QjsQTV3GF3uKf65QtE` from commit `c48dd43d`.
- Deferred: authenticated production Student browser acceptance remains a follow-up; local authenticated Student proof and source/build gates are complete.
- Verified: 69 focused tests passed; TypeScript, lint, build, diff, codemap, and docs checks passed. Authenticated local Student preview showed team checkouts, Upcoming Events, 31 visible users, AJ Harrison's profile, and masked Photo Mechanic keys with holder names and no Action column.
- Known unrelated test caveat: the full hidden-user smoke file still has three role-preview request-scope fixture failures (`cookies` called outside a request scope); the 12 visibility tests in that file pass.
