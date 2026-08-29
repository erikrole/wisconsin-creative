---
name: gt-ios-slice
description: Canonical Wisconsin Creative native iOS implementation workflow. Use when the user runs /gt-ios-slice, asks to implement or polish a Wisconsin SwiftUI workflow, changes an API payload consumed by iOS, or needs native app readiness work. Keep native workflows native and verify the affected target.
---

# GT iOS Slice

Implement one native slice while preserving API rollout safety, target membership, and product boundaries.

## Orient

1. Read `AGENTS.md`, `docs/NORTH_STAR.md`, `docs/AREA_MOBILE.md`, the feature area doc, decisions, gaps, active ledger, and prior audit.
2. Read the target view and dependent stores, models, clients, services, tests, server routes, and response envelopes completely.
3. Confirm the affected Xcode target, deployment baseline, existing native pattern, and project membership rules.
4. Inspect `git status --short` and preserve unrelated work.

## Execute

1. Use `gt-plan` for a non-trivial slice.
2. Define the user-facing workflow and recovery behavior.
3. Keep the experience native-first, action-first, role-aware, and accessible.
4. Make decoded payload changes tolerant of rollout skew unless server-first deployment is guaranteed and recorded.
5. Register new Swift files in the explicit Xcode project and correct target membership.
6. Keep shared API, model, store/service, view, tests, and docs independently reviewable when substantial.

## Verify

Select proof from the `AGENTS.md` verification matrix. Use the current iOS scripts in `package.json`, including project checks, drift/gap checks, the affected target build, and relevant Swift source-contract tests. Launch and inspect the changed flow when simulator runtime proof is requested and available.

Do not call the slice ready from source edits or TypeScript tests alone. Record any build, device, entitlement, authentication, or runtime blocker precisely.

Use `area-doc-sync` when behavior ships. Do not commit, push, upload, or open a PR unless explicitly requested.
