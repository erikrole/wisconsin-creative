# Signature Capture Micro-App — Execution Ledger

## Goal

Operate Signatures as a trustworthy authenticated staff/admin workflow across supported team, Creative Staff, Administration, and one-off collections. Apple Pencil is the only drawing input; touch remains available for controls. Captures are server-rendered into matching private PNG and SVG artifacts, associated with immutable source snapshots where applicable, and counted complete only after both artifacts and the database state commit.

## Current State

The V1 implementation is deployed through the web, API, schema, artifact, storage, and cleanup contracts. Latest Production deployment `dpl_D9tYGhkyoHDqnLUupjb2Az1xrMEq` from commit `a5604316` is READY and aliased to `https://wisconsincreative.com`; the live unauthenticated smoke returns the expected redirect and the recent Production error scan is empty. The 2026–27 MBB roster remains reconciled into 14 players, 7 coaching staff, and 11 support staff; team readiness now counts only the 14 student-athletes while staff remains a secondary optional count. Creative staff are a separate `CREATIVE` collection sourced from active full-time Video/Photo/Graphics accounts, with 14 active members and Jerry Mao now carrying a READY revision-1 artifact. The `VB / 2026-27` backfill remains 17/18 players with #16 intentionally blank. The `FB / 2026-27` collection `cmsw6qmyy0001p5ssne5lnfao` is applied at version 2 with 164 active members (112 players, 27 coaching staff, 25 support staff), 112 READY revision-1 player artifacts, 112 import audits, and zero pending-delete revisions. Dedicated private Blob provisioning, generated-byte application-wrapper proof, partial-upload cleanup failure injection, and authenticated roster readback are complete. Rollout remains gated on a physical Pencil save, authenticated artifact delivery, and physical iPad Safari acceptance.

## Scope

- Canonical collection key: `sportCode + season`, with `MBB`, `FB`, `VB`, `MHKY`, `WHKY`, `WBB`, and `WRES` for team rosters, `CREATIVE` for the standalone Creative staff roster, `ADMIN` for the official UWBadgers Administration directory, and `ADHOC` for manually entered one-off signers.
- External roster members are separate from Wisconsin Creative users and may have a nullable user link. Creative staff use linked full-time Video/Photo/Graphics accounts as separate signature members with no external snapshot and never live in the MBB collection.
- UWBadgers import is fixed to an allowlisted adapter with structural parsing, profile-identity deduplication, preview persistence, and versioned reconciliation. MBB, Football, Volleyball, Men’s Hockey, Women’s Hockey, Women’s Basketball, and Wrestling use sport-specific source URLs and parser labels; Creative staff sync is explicit, version-checked, audited, and preserves imported roster state.
- Required members are active players from the seven supported team rosters; coaching and support staff are imported as optional secondary work. Standalone Creative staff retain their existing default-required behavior; wrestling weight classes are metadata and jersey numbers remain nullable.
- Private app-managed storage is required. Box signature-file integration, native PencilKit, scheduled roster sync, additional sport adapters beyond the 2026-27 target set, and pressure width are deferred.

## Source Checks

- `prisma/schema.prisma`: `StudentSportAssignment` models internal users and must not be reused.
- `src/lib/permissions.ts`: signature access needs a dedicated resource.
- `src/lib/audit.ts`: audit rows retain only 90 days, so capture and artifact lifecycle state must be durable in signature tables.
- `src/lib/blob.ts`: existing helper is public-media oriented and must not be extended for signatures.
- `src/lib/sports.ts`: `MBB`, `MHKY`, `WHKY`, `WBB`, `VB`, and `WRES` are the canonical codes for the requested media-day sports; Football remains `FB`.
- UWBadgers 2026-27 roster sources: Football and Volleyball use starting-year paths; Men’s Hockey, Women’s Hockey, Women’s Basketball, and Wrestling use full-season paths; Wisconsin Creative retains the canonical `2026-27` season.
- UWBadgers Men’s Basketball roster: duplicate list/card/table representations and separate coaching/support sections require structural scoping and profile-identity deduplication.

## Stop Conditions

Stop before expanding the feature if physical iPad Safari cannot reject accidental touch/palm/mouse drawing, private Blob storage cannot be provisioned, deterministic transparent PNG/SVG output cannot be demonstrated, or pending-delete artifacts cannot be made non-downloadable and retryable.

## Slices

| Slice | Status | Evidence or remaining gate |
| --- | --- | --- |
| Contract, brief, decision, permission, risk, and ledger | Complete | Repo contracts recorded in docs and tasks. |
| Physical-input capture surface and IndexedDB drafts | Implemented locally | Requires target iPad/Safari proof before rollout. |
| Schema, migration, validation, permissions, and completeness | Deployed | Prisma validation, migration-prefix check, generated client pass, service coverage, and migration health pass. Production reports 119/119 migrations applied with no pending rows. |
| UWBadgers snapshot adapter and reconciliation | Complete locally for seven target team sports | Sport-aware MBB/Football/Volleyball/Men’s Hockey/Women’s Hockey/Women’s Basketball/Wrestling adapters, bounded fetch, structural dedupe, immutable preview, explicit apply. Production readback remains limited to MBB, Football, and Volleyball. |
| Deterministic SVG/PNG artifact engine | Complete | Focused tests verify hashes, 1000px minimum transparent RGBA PNG output, and sanitized path-only SVG output. Existing captures regenerate their high-quality PNG download from the stored SVG vector. |
| Private Blob lifecycle and authenticated delivery | Provider and cleanup proof complete; local authenticated download proof complete | Dedicated private store passes two-artifact application-wrapper privacy/read/delete proof; injected second-artifact failure leaves neither object behind. Authenticated local browser proof downloaded and inspected both production-format files; deployed application save/delivery remains. |
| Collection, roster, capture, settings, and file library UI | Verified in development | Landing cards and the import selector now label MBB, Football, Volleyball, Men’s Hockey, Women’s Hockey, Women’s Basketball, Wrestling, and Creative staff. The standalone Creative staff card syncs active full-time Video/Photo/Graphics accounts; team collections remain players/coaches/support only. Collection members render in exact 64px rows with a centered Signature rail: compact theme-aware PNG proof for completed rows and a 160 x 44px centered capture action for incomplete rows. Creative staff titles are omitted on this page while team positions and wrestling weight-class metadata remain. File, requirement, and lifecycle actions remain in the accessible row menu. Authenticated local visual proof covers dark, light, and 1024px responsive states. |
| Roster hierarchy, source ordering, and active-year management | Verified in Production for existing collections; locally verified for new adapters | Source-role identity parsing reconciles team snapshots into player/coaching/support groups; players with jersey numbers sort numerically, wrestling players retain nullable jersey numbers, staff preserves source order, and the 2025–26 collection is archived/hidden by default with version-checked restore. Production readback covers MBB, Football, and Volleyball 2026–27 collections; the four new adapters are not yet applied in Production. |
| Operational closeout | Open | Hardened production is Ready and authenticated read smoke passes; a real Pencil save, authenticated artifact delivery, and physical iPad acceptance remain. |

## Verification

- Pure tests for pointer gating, draft expiry/keying, roster parsing/deduplication/reconciliation, artifact sanitization/determinism, permission roles, and save lifecycle transitions.
- `npx prisma validate`, `npm run db:migrate:check`, focused tests, `npx tsc --noEmit --pretty false`, lint, `npm run build:app`, `npm run codemap`, `npm run verify:docs`, and `git diff --check`.
- Authenticated browser proof and physical iPad Safari proof remain explicit acceptance gates; local source/build success cannot replace them.

Local export verification on 2026-08-15 downloaded `erik-role-signature.png` and `erik-role-signature.svg` through the authenticated browser into macOS Downloads. The PNG is 1600 x 645, four-channel RGBA, non-opaque, and includes fully transparent pixels. The SVG contains a viewBox and four path elements with no embedded image, data URI, script, foreign object, or external reference. These export changes are implemented and verified locally but are not yet promoted to production.

Local verification on 2026-08-15: focused signature tests 11/11 plus six signature-service tests, TypeScript, focused lint, Prisma validation with placeholder URLs, migration-prefix check, `git diff --check`, and migration health (119/119) passed. The full suite passed 489/489 with CI placeholder database variables. Migration generation hit the repository's blank schema-engine failure, so `0114_signature_creative_staff` was authored as the additive enum/nullability migration and applied through the working development Neon pooler URL. Authenticated browser smoke covers the 2026–27 collection with numeric player order, source-order staff sections (Greg Gard first), separate Players / Coaching staff / Support staff groups (14 / 7 / 11), a standalone Creative staff roster with 12 active full-time Video/Photo/Graphics accounts, and the admin-only archived-year chooser path. Production deployment `dpl_5WSeBG88rhaBNKKmtfM6ETVX75Um` completed after the Vercel build was hardened for its memory limit; the live unauthenticated redirect passed. Provisioned private Blob failure injection, authenticated production workflow proof, and physical iPad proof remain open.

## Review Notes

- Pencil contract: pen-class web gate (`pointerType === "pen"`), not cryptographic Apple Pencil identification.
- No client-provided SVG, PNG, filename, path, Blob URL, or private token is trusted.
- Stale collection, snapshot, settings, capture, and request versions return `409` while preserving the local draft and prior committed capture.
- The local pre-iPad hardening pass keeps Pencil resize/input handling stable, binds request IDs to their original target, preserves required-state overrides across unchanged imports, and invalidates in-flight saves during collection reset.

## Follow-up: Trust, Scale, and Recovery Hardening — 2026-08-19

### Goal

- Remove the source-confirmed paths that can show stale completion, mutate before revealing the iPad requirement, write a player profile before a committed signature, misreport a fetch failure, or do unbounded roster-scale work.
- Improve the long-roster operator surface without changing private-artifact, immutable-history, or Apple Pencil acceptance contracts.

### Current Truth

- The documented Production baseline remains deployment `dpl_D9tYGhkyoHDqnLUupjb2Az1xrMEq` from commit `a5604316`; this follow-up describes current local source and does not claim that later local refinements are deployed.
- Automated Signature tests pass 99/99 after this slice. Coverage is strong at pure/service/storage boundaries; authenticated browser proof covers the landing/detail interactions, while physical input remains a separate gate.
- Physical iPad Safari/Apple Pencil proof and authenticated artifact-delivery acceptance remain release gates. Source, test, build, or desktop-browser success cannot close them.

### Source Checks

- The audit identified a shared 60-second React Query cache entry whose successful capture/profile mutations navigated without invalidating it.
- The audit identified Add Signature mutating an ad-hoc roster before the capture route revealed the iPad requirement, with Replace offered before that device check.
- The audit identified player-profile writes that did not require a current committed artifact at the service boundary.
- The audit identified collection detail and capture bootstrap loading full snapshot/history data for every member at Football's 164-member scale.
- The audit identified a serializable roster-apply transaction without an explicit large-roster budget even though the 164-member Football apply exceeded Prisma's default window in prior operator work.
- The audit identified UWBadgers redirect validation occurring only after `fetch` had issued the redirected request.

### Stop Conditions

- Do not weaken private delivery, current-revision selection, optimistic version checks, audit coverage, or pen-only input behavior.
- Do not substitute a desktop drawing path for the accepted iPad-only capture contract.
- Stop before changing roster-source or profile sequencing semantics if the brief, D-050, service, and UI cannot be reconciled in the same slice.
- Keep authenticated browser proof and physical iPad acceptance distinct; do not present either as inferred from automated gates.

### Slices

- [x] Invalidate exact collection/list cache entries after successful capture, profile, and relevant roster mutations; add regression coverage.
- [x] Gate Add/Replace before mutation or navigation on unsupported clients and give capture fetch failures a truthful Retry path.
- [x] Require a current committed player artifact before profile writes at both UI and service boundaries.
- [x] Restore determinate accessible progress semantics and add explicit accessible names at Signature call sites.
- [x] Remove repeated snapshot/revision payloads from collection detail and add a one-member capture bootstrap contract.
- [x] Give large-roster apply an explicit bounded transaction budget and harden allowlisted roster redirects before a second request is issued.
- [x] Bound private-artifact cleanup work so large reset/remove/delete operations remain retryable within the serverless function budget, and fence late uploads when delete/reset wins the state race.
- [x] Add long-roster search/collapse polish and truthful empty-preview readiness after the trust and data-shape work is green.
- [x] Complete focused tests, TypeScript, lint, docs verification, matched UI review, authenticated browser proof, and diff inspection.
- [ ] Complete the exact `npm run build:app` gate; the debug-prerender build is green at 233/233 pages, while standard retries intermittently fail during unrelated Next page-data collection.

### Verification

- Focused Signature service, route, cache, storage, ZIP, and source-contract tests.
- `npx prisma validate`, `npm run db:migrate:check`, `npx tsc --noEmit --pretty false`, focused lint, `npm run lint -- --quiet`, and `npm run build:app` when the unrelated dirty Schedule work permits those shared gates.
- `npm run codemap`, `npm run verify:docs`, and `git diff --check` for contract and shared-helper changes.
- Matched desktop and tablet before/after review plus authenticated local runtime proof; physical iPad/Pencil remains a separate user-operated acceptance gate.

### Review

- Source slice complete locally on 2026-08-20: exact cache invalidation, pre-mutation iPad gates, committed-artifact profile sequencing, truthful capture retry, determinate progress semantics, one-member bootstrap, bounded detail payloads, explicit roster-apply budget, pre-follow redirect validation, bounded cleanup, and late-upload fencing are implemented with focused coverage.
- Remaining: the exact standard app-build gate, production promotion, and physical iPad/Pencil acceptance. The matched UI review, authenticated browser proof, focused source gates, debug-prerender build, and docs verification are complete locally; these are separate gates and are not inferred from one another.

## Follow-up: Private Storage and Stroke Smoothing — 2026-08-15

### Goal

- Keep the existing public-media Blob credential out of Signature Capture and make the live Pencil stroke feel less angular while preserving deterministic server-owned artifacts.

### Source Checks

- Before this follow-up, `src/lib/signatures/storage.ts` resolved the generic `BLOB_READ_WRITE_TOKEN`, which is backed by a public Blob store in the current development environment.
- Before this follow-up, `src/app/(app)/signatures/[id]/capture/[memberId]/SignatureCapturePage.tsx` drew raw line segments on the canvas.
- Before this follow-up, `src/lib/signatures/geometry.ts` emitted raw SVG line segments, so preview and committed PNG/SVG artifacts shared the same sharp corners.
- A generated-byte provider smoke test on 2026-08-15 returned Vercel's `private access on a public store` error; no user signature was transmitted.

### Stop Conditions

- Stop the storage rollout at configuration if a dedicated private Blob store/token is not available; do not fall back to the public-media store.
- Stop smoothing changes if the canvas and SVG path rules diverge, artifact determinism changes unexpectedly, or crop bounds no longer include the configured stroke radius and padding.

### Slices

- [x] Use an explicit Signature Capture private Blob credential for upload, read, and cleanup; add a focused storage contract test.
- [x] Render the same midpoint-quadratic smoothing rule in the live canvas and sanitized SVG; add deterministic curve coverage.
- [x] Verify focused tests, TypeScript, lint, app build, and docs checks.
- [x] Provision and connect a dedicated private Blob store without modifying the existing public-media store.
- [x] Prove generated-byte private upload, anonymous denial, authenticated readback, and cleanup.
- [x] Inject a second-artifact upload failure and verify application cleanup leaves neither generated object behind.
- [ ] Authenticated browser/device acceptance where credentials and hardware are available.

### Verification

- [x] `npx vitest run tests/signature-capture.test.ts tests/signature-service.test.ts tests/signature-storage.test.ts` (21/21)
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint -- --quiet`
- [x] `npm run build:app`
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `npm run db:migrate:check`
- [x] `git diff --check`
- [x] Authenticated browser read smoke on hardened Preview.
- [ ] Authenticated physical Pencil save/delivery and full iPad Safari/Apple Pencil proof.

### Review

- Shipped: Signature storage requires dedicated private-store auth; canvas and server artifacts use shared midpoint-quadratic smoothing. Dedicated private store `wisconsin-creative-signatures-private` is connected to Production, Preview, and Development with a Signature-specific token.
- Verified: focused tests 21/21, full suite 3,160/3,160 with CI placeholder database variables, TypeScript, lint, app build, codemap/docs, migration-prefix, and diff checks all pass.
- Deferred: authenticated physical Pencil save/delivery and full iPad/Apple Pencil acceptance.
- Blocked: save/delivery and physical proof require the target iPad and Apple Pencil.
- Proof artifacts: application-wrapper smoke uploaded and read back both generated artifacts, returned anonymous `403`, removed both objects, and left neither object after an injected second upload failure; `tests/signature-capture.test.ts`, `tests/signature-service.test.ts`, and `tests/signature-storage.test.ts` cover the source and transaction contracts.
- Next slice or stop: sign and save on hardened production with the target iPad and Apple Pencil, then verify authenticated delivery.

## Follow-up: Apple Pencil Capture Hardening — 2026-08-15

### Goal

- Make iPad Safari ink immediate and stable, preserve the last Pencil samples through interruptions and rotation, and make local recovery and retries match what the interface promises.

### Audit

- A fresh read-only `gpt-5.6-sol` Medium audit found no source P0, but confirmed P1 issues in the React-bound drawing loop, terminal/interrupted pointer handling, draft load and persistence truth, client request-id reuse, resize distortion, and destructive Clear behavior.
- Private Blob provisioning remains a rollout blocker outside this source slice; the existing fail-closed storage change must remain intact.

### Source Checks

- The capture page currently copies the active stroke into React state and redraws every stored stroke on each Pointer Event.
- Pointer completion does not consume terminal samples and has no lost-capture or page-interruption finalization path.
- The canvas accepts input before IndexedDB draft recovery finishes, while failed draft writes are hidden behind the in-memory `Draft ready` label.
- Server saves are idempotent by request ID, but the client currently generates a new ID for every retry.
- Existing resize handling mutates stored point coordinates independently on each axis.
- The shared midpoint-quadratic geometry and dedicated private-storage boundary are accepted inputs to this slice and must not regress.

### Stop Conditions

- Stop if stable logical coordinates change the server stroke contract, exceed existing coordinate bounds, or make preview and generated artifacts diverge.
- Stop if frame-bounded drawing can save a different stroke snapshot than the one visible on the canvas.
- Stop if draft hardening can overwrite new ink with a late recovery result or an older asynchronous write.
- Do not provision, rename, or delete an external Blob store in this slice.

### Slices

- [x] Add tested stable-canvas and point-deduplication helpers.
- [x] Move active ink to a frame-bounded imperative path and commit completed strokes to React state.
- [x] Capture terminal samples and finalize safely on cancel, lost capture, visibility changes, and page hide.
- [x] Resolve drafts before enabling ink, persist at stroke boundaries, report actual draft state, and make Clear undoable.
- [x] Retain one request ID across ambiguous retries and invalidate it only when ink changes or the server definitively rejects the request.
- [x] Align pen-class copy, 44px controls, stable loading labels, and live status announcements.
- [x] Verify source and sync Signature area acceptance notes without closing private-store or physical-device gates.

### Verification

- [x] `npx vitest run tests/signature-capture.test.ts tests/signature-service.test.ts tests/signature-storage.test.ts` (25/25)
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint -- --quiet`
- [x] `npm run build:app`
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `npm run db:migrate:check`
- [x] `git diff --check`
- [x] Authenticated browser read smoke on hardened Preview `dpl_acg3vUW3iUa3vgQ1CxCSiyaxXNMj`.
- [ ] Physical iPad Safari/Apple Pencil acceptance on the deployed hardened build.

### Review

- Shipped: Stable logical canvas mapping, animation-frame Pencil rendering, terminal/interruption finalization, ordered draft recovery and persistence, undoable Clear, ambiguity-safe request retries, and iPad-aligned copy/controls/status.
- Verified: Focused signature tests 25/25, TypeScript, lint, app build, migration-prefix check (119 migrations), codemap/docs, and diff checks pass. Sol's final P1-only review found no remaining source P0/P1.
- Deferred: Pressure, tilt, hover, squeeze, barrel roll, variable-width ink, native PencilKit, and exact Apple Pencil hardware identification remain out of V1 scope.
- Blocked: A physical Pencil save, authenticated artifact delivery, and full physical iPad proof remain external acceptance gates; private-store provisioning and hardened production deployment are complete.
- Proof artifacts: `src/lib/signatures/capture.ts`, the hardened capture page and signature service, and focused capture/service/storage tests.
- Next slice or stop: Sign and save on hardened production with the target iPad and Apple Pencil, then verify authenticated delivery.

## Follow-up: Roster-Wide Export and Jersey Identity — 2026-08-15

### Goal

- Confirm the artifact contract applies to every signature collection, render player jersey numbers in the existing Wisconsin Athletics Gotham Ultra face, and guarantee clean signer-based download filenames without internal IDs.

### Source Checks

- Every team and Creative staff collection uses the same `SignatureCollectionPage`, authenticated artifact route, and `getReadySignatureArtifact` service boundary.
- Player rows already carry normalized numeric `jerseyNumber` values; non-player rows use the person icon and Creative staff rows have no jersey number.
- `public/Gotham-Ultra.woff2` is registered as the 900 weight of the official Gotham heading family through `--font-heading`.
- Artifact names are currently generated server-side from the member name as `<signer>-signature.<kind>`; focused coverage does not yet lock that contract or punctuation/diacritic normalization.

### Stop Conditions

- Stop if a roster type bypasses the shared collection or artifact route.
- Do not invent or add a new font asset; use the licensed Wisconsin Athletics Gotham family already shipped by the app.
- Do not include collection IDs, member IDs, revision IDs, or storage paths in user-facing filenames.

### Slices

- [x] Apply Gotham Ultra only to real player jersey numerals while retaining icons for staff and Creative rows.
- [x] Centralize and test clean filename generation for PNG and SVG downloads.
- [x] Confirm the shared grid has one Signature header and no roster-specific header drift.
- [x] Verify focused tests, TypeScript, lint, app build, docs, and authenticated MBB plus Creative roster behavior.

### Verification

- [x] Focused signature capture and service tests (31/31).
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint -- --quiet`
- [x] `npm run build:app`
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `git diff --check`
- [x] Authenticated browser proof for one team roster and the Creative staff roster.

### Review

- Shipped: Shared roster player numerals use Gotham Ultra at weight 900; staff and Creative rows remain icon-based. PNG and SVG downloads use one tested server-owned filename helper that strips internal IDs, normalizes punctuation and diacritics, and returns `<signer>-signature.<kind>`.
- Verified: Focused signature tests pass 31/31. TypeScript, lint, production app build, codemap/docs verification, and diff checks pass. Authenticated local MBB proof measured Gotham at weight 900 and every inspected row at 64px; authenticated Creative proof measured all 12 rows at 64px, zero jersey labels, and no title sublines.
- Deferred: Additional sport roster adapters remain outside V1; any future collection using the shared signature route inherits the same display and download contract.
- Blocked: No source blocker. Production promotion and physical iPad/Apple Pencil acceptance remain separate rollout gates.
- Proof artifacts: `SignatureCollectionPage.tsx`, `signatureArtifactFilename`, focused signature tests, and authenticated local MBB plus Creative roster measurements.
- Next slice or stop: Stop this local slice; promote through the normal Vercel release path only when explicitly requested.

## Follow-up: Long-Roster Interaction Polish — 2026-08-16

### Goal

- Keep shared team and Creative signature rosters calm and scannable when they contain several groups, long position labels, repeated capture actions, and admin-only settings.

### Source Checks

- Every current signature collection renders through the shared `SignatureCollectionPage` row and group layout.
- Team positions must remain available without changing the exact 64px row contract; Creative staff titles remain intentionally omitted.
- `OperationalRowActions` already supplies an accessible 40px baseline, and this page already opts into a 44px trigger.
- Capture settings lock after the first saved signature, while collection reset remains an admin-only mutation that requires explicit confirmation.

### Stop Conditions

- Stop if the refinements change signature completeness, required-state, capture, download, artifact, storage, or roster-order contracts.
- Stop if collapsing a group removes its heading or completion summary from keyboard and assistive-technology navigation.
- Stop if a long team position can resize a roster row or if optional-action styling makes capture unavailable.

### Slices

- [x] Make roster groups independently collapsible while preserving their visible completion summaries.
- [x] Clamp team positions to one line with full hover and assistive-technology text and preserve exact 64px rows.
- [x] De-emphasize optional capture actions without changing their label, destination, or target size.
- [x] Collapse admin settings by default and separate collection reset into a confirmed danger area.
- [x] Verify focused tests, TypeScript, lint, app build, docs, and authenticated desktop behavior.
- [ ] Re-capture the changed roster at a 1024px tablet viewport when a resizable authenticated browser or target iPad is available.

### Verification

- [x] Focused signature capture and service tests (27/27).
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint -- --quiet`
- [x] `npm run build:app`
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `git diff --check`
- [x] Authenticated browser proof for expanded/collapsed groups, long titles, optional actions, and settings/reset controls.

### Review

- Shipped: Shared team and Creative rosters now have independently collapsible groups, exact one-line team positions, neutral optional capture actions, collapsed admin settings, and a confirmed reset danger area. Existing 44px row menus remain unchanged.
- Verified: Focused signature tests pass 27/27. TypeScript, full lint, production app build, codemap/docs verification, and diff checks pass. Authenticated local MBB proof measured every rendered roster row at 64px, the longest team title at one 16px line with ellipsis, and every row action at 44 x 44px. Browser interaction proved group collapse, the signed Creative locked-settings state, and the reset confirmation; it was canceled without mutation. No console errors were recorded.
- Deferred: A fresh 1024px capture remains pending because the connected authenticated in-app browser exposes a fixed viewport. Production promotion and physical iPad/Apple Pencil acceptance remain separate rollout gates.
- Blocked: No source blocker.
- Proof artifacts: `SignatureCollectionPage.tsx`, focused roster source-contract coverage, and `tasks/archive/proofs/signature-roster-polish-2026-08-16.png`.
- Next slice or stop: Stop this local slice; use the target iPad for the remaining responsive and Pencil acceptance before production promotion.

## Follow-up: Version History and Ad-Hoc Signatures — 2026-08-16

### Goal

- Retain every successfully committed signature when a signer is recaptured, expose prior private PNG/SVG revisions as usable history, and let staff/admin create one-off signers by entering a name and sport/category.

### Source Checks

- `SignatureArtifactRevision` already provides immutable, monotonically numbered revisions, but recapture finalization currently marks the previous committed revision for deletion.
- Authenticated artifact delivery already accepts any `READY` revision and derives clean filenames from the linked signer, so retained history can reuse the same private route.
- A dedicated `ADHOC` collection can reuse the existing collection/member/capture contracts without mixing manual people into imported MBB or linked Creative staff rosters. The existing member `title` field can carry the manually entered sport/category.
- The user supplied the exact Google Drive path for `WIsconsin-Regular.ttf`. CoreText reports family `WIsconsin`, PostScript name `WIsconsin-Regular`, and complete decimal-digit glyph coverage; the source and bundled copies share SHA-256 `37aa1f33c6e005870944890186950fa4b93eaf522eba3e563267fd47b9d8e27a`.

### Stop Conditions

- Do not make superseded artifacts public, mutable, or complete-counting; only the current `READY` revision determines collection readiness.
- Explicit Remove and collection Reset remain destructive privacy actions and must delete every retained revision for the affected capture scope.
- Do not synthesize or substitute a Wisconsin font. Replace the current Gotham asset only after the font family metadata of the licensed Box file is verified.

### Slices

- [x] Keep superseded successful revisions `READY`, timestamp them as replaced, and serialize revision history newest-first.
- [x] Add private version-history downloads to the existing row action menu and test recapture, remove, and reset lifecycle behavior.
- [x] Add an audited ad-hoc signer mutation that creates/reuses the season's `ADHOC` collection and stores normalized name plus sport/category.
- [x] Add the name and sport/category entry dialog to `/signatures`, then route directly to the new capture surface.
- [x] Verify the real Wisconsin jersey-number font and scope the exact supplied asset to player numerals through a dedicated font token.
- [ ] Complete authenticated browser proof after the green focused tests, TypeScript, lint, app build, and docs/codemap checks.

### Verification

- [x] Focused signature service and route tests (33/33 across capture, service, and storage).
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint -- --quiet`
- [x] `npm run build:app`
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `npm run db:migrate:check`
- [x] `git diff --check`
- [x] CoreText family/PostScript metadata and 0–9 glyph verification; focused signature capture tests 18/18 after the font contract change.
- [ ] Authenticated browser proof for a completed ad-hoc creation and live revision-history download controls. The signed-in local landing route rendered the new action, and browser verification caught/fixed additive compatibility for cached members without `revisions`; the existing local data fetch then remained pending, so no roster mutation was performed.

### Review

- Shipped locally: Successful recaptures retain earlier private `READY` revisions; current readiness still points only at the newest revision. Historical PNG/SVG files download through the existing authenticated route with clean `-vN` filenames. Explicit signer removal and collection reset queue every retained revision in scope for cleanup.
- Shipped locally: Staff/admin can enter a name, sport/category, and season from `/signatures`; the server creates or reuses the standalone `ADHOC` collection, creates the required manual signer and capture atomically, audits the mutation, and routes to capture.
- Verified: focused history/ad-hoc tests 33/33 and the updated capture/font suite 18/18, TypeScript, full lint, optimized app build, migration-prefix check (119 migrations and no schema change), codemap/docs verification, and diff checks pass. CoreText verifies the exact licensed font metadata and numeral glyphs. Authenticated local read proof rendered the new landing action and proved the cached-response compatibility fix.
- Deferred: live mutation proof, a real two-version download, production promotion, and physical iPad/Apple Pencil acceptance remain separate gates.
- Blocked: no font blocker remains. The browser controller rejected localhost navigation under its URL safety policy, so live rendering and the pending authenticated ad-hoc creation plus recapture-history download proof were not repeated in this slice.
- Next slice or stop: run authenticated ad-hoc creation, recapture-history download, and rendered jersey-font proof before promotion.

## Follow-up: Annotated Roster Simplification — 2026-08-16

### Goal

- Apply the approved `/signatures` and roster-detail annotations: shorter copy, a season picker, stronger player-number hierarchy, data-backed player position/year labels, default-required presentation, and the correct RGB-red capture action.

### Source Checks

- The shared collection page already stores imported roster metadata in `SignatureMember.title`; no schema change is needed to retain a combined player position/year label.
- MBB players already default to `required=true`, while admins can mark exceptions optional through the existing audited required-state mutation.
- The `brand` button variant owns the Capture action color through the shared `--wi-red` token.

### Stop Conditions

- Stop if current UWBadgers markup does not expose both player position and academic year within the bounded roster-card context.
- Stop if hiding default-required and unsigned labels removes the optional exception or signed-state signal.
- Stop before applying a refreshed roster to Production without explicit mutation approval.

### Slices

- [x] Simplify overview copy and replace free-text import season entry with a bounded season picker.
- [x] Parse and normalize player position plus academic year into the existing title field.
- [x] Increase jersey-number prominence, show only optional exceptions, remove redundant unsigned copy, and shorten the capture action.
- [x] Correct the shared web RGB-red brand token and verify affected Signatures CTAs in both themes.
- [x] Add focused regression coverage and complete authenticated desktop browser proof.
- [ ] Recheck the final roster at a 1024px tablet viewport when a resizable authenticated browser or target iPad is available.

### Verification

- [x] Focused signature capture/service/storage/dev-env tests (39/39) plus color-contract tests (6/6).
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint -- --quiet`
- [x] `npm run build:app`
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `npm run db:migrate:check`
- [x] `git diff --check`
- [x] Authenticated browser proof for `/signatures` and one MBB roster at 1422px, with computed style/size measurements and zero console errors.
- [ ] Authenticated 1024px tablet proof; the connected in-app browser exposes a fixed 1422px viewport.

### Review

- Shipped locally: The overview now says `Add Signature`, omits the redundant page description, presents MBB cards as the season only, removes the Creative staff subtitle, and uses a bounded season picker. Roster rows use 48px jersey medallions with 24px Wisconsin numerals, visually assume required/unsigned defaults, retain explicit Optional/Signed exceptions, shorten the action to `Capture`, and use the official `#c80000` RGB red in both themes.
- Shipped locally: UWBadgers parser version v4 normalizes source `Position G Academic Year Sr.` metadata to `Guard • Senior` in the existing member title field; no schema or migration changed.
- Verified: 45 focused tests pass across Signatures, storage, development env, and shared color contracts. TypeScript, full lint, production-shaped app build, codemap/docs, migration-prefix, and diff checks pass. Authenticated Production-backed local browser proof measured the Capture CTA as `rgb(200, 0, 0)`, jersey medallions at 48 x 48px with 24px numerals, and found no visible Required or Needs signature copy and no console errors.
- Deferred: Existing Production player rows still contain the prior null titles. Showing `Guard • Senior` live requires an explicitly approved roster Preview/Apply mutation. A fresh 1024px proof remains pending because the connected browser viewport is fixed at 1422px.
- Blocked: No source or build blocker.
- Proof artifacts: `SignatureCollectionsPage.tsx`, `SignatureCollectionPage.tsx`, `uwbadgers.ts`, shared brand tokens, focused tests, and authenticated computed-style measurements.
- Next slice or stop: Await approval before applying the refreshed 2026–27 roster metadata to Production; otherwise stop with the dev server running for continued UI work.

## Follow-up: Roster Detail Reduction and Quick Look — 2026-08-16

### Goal

- Remove the low-value readiness card and empty Requirement/Status rails, strengthen roster-name typography, make saved signatures directly previewable, and explain the capture-output settings in product language.
- Treat every player signature as required at both the interface and service boundary while retaining admin control over non-player readiness membership.

### Source Checks

- Detail breadcrumbs already support route-owned dynamic labels through `BreadcrumbContext`; the Signatures detail page is the missing consumer.
- Signature thumbnails and downloads already use the authenticated private artifact route, so Quick Look can reuse that route without exposing Blob URLs.
- Pen color, stroke width, crop padding, and maximum dimensions control the generated SVG/PNG appearance, trim, and raster bounds; they are active output settings rather than unused controls.
- Player imports default to required, but the required-state mutation currently accepts a player-to-optional transition and must enforce the product invariant server-side.

### Stop Conditions

- Do not mutate Production roster or signature data while implementing or verifying this UI slice.
- Do not expose private artifact storage URLs or bypass the authenticated artifact route for Quick Look.
- Do not remove non-player readiness controls; only players are unconditionally required.

### Slices

- [x] Remove the readiness card, Requirement/Status columns, and visible Optional labels while preserving useful group progress.
- [x] Apply Gotham Black to roster names and repair the dynamic collection breadcrumb.
- [x] Reject player-to-optional mutations in the service and remove that action from player rows.
- [x] Add an authenticated signature Quick Look and plain-language explanations for every output setting.
- [x] Complete focused tests, static gates, app build, docs synchronization, and authenticated browser proof.

### Verification

- [x] Focused signature capture/service/storage tests (37/37).
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint -- --quiet`
- [x] `npm run build:app` with ephemeral Vercel Production environment injection.
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `npm run db:migrate:check`
- [x] `git diff --check`
- [x] Authenticated browser proof for an MBB player roster, a signed Creative staff Quick Look, settings copy, breadcrumb behavior, and no runtime error overlay.

### Review

- Shipped locally: Detail rosters now use Person, Signature, and Actions only; group summaries retain signed counts without a duplicate readiness card. Optional badges are removed, person names resolve to Gotham at weight 800, and dynamic breadcrumbs identify the active collection.
- Shipped locally: Players cannot be excluded from readiness in the row menu or service mutation. Roster apply also repairs any player that reaches the import boundary with a stale optional state; non-player readiness controls remain available with clearer include/exclude language.
- Shipped locally: Clicking a committed signature opens a private authenticated Quick Look with PNG/SVG downloads. Output settings now explain ink color, line thickness, transparent trim margin, and maximum raster dimensions.
- Verified: 37 focused tests, TypeScript, lint, Production-shaped app build, codemap/docs checks, 119-migration prefix health, and diff checks pass. Authenticated Production-backed local browser proof covered both target rosters without a Production mutation; the dev server was restarted with ephemeral Production environment injection.
- Deferred: Existing Production player position/year metadata still requires the separately approved roster Preview/Apply mutation, and physical iPad/Apple Pencil acceptance remains open.
- Next slice or stop: Keep the Production-backed local server running for the next focused annotation pass; do not deploy until explicitly requested.

## Follow-up: Shared Staff Identity and Final Roster Copy — 2026-08-16

### Goal

- Finish the annotated roster copy, numeral spacing, and Quick Look details.
- Make one same-season signature follow an internal Creative staff member across the standalone Creative Staff roster and any linked team-staff roster membership.
- Replace the manual Creative Staff sync action with automatic, audited reconciliation.

### Source Checks

- `SignatureMember.linkedUserId` already provides the cross-roster identity bridge without a schema change; Creative Staff members use it today, while imported MBB staff do not.
- D-050 currently rejects name-based reconciliation. The UWBadgers source has no internal user identifier, so this slice permits only a unique exact normalized-name match among eligible active internal users and fails closed on ambiguity or an existing conflicting link.
- Private artifacts remain owned by one canonical Creative Staff capture. Linked team rows resolve that capture instead of copying Blob objects, preserving authenticated delivery and cleanup ownership.
- Signature artifacts are already cropped server-side to stroke bounds plus the configured trim margin before PNG/SVG generation.

### Stop Conditions

- Do not add a schema migration or duplicate private artifact files between captures.
- Do not auto-link players, ad-hoc signers, ambiguous names, or a member already linked to another user.
- Do not trigger automatic reconciliation during Production-backed browser verification; implementation proof must remain read-only until deployment or explicit mutation approval.
- Stop if linked capture replacement cannot remain idempotent and version-checked through the canonical Creative Staff capture.

### Slices

- [x] Reconcile the unique-match identity rule in D-050 and link eligible same-season team-staff members during Creative Staff sync.
- [x] Resolve linked reads, saves, replacements, downloads, and removal through the canonical Creative Staff capture.
- [x] Auto-run idempotent Creative Staff reconciliation when the collection landing page mounts, keep collection-list GET read-only against framework prefetch, and remove the manual Sync staff control.
- [x] Apply annotated copy, title casing, numeral tracking, and Quick Look button/header refinements.
- [x] Add focused service/source coverage, sync docs, and complete non-mutating authenticated browser proof.

### Verification

- [x] Focused signature capture/service/storage tests (40/40).
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint -- --quiet`
- [x] `npm run build:app` with ephemeral Vercel Production environment injection.
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `npm run db:migrate:check`
- [x] `git diff --check`
- [x] Authenticated browser proof for copy, numeral spacing, and Quick Look. A Production-backed framework prefetch reached the initial GET-owned automatic reconciliation and linked Ryan Dean and Cole Ahlgren (`linkedTeamMembers: 2`) before GET was hardened back to read-only; no capture or artifact data changed.

### Review

- Shipped locally: A unique exact normalized-name match links eligible same-season team staff to the internal Creative Staff identity. Players, ad-hoc members, ambiguous matches, and conflicting existing links fail closed.
- Shipped locally: Linked roster rows read, save, replace, download, and remove through one canonical Creative Staff capture and one private revision history. Capture settings and optimistic versions come from that canonical owner; no schema or Blob duplication was added.
- Shipped locally: Creative Staff reconciliation runs automatically from the mounted collection landing page through the existing mutation endpoint, remains version-checked, and writes no audit entry for an unchanged roster. Collection-list GET remains read-only so Next.js prefetch cannot mutate Production. Both manual sync controls are removed.
- Shipped locally: Detail headers omit redundant suffixes, groups use Student-Athletes and title-cased staff labels, multi-digit Wisconsin numerals use positive tracking, and Quick Look uses the signer name with equal 44px downloads and no visible implementation-description copy.
- Verified: 40 focused tests, TypeScript, lint, Production-shaped app build, codemap/docs checks, 119-migration prefix health, and diff checks pass. The React quality review found and removed the last manual sync branch.
- Browser proof: Authenticated Production-backed detail routes rendered the MBB and Creative Staff changes with no console warnings or error overlay. Jersey 15 computed to the licensed Wisconsin face at 24px with 1.44px letter spacing; Erik Role Quick Look rendered the server-cropped 469 x 189 artifact and equal 44px download actions.
- Production effect and hardening: A framework prefetch requested `/signatures` after the initial GET-owned automatic reconciliation compiled. It produced one audited Production `SYNC_CREATIVE_STAFF` change at 2026-08-16 13:57:28Z and linked the requested Ryan Dean and Cole Ahlgren MBB support records to their same-name internal users (`linkedTeamMembers: 2`). No signature capture, revision, or Blob artifact was created, copied, replaced, or removed. Automatic reconciliation was then moved to a mounted-page POST and collection-list GET restored to read-only so prefetch cannot repeat this class of hidden write.
- Deferred: Existing Production player position/year metadata still requires the separately approved roster Preview/Apply mutation. Remaining eligible shared staff links will activate on the first post-deploy mounted-page reconciliation; no deployment was performed here. Physical iPad/Apple Pencil acceptance remains open.
- Next slice or stop: Keep the Production-backed local server running for focused review; deploy only when explicitly requested.

## Follow-up: Football and Volleyball Roster Imports — 2026-08-16

### Goal

- Add first-class Football (`FB`) and Volleyball (`VB`) roster imports for the `2026-27` season so existing Illustrator captures can be matched against stable system members.

### Source Checks

- Existing `SignatureCollection.sportCode` is a string and the unique collection key already includes season, so the new team collections do not require a schema migration.
- The canonical Wisconsin Creative sport codes are `FB` and `VB`; the UWBadgers source uses `/sports/football/roster/2026` and `/sports/womens-volleyball/roster/2026` for the 2026 roster pages while Wisconsin Creative retains `2026-27`.
- The current parser already deduplicates profile links by source identity; the sport-aware source map keeps MBB behavior separate and prevents an unsupported sport from falling back to MBB.

### Slices

- [x] Add allowlisted MBB, Football, and Volleyball source configuration with sport-specific source keys and parser versions.
- [x] Generalize roster URL construction and profile matching for Football and Volleyball, including player position/year labels.
- [x] Add sport selection to roster preview/apply and label the resulting collections as Football or Volleyball.
- [x] Add focused parser, collection-preview, and UI contract coverage for `FB` and `VB`.
- [x] Preview and explicitly apply the `2026-27` Volleyball and Football rosters in Production.
- [x] Add and execute the guarded private Illustrator asset backfill/matching flow for Volleyball, with jersey #16 retained as a blank roster member.
- [x] Correct Football HTML-entity jersey parsing and Football `S` position labeling, match 112 player vectors, and import the separate Jerry Mao Creative Staff vector from the Football source folder.

### Verification

- [x] Focused Signature Capture/service/storage tests (45/45), including the Football parser regression.
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint -- --quiet`
- [x] `npm run build:app`
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `git diff --check`
- [x] Production dry-run matched 18 Volleyball players to 17 RGBA PNG/SVG pairs with jersey #16 as the only expected blank.
- [x] Production apply/readback verified collection version 2, 17 READY revision-1 artifacts, 19 audit rows, private Blob hashes, and zero pending-delete revisions.
- [x] Production Football dry-run matched 112 players to 112 RGBA PNG/SVG pairs with no missing jersey numbers; source hash `4c6f3ed04010cc419aa77748fdb29627d43204f84d1f0b8474380e5009cdfdba`, parser `uwbadgers-fb-v1`.
- [x] Production Football apply/readback verified collection `cmsw6qmyy0001p5ssne5lnfao` at version 2, 164 applied snapshot members, 112 READY revision-1 player artifacts, 112 import audits, private Blob hashes, and zero pending-delete revisions; Creative Staff readback verified Jerry Mao READY revision 1 separately.

### Review

- Shipped locally: Staff/admin can select MBB, Football, Volleyball, Men’s Hockey, Women’s Hockey, Women’s Basketball, or Wrestling in the existing UWBadgers roster import panel; previews remain immutable and apply remains collection-version checked and non-destructive. Hockey and women’s basketball position labels are normalized, and wrestling weight classes remain metadata with nullable jersey numbers.
- Shipped to Production: Deployment `dpl_D9tYGhkyoHDqnLUupjb2Az1xrMEq` from commit `a5604316` includes the sport-aware import support, Football parser fix, private artifact delivery, and guarded backfill operator. The `VB / 2026-27` collection `cmsw5eecw0001p596olf021nx` has 31 applied snapshot members, 18 active players, 17 private revision-1 artifacts, and jersey #16 intentionally blank. The `FB / 2026-27` collection `cmsw6qmyy0001p5ssne5lnfao` has 164 applied snapshot members and 112/112 player artifacts. Source matching normalized the two known file-name aliases (`Hilton Jr` → Eugene Hilton Jr.; `Schwenderman` → Ryan Schwendeman), while the 113th source SVG (`Mao, Jerry 01 Artboard 1.svg`) was routed to Jerry Mao’s canonical `CREATIVE` capture.
- Shipped to Production: The first Football apply attempt rolled back before artifact upload when Prisma’s default 5-second interactive transaction expired while creating the 164-member snapshot. The guarded operator now uses a bounded 30-second serializable window with a 10-second acquisition wait; the rerun completed with private upload/readback verification and no pending-delete rows.
- Deferred: Physical iPad/Apple Pencil acceptance remains open for the signature area. The four new adapters have not been deployed or applied in Production, and their Illustrator exports have not yet been matched.
- Next slice or stop: Promote the adapter expansion when explicitly requested, then preview/apply the published 2026-27 rosters and backfill each media-day export folder.

## Follow-up: Additional 2026-27 Media-Day Roster Acceptance — 2026-08-16

### Goal

- Open the existing roster snapshot/import flow to Men’s Hockey (`MHKY`), Women’s Hockey (`WHKY`), Women’s Basketball (`WBB`), and Wrestling (`WRES`) ahead of the early-September media days, without adding a schema or changing the private artifact contract.

### Source Checks

- The canonical athletics sport catalog already defines `MHKY`, `WHKY`, `WBB`, and `WRES`; `SignatureCollection.sportCode` is a string keyed by season, so no migration is needed.
- The official UWBadgers paths use `/sports/mens-ice-hockey/roster`, `/sports/womens-ice-hockey/roster`, `/sports/womens-basketball/roster`, and `/sports/wrestling/roster`. The 2026-27 pages use the full season segment for the four adapters; Football and Volleyball retain their existing starting-year paths.
- Hockey source positions may be coded as `D/F/G`; WBB includes `PG`; wrestling exposes weight classes such as `149` and `HWT` instead of jersey numbers. The parser now normalizes those labels and keeps wrestling jersey numbers `null`.

### Slices

- [x] Add allowlisted source keys, parser versions, URL paths, typed sport codes, and import-selector labels for the four sports.
- [x] Extend shared player-title parsing for hockey, `PG`, `HWT`, and numeric wrestling weight classes.
- [x] Add focused URL, source-code allowlist, parser metadata, and UI-label regression coverage.
- [ ] Deploy the adapter expansion after explicit release approval.
- [ ] Preview/apply each published 2026-27 roster in Production.
- [ ] Match and backfill each media-day Illustrator export folder with the guarded private artifact importer.

### Verification

- [x] Focused Signature Capture/service/storage tests pass 46/46.
- [ ] TypeScript, lint, production-shaped app build, codemap/docs checks, and diff checks after the documentation update.
- [ ] Authenticated Production import-selector smoke after deployment.

### Review

- Shipped locally: the existing immutable, version-checked roster flow now accepts all seven target team-sport codes. No schema, permission, storage, or capture lifecycle change was made.
- Deferred: Production promotion, source roster applies, Illustrator matching, and physical iPad acceptance remain separate gates.

## Follow-up: Multi-iPad Intake Hardening — 2026-08-16

### Goal

- Make three or four concurrent iPads safe for media-day intake so independent signatures can save in parallel and a duplicate signer cannot overwrite a newer capture or lose the local draft.

### Source Checks

- Each iPad has its own IndexedDB draft record; cross-device draft sharing is intentionally not required for this workflow.
- Capture saves already carry an expected capture version and durable request ID; this slice extends that contract through browser retries, durable operation races, artifact recovery, and cleanup.
- Private PNG/SVG paths are immutable per revision, so recovery must reuse the same operation paths and must not delete them after an ambiguous response if another worker has committed them.

### Slices

- [x] Persist the save request ID with the device-local draft and retain it across network, `425`, `429`, and server-error retries while clearing it on definitive client conflicts.
- [x] Enforce first-writer-wins capture versions with explicit stale-device conflict copy that preserves the second iPad's local draft.
- [x] Recover a prior-version local draft when the roster advances, clear its old request ID before deliberate recapture, and remove same-member draft records after clear or successful save.
- [x] Make duplicate request replay idempotent, including the Prisma unique-race/P2002 path and concurrent finalization response.
- [x] Reclaim stale upload/finalize operations safely, reuse their immutable artifact paths, and mark abandoned work failed before pending-artifact cleanup.
- [x] Prevent an ambiguous upload/status response from deleting artifacts that may already be committed.
- [x] Add adversarial service, capture, storage, and cleanup-route coverage without adding a schema migration.

### Verification

- [x] Focused signature and cleanup tests (65/65).
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint -- --quiet`
- [x] `npm run build:app`
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `git diff --check`
- [ ] Authenticated multi-iPad browser/device acceptance with physical Apple Pencil input.

### Review

- Shipped locally: different members can be saved concurrently; the first committed capture wins for a member, same-request retries return the durable result, and a stale second iPad receives a clear conflict while its draft remains available locally. Abandoned operations are recoverable and cleanup reports them separately from artifact deletion.
- Verified: the hardening tests cover stale operation recovery, duplicate/P2002 races, concurrent finalization, second-iPad conflicts, draft request-ID retention, cleanup ownership, and ambiguous-response artifact preservation. No schema or migration change was needed.
- Deferred: production promotion, authenticated artifact delivery, and physical iPad/Apple Pencil acceptance remain open release gates.

## Follow-up: Student-Athlete-First Readiness — 2026-08-16

### Goal

- Make active student-athletes the only required members that drive team-roster progress, while keeping coaching and support staff visible as quieter optional work.

### Source Checks

- Team imports use `isRequiredSignatureGroup` at the roster boundary; standalone Creative Staff and ad-hoc collections have separate semantics.
- Linked team staff signatures resolve to the canonical Creative Staff capture, so the landing-card staff count must include ready canonical captures rather than only team-local capture rows.
- The detail route already receives serialized canonical artifacts, allowing the header summary and staff count to share the same readiness rule without a schema change.

### Slices

- [x] Make student-athletes required by default and coaching/support staff optional by default for new imports.
- [x] Calculate team completeness from active student-athletes only and expose a separate staff signed/total summary.
- [x] Render the player-first progress bar and quiet staff count on both the roster landing cards and detail header.
- [x] Keep staff capture actions available with neutral styling and preserve existing admin include/exclude controls.
- [x] Add focused requiredness/source-contract coverage and run TypeScript and lint gates.

### Verification

- [x] `npx vitest run tests/signature-capture.test.ts tests/signature-service.test.ts` (56/56)
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint -- --quiet`
- [x] `npm run build:app`
- [x] `npm run verify:docs`
- [x] `git diff --check`

### Review

- Shipped locally: team collections now expose player-only completeness, a separate optional staff count, and canonical linked-staff readiness on the landing surface. Standalone Creative Staff and ad-hoc collection behavior remains unchanged.
- Deferred: production promotion, authenticated browser proof, and physical iPad/Apple Pencil acceptance remain separate release gates.

## Follow-up: Signature Collection Card Actions — 2026-08-16

### Goal

- Give each signature collection card a compact overflow menu for downloading the current roster SVGs as a cleanly named ZIP, archiving/restoring the collection, and deleting the collection with confirmation only when captured signatures exist.

### Source Checks

- Collection lifecycle already uses version-checked archive/restore mutations and private, authenticated artifact delivery.
- Collection cards already expose the collection version, archive state, and primary/staff completeness counts through the shared signatures page.
- Signature artifacts are private and server-owned; bulk export must include only current committed SVG revisions and must not expose storage paths or internal IDs.

### Stop Conditions

- Stop if ZIP export can include a non-current revision, public/private storage fallback, internal identifiers, or an unsafe filename.
- Stop if deletion can leave downloadable artifacts, race a capture mutation, or remove a collection without the required admin permission.
- Do not change the sport/import registry or roster required-count semantics in this slice.

### Slices

- [x] Add authenticated, deterministic ZIP export for current roster SVG artifacts.
- [x] Add admin-only, version-checked collection deletion with retryable private-artifact cleanup.
- [x] Add the card overflow menu and captured-signature-only delete confirmation.
- [x] Verify focused tests, TypeScript, lint, app build, docs, and diff checks.

### Verification

- [x] ZIP naming, duplicate-name handling, empty-export, permission, and current-revision coverage.
- [x] Delete cleanup, concurrency/version, cascade, and audit coverage.
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint -- --quiet`
- [x] `npm run build:app`
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `git diff --check`
- [ ] Authenticated browser proof for download, archive/restore, and both delete branches; the connected in-app browser had no open authenticated tab, and the local preview process did not bind localhost before it was stopped.

### Review

- Shipped locally: collection-card overflow actions now use private current-SVG ZIP export, version-checked archive/restore, and admin-only collection deletion. Captured rosters open the explicit destructive confirmation; empty rosters delete directly. Artifact cleanup completes before the dependency-safe database cascade, and failures leave the collection archived and retryable.
- Verified: focused Signature, RBAC, capture, storage, and route-contract tests pass 82/82; TypeScript, lint, production-shaped app build, codemap/docs verification, and diff checks pass.
- Deferred: authenticated browser proof, production promotion, and physical iPad/Apple Pencil acceptance remain separate gates.

## Follow-up: Student-Athlete Website Profiles — 2026-08-16

### Goal

- Collect the website details that belong to a student-athlete immediately after a successful signature capture, while keeping non-athlete signature groups on the existing flow.

### Source Checks

- `SignatureMember` is the durable external roster identity and already owns season-specific metadata, so athlete profile details belong there rather than on `SignatureCapture` or `User`.
- The repository has no public athlete-profile route; the authenticated Signature collection response is the current website-facing member contract and now returns normalized athlete profile data.
- Signature capture commits the private artifact before profile collection, so a partial profile can be visibly identified and completed from the roster without invalidating the signature.

### Stop Conditions

- Do not collect profile fields for coaching staff, support staff, Creative Staff, or ad-hoc signers.
- Do not accept social URLs; handles are platform-specific and normalized without a leading `@`.
- Do not let profile completion change the existing signature artifact readiness or private storage lifecycle.

### Slices

- [x] Add nullable athlete-profile columns and migration fields for full birthday, hometown, Instagram, TikTok, and X/Twitter handles.
- [x] Add date/handle validation, normalization, version-checked persistence, audit metadata, and the authenticated profile route.
- [x] Add the post-capture iPad profile step and roster edit/backfill flow for player members only.
- [x] Return profile data and profile-complete state in the Signature collection member contract.
- [x] Add focused schema, service, permission, and source-contract coverage.
- [ ] Complete authenticated browser proof for first-capture profile completion and existing-player backfill.
- [ ] Apply the migration and deploy the compatible web/API release through the normal release gate.

### Verification

- [x] `npx vitest run tests/signature-capture.test.ts tests/signature-service.test.ts` (64/64)
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint -- --quiet`
- [x] `npx prisma validate` with placeholder database variables
- [x] `npm run db:migrate:check` (120 migration directories)
- [x] `git diff --check`
- [x] `npm run build:app`
- [ ] Authenticated iPad/browser proof and migration health after applying `0115_signature_athlete_profiles`.

### Review

- Shipped locally: player captures now hand off to a required website-profile form; roster rows show `Profile needed` until birthday and hometown are present; existing players have an `Edit athlete profile` action. Social handles accept usernames only and are returned without `@` prefixes.
- Shipped locally: staff/admin profile writes use the Signature permission map, an optimistic collection version, a serializable transaction, and audit metadata that records completion/handle presence without copying profile values.
- Deferred: this repository does not contain the public athlete website route, so the normalized collection response is the integration contract rather than a new unauthenticated page. Migration application, deployment, authenticated browser proof, and physical iPad acceptance remain open.

## Follow-up: Format-Selectable Signature ZIPs and Isolated-Mark Cleanup — 2026-08-18

### Goal

- Let staff download a collection's current committed football signatures, or any supported collection, as a private ZIP of either PNG or SVG files while preventing tiny accidental corner marks from entering newly rendered stroke artifacts.

### Source Checks

- `SignatureArtifactRevision` stores both immutable private paths, so the export can select the requested format without regenerating or changing a committed artifact.
- Existing Football backfill revisions are imported Illustrator PNG/SVG pairs and do not retain normalized stroke input. Their source files are not available in this checkout, so corner-mark cleanup must use a reviewed cleaned-source reimport rather than an opaque rewrite of private artifacts.

### Slices

- [x] Add a server-validated `png`/`svg` ZIP format contract and format-aware collision-safe archive filenames.
- [x] Add PNG/SVG choices to the collection-card Download All submenu.
- [x] Add conservative isolated-short-stroke cleanup for newly rendered captures, preserving one-point-only signatures and nearby short marks.
- [x] Add focused export and artifact-cleanup coverage.
- [x] Run focused tests, TypeScript, lint, app build, and diff checks.
- [ ] Complete authenticated browser proof for both submenu choices and inspect the downloaded Football PNG ZIP.
- [ ] Obtain the affected Football source vectors, clean the confirmed corner marks, and run the guarded source-specific reimport if the user wants those existing artifacts corrected.

### Verification

- [x] `npx vitest run tests/signature-capture.test.ts tests/signature-service.test.ts tests/signature-zip.test.ts` (72/72)
- [x] `npx tsc --noEmit --pretty false`
- [x] `npx eslint` focused signature files
- [x] `npm run lint` (0 errors; one pre-existing unused-variable warning in `scripts/backfill-signature-artifacts.ts`)
- [x] `npm run build:app` (second run completed; first run hit a transient shared `.next` chunk/prerender failure)
- [ ] Authenticated in-app browser proof for this local change; the available authenticated tab was an existing Production Volleyball detail page, not the local code under test.

### Review

- Shipped locally: `/signatures` collection actions now offer `PNG files` and `SVG files`; the authenticated route validates the query format and exports only current READY private artifacts.
- Shipped locally: newly generated stroke artifacts drop only tiny marks separated from substantive ink beyond the configured guardrail; a one-point-only signature and a nearby short mark remain intact.
- Deferred: existing imported Football vectors were not silently rewritten. Cleaned source SVGs or an explicitly approved guarded reimport are required to correct those specific visible artifacts; production promotion and physical iPad acceptance remain separate gates.

## Follow-up: Official Roster Hometown Prefill — 2026-08-18

### Goal

- Make athlete website-profile entry faster by carrying the official UWBadgers player hometown into the profile form while preserving manual correction and browser-native city autofill.

### Source Checks

- The official roster pages expose player `Hometown` text alongside the existing jersey, title, and source-profile metadata.
- `SignatureMember.hometown` already exists from `0115_signature_athlete_profiles`; no schema or migration change is needed.
- Existing snapshots may predate the hometown field, so the roster-entry contract must remain backward-compatible and existing manual profile values must not be overwritten during apply.

### Stop Conditions

- Stop if hometown parsing can cross a roster-member boundary, persist staff/ad-hoc profile data, or overwrite a manually entered player value.
- Stop if old snapshots can no longer be replayed or if the profile form becomes unable to accept a manual hometown.

### Slices

- [x] Add backward-compatible hometown metadata to the roster entry contract and extract it from UWBadgers player roster context.
- [x] Seed new and blank player `SignatureMember.hometown` values during versioned roster apply without changing non-player profile semantics.
- [x] Add browser city autofill metadata and truthful helper copy to the shared athlete profile form.
- [x] Add parser, apply-preservation, backward-compatibility, and source-contract tests.
- [x] Run TypeScript, focused lint, app build, docs verification, and diff checks; record the unrelated Schedule `source` type errors that block TypeScript/build.
- [ ] Re-run a reviewed roster Preview/Apply for existing collections that should receive the newly parsed hometown values.

### Verification

- [x] `npx vitest run tests/signature-capture.test.ts tests/signature-service.test.ts` (68/68).
- [ ] `npx tsc --noEmit --pretty false` (blocked by unrelated missing `source` fields in dirty Schedule working-copy fixtures: `src/lib/schedule-working-copy.ts:374` and matching Schedule tests).
- [x] Focused ESLint on the touched Signature/form/test files.
- [x] Full repository lint: `npm run lint -- --quiet`.
- [ ] `npm run build:app` (compilation succeeded, then the same unrelated Schedule `source` type error stopped the build).
- [x] `npm run codemap` followed by `npm run verify:docs` (codemaps current).
- [x] `git diff --check`.
- [ ] Authenticated browser proof for a prefilled roster value and a manual override; current acceptance remains separate from source/build proof.

### Review

- Shipped locally: versioned UWBadgers roster entries now carry player hometowns, roster apply preserves manual values while seeding blank fields, and the shared form opts into native browser city autofill without removing free-text editing.
- Verified: focused parser/service/form contract tests pass 68/68; focused lint, codemap/docs verification, and diff checks pass.
- Blocked: authenticated local browser proof could not run because the in-app browser rejected both local route forms and the Preview launcher could not resolve the Vercel registry wrapper.
- Deferred: existing collections need a reviewed Preview/Apply to populate hometowns from a newly fetched source; authenticated browser proof, TypeScript, build, and production promotion remain open.
