---
name: gt-ship
description: Canonical Wisconsin Creative closeout and shipping workflow. Use when the user runs /gt-ship or explicitly asks to verify and close out a completed slice, stage and commit it, push it, prepare a PR, or perform another named shipping action. Never sweep unrelated dirty work or infer permission for later shipping steps.
---

# GT Ship

Close out only the authorized slice. Treat stage, commit, push, PR, deployment, upload, and release as separate permissions unless the user explicitly groups them.

## Establish scope

1. Read `AGENTS.md`, `git status --short`, `git diff --name-only HEAD`, the active ledger, relevant area docs, and gaps.
2. Identify in-scope tracked and untracked files from the user request and ledger.
3. Inspect the final diff and leave unrelated files unstaged.
4. Use `area-doc-sync` when shipped behavior or accepted contracts changed.

## Verify

Select the complete minimum proof from the `AGENTS.md` verification matrix for every affected platform and behavior. Add:

- Focused tests for the changed contract.
- Authenticated browser proof for visible web workflows, or the recorded blocker.
- Relevant iOS project, drift, source-contract, build, and runtime proof for native work.
- Controlled migration health and deploy-shaped proof for schema or deployment work.

Do not treat an existing failure as harmless until evidence shows it is unrelated to the slice.

## Ship only what was requested

1. Stage only in-scope files, including intentional untracked files.
2. Recheck the staged diff and staged file list.
3. Commit only when requested, using `feat:`, `fix:`, or `chore:` and a user-facing outcome.
4. Push, open or update a PR, deploy, upload, or release only when each action is explicitly requested or already part of the named workflow.
5. Record resulting commit, branch, PR, deployment, or release evidence in the active ledger when created.

Never create a standalone generated-artifact or tsbuildinfo commit. Close with shipped scope, proof, external blockers, and exact remaining actions.
