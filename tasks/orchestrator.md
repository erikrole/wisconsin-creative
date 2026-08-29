# Codex Orchestrator Ledger - 2026-06-18

## Purpose
- Keep one read-only control plane for stale PRs, active plans, and Codex worker dispatch.
- Classify work before creating branches, closing PRs, or starting worker/reviewer threads.
- Favor one bounded, independently verifiable slice at a time.

## Source Snapshot
- Branch: `main`.
- Worktree before ledger write: planning-only changes in `tasks/todo.md` and `tasks/orchestrator-plan.md`.
- Live open PRs from GitHub: 3.
- Current task queue: many completed Schedule/Kiosk sections remain in `tasks/todo.md`; unfinished work is concentrated in `tasks/kiosk-only-custody-plan.md` and one iOS Schedule verification item.
- Network note: GitHub metadata needed approved network access after sandboxed `gh` calls failed to connect to `api.github.com`.

## Classification Rules
- Close: stale, superseded, conflicting, or no longer aligned with current decisions.
- Revive: useful work, but needs a fresh builder/reviewer pass before merge.
- Merge-ready: clean, current, verified, and no missing docs or proof.
- Needs human decision: product direction or risk tradeoff cannot be decided from repo evidence.
- Blocked: cannot safely proceed until a named external condition is resolved.

## Open PRs

### Revive
- PR #349: `chore(deps-dev): bump the development-dependencies group across 1 directory with 4 updates`
  - URL: https://github.com/erikrole/wisconsin-creative/pull/349
  - Head: `dependabot/npm_and_yarn/development-dependencies-0d41c07746`
  - Author: Dependabot.
  - Files: `package.json`, `package-lock.json`.
  - Scope: `@next/bundle-analyzer`, `@types/node`, `eslint-config-next`, `vitest`.
  - State: mergeable, Vercel success, CI `validate` failure, Claude review failure.
  - Classification: Revive as the first dependency pilot only after a builder thread checks out the branch and runs local dependency/build verification.
  - Triage update 2026-06-18: failing checks are not caused by the package diff.
    - `validate` fails during `npm ci` because `postinstall` runs `prisma generate`, `prisma.config.ts` requires `DIRECT_URL`, and the CI job only supplies `DATABASE_URL` for the later build step.
    - `claude-review` fails because the workflow was triggered by Dependabot and `anthropics/claude-code-action` rejects bot actors unless Dependabot is added to `allowed_bots`.
    - The patch itself changes only dev dependency versions and lockfile entries.
  - Builder verification update 2026-06-18:
    - Isolated worktree: `/private/tmp/gt-pr349` on `codex/pr-349-verify`.
    - `DIRECT_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder npm ci`: passed.
    - `npm audit --audit-level=high`: failed with 2 high advisories (`vite`, `ws`). Current `main` also fails this gate, with the same 2 high advisories plus a critical `vitest <3.2.6` advisory. PR #349 removes the Vitest critical but does not make the audit gate green.
    - `./node_modules/.bin/vitest --version`: `vitest/3.2.6`.
    - `npm test -- tests/query-client.test.ts`: passed 5 tests.
    - `npm run db:migrate:check`: passed.
    - `npm run lint`: passed with existing warnings.
    - `./node_modules/.bin/tsc --noEmit --pretty false`: blocked by pre-existing `tests/bulk-unit-adjustment-routes.test.ts:171`.
    - `DATABASE_URL=... DIRECT_URL=... SESSION_SECRET=... ./node_modules/.bin/next build`: passed.
    - `npm audit fix --dry-run`: suggests a broad dependency hardening set, not a tiny lockfile correction. The dry-run includes Sentry/OpenTelemetry, Babel, Vite, Webpack/ws, MDXEditor/js-yaml, Resend/Svix/uuid, and related transitive churn.
  - Classification update: Not merge-ready. Keep revived, but do not merge until the audit gate decision is made. Options are either include the remaining advisory fixes in a dependency hardening branch or adjust CI policy deliberately; do not treat this as a PR #349 regression.
  - Worker shape: dependency-only builder, no app behavior changes, no docs unless dependency behavior forces it.
  - Reviewer shape: package diff, lockfile sanity, CI failure diagnosis, local command proof.
  - Slice 2 pilot update 2026-06-18:
    - Builder agent verified current PR head `68a7066` merges cleanly onto local `main` `a674ece`, changes only `package.json` and `package-lock.json`, and passes `npm ci`, migration-prefix check, lint, focused Vitest, TypeScript, placeholder-env Next build, and `git diff --check`.
    - Reviewer agent found no lockfile sanity issue and confirmed PR #349 removes the baseline critical `vitest <3.2.6` advisory.
    - Merge recommendation remains blocked unless the team deliberately accepts existing `vite` and `ws` high advisories as baseline debt and treats the CI `DIRECT_URL`/Dependabot-review failures as separate policy/config work.
    - Final classification: Package-mergeable, but not merge-ready under a mandatory high-audit gate.

- PR #353: `chore(deps): bump the production-dependencies group across 1 directory with 23 updates`
  - URL: https://github.com/erikrole/wisconsin-creative/pull/353
  - Head: `dependabot/npm_and_yarn/production-dependencies-7ef9f29df0`
  - Author: Dependabot.
  - Files: `package.json`, `package-lock.json`.
  - Scope: broad production dependency batch including Next patch, React patch, Radix, TanStack Query, Neon serverless, Sentry, Resend, Tailwind, date-fns, and form packages.
  - State: mergeable, Vercel success, CI `validate` failure, Claude review failure.
  - Classification: Revive after PR #349, not before. This touches runtime dependencies and should get a stricter reviewer pass.
  - Worker shape: dependency-only builder with focused app compile and selected smoke checks.
  - Reviewer shape: package risk review, serverless/runtime dependency attention, lockfile sanity, CI failure diagnosis.
  - Triage update 2026-06-18:
    - Builder agent verified PR head `10c5d4640ecccf404065dc39861069eb087dc7e9` merges cleanly onto local `main` `a674ecea5d1d5b205cc4d539584c45c74c286c4e`, changes only `package.json` and `package-lock.json`, and passes `npm ci`, migration-prefix check, lint, focused runtime tests, TypeScript, placeholder-env Next build, and `git diff --check`.
    - `npm audit --audit-level=high` still fails on `vite`, `vitest`, and `ws`, but the PR improves the baseline from 17 vulnerabilities to 7.
    - Reviewer agent found no lockfile sanity issue and confirmed the package diff is package-mergeable.
    - Merge recommendation remains blocked under current gates because high audit is still red, CI still lacks `DIRECT_URL` during `postinstall`, and Dependabot review policy still rejects the bot actor.
    - Additional reviewer ask before any policy-exception merge: one authenticated browser smoke pass because this is a broad runtime dependency batch.
    - Final classification: Package-mergeable, but not merge-ready under mandatory high-audit/current required checks.

### Closed
- PR #324: `chore(deps): bump in-range minors, lucide v1, and zod v4`
  - URL: https://github.com/erikrole/wisconsin-creative/pull/324
  - Head: `claude/deps-slices-1-2-4`
  - Author: Erik Role, commits authored by Claude.
  - Files: dependency files plus small Zod v4 route/helper migrations and `tasks/dependency-updates-plan.md`.
  - State: closed 2026-06-18 after explicit approval. Before close, live GitHub metadata reported `OPEN`, `DIRTY`, and stale since 2026-05-01.
  - Classification: Closed rather than merged. It was old, conflicted with `main`, and overlapped newer dependency work. If Zod 4 or Lucide v1 is still desired, recreate as a new narrow dependency plan against current `main`.
  - Triage update 2026-06-18:
    - Before close, live GitHub metadata reported the PR open, non-draft, `DIRTY`, last updated 2026-05-01, with package and Zod helper changes still mixed together.
    - Patch scope is `package.json`, `package-lock.json`, four Zod error route call sites, `src/lib/http.ts`, `src/lib/validation.ts`, and `tasks/dependency-updates-plan.md`.
    - Current `main` has already moved past part of the old dependency context: `next`/`eslint-config-next` are at `15.5.16`, while the PR was cut against `15.5.15`; newer PR #349 and PR #353 now own the current dependency lane.
    - Unique remaining ideas are Lucide v1 and Zod 4 compatibility. They should not be rescued from this stale branch because the combined patch mixes old in-range dependency churn, a dev dependency downgrade/reconcile, and breaking Zod migration work.
    - Final action: closed PR #324 after explicit user approval, with a note that Lucide v1 and Zod 4 should be recreated as separate current-main dependency slices if still desired.

### Merge-ready
- None.

### Needs Human Decision
- None from current PR evidence.

### Blocked
- No PR is blocked from classification.
- PR #349 and PR #353 are blocked from merge by failing required checks until a dependency worker diagnoses current CI output and local verification.

## Active Plan Work

### Recently Completed
- `tasks/kiosk-only-custody-plan.md`: Slices 4 and 5 completed. Reservation pickup now creates linked kiosk checkout custody after scans pass, closes the source reservation, and checkout reporting/browser proof is complete.
- `tasks/todo.md`: iOS Schedule all-day display correction verification completed. Focused source-contract test, drift, audit, whitespace, docs, and simulator build passed.
- `tasks/todo.md`: top completed Schedule, iOS all-day, dashboard-title, item-crash, event-call-window, and kiosk-only custody sections were consolidated into `tasks/archive/completed-2026-06/active-queue-cleanup-2026-06-18.md` so they no longer advertise as active.
- `tasks/todo.md`: completed 2026-06-15 Kiosk/iOS follow-up sections and the completed 2026-06-13 kiosk UI consolidation were consolidated into `tasks/archive/completed-2026-06/kiosk-ios-followups-2026-06-15.md`.
- 2026-06-12 kiosk pickup post-deploy schema proof is complete: live migration health is clean, `scan_events.phase` is `ScanPhase`, the typed `phase = 'CHECKOUT'::"ScanPhase"` comparison succeeds, and focused pickup route tests pass.
- `tasks/todo.md`: the completed 2026-06-12 kiosk bundle was consolidated into `tasks/archive/completed-2026-06/kiosk-2026-06-12-cleanup.md`; the remaining live pickup scan smoke was later completed and archived to `tasks/archive/completed-2026-06/kiosk-pickup-live-smoke-followup-2026-06-18.md`.
- `tasks/todo.md`: completed roadmap intake and project folder cleanup sections were consolidated into `tasks/archive/completed-2026-06/roadmap-and-project-cleanup-2026-06-12.md`.
- `tasks/todo.md`: completed ambient quick search removal and B&H image picker sections were consolidated into `tasks/archive/completed-2026-06/search-and-bhphoto-cleanup-2026-06-10.md`.
- `tasks/todo.md`: completed Item Info Sidebar Hardening and Item Detail Identity Firmware Refresh sections were consolidated into `tasks/archive/completed-2026-06/item-info-identity-firmware-cleanup-2026-06-10.md`.
- `tasks/todo.md`: completed Item Detail Firmware Badge and Item Detail Firmware Display sections were consolidated into `tasks/archive/completed-2026-06/item-detail-firmware-cleanup-2026-06-10.md`.
- `tasks/todo.md`: completed Firmware Watch Daily Notifications and Firmware Watch Inventory Seed Follow-up sections were consolidated into `tasks/archive/completed-2026-06/firmware-watch-cleanup-2026-06-10.md`.
- `tasks/todo.md`: completed Add Item Flow Quick Fixes and QR Code Generation Simplification sections were consolidated into `tasks/archive/completed-2026-06/add-item-qr-cleanup-2026-06-10.md`.
- `tasks/todo.md`: completed iOS Settings Detail Menus and iOS Settings First-Class sections were consolidated into `tasks/archive/completed-2026-06/ios-settings-cleanup-2026-06-10.md`.
- `tasks/todo.md`: completed Booking Flow Follow-up and iOS Notifications Category Parity sections were consolidated into `tasks/archive/completed-2026-06/booking-flow-notification-category-cleanup-2026-06-10.md`.
- `tasks/todo.md`: completed iOS Notifications Token Honesty and Tap-Through sections were consolidated into `tasks/archive/completed-2026-06/ios-notifications-token-tapthrough-cleanup-2026-06-10.md`.
- `tasks/todo.md`: completed iOS Notifications Audit and iOS Runtime Warning Cleanup sections were consolidated into `tasks/archive/completed-2026-06/ios-notifications-audit-runtime-cleanup-2026-06-10.md`.
- `tasks/todo.md`: completed iOS HIG/iOS 27 Readiness and iOS Schedule Detail/Trade Control sections were consolidated into `tasks/archive/completed-2026-06/ios-hig-schedule-trade-cleanup-2026-06-05.md`.
- `tasks/todo.md`: completed iOS Create Booking Control Clarity and iOS Profile Controls Clarity sections were consolidated into `tasks/archive/completed-2026-06/ios-create-booking-profile-clarity-cleanup-2026-06-03.md`.
- `tasks/todo.md`: completed iOS Booking Detail Control Clarity and iOS Items Control Clarity sections were consolidated into `tasks/archive/completed-2026-06/ios-booking-detail-items-clarity-cleanup-2026-06-03.md`.
- `tasks/todo.md`: completed iOS Schedule Control Clarity and iOS Tabs And Buttons Readiness sections were consolidated into `tasks/archive/completed-2026-06/ios-schedule-tabs-clarity-cleanup-2026-06-03.md`.
- `tasks/todo.md`: completed Booking Create UX Ownership Pass and Booking Create Hardening sections were consolidated into `tasks/archive/completed-2026-06/booking-create-cleanup-2026-05-30.md`.
- `tasks/todo.md`: completed Global Search through Damage Report Photos + Avatar Polish sections were consolidated into `tasks/archive/completed-2026-06/may-completed-major-work-cleanup-2026-05-21.md`.
- `tasks/todo.md`: completed Avatar + shadcn through Derived Bulk Unit QR Scans sections were consolidated into `tasks/archive/completed-2026-06/may-post-backlog-ui-item-cleanup-2026-05-07.md`; Active Backlog Index and Bulk Battery Hardening remain active because each contains unchecked follow-up items.
- `tasks/todo.md`: completed Codex Readiness and legacy completed tail sections were consolidated into `tasks/archive/completed-2026-06/codex-readiness-legacy-tail-cleanup-2026-05-05.md`.
- `tasks/todo.md`: completed Wins Sprint was consolidated into `tasks/archive/completed-2026-06/wins-sprint-cleanup-2026-04-30.md`.
- `tasks/todo.md`: dependency PR audit blockers were resolved and archived to `tasks/archive/completed-2026-06/dependency-audit-hardening-2026-06-18.md`; package hardening, CI install env correction, Dependabot review policy, and PR reconciliation have shipped locally.
- `tasks/todo.md`: Codex PR and plan orchestrator starting slice was archived to `tasks/archive/completed-2026-06/orchestrator-starting-slice-2026-06-18.md`; `tasks/orchestrator.md` remains the manual control plane for future "Next" turns.
- PR #324 was closed after explicit approval because it was stale, conflicting, and mixed old dependency churn with Lucide v1 and Zod 4 migration work.
- `tasks/todo.md`: kiosk pickup live smoke follow-up was archived to `tasks/archive/completed-2026-06/kiosk-pickup-live-smoke-followup-2026-06-18.md`; fixture-backed live database smoke wrote `CHECKOUT` scan event `cmqkb0ic80001kvdlqt57up29`, opened checkout `cmqkb0kem0008kvdlx6k7zuwe`, and cleanup left zero disposable bookings, kiosk devices, users, or scan events.
- `tasks/todo.md`: Onboarding Flow Plan was archived to `tasks/archive/completed-2026-06/onboarding-flow-plan-2026-06-03.md` after focused onboarding verification passed 27 tests and migration-prefix check passed.
- `tasks/todo.md`: Internal Public Beta Launch Readiness was archived to `tasks/archive/completed-2026-06/internal-public-beta-launch-readiness-2026-06-08.md`; release cut moved to `tasks/internal-public-beta-release-cut-followup.md` because it requires a clean worktree and creates a version commit/tag/push.
- `tasks/todo.md`: Bulk Battery Hardening was archived to `tasks/archive/completed-2026-06/bulk-battery-hardening-cleanup-2026-05-05.md`; unresolved future work moved to `tasks/bulk-battery-followups.md`.
- `tasks/todo.md`: Admin Fix Today queue was reconciled as shipped and its plan moved to `tasks/archive/completed-2026-06/admin-fix-today-plan-2026-05-13.md`.
- `tasks/todo.md`: Admin helper and low-priority systemic follow-ups were split into `tasks/admin-helper-followups.md`; stale pending-pickup auto-expiry and GAP-35 references were reconciled.
- Completed Battery Ops empty-state plan moved to `tasks/archive/completed-2026-06/battery-ops-empty-state-plan-2026-05-20.md`.
- Root task debt cleanup: completed avatar/shadcn, gap reliability, workflow plugin, attachment hardening, design-language accessibility, design-language detail follow-up, and booking row action plans moved to `tasks/archive/completed-2026-06/`.
- Root task debt cleanup: completed booking create UX, Trade Board active filters, Trade Board row actions, Settings control map polish, and Settings actions/empty-copy plans moved to `tasks/archive/completed-2026-06/`.
- Root task debt cleanup: completed design-language next-three, design-language foundation, shift staffing MVP, and schedule freshness signal plans moved to `tasks/archive/completed-2026-06/`.
- Root task debt cleanup: completed Settings navigation rail, Settings shell cleanup, and Labels UI polish plans moved to `tasks/archive/completed-2026-06/`.
- Root task debt cleanup: completed Resources rename MVP, repo map system, and Reports UI polish plans moved to `tasks/archive/completed-2026-06/`; Reports charts remains active because it lacks completed review evidence.
- Root task debt cleanup: completed creation flow system, ESLint CLI migration, booking create hardening, damage report photos/avatar polish, and React Query cache follow-up plans moved to `tasks/archive/completed-2026-06/`.
- Root task debt cleanup: completed design-language follow-up, low-traffic controls, high-impact batch, metrics/targets, and auth/event/image batch plans moved to `tasks/archive/completed-2026-06/`.
- Root task debt cleanup: completed iOS schedule, items, create-booking, profile, booking-detail, tabs/buttons, notification token, notification tap-through, runtime warning, and notification category parity plans moved to `tasks/archive/completed-2026-06/`.
- Root task debt cleanup: completed no-temp-password onboarding, shift email notifications, project folder cleanup, bulk item families, cross-page state awareness, and custody confidence plans moved to `tasks/archive/completed-2026-06/`.

### Revive
- None currently identified from local task plans.

### Close Or Archive Candidates
- Completed 2026-06-12 kiosk sections are archived, including the fixture-backed live pickup smoke follow-up.
- Stop before archiving Active Backlog Index: admin helpers, ops V2/V3, and low-priority systemic gaps remain unchecked but now point to focused follow-up files.
- Bulk Battery Hardening is archived. Remaining battery-adjacent future work lives in `tasks/bulk-battery-followups.md`.
- Admin Helper Backlog and Deferred Gaps To Keep Visible were split into `tasks/admin-helper-followups.md`.
- No fully checked active cleanup sections remain in `tasks/todo.md` after the latest archive pass.

### Merge-ready
- The local dependency hardening slice is verification-ready and archived. It clears the high audit gate and supersedes PR #349 and PR #353 once shipped.

### Needs Human Decision
- None currently identified from current PR evidence.

### Blocked
- Broad TypeScript proof is known to be blocked in several recent slices by the pre-existing `tests/bulk-unit-adjustment-routes.test.ts:171` warning. Treat that as a known repo gate until a separate hardening slice fixes it.
- Authenticated browser smoke has been repeatedly blocked when local runtime or Neon access is unavailable. Do not mark web UI slices done without either browser proof or a named browser-proof blocker.

## Recommended Dispatch Order
1. Ship the local dependency hardening slice when the user wants to commit/push: it supersedes PR #349 and PR #353, clears high audit, fixes CI install env, and allows Dependabot through Claude review narrowly.
2. Recreate Lucide v1 and Zod 4 as separate current-main slices only if still desired.
3. Continue with the next non-mutating task cleanup or planning slice unless the user redirects to implementation or shipping.

## Recurring Wake-Up Policy

Decision: keep the orchestrator manual for now. Do not create an automatic recurring Codex wake-up until two more manual runs prove the loop stays useful without generating stale branch churn.

### Mode
- Manual trigger: the user says "Next" or asks for the orchestrator to continue.
- Goal-driven only after explicit user request: use a Codex goal for a bounded objective such as "triage open PRs until each is close/revive/blocked."
- Automation-driven is deferred. It is allowed only after the user explicitly asks to create a recurring automation and the policy below is still acceptable.

### Cadence Proposal
- Manual check-in cadence: at most one orchestrator slice per user "Next."
- Suggested recurring cadence if later automated: weekday morning, no more than once per day.
- Dependency PR cadence: weekly, unless a security advisory is active.
- Product-plan cadence: one active plan slice at a time, never parallel with dependency branch edits unless file ownership is disjoint.

### Notification Rules
- Report only status changes that require a decision or unblock action:
  - PR became merge-ready.
  - PR should be closed.
  - PR is blocked by a named policy or CI issue.
  - Active plan slice passed verification.
  - Verification failed with a concrete next action.
- Do not notify for routine "still blocked" states unless the blocker changed.
- Include exact commands and paths for any proof claim.

### Wake-Up Stop Conditions
- Stop after one completed slice.
- Stop if a merge/audit/security policy decision is needed.
- Stop if a worker would touch files already modified by an active unmerged slice.
- Stop if a branch needs schema, API, UI, docs, and browser proof in one pass; split first.
- Stop after two consecutive tool failures or environment blockers.
- Stop if the action would close, merge, push, or create a real recurring automation without explicit user approval.

### Next Manual Entry Point
- If the user says "Next" again, use this order unless they redirect:
  1. Continue with the next non-mutating task cleanup or planning slice, likely stale standalone plan reconciliation.
  2. If the user redirects to shipping, prepare the local dependency hardening slice for commit/PR.

## Worker Prompt Contract
- Read `AGENTS.md`, `docs/NORTH_STAR.md`, relevant `docs/AREA_*.md`, relevant `docs/BRIEF_*.md`, `docs/DECISIONS.md`, `docs/GAPS_AND_RISKS.md`, the active plan file, and current source before editing.
- Own one slice only.
- Update the plan and docs in the same branch when behavior changes.
- Run focused tests, `git diff --check`, and the slice-specific build/type/doc proof.
- Stop on explicit contract mismatch instead of widening scope.

### Reusable Builder Prompt Template

Use this when creating a builder thread for one revived PR or one active plan slice:

```text
You are the builder for one bounded Wisconsin Creative slice.

Objective:
- <one sentence objective>

Scope:
- Own only <PR number / plan slice / file area>.
- Do not touch unrelated refactors, stale task cleanup, dependency updates, or parallel work.
- If the slice needs schema, API, UI, docs, and browser proof all at once, stop and split it smaller.

Required source reads before editing:
- AGENTS.md
- docs/NORTH_STAR.md
- docs/DECISIONS.md
- docs/GAPS_AND_RISKS.md
- Relevant docs/BRIEF_* and docs/AREA_* files
- Relevant task plan: <path>
- Current source files you will edit, read in full before editing

Implementation rules:
- Preserve accepted decisions, especially derived status, SERIALIZABLE integrity, audit logging, role boundaries, and kiosk-only custody.
- Prefer existing helpers and shadcn/ui components.
- Update relevant docs and plan files in the same branch when behavior changes.
- Do not close PRs, merge branches, or change CI policy unless this slice explicitly says so.

Verification:
- Run focused tests for touched behavior.
- Run git diff --check.
- Run npm run verify:docs after docs/codemap changes.
- Run ./node_modules/.bin/tsc --noEmit --pretty false unless a known blocker is documented with exact file and line.
- Run ./node_modules/.bin/next build for web/product-code changes.
- Run authenticated browser smoke for touched web UI, or record the exact blocker.
- Run iOS simulator build only when native code or native contracts changed.

Stop conditions:
- Stop on product-contract mismatch.
- Stop after two repeated tool/approach failures.
- Stop if another active worker owns the same files.
- Stop if verification exposes a broader defect outside the slice; record it instead of widening.

Handoff:
- Summarize changed files, behavior, verification commands, blockers, and remaining risk.
- Leave git status readable. Do not stage or commit unless asked.
```

### Reusable Dependency Builder Prompt Template

Use this only for revived dependency PRs:

```text
You are the dependency builder for <PR number>.

Objective:
- Verify whether the dependency diff is mergeable against current main without changing app behavior.

Scope:
- Inspect package.json, package-lock.json, CI failures, and dependency release risk.
- Do not edit product code unless the dependency update requires a minimal compatibility fix.
- Do not run npm audit fix unless explicitly directed; dry-run output is evidence, not authorization.

Required verification:
- npm ci with the minimum env needed for postinstall.
- npm audit --audit-level=high and compare against current main if it fails.
- npm run db:migrate:check.
- npm run lint.
- Focused tests relevant to changed tooling/runtime packages.
- ./node_modules/.bin/tsc --noEmit --pretty false, recording exact known blockers.
- ./node_modules/.bin/next build with local placeholder env if safe.

Handoff:
- Classify as merge-ready, blocked, needs follow-up branch, or close.
- Separate PR-caused failures from baseline failures.
- Include exact commands and outcomes.
```

## Reviewer Prompt Contract
- Review as a code reviewer.
- Findings first, ordered by severity, with file and line references.
- Verify docs, tests, and proof match the slice.
- Flag missing authenticated browser or iOS simulator proof when the slice requires it.
- Do not rewrite the branch unless explicitly promoted to builder.

### Reusable Reviewer Prompt Template

Use this when creating a reviewer thread for a builder branch, PR, or completed slice:

```text
You are reviewing <branch / PR / slice> as a senior code reviewer.

Review stance:
- Findings first, ordered by severity.
- Include file and line references.
- Focus on bugs, regressions, data integrity, auth/role boundaries, auditability, missing tests, missing docs, and verification gaps.
- Do not rewrite the branch. Suggest fixes only.

Required checks:
- Read AGENTS.md, docs/NORTH_STAR.md, docs/DECISIONS.md, docs/GAPS_AND_RISKS.md, the relevant AREA/BRIEF docs, the active plan, and the diff.
- Confirm the implementation owns exactly one bounded slice.
- Confirm docs and task plan were updated when behavior changed.
- Confirm verification matches the slice risk.
- Flag missing authenticated browser proof for touched web UI.
- Flag missing iOS simulator proof for touched native code or native contracts.

Output format:
- Findings
- Open questions or assumptions
- Verification reviewed
- Merge recommendation: merge-ready, needs changes, blocked, or close
```

### Reusable Verification-Only Prompt Template

Use this for completed work that only needs proof:

```text
You are the verification-only worker for <slice>.

Rules:
- Do not edit product code unless a verification failure directly identifies a small fix and the user promotes you to builder.
- Run the named proof commands and collect exact outcomes.
- If a command is blocked by environment, capture the precise blocker and the smallest next action.
- Update only the relevant task ledger with verification results.

Handoff:
- List passed checks, failed checks, environment blockers, and whether the slice can be considered verified.
```

## Review
- Shipped: read-only orchestrator ledger with live PR and active-plan classifications. PR #349 received reviewer-only CI triage and isolated builder verification.
- Shipped: Slice 1 added reusable builder, dependency-builder, reviewer, and verification-only prompt templates to keep future worker threads bounded and reviewable.
- Shipped: Slice 2 ran the first revived PR pilot with one builder and one reviewer agent for PR #349. The pilot validated the new contracts and left PR #349 blocked on an explicit audit-policy decision rather than package-diff risk.
- Shipped: Slice 3 added a recurring wake-up policy. The loop stays manual by default, allows goal-driven execution only by explicit request, defers real recurring automation, and defines cadence, notification rules, and stop conditions.
- Shipped: PR #353 dependency triage now has builder and reviewer proof. Like PR #349, it is package-mergeable but blocked under mandatory audit/current required checks; unlike PR #349, it also needs authenticated browser smoke before any policy-exception merge because it touches broad runtime dependencies.
- Shipped: PR #324 close-candidate triage used fresh GitHub metadata and patch proof. It was stale, conflicting, and not worth merging; only Lucide v1 and Zod 4 remain useful as future separate current-main slices.
- Shipped: PR #324 was closed after explicit approval. The close comment preserved Lucide v1 and Zod 4 as future separate current-main slices if still desired.
- Shipped: first task-queue cleanup pass archived ten completed Schedule/iOS/Dashboard/Kiosk sections from `tasks/todo.md` into `tasks/archive/completed-2026-06/active-queue-cleanup-2026-06-18.md`.
- Shipped: second task-queue cleanup pass archived six completed Kiosk/iOS follow-up sections from `tasks/todo.md` into `tasks/archive/completed-2026-06/kiosk-ios-followups-2026-06-15.md`.
- Verified: live Neon migration health and `scan_events.phase` enum conversion. The exact typed comparison that previously failed now succeeds; focused kiosk pickup route tests pass. Remaining live scan smoke needs a safe pending-pickup or due-reservation fixture.
- Verified: fixture-backed live database kiosk pickup smoke passed through local kiosk HTTP routes after explicit approval. The smoke wrote `CHECKOUT` scan event `cmqkb0ic80001kvdlqt57up29`, fulfilled reservation `cmqkb0dwf0005kvp65stk1ove`, opened checkout `cmqkb0kem0008kvdlx6k7zuwe`, and cleaned up all disposable records.
- Shipped: third task-queue cleanup pass split the remaining live pickup scan smoke out from the completed 2026-06-12 kiosk bundle; the smoke follow-up is now completed and archived to `tasks/archive/completed-2026-06/kiosk-pickup-live-smoke-followup-2026-06-18.md`.
- Verified: `gh pr list`, `gh pr view` for PRs #349, #353, and #324, PR #349 patch inspection, PR #349 Actions log inspection, isolated PR #349 `npm ci`, `npm audit`, focused Vitest, migration-prefix check, lint, TypeScript attempt, local Next build, task queue inspection, plan inspection, and `git diff --check`.
- Deferred: PR closure, dependency branch changes, real recurring automation creation, and any product code changes outside the already-completed kiosk/report slices.
