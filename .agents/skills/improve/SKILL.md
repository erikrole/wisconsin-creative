---
name: improve
description: "Audit Wisconsin Creative repository-wide priorities, technical debt, and implementation candidates from current evidence."
---

# Improve Wisconsin Creative

Survey the current repository as a senior advisor. Produce a short, evidence-backed priority list. Keep evidence gathering read-only; continue implementation when the same request asks to clean up, fix, or improve the evidenced issues.

## Establish current truth

1. Read `AGENTS.md` and the task index. Use `docs/NORTH_STAR.md` for product-direction questions; search current ledgers, lessons, decisions, and gaps for the audit scope. Read task-lifecycle guidance before creating or moving a plan.
2. Inspect `git status --short`, recent history, package scripts, CI, schema, app boundaries, tests, and the highest-risk or highest-churn areas relevant to the request.
3. Treat `plans/README.md` as historical unless `tasks/INDEX.md` or the current request explicitly activates an improve-plan batch.
4. Separate shipped main-branch truth, active dirty work, historical recommendations, and live/runtime evidence.

## Audit

Choose depth from the request:

- Quick: highest-risk correctness, security, and verification issues.
- Standard: correctness, security, performance, tests, architecture, dependencies, DX, docs, and product direction.
- Deep: broad repository coverage with explicit exclusions and confidence limits.

Use read-only parallel agents only when the user requests delegation or the active agent instructions explicitly allow it. Give each agent a bounded evidence-gathering scope. Verify every retained finding directly against current source before presenting it.

## Findings

For every finding include:

- Evidence with exact paths and lines.
- User or operator impact.
- Confidence.
- Effort and change risk.
- The smallest safe next slice.
- Dependencies or active-work overlap.

Reject speculative, duplicate, historical, or low-leverage findings. Present product-direction options separately from defects.

## Planning and execution routing

- For planning only, route selected findings through `gt-plan` and the current task-root contract.
- Update an existing active ledger before creating a new plan.
- Create a batch under `plans/` only when the user explicitly requests an improve-plan batch; register its active status and routing in `tasks/INDEX.md` and `tasks/todo.md`.
- Execute when the current request already asks to implement, fix, or clean up the in-scope findings; diagnosis is not an extra permission checkpoint.
- Use the canonical domain skill for implementation: `gt-page`, `gt-api-hardening`, `gt-ios-slice`, `gt-migrate`, or another current owner.
- Use reversible isolation when needed to preserve user work. Delegation follows active agent instructions. Commits, issues, PRs, pushes, and merges require existing user authorization.

## Explicit variants

- `quick`, `standard`, or `deep`: set audit depth.
- `branch`: audit the current branch diff and direct consumers; label findings introduced or pre-existing.
- `plan <description or finding>`: skip the broad audit and use `gt-plan` to create or update the current task-ledger entry.
- `execute <plan or finding>`: reconcile the input against current source and active dirty work, then execute through the canonical domain skill. The word `execute` authorizes implementation, not automatic branching, delegation, commit, push, PR, or merge.
- `reconcile`: verify historical plan status against current source and move any still-actionable work into the current task system without reopening completed findings.
- `--issues`: create GitHub issues only when this explicit flag is present and issue creation is otherwise authorized.

## Closeout

Report what was audited, what was excluded, the ranked findings, rejected candidates worth remembering, active-work conflicts, and the recommended next slice. Keep the chat report concise; durable detail belongs in the selected task ledger.
