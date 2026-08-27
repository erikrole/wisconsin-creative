# Signature Signing Experience Plan - 2026-08-25

## Goal

- Make the iPad signing surface consistent, rehearsable, and truthful before it carries real media-day volume: one uniform exported line weight for every signer, an admin settings panel that shows the pen it is configuring, a practice pad and pen check before the real capture, a pre-commit view of the actual cropped artifact, and roster-free progression between signers.
- Line weight is deliberately uniform. Pressure sensitivity, velocity tapering, and stroke-end tapering are out of scope by explicit product direction.

## Route

- Owner area: Signatures.
- Ledger: this active plan. `tasks/signature-capture-micro-app-plan.md` remains the V1 implementation/rollout ledger and keeps GAP-65.
- Scope: shared stroke geometry and artifact rendering, the admin capture-settings panel, the iPad capture surface, focused tests, and area documentation.

## Source Checks

- `penSettings` lives only on `SignatureCollection` (`prisma/schema.prisma:921`), is admin-only, and locks permanently once `firstCaptureAt` is set (`settingsLocked = hasCapturedSignatures` in `SignatureCollectionPage.tsx`). No revision records the pen that produced it.
- `buildSignatureSvg` writes `stroke-width` in logical canvas units while the SVG `viewBox` is the tight crop, and `renderSignaturePngFromSvg` scales that crop to fit `maxWidth` x `maxHeight`. Exported weight is therefore `strokeWidth / cropWidth`, which varies with how large the signer happened to sign — roughly 3x between a 300-unit and a 900-unit crop at identical settings.
- The capture canvas draws with the same absolute `strokeWidth`, so the on-canvas pen is unchanged by any crop-relative normalization; only the exported artifact becomes consistent.
- PNG download regeneration reads the **stored SVG** and rasterizes it (`artifacts/[revisionId]/[kind]/route.ts`), so stroke width is already baked into committed revisions. Changing the renderer cannot alter existing artifacts.
- `geometry.ts` is already imported by the client capture page and pulls in no Node-only dependency, so shared render helpers can live there. `artifacts.ts` imports `sharp` and must stay server-only.
- `computeSignatureCropBounds` throws `Signature exceeds the configured crop dimensions` server-side, after the signer has finished. Nothing on the client bounds the drawing against `maxWidth` / `maxHeight`.
- Stroke-generated captures are currently rare in production: the applied `FB` and `VB` rosters are Illustrator imports whose weights already vary by source, and GAP-65 still lists a real Pencil save as open. Normalizing now, before capture volume exists, avoids splitting a roster between two weight rules.
- The working tree carries unrelated docs, `tasks/`, and `signatures.ts` changes from other work; those files stay out of scope.

## Stop Conditions

- Stop if normalization cannot keep rendering deterministic — identical strokes and settings must continue to produce identical SVG/PNG bytes and hashes.
- Stop before touching committed revisions, the private storage contract, save-operation lifecycle, or capture-version conflict semantics.
- Do not add pressure, tilt, velocity, or taper to the stroke model.
- Do not remove the pen-class input gate, the iPad gate, or the disabled-until-ink Save state.

## Slices

- [x] Slice 1: Normalize exported stroke weight against the export scale so one setting yields one line weight across a roster, and prove determinism plus unchanged cleanup behavior.
- [x] Slice 2: Render a live pen sample in the admin capture-settings panel from the same shared builder, so line thickness and ink are configured against real output rather than a bare number.
- [ ] Slice 3: Add a practice pad and pen check to the capture surface — same renderer and settings, no draft persistence, Save disabled — so an athlete and the Pencil are both warm before the real signature.
- [ ] Slice 4: Show the actual cropped artifact on a transparency ground before commit, and bound the drawing client-side against the configured maximum dimensions instead of failing at save.
- [ ] Slice 5: Add Save-and-next progression across unsigned signers plus an explicit signer confirmation, so a 164-row roster is not scrolled between athletes and a wrong-signer save is harder to make.
- [ ] Slice 6: Record resolved pen settings on `SignatureArtifactRevision` and allow a bounded per-capture thickness override, which also retires the permanent collection settings lock.

Slices 1-2 are this pass. Slices 3-6 remain queued and are ordered by value against cost.

## Verification

- [x] Focused signature tests: 106 passed across six files, including three new contracts — equal exported weight for a small and a large signature, the clamp for a degenerate crop, and the export-size helper pinned against the bytes sharp renders.
- [x] `npx tsc --noEmit --pretty false` (clean; the repository's pre-existing stale `.next/types` TS6053 entries are unrelated and appear without any local change).
- [x] `npm run lint`
- [x] `npm run build:app` (exit 0, compiled in 20.1s; the `/_document` rejection during page-data collection is the known unrelated transient already recorded in `signature-capture-micro-app-plan.md`).
- [x] `git diff --check`
- [x] Production deployment of the capture-state fix: `dpl_FU8zF5NgFgyUtQ8C5BjgwnBG5rfS` from commit `25aae229` is READY and aliased to `https://wisconsincreative.com`; unauthenticated smoke on `/signatures` and the reported capture route both return the expected `307` to `/login`.
- [x] Follow-up iPad bootstrap contract fix is source-verified locally: the capture page now unwraps the API's nested `{ collection, member }` response, with a regression contract named for the false-archive failure.
- [ ] Production deployment of the bootstrap contract fix remains pending; authenticated browser proof and physical iPad acceptance remain separate gates.
- [ ] Authenticated browser proof of the settings panel: the Preview dev server starts and serves the app, but the tab is unauthenticated and no session was established in this pass. Slices 1-2 reached production at 08:03 through the repository's automatic commit/push pipeline before this gate was met.
- [ ] Matched UI review capture for the settings-panel change; blocked behind the authenticated session above.
- [ ] Physical iPad / Apple Pencil acceptance remains open under GAP-65 and is not claimed by this plan.

## Review

- Shipped locally (slices 1-2): exported line weight is normalized against the export scale, so one configured thickness delivers one uniform line across a roster instead of an apparent weight that varied roughly 3x with signature size. The shared SVG builder moved from server-only `artifacts.ts` into client-safe `geometry.ts` and is re-exported, so the new admin pen preview renders through the exact builder that produces the delivered artifact rather than a reimplementation.
- Unchanged on purpose: pen-class input gating, the iPad gate, draft and save-operation lifecycle, capture-version conflicts, private storage, and the cleanup thresholds in `removeAccidentalSignatureStrokes`, which still measure against the configured width.
- Existing artifacts are safe: PNG download regeneration rasterizes the stored SVG, so committed revisions keep the width baked in at capture time and cannot be re-rendered by this change.
- Known consequence: a collection that already holds stroke-generated captures will render new captures under the new rule while older ones keep their original weight. The applied `FB` and `VB` rosters are Illustrator imports whose weights already vary by source, and GAP-65 still lists a real Pencil save as open, so the exposure is small — but a partially stroke-captured roster should be reset and recaptured rather than mixed.
- Added outside the planned slices: the capture surface's unavailable card named only two of the four states that can reach it. It now distinguishes an archived collection, an inactive signer, unusable pen settings, and an unresolved payload, and matches the existing error-card treatment. Reported from a live hit of the old message; the specific record behind that hit is still unconfirmed because the Preview database readback was blocked by the local permission classifier.
- Follow-up bug fix (local, not deployed): the one-member capture API returned `{ collection, member }` while the iPad page consumed the response as a flat collection. That made an open Creative Staff roster appear archived and rendered its season as `undefined`; the page now unwraps the response before evaluating status or starting capture. Production readback confirms `CREATIVE / 2026-27` is `OPEN` and has no archive audit entry.
- Next slice or stop: Slice 3 (practice pad and pen check) is the next bounded step and pairs naturally with the open GAP-65 physical iPad acceptance. Stop here if the authenticated settings-panel capture should come first.

## Shoot Week Readiness - 2026-08-27

### Goal

- Make the Production Signatures workflow operationally ready for the Aug. 31-Sept. 3 video shoots: Women's Hockey on Monday, Men's Hockey and Wrestling on Tuesday, Men's Basketball on Wednesday, and Women's Basketball on Thursday.

### Source Checks

- Production `/signatures` is authenticated and currently exposes open `2026-27` collections for Women's Hockey (25 active players), Wrestling (18), Men's Basketball (14), and Women's Basketball (14). Men's Hockey is the only missing shoot-week collection.
- The connected `Mega Shoot and Media Shoot Full Details` workbook confirms a `CHECK IN/SIGNATURES` station and the four-day team sequence, but it does not contain a Men's Hockey roster tab. The station is still assigned only to the generic `Brand Comm Student` role, the personnel/gear tab still shows `????` for `Kohl Center - Signature`, and the workbook explicitly says `iPad Needed`.
- The canonical Men's Hockey adapter requests the official `/sports/mens-ice-hockey/roster/2026-27` page. On 2026-08-27 the official site still presents the 2025-26 roster at its current roster route, so Production must not silently apply last season's people to the `2026-27` collection.
- `main` contains the iPad bootstrap response-shape fix (`9e5bfd48`). The current Production deployment `dpl_FGrmRuKWMnsfGocqKSyDQzeguDaP` is READY, aliased to `wisconsincreative.com`, and renders the authenticated collection landing/details without console errors. Physical iPad/Pencil proof remains a separate gate.

### Stop Conditions

- Stop before creating or applying the Men's Hockey collection unless an authoritative current roster is available from UWBadgers or an explicitly approved internal source.
- Stop if any existing shoot collection is archived, has no applied snapshot, has unexpected active-player counts, or cannot open a one-member bootstrap with the collection and member identities intact.
- Do not represent desktop/API proof as physical Apple Pencil acceptance.

### Slices

- [x] Read back each existing shoot roster, including member counts, active/current snapshot state, first unsigned player, and capture readiness.
- [ ] Materialize the Men's Hockey `2026-27` collection from an authoritative current roster, or record the exact source blocker and safe field fallback.
- [x] Run focused Signature tests and compile gates against the source on `main` without absorbing unrelated dirty-worktree failures.
- [ ] Complete authenticated Production smoke for landing, roster detail, one-member bootstrap, and authenticated private artifact delivery where a committed shoot-roster artifact exists.
- [ ] Complete a physical iPad/Apple Pencil rehearsal: pen-only ink, touch controls, save, Saved feedback/direct roster return, artifact preview/download, rotation/interruption, and a second-device conflict check.

### Verification

- [x] `npx vitest run tests/signature-capture.test.ts tests/signature-client-cache.test.ts tests/signature-member-route.test.ts tests/signature-service.test.ts tests/signature-storage.test.ts tests/signature-zip.test.ts` (107/107).
- [x] `npx tsc --noEmit --pretty false`.
- [x] `npm run lint -- --quiet`.
- [x] `npm run build:app` after confirming no dev server owned the shared `.next` directory; 245/245 static pages generated.
- [x] `git diff --check -- tasks/signature-signing-experience-plan-2026-08-25.md`.
- [ ] Authenticated Production browser and server read-back for all five shoot collections.
- [ ] Physical iPad/Apple Pencil acceptance recorded separately from automated and desktop proof.

### Review

- Shipped: Production Men's Basketball received a reviewed, version-checked, non-destructive roster refresh. Its 14 active players are unchanged; current source metadata now renders, including `Guard • Senior` for Trey Autry instead of the stale generic athlete label. No application source, schema, migration, or private artifact was changed.
- Verified: Production has open, already-applied `2026-27` rosters matching the current official source for Women's Hockey (25 players / 36 total members), Wrestling (18 / 27), and Women's Basketball (14 / 26). Men's Basketball is open at 14 players / 32 total members after the refresh. The protected Cole Ahlgren PNG renders from `/api/signatures/artifacts/.../png` in the MBB roster Quick Look with authenticated PNG/SVG download actions. The live deployment is READY; 107 focused tests, TypeScript, lint, `build:app`, and the targeted diff check pass.
- Deferred: Practice pad, pre-commit artifact view, Save-and-next progression, and per-revision pen settings remain the queued slices above; they were not expanded into this readiness pass. A named signature-station operator and physical iPad assignment are operational scheduling work, not inferred in this repository.
- Blocked: The official Men's Hockey `2026-27` URL has no roster entries, Production Preview fails closed, the shoot workbook has no MHKY roster tab, and copying the public 2025-26 roster would be unsafe. The existing archived ad-hoc roster is not a team-roster substitute. Physical iPad/Apple Pencil save, Saved feedback/direct roster return, rotation/interruption, and multi-device conflict acceptance are also unverified. `npm run verify:docs` remains red on pre-existing `docs/CODEMAPS/architecture.md` and `docs/CODEMAPS/frontend.md` drift; generated docs were not overwritten while concurrent work is present.
- Proof artifacts: Production deployment `dpl_FGrmRuKWMnsfGocqKSyDQzeguDaP`; live roster ids `cmtafqt0g0001kz043zj70fvk` (WHKY), `cmtafpx3h0001l9042jzan5nh` (WRES), `cmsunkqrs003op5g4rqk1902y` (MBB), and `cmtafrbpr003nkz04feik3pxn` (WBB); connected shoot workbook `1wtmeKCHEawUIp7u_GOae7PNXjXLpXXqDFSdPVvrjFG8`.
- Next slice or stop: Obtain or approve an authoritative current Men's Hockey roster, then Preview/Apply it into `MHKY / 2026-27` and perform the physical iPad rehearsal before Monday's first signature station. Stop before any last-season fallback or test recapture of a real Production signer.

## Profile Removal and Save Feedback - 2026-08-27

### Goal

- Remove the student-athlete website-profile feature from Signatures so every successful capture returns directly to the roster, and give Save a brief, restrained success animation before that navigation.

### Source Checks

- The profile feature currently spans the post-capture branch, collection-row status/action/dialog, one authenticated mutation route, service/type contracts, permission mapping, focused tests, and the accepted Signatures docs.
- Existing `SignatureMember` profile columns may contain production data. This slice removes the feature and its runtime exposure without dropping or rewriting historical database values.
- The capture save operation, draft lifecycle, private artifact commit, cache invalidation, and capture-version conflict behavior remain the source of truth and stay unchanged.

### Stop Conditions

- Stop before deleting or migrating persisted profile values; data destruction is not required to remove the feature.
- Stop if the save-success treatment delays failure recovery, announces success before the artifact commit, or ignores reduced-motion preferences.
- Stop before changing roster imports, source-profile identity, hometown roster metadata, or the private artifact lifecycle.

### Slices

- [x] Remove profile UI, response fields, mutation route/service/schema-boundary contracts, and permission/test expectations while preserving dormant database columns and imported roster metadata.
- [x] Add a short post-commit Saved state to the capture action, with functional motion under `motion-safe` and direct roster navigation after the feedback.
- [x] Reconcile Signatures docs and the shoot-week rehearsal checklist with the simplified capture-to-roster flow.

### Verification

- [x] Focused Signature tests: 104/104 pass.
- [x] `npx tsc --noEmit --pretty false`.
- [x] `npm run lint -- --quiet`.
- [x] `npm run build:app` after confirming no dev server owned `.next`; 245/245 pages generated and the deleted profile route was absent from the route inventory.
- [x] `git diff --check` on the in-scope files.
- [x] Authenticated browser proof: the same Football roster has 112 `Profile needed` labels and an `Edit athlete profile` action in Production, versus zero of both in local Preview; neither page logged a console error.
- [x] Matched `gt-ui-review` proof at `tasks/signatures-profile-removal-save-feedback-review-2026-08-27/index.html`.

### Review

- Shipped: Local source now removes the Signatures-only website-profile UI, response fields, validation and service path, mutation route, and permission. A successful private artifact commit briefly changes Save signature to an animated green Saved state, then replaces the capture history entry with the roster. Existing database columns and values are untouched.
- Verified: 104 focused Signature tests, TypeScript, ESLint, `build:app`, scoped `git diff --check`, authenticated local Preview, matched Production/local roster captures, and a rendered review page pass. A post-commit navigation exception now remains truthfully Saved and cannot expose a repeat-save button.
- Deferred: The animation was not triggered against a live signer because that would replace a real private artifact. Its state ordering and reduced-motion contract are automated/source verified; physical iPad and Apple Pencil acceptance remains the distinct final interaction gate.
- Blocked: `npm run verify:docs` still reports shared generated codemap drift in `architecture.md`, `backend.md`, `frontend.md`, and `areas.md`. This slice removed its stale route references and updated the Signatures service line count, but did not run the generator over a heavily dirty parallel worktree. The change is not committed, deployed, or production-verified.
- Proof artifacts: `tasks/signatures-profile-removal-save-feedback-review-2026-08-27/index.html`, with matched `before.png` and `after.png` captures from the same live Football roster, account, browser, viewport, and open action menu.
- Next slice or stop: Rehearse one non-production or explicitly approved test capture on the physical shoot iPad with Apple Pencil, including the Saved feedback, direct roster return, rotation/interruption, and second-device conflict. Stop before overwriting any real signer for test proof.
