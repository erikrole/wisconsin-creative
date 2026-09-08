---
name: gt-plan
description: "Plan a substantial Wisconsin Creative feature, fix, or follow-up from current source. Use for explicit planning or multi-step work needing a durable plan; small implementation tasks can plan inline."
---

# GT Plan

Produce a bounded path to the requested outcome, then continue implementation if already requested. A plan is not an extra approval gate.

1. Inspect working-tree scope, `AGENTS.md`, `docs/NORTH_STAR.md`, the owner source, and relevant area/brief contracts. Search decisions, risks, and lessons for this issue. Inspect schema only when data contracts change.
2. Identify the user-visible outcome, owner area, current evidence, and unresolved decisions. Separate checkout changes from deployed/runtime state.
3. Reuse an existing owner plan when it belongs to this work. Consult `tasks/README.md` and `tasks/INDEX.md` before creating a durable plan or moving one. For a small task, an inline bounded plan is sufficient.
4. Choose the smallest coherent first slice. Split schema/service/client work when independently verifiable; do not force every task into five fixed phases.
5. Record acceptance criteria, affected paths, exact relevant verification commands from `package.json`, and any required authenticated, simulator, device, migration, or deployment proof. The `AGENTS.md` matrix is authoritative; omit unrelated gates.
6. Resolve source/contract discrepancies with available evidence. Ask only for a product decision or authority that cannot be established. Missing external proof need not block independent source work.

Durable plan shape: outcome; owner/scope; source facts; bounded steps; verification; local/deployed status; remaining blockers. Update completion state once it changes, not after every routine tool call.

Planning-only or deferral requests end with the plan/ledger. Implementation requests continue through the primary domain skill. Commit, push, release, and live mutations follow existing authorization; do not infer them from a plan approval.
