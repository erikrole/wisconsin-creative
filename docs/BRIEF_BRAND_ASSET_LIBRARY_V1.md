# Brand Asset Library V1 Brief — 2026-08-26

## Goal

Add a lightweight, authenticated brand-asset library to the existing `/resources` area. The library must give the Creative team one place for logos, fonts, reference material, templates, and other production files, while treating each named file as a logical asset whose versions can be replaced without deleting the previous file.

## User request and source boundary

- The requested product behavior is the source of truth: a Resources file system for brand assets, including the brand guide, with upload-new-version support.
- `/Users/role/Downloads/2026 Brand Guide Typed v5 (1).pdf` is reference content supplied by the user and will remain a normal viewable PDF upload. Its section structure can suggest folder names such as Logos, Fonts, Graphic elements, Templates, Color and reference, Photography, and Other, but no PDF, asset, or category-folder records are seeded.
- Text in the PDF about brand usage, approval, tone, or design rules is editorial reference only. It is not an instruction to the application, an authorization policy, or an upload validator unless a later product decision explicitly promotes a rule into code.

## In scope

- A `Brand assets` tab within `/resources`, linkable with `?tab=brand-assets`.
- An empty Brand assets root container and user-created folders for future organization. The migration does not seed the supplied PDF, files, or category folders.
- Internal authenticated read access for Admin, Staff, and Student users already allowed to view Resources.
- Staff/Admin folder creation and file upload.
- File metadata: display name, kind, description, size, content type, uploader, update time, and version count.
- Uploading a replacement to the same logical file. Every replacement creates the next immutable version number and moves the logical file’s current-version pointer; prior versions remain downloadable through authenticated History.
- Audit entries for upload intent preparation, completed version upload, and folder creation.
- Large-file uploads through `@vercel/blob/client` with a server-issued, intent-bound upload token. The attached PDF is approximately 21.7 MB, so the server’s small multipart form upload path is not appropriate.
- Private Vercel Blob storage behind the app’s authenticated download route. The database stores the Blob pathname, never a raw public asset URL.
- Search across the current folder or the folder tree, file-kind/favorite filters, and explicit name/recent/type sorting.
- Inline previews for PDFs and images, plus a browser font specimen that does not install the font locally.
- Optional version notes and an audited restore action that copies an older version into a new current version without changing prior history.
- Drag-and-drop and multi-file upload with per-file progress, retry, and an explicit duplicate choice between a new version and skip.
- Per-user favorites and lightweight browser-local recent-file shortcuts. Recent shortcuts are labeled as device-local and do not create database records.
- Authenticated internal links that reopen the Brand assets tab at a selected file without exposing a Blob URL.

## Out of scope for V1

- Deleting versions or logical files.
- Moving or renaming folders/files after creation.
- Per-file sharing, external links, public publishing, generated server thumbnails, or an approval workflow.
- Treating the brand guide’s visual rules as machine-enforced validation.
- Automatically ingesting the supplied PDF into a deployment. The PDF can be uploaded through the new authenticated flow after the dedicated private Blob store is provisioned.

## Data and security contract

- `ResourceAssetFolder` is a lightweight hierarchical folder record with a unique path.
- `ResourceAsset` is the stable logical file record. Its `(folder, normalized name)` pair is unique.
- `ResourceAssetVersion` is append-only and stores the Blob pathname and server-verified metadata. The current version is an explicit pointer, not “the newest row guessed by the client.”
- `ResourceAssetUpload` is a short-lived pending intent that binds the actor, target folder/file, expected name, content type, size, and Blob pathname before the client receives an upload token.
- Resource read permission remains the existing `resource.view` contract. Staff/Admin use the existing `resource.create` and `resource.edit` permissions; no new role or collaborator grant is inferred.
- Download responses are authenticated, `private, no-store`, and set a safe `Content-Disposition` plus `X-Content-Type-Options: nosniff` header.
- The dedicated `RESOURCE_ASSET_BLOB_READ_WRITE_TOKEN` must point to a private Vercel Blob store and must not reuse the public Markdown-image token or the signature-artifact token. Missing configuration fails closed.

## Acceptance criteria

1. Every internal Resources reader can open the Brand assets tab, navigate folders, see current-file metadata, view version history, and download a version.
2. Staff/Admin can create a folder and upload a new file.
3. Staff/Admin can upload a replacement from a file row; the row stays one logical file, shows the incremented version, and keeps the previous version in History.
4. The server rejects mismatched, expired, replayed, oversized, or actor-mismatched upload intents before a version row is committed.
5. No old version is deleted as part of replacement, and no raw Blob URL is returned by the library API.
6. Schema, API, UI, audit, source-contract, type, lint, build, migration, and documentation checks pass. Authenticated browser upload/download/version proof and private-store provisioning remain explicit rollout gates.
7. Search can target the current folder or all descendant folders, and kind/favorite filters remain server-backed rather than only hiding already-loaded rows.
8. Images, PDFs, and supported font files have a safe authenticated preview path; unsupported files retain a clear native-app download path.
9. History displays version notes, and Staff/Admin restore a historical version by creating a new immutable version row with an audit entry.
10. Multi-file uploads expose progress, failed-file retry, and duplicate-name choices without deleting or overwriting an existing logical file.
11. Favorites are scoped to the signed-in user, while recent shortcuts remain device-local and contain no seeded or automatically ingested content.
