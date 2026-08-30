# Add Item Workflow and Image Chooser Plan - 2026-07-28

## Goal
- Keep Add Item as one comprehensive web sheet while making tracking selection, image choice, repeated intake, and post-create recovery consistent across serialized items and item families.

## Route
- Owner area: Items
- Secondary area: Bulk Inventory
- Ledger: `tasks/add-item-workflow-plan.md`
- Existing reference: `tasks/archive/add-item-flow-quick-fixes-plan.md`

## Source Checks
- `src/app/(app)/items/new-item-sheet.tsx` owns all three tracking modes and the post-create handoff.
- `src/components/ChooseImageModal.tsx` already owns persisted item and item-family search, URL, upload, and removal.
- Asset and bulk-SKU image routes already provide permission-checked, audited Blob persistence.
- The current serialized pre-create photo path posts multipart field `image`, while the image route requires `file`.

## Stop Conditions
- Stop if either create response does not return a durable catalog ID.
- Stop if create permission does not allow the corresponding image mutation for the same operator.
- Stop if the shared modal cannot preserve its current item-detail and item-family-detail callers.

## Slices
- [x] Slice 1: Add draft image selection to the shared modal without changing persisted callers.
- [x] Slice 2: Unify Add Item image staging and post-create persistence across new Standard, Units, and Quantity records.
- [x] Slice 3: Normalize the full-sheet hierarchy and repeated-intake success/reset behavior.
- [x] Slice 4: Add focused regression coverage and sync Items, Bulk Inventory, and design-language docs.

## Verification
- [x] Focused Add Item, image modal, image-search, and pending-action Vitest coverage.
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [x] `npm run codemap`
- [x] `npm run verify:docs`
- [x] `npm run db:migrate:check`
- [x] `git diff --check`
- [x] `npm run build:app`
- [ ] Authenticated browser smoke on `/items` at desktop and narrow widths, or record the exact blocker.

## Review
- Shipped: Add Item now stages Search, Paste URL, or Upload images before create for new Standard, Units, and Quantity records; saves through the correct audited endpoint after ID return; isolates image retry from record creation; removes duplicated tracking guidance and the pre-submit Add another checkbox; and fully resets repeated intake to Standard.
- Verified: 23 focused Vitest assertions, focused and full lint, TypeScript, migration-prefix check, regenerated/current codemaps, whitespace check, and `npm run build:app`.
- Deferred: No native iOS work, schema change, new route, or image change for Quantity add-to-existing.
- Blocked: Authenticated browser proof. The only available in-app browser blocks localhost; its LAN request reached `/items` and received the expected `307` to `/login`, but no authenticated browser was available. A concurrent build/dev `.next` collision then made `/login` return 500, so no visual or narrow-width claims are recorded.
- Proof artifacts: Focused test output (5 files, 23 tests) and successful 210-page app build in this session.
- Next slice or stop: Stop implementation. Re-run authenticated desktop/narrow Add Item smoke when a local authenticated browser session is available.

## Follow-up - Intake Golden Path - 2026-08-30

### Goal
- Make the required Add Item path visible and finishable without scrolling through optional metadata, while preserving Standard, Units, Quantity, image staging, attachment policy, quantity adjustment, and the existing post-create handoff.

### Source Checks
- `docs/AREA_ITEMS.md` requires Standard fast intake to keep asset tag, category, location, and QR code together and says optional metadata is collapsed by default.
- The current Standard form renders product, image, procurement, notes, and policy sections expanded between or after required fields, so the live sheet contradicts that surface contract.
- `POST /api/assets` and `POST /api/bulk-skus` already return durable created IDs and enforce permission, reference, uniqueness, transaction, and audit contracts; this follow-up does not need a schema or mutation-route change.
- `NewKitSheet` and `AddLicenseDialog` establish the local create-flow patterns worth reusing: first-field focus, field-associated errors, stable pending actions, product-language submit labels, and explicit post-create recovery.

### Stop Conditions
- Stop if collapsing optional groups can hide a required attachment, stock-adjustment, or image-retry action.
- Stop if a visual refactor changes serialized or item-family payloads, eligibility defaults, quantity-unit creation, or audited image persistence.
- Stop if the authenticated baseline and after capture cannot be made from the same role, data, viewport, and entry state; record the browser blocker instead of claiming matched visual proof.

### Slices
- [x] Slice 5: Recompose tracking selection and Standard fast intake so the four required fields are one compact golden path and optional groups are discoverable but collapsed by default.
- [x] Slice 6: Add field-associated validation, focus/scroll recovery, accurate submit language, 40px controls, responsive narrow-sheet layout, and accidental-discard protection across all tracking styles.
- [x] Slice 7: Add focused regression coverage, sync Items documentation, run web verification gates, and record the matched-capture blocker without publishing unmatched proof.

### Verification
- [x] Focused Add Item UI, submit-payload, image, quantity-adjustment, and API contract tests.
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [x] `npm run codemap` before docs verification if shared component ownership or codemaps changed.
- [x] `npm run verify:docs`
- [x] `npm run db:migrate:check`
- [x] `git diff --check`
- [x] `npm run build:app`
- [x] Authenticated `/items` browser smoke covering Standard, Units, Quantity, validation recovery, discard confirmation, disclosure/scroll behavior, retryable stock-load failure, console/network state, and desktop/narrow widths.
- [ ] Real Standard create and Quantity adjustment handoff mutation proof; Preview item APIs currently return Prisma `P2022` against the dirty-worktree schema, and no test data was created.
- [x] `gt-ui-review` stop condition recorded: the supplied production appshot was not available as a local baseline, and local Preview could not reproduce the same populated data/API state, so no unmatched review artifact was published.

### Follow-up Review
- Shipped: Required-first Essentials flows for Standard, Units, and Quantity; collapsed optional groups; explicit create-versus-add-stock choice; exact whole-number quantity validation; field-associated focus recovery; tracking-aware progress and submit language; dirty-sheet discard confirmation; honest stock lookup states; and refreshed post-create handoff exits.
- Verified: Six focused files / 40 tests, TypeScript, full lint, current codemaps, docs verification, migration naming/history check, scoped diff check, and a clean 251-page `npm run build:app`. Authenticated local browser proof covered the desktop sheet and a 390 x 844 viewport, required-field focus, optional disclosure, Quantity modes, discard recovery, anchored actions, and the retryable failed-stock state.
- Deferred: No mutation route, schema, migration, seed data, commit, push, or deployment was part of this UI slice.
- Blocked: Preview item reads and submits hit Prisma `P2022` against the current dirty-worktree schema, so creating a disposable Standard item and exercising a real Quantity adjustment were not safe proof. A matched before/after review was also unavailable because the supplied production appshot was not a local capture and local Preview did not have the same populated data/API state.
- Proof artifacts: Focused test/build output and authenticated in-app browser inspection in this session. No `gt-ui-review` page was published because its matched-capture contract could not be met.
- Next slice or stop: Stop local implementation. Once Preview schema and item APIs agree, run an authorized disposable Standard create and Quantity adjustment through the shared handoff, then capture matched production-state before/after proof without changing the implementation.

## Follow-up - Repeated Serialized Intake - 2026-08-30

### Goal
- Let an operator add another physical copy of an existing serialized product, or continue a same-product intake batch, without re-entering shared metadata or accidentally carrying forward unit-specific identity and procurement values.

### Source Checks
- The current `Duplicate` actions call `POST /api/assets/[id]/duplicate` immediately, invent `-COPY-` tag and serial values, and copy purchase, warranty, residual, and notes fields that describe the old physical unit. That is not a safe intake workflow for a newly purchased FX3.
- `GET /api/assets/[id]` already returns the reusable source identity, taxonomy, location, image, product link, and workflow policy needed to seed the normal Add Item form.
- `POST /api/assets` remains the authoritative permission-checked, uniqueness-enforced, audited mutation. This slice needs no schema, migration, or new mutation route.
- Repeated asset-tag helpers already identify families such as `FX3`, `FX3 2`, and `FX3 4`; the copy-forward path can use that source truth to suggest the next tag while leaving serial, QR, campus tag, purchase/warranty values, fiscal year, and notes as new-unit fields.

### Stop Conditions
- Stop if the source item read cannot distinguish reusable product defaults from per-unit values.
- Stop if copy-forward bypasses the normal create validation, uniqueness, audit, image persistence, or post-create handoff.
- Stop if the UI implies item-family `Units` records support per-unit serial/procurement metadata; this slice is for Standard serialized copies only.
- Stop if matched before/after proof cannot use the same role, data, viewport, and entry state; record the blocker instead of publishing unmatched captures.

### Slices
- [x] Slice 8: Define a serialized intake template that carries product/taxonomy/location/image/policy defaults, suggests the next asset tag, and clears every physical-unit-specific field.
- [x] Slice 9: Replace instant `Duplicate` entry points with `Add another like this`, load the source into the reviewed Add Item sheet, and let the success handoff continue a same-product batch or start a different item.
- [x] Slice 10: Add focused regression coverage, sync Items documentation, and run source, build, authenticated browser, and matched visual-review gates.

### Verification
- [x] Focused Add Item template, repeat-tag, handoff, item-list action, item-detail action, payload, and image tests.
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [x] `npm run codemap` when generated ownership maps drift.
- [x] `npm run verify:docs`
- [x] `npm run db:migrate:check`
- [x] Scoped `git diff --check`
- [x] `npm run build:app`
- [ ] Authenticated `/items` and serialized item-detail smoke covering source loading, copied-versus-cleared fields, same-product continuation, recovery, and narrow width.
- [x] `gt-ui-review` matched before/after page, or an explicit matched-capture blocker.

### Repeated Intake Review
- Shipped: Serialized list and detail actions now open `Add another like this` in the normal Add Item sheet. Reusable product, category, department, location, link, image, and workflow defaults carry forward; the next asset tag is suggested; QR is regenerated; and serial, campus tag, procurement, fiscal-year, residual, and notes fields start fresh. The handoff can continue the same-product batch or start a different item.
- Verified: Six focused files / 43 tests, TypeScript, full lint, migration naming/history, current codemaps, docs verification, scoped whitespace review, a React-specific source pass, and a clean 251-page `npm run build:app` after preserving and replacing one stale generated cache.
- Deferred: The compatibility duplicate API remains available to unknown older callers, but the Items list and serialized detail no longer call it. No schema, migration, mutation route, commit, push, deployment, or real inventory creation was part of this slice.
- Blocked: Authenticated Preview reached `/items` as ADMIN, but `/api/assets?limit=25&offset=0&sort=popular` returned Prisma `P2022` from `bulkSku.findMany` against the dirty-worktree schema. The list therefore could not expose a real serialized row or item-detail source for copy-forward/browser proof. The shared `.next` directory also became incomplete during that Preview session, so the server was stopped. A matched before/after review could not be produced from the same role, data, viewport, and source state.
- Proof artifacts: Focused test, type, lint, docs, migration, diff, and build output plus authenticated browser/server inspection in this session. No unmatched `gt-ui-review` page was published.
- Next slice or stop: Stop local implementation. After Preview schema and item APIs agree, smoke one disposable serialized source through `Add another like this`, verify copied-versus-cleared values and same-product continuation at desktop and narrow widths, then produce matched visual proof.

## Follow-up - Serialized Batch Intake - 2026-08-30

### Goal
- Let an operator receive up to 25 copies of one serialized product in one keyboard-friendly workspace: shared product and shipment details are entered once, while tag, serial, QR, and campus tag remain explicit per-unit identities.

### Source Checks
- `SerializedItemForm` currently owns one serialized payload and already separates safe reusable product defaults from physical-unit identity and procurement values.
- `POST /api/assets` is the established authenticated, permission-checked, schema-validated, uniqueness-enforced, and audited create boundary. It creates one physical asset and returns `{ data: { id, ... } }` with HTTP 201.
- There is no accepted batch-asset mutation contract. This slice will keep each unit on `POST /api/assets`, submit a bounded batch from the client, and surface partial success by exact unit so a retry never repeats an already-created asset.
- Product metadata, category, department, location, link, image, and workflow policy are shared. New-shipment purchase date, price, warranty, residual value, fiscal year, and notes apply to every new unit but never come from the older source item. Asset tag, serial, QR, and UW tag remain editable per row.
- Existing shadcn sheet, input, textarea, alert, badge, button, and table/card primitives are sufficient; no new visual primitive or schema is required.

### Stop Conditions
- Stop if batch mode can submit duplicate tags, nonblank duplicate serials, duplicate QR values, blank required unit identity, or more than 25 units.
- Stop if a partial failure can cause successful rows to be submitted again or can be described as a fully successful batch.
- Stop if shared shipment values leak from the older source item, or if batch mode changes attachment, Units-family, Quantity-stock, image-audit, or single-item behavior.
- Stop if matched before/after proof cannot use the same role, source data, viewport, and entry state; record the blocker instead of publishing unmatched captures.

### Slices
- [x] Slice 11: Add a tested serialized-unit draft model for bounded row generation, deterministic next tags and QR codes, in-batch uniqueness validation, progress, and clipboard serial parsing.
- [x] Slice 12: Add single-versus-batch intake controls, shared shipment fields, responsive unit rows, keyboard/paste entry, bounded existing-route submission, and exact success/partial handoff recovery.
- [x] Slice 13: Add focused regression coverage, sync Items documentation, and run source, build, authenticated browser, keyboard/narrow-width, and matched visual-review gates.

### Verification
- [x] Focused batch draft, validation, clipboard, serialized payload, submission, partial handoff, and existing single-item regression tests.
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [x] `npm run codemap` when generated ownership maps drift.
- [x] `npm run verify:docs`
- [x] `npm run db:migrate:check`
- [x] Scoped `git diff --check`
- [x] `npm run build:app`
- [ ] Authenticated `/items` and serialized detail smoke at desktop and narrow widths without creating production inventory.
- [x] `gt-ui-review` matched before/after page, or an explicit matched-capture blocker.

### Batch Intake Review
- Shipped: Standard Add Item can now receive 1–25 physical records with one shared product/shipment workspace and explicit per-unit tag, optional serial, QR, and campus tag rows. Changing the first generated tag advances untouched later rows, pasted serial columns expand the batch, Enter advances through the serial column, in-batch identities validate before submit, and the action reports record/image progress. Each row still uses the existing audited asset-create route. Full success can repeat the same shipment size; partial success keeps only unfinished rows and preserves original next-tag and image-retry state so created records never resubmit.
- Verified: Seven focused files / 51 tests, TypeScript, full ESLint, current codemaps, docs verification, migration naming/history, scoped whitespace checks, and a clean 251-page `npm run build:app`. The full dirty-checkout suite reached 4,158 passing tests; its 25 failures are in unrelated in-progress Schedule, iOS, kiosk, Role Preview, Resources, and shared source-contract work, with no Add Item failure.
- Deferred: No schema, migration, new API route, item-family behavior, compatibility-route removal, commit, push, deployment, or real inventory mutation was part of this slice.
- Blocked: Authenticated desktop/narrow browser and matched before/after proof remain unavailable. The shared Chrome DevTools profile is locked by another browser session, the isolated `agent-browser` executable is not installed, and the most recent authenticated Preview Items read still failed with Prisma `P2022` against the dirty-worktree schema. No unmatched review artifact or unsafe test inventory was created.
- Proof artifacts: Focused and full test output, TypeScript/lint/docs/migration/diff output, and the successful 251-page app build in this session. The visual-review stop condition is recorded instead of publishing unmatched captures.
- Next slice or stop: Stop implementation. Once Preview schema and item APIs agree and an authenticated browser is available, smoke a disposable 3-row Standard shipment from an existing serialized source at desktop and 390px width, deliberately force one uniqueness conflict to confirm `Fix remaining`, then capture matched before/after proof without expanding the implementation.
