# Audit: brand assets (iOS) — 2026-10-16

**MVP verdict:** Source-complete, read-only. Authenticated iPhone 18 Pro Max proof is still open. xcodebuild was not run in the environment that added this surface.
**Ship bar:** a calm folder list a student or staff member can open from Browse and use to look at a logo or PDF at a venue.
**Audit type:** static source (no build, no signed-in device)

Scope: `BrandAssetsView` (folder list, search, file page) and `BrandAssetModels` (list decode, size and preview rules). Reachable from Browse for every role except collaborator. Uploads stay on the web.

## What shipped

- Browse adds Brand assets after Guides for internal roles. Collaborators do not get the row, because `resource.view` refuses them on `/api/resources/assets`.
- The list reads `GET /api/resources/assets`. A folder push sends `folderId`. Search sends `q` and `scope=all`, and hides child folders while results are showing. Sort is name, recent, or type.
- A file page uses the list payload. It does not call `GET /api/resources/assets/:id`.
- Images, SVG, and PDF open on the phone when the current file is 40 MB or smaller. Raster previews are thumbnails. SVG is wrapped with a script-free page. PDF uses PDFKit.
- Larger files, video, fonts, and other types download through `GET /api/resources/assets/:id/download` and share from a temp file. Fonts say sharing does not install the font.
- A file with no current version says uploading stays on the web.
- Folder create, upload, favorites, and version restore are absent from the view.

## P0 — blocks MVP

- None in source. Device proof and the Mac Xcode build are open, not a code defect found here.

## P1 — polish before ship

- [ ] [Flows] Authenticated iPhone 18 Pro Max still has to show the root folder, a child folder, search, a logo, a PDF, share for a non-preview file, and a collaborator Browse menu without Brand assets.

## Acceptance criteria status

AREA_MOBILE.md:
- [x] Brand assets is in the Browse contract for internal roles and hidden from collaborators.
- [x] The screen is read-only. Folder create, upload, and version restore stay on the web.

AREA_RESOURCES.md:
- [x] Native browse uses the existing asset list and current-file download. No new API route.

## Lenses checked

- [x] Gaps — device proof stays open in this audit and the area changelog. No new gap id.
- [x] Flows — a newer search cancels the previous load. A failed list keeps the error and offers Try again.
- [x] UI polish — one sort menu, system search, secondary icons. Color stays on `Color.statusText`.
- [x] Hardening — no POST, PATCH, PUT, or DELETE from this view. SVG preview disables JavaScript and drops script, foreignObject, event handlers, and `javascript:` URLs.
- [x] Breaking — Guides copy and the Guides destination are unchanged.
