# Color Correction 101 Resource Plan - 2026-08-25

## Goal

- Port the selected `Color Correction 101` tab from the Creative Guides Google Doc into the authenticated Wisconsin Creative Resources library.
- Preserve the source guidance and all 19 embedded screenshots while presenting them as a readable, editable Markdown resource.

## Route

- Owner area: `docs/AREA_RESOURCES.md`
- Ledger: this plan; archive it after the resource is published and verified.
- Target route: `/resources/color-correction-101` (confirmed slug).

## Source Checks

- Source tab is the selected `Color Correction 101` tab in Google Doc `Creative Guides`.
- The selected tab exported to `/Users/role/Downloads/Creative Guides.md` with four sections, 19 embedded PNG data URLs, and no external image URLs.
- Resource Markdown is the source of truth (`docs/AREA_RESOURCES.md`, `docs/GUIDE_MARKDOWN.md`).
- Existing authoring route: `src/app/(app)/resources/new/_components/NewGuideClient.tsx`.
- Existing image contract: `/api/resources/upload-image`, raster-only, 10 MB per image, public Blob URL returned to the Markdown editor.
- Existing reader route: `src/app/(app)/resources/[slug]/_components/GuideReader.tsx` and `src/components/resources/MarkdownReader.tsx`.

## Stop Conditions

- Stop if the downloaded tab does not match the selected `Color Correction 101` source or its embedded image count/content cannot be recovered.
- Stop if the current authenticated user cannot create/publish a Resource or if an image upload fails validation/rate limits.
- Stop if the editor or reader drops image titles, captions, tables, callouts, or other source content; fix the smallest supported contract only after reproducing it.
- Do not delete or overwrite an existing resource with the same title; inspect and use the existing record if one already exists.

## Slices

- [x] Slice 1: Recover the selected source tab and audit its Markdown/images.
- [x] Slice 2: Create the typed `Color Correction 101` Resource with clean Markdown and upload all source screenshots.
- [ ] Slice 3: Publish and verify the resource in authenticated desktop and narrow-width reader views.
- [x] Slice 4: Sync the Resources area doc and record the remaining visual-proof boundary in this ledger.
- [x] Follow-up: Fix reader image sizing so arbitrary source aspect ratios are preserved.

## Verification

- [x] Validate extracted PNG magic bytes, dimensions, and one-to-one Markdown image references.
- [x] Run focused guide-content/reader tests (19 passed), TypeScript (`npx tsc --noEmit --pretty false`), and the repository docs/whitespace checks for the plan and area-doc updates (`npm run verify:docs`).
- [x] Run `git diff --check`.
- [x] Run the image-reader regression test, focused Resources tests (25 passed), `npx tsc --noEmit --pretty false`, targeted ESLint, and `npm run build:app` for the image-sizing fix.
- [x] Verify the published Resource record and image URLs through direct database/Blob read-back and audit-log inspection.
- [ ] Verify the reader shows the full heading structure, all 19 screenshots, captions/labels, callout styling, table of contents, and no broken images at desktop and narrow widths.
- [x] Record any unavailable browser console/network proof explicitly.

## Review

- Shipped: Resource `cmt9hqt5n0001p5qiponwq0pz`, slug `color-correction-101`, published as `HOW_TO` / `Video`, targeted to `VIDEO`; 19 PNGs uploaded under `resources/color-correction-101/`. Source fix removes the reader's hard-coded image dimensions and preserves intrinsic ratios.
- Verified: Source export `/Users/role/Downloads/Creative Guides.md`; extracted asset set `/private/tmp/color-correction-101-assets/`; 19/19 Blob URLs returned HTTP 200 with `image/png` and PNG magic bytes; Markdown read-back contains 9 headings, 19 absolute image URLs, and no local placeholders; creation and image-embedding audit entries exist.
- Deferred: Production deployment, authenticated desktop/narrow-width reader screenshots, console proof, and the required before/after UI review artifact. The repository's production path is Git-connected `main`; unrelated dirty work was left untouched and no push/deploy was made.
- Blocked: Local unauthenticated requests correctly redirect to `/login`; the local preview env cannot authenticate the user because its session secret is intentionally too short, and transmitting the stored Playwright password was outside the request scope.
- Proof artifacts: This plan; `docs/AREA_RESOURCES.md`; database/Blob read-back from the import script; source regression test; `npm run build:app`; local route header check (`307`, `Location: /login`).
- Next slice or stop: Deploy the isolated reader fix through the normal Git-connected release path, then capture authenticated desktop and narrow-width proof against the live resource.
