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
