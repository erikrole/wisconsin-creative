# Resource importer hardening and Preview rollout

Date: 2026-09-11
Owner: Erik Role
Status: Source fixes verified; Preview apply blocked by historical migration provenance (GAP-79).

## Scope and authority

User requested auditing/improving the backend guide importer before applying the previously proposed Preview rollout. This authorizes importer fixes and the target Preview migration, not production deployment, historical receipt rewriting, database reset, or adoption/overwriting of the published Football guide. No commit/push was requested. The worktree was clean at start.

Owners: `src/lib/resource-import.ts`, `src/lib/resource-import-images.ts`, `src/app/api/resources/import/route.ts`, import schemas in `src/lib/validation.ts`, focused tests, `docs/AREA_RESOURCES.md`, `docs/GAPS_AND_RISKS.md`. Existing migration `0146_resource_import_key` and Prisma schema were reviewed but not changed. Markdown readers/editor/native behavior remain unchanged.

## Bounded plan and results

- [x] Audit validation, auth/ownership, update semantics, image transport, transaction/audit behavior and real Preview migration state.
- [x] Preserve omitted publication/type/targeting/feature settings and canonical Markdown; return proposed content and current version in dry-run.
- [x] Default to dry-run; require explicit apply and update version. Enforce permissions/ownership at both route and callable service boundaries.
- [x] Bound and validate JSON/multipart parsing, reject ambiguous/unknown/duplicate image inputs and malformed placeholders.
- [x] Remove the Blob URL substring bypass. Rehost only allowlisted HTTPS provider URLs, validate every redirect and MIME/signature, enforce per-image/aggregate bytes and shared deadline, prepare all inputs before uploading, reuse content-addressed objects.
- [x] Keep stable slugs, no-op unchanged imports, retry a create uniqueness race, and record Markdown hashes with transactional audits.
- [x] Run local focused tests, types, full lint, compile-only build and migration-shape checks.
- [ ] Reconcile original historical migration evidence for Preview; no forcing receipts or bypass deploys.
- [ ] Apply authorized forward migrations through the supported wrapper; read back column/index and migration health.
- [ ] Verify dedicated Preview public-image credentials, authenticated API dry-run/apply/retry, rendered image and audit read-back.

## Verification

- `npx vitest run tests/resource-import.test.ts tests/resource-import-images.test.ts tests/resource-import-route.test.ts tests/resource-types.test.ts tests/markdown-reader.test.ts tests/rbac.test.ts tests/rbac-route-contract.test.ts`: 77 tests passed (19 service, 18 image, 10 HTTP, 30 adjacent contracts).
- `npx tsc --noEmit --pretty false`: passed; also passed the build's type gate.
- `npm run lint`: passed.
- `npm run build:app`: passed, including 260 prerendered pages and the importer route. No dev server occupied port 3000. This command does not deploy migrations.
- `npm run db:migrate:check`: 152 migration folders valid; `db:migrate:guard`: passed.
- `npm run codemap` and `npm run verify:docs`: passed; only importer-related generated maps changed. `git diff --check` and final focused lint/type checks passed.
- HTTP tests run the actual `withAuth` wrapper with mocked authentication/storage; they are not live authenticated-runtime proof. Service transaction mocks prove call/error behavior, not real database rollback.

## Live target evidence and blocker

Authenticated Neon operator reads verified project `flat-night-29913432`, database `gear-tracker`, branch `preview-default` (`br-morning-surf-aiuyphxx`). Complete live receipts were evaluated using the repository's `evaluateMigrationHealth` implementation and SHA-256 hashes of current migration files:

- 149 of 152 local migration names applied; none missing locally and no unresolved failed rows.
- Pending: `0144_restore_asset_allocation_overlap_guard`, `0145_restore_declared_lookup_indexes`, `0146_resource_import_key`.
- 43 historical checksums unverified; one mismatch in `0071_add_event_subtitle`.
- Physical catalog: import-key column absent, unique import-key index absent, allocation-overlap guard absent.
- `docs/PRISMA_NEON_RUNBOOK.md`, Recovery Rules: "Reconcile original deployment evidence before another deployment"; do not populate old receipts with current hashes.
- Local `.env.preview.local` names an older endpoint, not the current isolated Preview endpoint. It was not loaded into a runtime or used for writes. The runbook scopes production Blob tokens out of Preview; dedicated test credentials must be verified before image proof. No secret values were printed.

No live migrations, resources, audit rows, sessions, Blob objects, production settings or deployments were mutated. Applying safely now requires the distinct database-history reconciliation work recorded in `tasks/database-audit-plan-2026-09-07.md`.

## Remaining limitations

Dry-run checks local file signatures and plans URLs but does not fetch remote content or validate Blob credentials. Use a file for a non-allowlisted image host. The HTTP body ceiling includes multipart overhead, so large images need the remote route or prior approved upload. A DB/audit failure after uploads may leave reusable content-addressed objects; deleting them automatically could break another import. A manually authored guide is not adopted by matching title: identify an explicit migration/adoption strategy before reimporting the already published Football guide. The UI editor remains available.
