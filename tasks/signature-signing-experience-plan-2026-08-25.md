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

- [ ] Slice 1: Normalize exported stroke weight against the export scale so one setting yields one line weight across a roster, and prove determinism plus unchanged cleanup behavior.
- [ ] Slice 2: Render a live pen sample in the admin capture-settings panel from the same shared builder, so line thickness and ink are configured against real output rather than a bare number.
- [ ] Slice 3: Add a practice pad and pen check to the capture surface — same renderer and settings, no draft persistence, Save disabled — so an athlete and the Pencil are both warm before the real signature.
- [ ] Slice 4: Show the actual cropped artifact on a transparency ground before commit, and bound the drawing client-side against the configured maximum dimensions instead of failing at save.
- [ ] Slice 5: Add Save-and-next progression across unsigned signers plus an explicit signer confirmation, so a 164-row roster is not scrolled between athletes and a wrong-signer save is harder to make.
- [ ] Slice 6: Record resolved pen settings on `SignatureArtifactRevision` and allow a bounded per-capture thickness override, which also retires the permanent collection settings lock.

Slices 1-2 are this pass. Slices 3-6 remain queued and are ordered by value against cost.

## Verification

- [ ] Focused signature artifact, geometry, and service tests.
- [ ] `npx tsc --noEmit --pretty false`
- [ ] `npm run lint`
- [ ] `npm run build:app`
- [ ] `git diff --check`
- [ ] Matched UI review capture for the settings-panel change.
- [ ] Physical iPad / Apple Pencil acceptance remains open under GAP-65 and is not claimed by this plan.

## Review

- Pending.
