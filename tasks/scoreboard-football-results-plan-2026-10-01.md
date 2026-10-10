# Football results enrichment

Status: locally implemented and verified; rollout remains open under GAP-88. Branch `codex/scoreboard-football-results`, based on `2b2a3cfbd89afba7ff041e9f795524a356abb36a`.

## Contract and scope

- Link UW and ESPN football game identities to existing Schedule events; never create crew events from ESPN.
- Preserve each provider's observed final score, identity, source URL, observation time, and normalized snapshot. UW calendar W/L/T remains the record authority (D-056).
- Display a final score only when both providers agree and it agrees with the event's official result and identity. Disagreement, missing data, ambiguity, and failed refreshes remain explicit; good observations survive failures.
- Refresh the current football season in a separate bounded daily cron and an authorized manual API, without extending morning-refresh's budget.
- Add scores and source links to web team and person Scoreboards. Additive response fields leave existing native decoders compatible; native score presentation and other sports are follow-up slices.
- No commit, push, production migration, or deployment is authorized by this implementation request.

## Files and steps

1. Inspect live public payloads and define football parser/matching contracts.
2. Add the provider observation schema and forward migration; offline generation only until a branch-owned preview exists.
3. Implement bounded refresh, transaction/audit persistence, authenticated manual refresh, and cron.
4. Add safe Scoreboard projections and reuse one score component for team/person surfaces.
5. Test identity ambiguity, score orientation, disagreements, source changes/failures, authorization, and unchanged record math; run TypeScript, lint, compile-only build, migration and docs checks.
6. Create the local visual review and record real runtime/migration limitations. Sync Events/Users docs and accepted data authority.

## Verification

- Public 2026 UW and ESPN regular/postseason football schedules downloaded read-only. Both sources contain the same four completed-game scores: Notre Dame 13–41, Western Illinois 36–9, Eastern Michigan 54–10, Penn State 24–20 (Wisconsin first). Public-input hashes and minimal parser fixtures are retained in `tests/fixtures/football-results/README.md`.
- Focused regression suite: 92 tests passed across 13 files, covering parser/matching, refresh persistence, manual authorization, existing team/person Scoreboards, native source contracts, and cron rules/authentication.
- `npx tsc --noEmit --pretty false` and targeted ESLint passed. One TypeScript attempt overlapped with the build replacing `.next/build/types` and failed on missing generated files; the isolated rerun passed after the build completed.
- `npm run build:app` passed: 272 generated pages. Pre-existing unused-variable warnings remain in kiosk dashboard and Sidebar; no new lint warnings in changed files. This was a compile-only build, not a deployment or migration.
- Prisma format/validate/generate passed. Offline schema diff produced the forward migration. `npm run db:migrate:check` passed (169 migrations), and the schema/migration guard confirmed the pair.
- A disposable PostgreSQL 17 cluster accepted the HEAD schema followed by the new forward migration. Unique provider/game and event/provider constraints, foreign key rejection, cascading delete, and a generated Prisma relation read with serializable advisory locking passed. The cluster was stopped afterward; no hosted data was changed.
- `npm run codemap`, `npm run verify:docs`, and `git diff --check` passed.
- [Visual review](archive/proofs/scoreboard-football-2026-10-01/review.html): isolated actual components, after-only, with 1100×820 light and 390×844 dark captures. Verified/pending/disputed/stale states, mocked non-JSON failure recovery, partial refresh status, keyboard access, 40px source-link target height, and no horizontal overflow or page errors passed. This does not prove either authenticated full route. A trustworthy authenticated before capture was unavailable. Fixture body text uses Arial in place of app-loaded Geist.
- Worktree isolated from unrelated kit work and existing untracked Xcode results. No commit, push, PR, hosted migration, or deployment performed.

## Remaining rollout gates

The final `preview:setup` read-back reports no hosted environment because this branch has no open same-repository PR targeting `main`. The repository requires explicit authorization to commit/push; after that, CI and Managed previews must create this branch's environment. No other branch or production credentials may substitute.

1. Commit this bounded slice, push, and open a PR only when authorized. Inspect actual CI and Managed previews results.
2. Run branch-owned `preview:setup`, `dev:preview`, and `auth:local`. Confirm migration `0163` is applied before the new Scoreboard relation reads.
3. Verify authenticated Staff/Admin refresh, database/audit read-back, repeated refresh idempotency, Student/Collaborator read-only access, team filter intersection, and person Scoreboard score/source links. Capture the real routes in light/dark and narrow/wide layouts.
4. Separately authorize merge/deploy. Inspect production deployment and migration status, perform authorized refresh/read-back, and observe cron health. A successful local build is not production acceptance.
5. Follow-up slices: native score presentation, other sports, richer team/player statistics, and any live-game or play-by-play feed. This slice only enriches final football scores.
