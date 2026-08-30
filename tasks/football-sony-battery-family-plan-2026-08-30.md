# Football Sony Battery Family Plan - 2026-08-30

## Goal
- Support `Football Sony Battery` as a separate unit-tracked item family.
- Give it the same reservation, checkout, pickup, return, and custody policy as the normal `Sony Battery` family.
- Do not add a Football-roster gate, role gate, or family-specific picker behavior.

## Route
- Owner area: Bulk Inventory Management.
- Secondary areas: Items, Reservations, and Kiosk custody documentation only.
- Ledger: this plan; the older `tasks/bulk-battery-followups.md` remains for unrelated future battery work.
- Accepted-contract update: clarify D-022 and the owning AREA docs so separate operational families may share one policy.

## Source Checks
- `BulkSku` is already the bookable item-family record, so a second Sony battery family does not require a new schema concept.
- `BulkSkuUnit` owns numbered unit identity and `BookingBulkUnitAllocation` owns exact checkout custody for both families.
- Reservations request family quantity. Exact units bind only during kiosk checkout or pickup under D-040.
- The current checkout is dirty with unrelated Schedule, iOS, macOS, docs, schema, and test work. This slice must remove only the unshipped eligibility-policy work and preserve all unrelated changes.

## Stop Conditions
- Stop before inventing a family QR value, physical unit count, unit-number split, product assignment, source-family transfer, or starting unit number; those require operator-provided physical inventory facts.
- Stop before changing production data, deploying, or redistributing the iOS app without separate authorization.
- Stop if the separate family would change the normal Sony Battery reservation or custody policy.
- Stop if implementation would move custody outside the kiosk or bind exact units during reservation creation.

## Slices
- [x] Slice 1: Record the corrected product contract: two separate unit-tracked Sony battery families with one shared policy.
- [x] Slice 2: Remove the unshipped eligibility schema, migration, API/service guards, special web/native UI, and policy-only tests.
- [x] Slice 3: Sync AREA docs, decisions, gaps, task index, and codemaps to the no-visible-policy-change result; remove the obsolete eligibility review artifact.
- [x] Slice 4: Run focused web/API/native contracts, Prisma checks, TypeScript, lint, app build, iOS build, docs verification, and final diff checks.
- [ ] Slice 5: Create the physical `Football Sony Battery` family and numbered units only after the operator supplies the inventory facts and explicitly authorizes the data change.

## Verification
- [x] Focused Vitest suites for bulk SKU, booking lifecycle, form options, kiosk checkout, item setup, and web/native picker contracts. 176 affected tests pass; one unrelated parallel iOS parity assertion still expects the retired single-array quarter-hour control.
- [x] `npx prisma validate`
- [x] `npm run db:migrate:check`
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [x] `npm run codemap`
- [x] `npm run verify:docs`
- [x] `npm run build:app` from an isolated copy after the shared `.next` trace race reproduced once; all 251 pages build.
- [x] Affected iOS source-contract tests and the pinned iPhone 16 Pro simulator build. The same unrelated parity assertion above remains; the required build passes.
- [x] `git diff --check`
- [x] Confirm the final product source contains no family-specific eligibility field, Football-roster checkout guard, or restricted-family product copy.

## Review
- Shipped: Local uncommitted rollback of the eligibility experiment plus accepted two-family/one-policy docs. Nothing is deployed.
- Verified: 176 affected tests; Prisma schema and migration-folder checks; TypeScript; full lint; current codemaps/docs; isolated 251-page app build; required iPhone 16 Pro / iOS 26.5 build; no-gate source sweep; whitespace check.
- Deferred: Physical Football Sony Battery family/QR/count/unit creation, production data, deployment, native distribution, and commit/push.
- Blocked: Physical family creation needs operator-confirmed inventory facts. One unrelated parallel native source-contract assertion remains stale against the current quarter-hour control implementation.
- Proof artifacts: None required for the rollback because the final source intentionally adds no family-specific UI; the supplied production screenshot remains context for the future physical family setup.
- Next slice or stop: Stop before data mutation. Resume only after the operator confirms physical inventory facts and explicitly authorizes family/unit creation.
