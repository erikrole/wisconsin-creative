# Canonical Schedule Window Kernel Plan - 2026-08-26

## Goal

- Centralize effective schedule-window resolution and half-open overlap semantics so assignment conflict checks and Open Work cannot drift on all-day events, call-time overrides, or worker class.

## Route

- Owner area: Schedule / Shifts
- Ledger: this active plan
- Related decisions: D-042, D-045, D-055

## Source Checks

- `src/lib/services/shift-assignments.ts` already performs the authoritative effective-window conflict recheck and includes an all-day event prefilter.
- `src/lib/services/schedule-open-work.ts` has a separate call-window resolver and pickup conflict query that do not carry the all-day event context.
- `src/lib/services/candidate-scoring.ts` and related schedule services contain additional private window resolvers; this slice will only migrate consumers whose input contracts can be preserved without widening an API response.
- No schema or migration change is required.

## Stop Conditions

- Stop the migration if a consumer has a distinct accepted integrity or display-window contract rather than silently changing it.
- Stop and reconcile `docs/DECISIONS.md` if the source requires a new worker class, role, lifecycle, or custody rule.
- Preserve unrelated dirty work and do not stage or commit it.

## Slices

- [x] Slice 1: Add pure schedule-window types, precedence resolution, all-day normalization, and overlap helpers.
- [x] Slice 2: Migrate assignment conflict checks and Open Work pickup/read paths while preserving query prefilter plus in-memory effective recheck behavior.
- [x] Slice 3: Add table-driven parity tests for precedence, all-day dates, half-open boundaries, malformed pairs, and excluded assignments.
- [x] Slice 4: Run focused tests, TypeScript, lint/build, diff checks, and record any runtime proof boundary.

## Verification

- [x] `npx vitest run tests/schedule-window.test.ts tests/schedule-open-work.test.ts tests/shift-assignments.test.ts tests/schedule-open-work-source.test.ts`
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [ ] `npm run build:app` — blocked by the unrelated dirty asset-library type error recorded below.
- [x] `git diff --check`
- [ ] Authenticated Schedule/Open Work browser smoke if the local session/runtime is available; otherwise record it as unverified.

## Review

- Shipped: Local implementation only; no commit, deployment, or production claim.
- Verified: 72 focused tests, `npx tsc --noEmit --pretty false`, `npm run lint`, and `git diff --check` passed. The broader suite reported 3,901 passed and 11 failures in unrelated dirty kiosk, role-preview, iOS welcome, timeline, and Brand Asset Library areas.
- Deferred: Candidate-scoring, publication, trade, reservation, and period/date consumers remain for later kernel migrations.
- Blocked: `npm run build:app` reaches compilation but fails on the unrelated dirty `BrandAssetLibrary.tsx` missing `initialFiles` at line 1657. `npm run codemap:check` also reports pre-existing drift in `docs/CODEMAPS/architecture.md`, `backend.md`, and `frontend.md`; regenerating it would overwrite parallel documentation work.
- Proof artifacts: `tests/schedule-window.test.ts`, `tests/schedule-open-work.test.ts`, and `tests/shift-assignments.test.ts`.
- Next slice or stop: Reconcile the dirty asset/codemap work before the next shared schedule-window migration; authenticated Schedule/Open Work smoke and deployment remain open.
