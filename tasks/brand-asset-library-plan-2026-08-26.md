# Brand Asset Library — 2026-08-26

## Goal

- Add a lightweight versioned file system under the Resources tab for the Wisconsin Athletics brand guide and related logos, fonts, templates, and production assets.
- Keep one stable logical file per name/folder while preserving every uploaded replacement as immutable version history.
- Use Vercel Blob client uploads and an authenticated app boundary instead of hand-rolling binary transport or exposing public asset URLs.

## Route

- Owner area: Resources / Brand assets (`/resources?tab=brand-assets`)
- Secondary areas: Prisma schema/migrations, audit, private Blob storage configuration
- Brief: `docs/BRIEF_BRAND_ASSET_LIBRARY_V1.md`
- Area doc: `docs/AREA_RESOURCES.md`
- Decision: `docs/DECISIONS.md` D-059

## Source checks

- `src/app/(app)/resources/page.tsx` owns the existing guide-first Resources shell and URL-backed query state.
- `src/lib/guides.ts` and the `Resource` model remain the Markdown guide system; the asset library is additive rather than a polymorphic rewrite of guides.
- `@vercel/blob/client` already provides the large-file client upload flow, while the repository has existing server-side Blob and authenticated route patterns.
- Existing `resource.view`, `resource.create`, and `resource.edit` permissions cover the V1 role boundary; collaborators remain default-deny under the current map.
- Existing audit and serializable-transaction helpers provide the required mutation contracts.
- The attached guide’s sections suggest useful folder names, but no category folders or files are seeded; PDF prose is content, not application instructions.

## Product and storage contract

- All authenticated internal Resource readers may browse and download current or historical versions.
- Staff/Admin may create folders, create logical files, and replace an existing file with the next version. There is no destructive delete path. No PDF, asset, or category-folder records are seeded; the migration only creates the empty technical root container.
- A short-lived upload intent binds the exact pathname, expected size, expected content type, target asset, and actor. Finalization re-reads Blob metadata before the serializable database transaction creates the version and advances the current pointer.
- The asset store is a dedicated private Vercel Blob store configured by `RESOURCE_ASSET_BLOB_READ_WRITE_TOKEN`. It is separate from public guide images and private Signature Capture artifacts.

## Stop conditions

- Stop schema/API work if the current migration prefix or dirty `prisma/schema.prisma` changes overlap this additive model and cannot be preserved safely.
- Stop storage rollout if a dedicated private Blob token is unavailable; do not silently fall back to the public image store.
- Stop if a proposed replacement deletes or overwrites an earlier version, returns a raw Blob URL, or lets the client choose the current version.
- Stop runtime claims when authenticated browser access or private-store provisioning is unavailable; source/build proof does not replace those gates.
- Preserve unrelated work already present in the working tree.

## Slices

- [x] Slice 1: Record the brief and D-059 storage/versioning decision.
- [x] Slice 2: Add the folder, logical asset, immutable version, and upload-intent schema/migration with only the empty technical root container.
- [x] Slice 3: Add intent-bound private Blob upload, authenticated finalization, folder/list/history/download APIs, and audit coverage.
- [x] Slice 4: Wire the Brand assets tab, folder navigation, upload/new-version dialog, and version history UI.
- [x] Slice 5: Add focused source/unit contracts, sync Resources/gap/task docs, and run migration/TypeScript/lint/build checks.
- [ ] Slice 6: Complete matched `gt-ui-review` captures and the upload/replacement/history/audit lifecycle. Dedicated store provisioning, Preview migration, authenticated Admin empty-state read, and empty private-store/database read-back are complete; no content was seeded. The current Preview PDF is explicit user test data, not seeded content.
- [x] Slice 7: Add the approved experience follow-up: folder-tree search/filter/sort, authenticated previews, version notes, audited restore-as-new-version, multi-file drag/drop/retry/conflict handling, favorites, device-local recents, and authenticated internal links.
- [ ] Slice 8: Complete populated authenticated browser proof for upload/replacement/preview/history/restore/favorite/link behavior, and refresh the matched UI review without seeding deployment content. The explicitly uploaded Preview PDF has completed upload/download/preview route read-back; replacement, history, restore, favorites, internal-link, and matched-capture proof remain open. Preview migration `0136_brand_asset_experience` is applied and read back cleanly; Production rollout remains a separate deployment gate.
- [x] Slice 9: Rework the Brand assets surface against the supplied Google Drive reference: working New/Home/Recent/Starred navigation, suggested-folder tiles, a compact toolbar, and a table-first file view. Focused tests, TypeScript, lint, build-app, docs verification, clean authenticated desktop browser proof, and image-to-code design QA pass; same-product matched before/after capture remains intentionally open because the starting component was untracked.
- [x] Slice 10: Bug-fix and hardening pass on the shipped surface. Fixed unreachable nested folders, sibling-prefix descendant search, the inert Home rail button, the internal-link preview that reopened on close, the replacement queue emptied by re-picking the same file, and the batch stalled by one duplicate name. Hardened finalize-time version numbering, named folder-name conflicts, sandboxed inline SVG, stored-object `Content-Length`, expired-intent pruning, validated device-local recents, and capped row thumbnail/specimen downloads. Added drop-to-upload on the folder view, sortable column headers, child folders in the rail, and client-side type/size pre-validation. Focused tests, TypeScript, ESLint, and `build:app` pass; unauthenticated route shape re-verified locally.
- [ ] Slice 11 (proposed, needs approval): rename and move for files and folders, plus a reversible delete path. The V1 brief defers all three, so this stays a separate product decision rather than part of the hardening pass.

## Verification

- `npx prisma validate` and `npm run db:migrate:check`
- Focused asset-library tests and route/source contracts
- `npx tsc --noEmit --pretty false`
- Focused ESLint, then full lint if the repository remains stable
- `npm run build:app`
- `npm run codemap` followed by `npm run verify:docs` when generated route/schema maps change
- `git diff --check`
- Authenticated browser proof for the Brand assets tab and empty-state read is complete; the explicit Preview PDF upload/download/preview route is also read back. Folder navigation, replacement, History, restore, favorites, internal links, and narrow-width coverage remain the content-lifecycle gate
- Matched before/after `gt-ui-review` page with the same role/data/viewport and no unrelated Resources changes
- Private Blob store provisioning and Preview migrations `0135`/`0136` are complete. The initial zero-content read-back remains the provisioning evidence; the current explicitly uploaded PDF and any replacement remain rollout evidence, not source-only evidence

## Review

- Local implementation complete: contract, schema/migration, private Blob boundary, API, UI, tests, docs, and build gates are recorded.
- Runtime proof partially complete: dedicated private-store provisioning, Preview migrations `0135`/`0136`, authenticated Admin empty-state read, and zero-content provisioning read-back pass; the explicitly uploaded PDF also has successful upload/download/preview route read-back. The Drive-inspired navigation and table redesign has clean authenticated desktop proof. Replacement/history read-back, audit read-back, and matched same-product before/after captures remain open.
- Deferred: delete/move/rename, public publishing, external sharing, generated server thumbnails, approval workflows, and automatic PDF ingestion.
