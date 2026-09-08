---
name: gt-ship
description: "Verify and perform the explicitly requested Wisconsin Creative commit, push, PR, deployment, or release for a bounded slice. Preserve unrelated dirty work and report each completed publication step."
---

# GT Ship

Inspect the request, current branch/status, in-scope diff, and owner ledger. Reuse the authorization already supplied for a named shipping workflow. A request to verify or commit does not automatically authorize push, deployment, or release; do not ask separately for steps already included.

## Prepare

Identify intentional tracked and untracked paths; never sweep unrelated dirty work. Review the final diff and affected contracts. Use `area-doc-sync` only for relevant documentation. Verify the applicable `AGENTS.md` matrix, including runtime/device/migration evidence when required. A blocked external gate must remain visible; unrelated failures require evidence before exclusion.

## Perform the authorized action

- Verify-only: report readiness; do not stage files.
- Commit: stage explicit paths, inspect staged content and staged file list, and create a specific conventional outcome-oriented commit. Preserve unrelated staged changes; use an isolated approach if scope cannot be separated safely.
- Push/PR: confirm branch, remote, target, and exact commit; push or update the requested PR, then read back its state. Account for automatic deployment associated with the target.
- Deployment: identify environment and source SHA, use safe migration preflight where relevant, and verify the affected deployed surface. A pushed commit is not deployment proof.
- Release: inspect `scripts/release.sh` before invocation. It updates package versions, commits, creates a CalVer tag, and pushes branch/tag; it is not a compile/test-only command. Preview with its dry-run on a suitable clean checkout and run the mutating path only when release is authorized. A GitHub release is distinct from App Store/TestFlight distribution.

Never stash or delete unrelated work to satisfy a clean-tree requirement. Do not make a standalone generated-artifact or tsbuildinfo commit.

Report scope, tests/runtime proof, commit, remote SHA/PR, deployment, release/distribution, and unresolved gates only where applicable. Keep local completion distinct from shipped production state.
