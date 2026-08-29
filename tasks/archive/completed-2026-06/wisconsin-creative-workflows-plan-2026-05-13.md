# Wisconsin Creative Workflows Plugin Plan - 2026-05-13

## Goal
- Add a repo-local plugin with focused command-style skills for repeated Wisconsin Creative work.
- Keep the workflows narrow enough to execute, verify, and ship without turning every request into a custom process.

## Plan
- [x] Create repo plugin marketplace entry.
- [x] Add `wisconsin-creative-workflows` plugin manifest.
- [x] Add focused workflow skills for planning, web page execution, web and iOS audits, API hardening, Prisma/Neon migration work, shipping, deploy recovery, iOS slices, and post-merge cleanup.
- [x] Validate plugin and skill metadata.
- [x] Document activation and next-session behavior.

## Review
- Shipped: Repo-local `wisconsin-creative-workflows` plugin with command-style skills for `/gt-plan`, `/gt-page`, `/gt-audit-web`, `/gt-audit-ios`, `/gt-api-hardening`, `/gt-migrate`, `/gt-ship`, `/gt-deploy-debug`, `/gt-ios-slice`, and `/gt-clean-after-merge`.
- Verified: JSON manifests parse with `jq`; every new plugin skill validates with `quick_validate.py`; existing updated `area-doc-sync` and `prisma-migrate-safely` skills validate after removing unsupported frontmatter.
- Follow-up: `/gt-clean-after-merge` found stale guidance in existing audit/doc-sync skills. Web audit now uses app-only verification unless deploy behavior is in scope, iOS audit now allows drift/gap checks and simulator builds after fixes, and doc sync uses `git status --short` so untracked files are not missed.
- Deferred: The current Codex session may need a reload before plugin-provided skills appear in the active skill list.
