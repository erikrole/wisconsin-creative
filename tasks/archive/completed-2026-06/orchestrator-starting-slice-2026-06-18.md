# Codex Orchestrator Plan - 2026-06-18

## Goal
- Build a conservative Wisconsin Creative orchestration loop that can triage stale PRs, active plan files, and pending work without widening implementation scope.
- Start with a read-only triage ledger. Only after that proves useful should worker and reviewer threads touch feature branches.

## Source Checks
- `AGENTS.md`: non-trivial work starts with a plan, uses checkable items, verifies before done, and stops to re-plan when scope or contracts go sideways.
- `docs/NORTH_STAR.md`: Wisconsin Creative prioritizes operational speed, clarity, trust, derived status, auditability, and integrity over broad feature churn.
- `docs/AI_COLLABORATION.md`: multi-agent handoffs need intent, state, validation, risks, and next actions; blocked agents should log evidence and stop instead of speculative refactors.
- `docs/DECISIONS.md`: orchestration must preserve hard gates such as D-001 derived status, D-006 SERIALIZABLE integrity, D-007 audit logging, D-011 role inheritance, and D-040 kiosk-only custody.
- `docs/GAPS_AND_RISKS.md`: active gaps and recent change-log entries are the source of truth for whether a revived PR still matches shipped reality.
- `tasks/README.md`: active ledgers live at the task root and completed plans move to `tasks/archive/`.
- `tasks/todo.md`: current task queue is schedule-heavy, with several completed review sections and the kiosk-only custody plan still partially open.
- `tasks/lessons.md`: process lessons require `NORTH_STAR.md` first, next-slice recommendations, local login for authenticated browser checks, and doc sync on every commit.
- `git status --short`: clean at plan creation.

## Slices
- [x] Slice 0: Read-only orchestrator ledger
  - Add `tasks/orchestrator.md`.
  - Collect open PRs, current branch/worktree state, active plan files, and `tasks/todo.md`.
  - Classify each candidate as Close, Revive, Merge-ready, Needs human decision, or Blocked.
  - Do not edit feature code, close PRs, create branches, or spawn worker threads in this slice.
- [x] Slice 1: Worker/reviewer prompt contracts
  - Add reusable builder and reviewer prompt templates to the orchestrator ledger.
  - Require one bounded slice per builder thread.
  - Require a review stance in reviewer threads: findings first, source paths, missing tests, and merge risk.
- [x] Slice 2: First revived PR pilot
  - Pick one low-risk revived PR or plan item from the ledger.
  - Create one builder thread and one reviewer thread.
  - Require docs, tests, and proof before the branch is considered merge-ready.
- [x] Slice 3: Recurring wake-up policy
  - Decide whether this should be manual, goal-driven, or automation-driven.
  - Add cadence, stop conditions, and notification rules only after Slice 0 and Slice 2 show the loop is useful.

## Verification
- [x] `git status --short`
- [x] `gh pr list --state open --json number,title,headRefName,baseRefName,isDraft,mergeable,updatedAt,author`
- [x] Active task and plan inspection across `tasks/todo.md` and `tasks/*.md`
- [x] `git diff --check`
- [x] Later code-writing slice verification is recorded in `tasks/archive/completed-2026-06/dependency-audit-hardening-2026-06-18.md`
- [x] No web UI slice ran under this plan; authenticated browser proof was not applicable

## Stop Conditions
- Stop if a PR changes a product contract that conflicts with `docs/DECISIONS.md`, especially derived status, audit logging, role boundaries, or kiosk-only custody.
- Stop if the branch cannot be classified from local/source evidence.
- Stop if authenticated browser proof is required but the local environment cannot reach auth/runtime dependencies.
- Stop if a worker thread would need to touch the same files as another active worker without an explicit handoff.
- Stop if the task would require schema, API, UI, and docs changes in one branch; split into a thinner slice first.

## Review
- Shipped: `tasks/orchestrator.md` now classifies open GitHub PRs, active plan work, recommended dispatch order, worker prompt contract, and reviewer prompt contract.
- Shipped: Slice 1 added reusable builder, dependency-builder, reviewer, and verification-only prompt templates to `tasks/orchestrator.md`.
- Shipped: Slice 2 used PR #349 as the first revived PR pilot. A builder agent verified the dependency diff in an isolated temp worktree, and a reviewer agent independently classified it as package-mergeable but blocked under a mandatory high-audit gate because `vite` and `ws` high advisories remain baseline debt.
- Shipped: Slice 3 chose a manual-first recurring wake-up policy. Real recurring automation is deferred until explicitly requested; future manual "Next" turns run one bounded slice, report only decision-worthy changes, and stop on policy, file-ownership, verification, or environment blockers.
- Verified: `git status --short`; `gh pr list`; `gh pr view` for PRs #349, #353, and #324; task queue and active plan inspection; `git diff --check`.
- Deferred: PR closure, dependency branch changes, real recurring automation creation, and product code changes outside the already-completed kiosk/report slices.
