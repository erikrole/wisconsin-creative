# Signature roster design QA

- Source visual truth: `/Users/role/.codex/generated_images/01a00787-0134-78c2-98b4-b99071bcb09b/exec-c593a80f-6171-4314-8711-7a008e41dfdc.png`
- Source pixels: 1487 x 1058
- Implementation route: `http://127.0.0.1:3000/signatures/cmsuuo6v2000bp5uym0kx3c24`
- Dark implementation: `/Users/role/Code/wisconsin-creative/design-qa-signature-roster-dark-final.png`
- Light implementation: `/Users/role/Code/wisconsin-creative/design-qa-signature-roster-light-final.png`
- Responsive implementation: `/Users/role/Code/wisconsin-creative/design-qa-signature-roster-1024.png`
- Side-by-side comparison: `/Users/role/Code/wisconsin-creative/design-qa-signature-roster-comparison.png`
- Intended viewport: desktop, 1487 x 1058 CSS pixels, device scale factor 1
- State: Creative staff roster, one committed signature

## Final visual comparison

The source and authenticated implementation were compared together at the same 1487 x 1058 dimensions. The implementation preserves the selected compact horizontal roster while retaining the product's existing shell, alphabetical Creative staff order, collection controls, and permission model. Creative staff rows intentionally omit title sublines; team rosters continue to show position/title.

All 12 roster rows measure exactly 64px. The Signature heading, saved PNG proof, and unsigned capture actions share the same center rail: heading x-center 1294px, capture x-center 1294px, and image x-center 1293.996px. Capture controls measure 160 x 44px; the signature proof is capped at 28px high so completion does not change row height.

Dark mode renders the decoded transparent signature white with `brightness(0) invert(1)`. Light mode renders the same decoded asset black with `brightness(0)`. At a 1024px viewport the page itself does not overflow; the fixed roster grid uses its own horizontal scroll surface and every row remains 64px.

## Artifact and download proof

The action menu exposes Replace, Download PNG, Download SVG, Remove, and requirement controls. Both explicit download actions completed through browser download events and landed in the macOS Downloads folder with clean filenames.

- PNG: `/Users/role/Downloads/erik-role-signature.png`
  - 1600 x 645 pixels
  - 4-channel RGBA PNG
  - Alpha range 0-255; `isOpaque: false`
  - 63,757 bytes
  - No white background; transparent pixels surround the signature ink
- SVG: `/Users/role/Downloads/erik-role-signature.svg`
  - 33,096 bytes
  - A real `viewBox` and four vector `<path>` elements
  - No `<image>`, embedded raster data, scripts, `foreignObject`, or external references

Newly saved PNG artifacts are rendered at up to 1600 x 900 while preserving aspect ratio, never below 1000px wide. Existing captures are regenerated from their stored SVG vector on explicit PNG download, so the same quality contract applies retroactively. Inline roster previews remain private, authenticated, and non-download-disposition responses.

## Comparison history

- Pass 1: localhost authentication blocked the first capture.
- Pass 2: authenticated layout proof passed, but private Blob credentials were absent locally.
- Pass 3: private delivery and decoded dark/light proof passed; explicit PNG download still opened inline.
- Pass 4: attachment behavior passed; the first SVG attachment was zero bytes because local Blob metadata supplied a zero content length.
- Final pass: PNG and SVG bodies are delivered with measured byte lengths, browser downloads complete, file metadata passes, responsive behavior passes, and no visual P0/P1/P2 findings remain.

## Findings

No remaining P0, P1, or P2 visual or artifact-delivery findings.

The one browser console `InvalidStateError: Transition was aborted because of invalid state` occurred during repeated automated download handling after successful file creation. It did not reproduce as a page-load or roster interaction failure and did not affect either downloaded artifact.

final result: passed

---

# Brand assets — Google Drive-style image-to-code QA

- Source visual truth: `/Users/role/Library/Application Support/CleanShot/media/media_nNcXBhRwTH/CleanShot 2026-08-26 at 21.45.14.png`
- Source pixels: 4336 x 2702; the Google Drive app region was cropped from x=502, y=172, at 3834 x 2530 and normalized to 1091 x 720 for comparison. The surrounding Work/browser chrome is not part of the product target.
- Implementation route: `http://127.0.0.1:3100/resources?tab=brand-assets`
- Implementation screenshot: `/Users/role/Code/wisconsin-creative/tasks/brand-asset-library-review-2026-08-26/brand-assets-drive-after.jpg`
- Side-by-side comparison: `/Users/role/Code/wisconsin-creative/tasks/brand-asset-library-review-2026-08-26/source-vs-after.jpg`
- Implementation pixels and CSS viewport: 1280 x 720; browser screenshot captured at the same 1:1 raster dimensions. The browser wrapper does not expose an independent device-scale-factor value.
- State: authenticated Admin, Brand assets root, one explicitly uploaded brand-guide PDF at v1, Home selected, no menu open. No content was seeded.

## Final visual comparison

The source and implementation were opened and reviewed together in the side-by-side comparison. The implementation preserves the Wisconsin Creative shell and theme while translating the reference hierarchy into the product: a secondary file-library rail with New/Home/Recent/Starred, suggested folder tiles when folders exist, a compact search/filter row, and a single file table with secondary actions behind the row menu.

The source is a light Google Drive screen and the implementation is currently in the app's dark system theme. That color and brand difference is intentional: this is a Drive-inspired workflow inside Wisconsin Creative, not a Google brand clone. The current Preview contains no seeded folders; therefore the live screenshot correctly shows the file table without a fabricated Suggested folders section. When users create folders, the new folder tiles render above the files list.

## Required fidelity surfaces

- Fonts and typography: the implementation keeps the existing product font stack and operational type scale; the reference's Google-specific font is not imported. Headings, table labels, and metadata remain legible at the captured viewport, with the long PDF name intentionally truncated in the name column.
- Spacing and layout rhythm: the internal rail, main content, toolbar, and table align to the existing page grid. The New button, navigation rows, folder tiles, and file-row controls retain 40px-or-larger interaction targets. No viewport overflow is visible in the 1280 x 720 capture.
- Colors and visual tokens: the implementation uses Wisconsin Creative semantic tokens and preserves dark-mode contrast. The reference's blue selected state and white canvas are treated as source-product styling, not copied over the branded app shell.
- Image quality and asset fidelity: the real Wisconsin Creative mark and existing icon library remain in use. No Google logo, custom illustration, CSS art, placeholder image, or handcrafted SVG was introduced.
- Copy and content: user-facing labels are product-specific (`Brand assets`, `Recent`, `Starred`, `Suggested files`) rather than Google Drive copy. The uploaded PDF is real Preview data; no fake folders or files were added for the screenshot.

## Interaction evidence

- Fresh authenticated browser load rendered the New menu trigger, Home, Recent, Starred, search, sort, Filters, and the PDF table with no console errors.
- New opens working `New folder` and `Upload file` menu items.
- Recent and Starred switch to their respective file views; Home returns to the root file view.
- The existing preview, history, favorite, internal-link, upload, and replacement actions remain wired behind the file row.

## Focused comparison evidence

The side-by-side comparison was sufficient for this desktop pass because the changed regions—the secondary rail, toolbar, section hierarchy, and table—are all visible and readable at 1280 x 720. The full source includes third-party browser chrome and a different data set, so the comparison intentionally judges structure, density, affordance placement, and content treatment rather than pixel-identical branding or data.

## Findings

No remaining P0, P1, or P2 visual findings. P3 follow-up: if the product later adopts a light default for this area, re-capture the same state to compare the token mapping against the light reference.

## Comparison history

- Pass 1: the prior Brand assets surface had repeated intro/card sections and many always-visible actions. The image-to-code pass replaced that density with the secondary rail, New menu, suggested-folder section, and table-first file view.
- Final pass: a fresh authenticated 1280 x 720 capture was reviewed against the cropped/normalized reference; New, Recent, Starred, Home, Filters, and row actions were exercised, and no browser console errors remained.

final result: passed
