# Women’s Hockey Signature Save Validation Plan - 2026-08-31

## Goal

- Restore reliable `WHKY / 2026-27` signature saves for freshmen without weakening private storage, concurrency, or payload protections.

## Route

- Owner area: Signatures.
- Ledger: this bounded incident plan; durable rollout truth remains in `tasks/signature-capture-micro-app-plan.md` and `docs/AREA_SIGNATURES.md`.
- Existing references: D-050, GAP-65, and the Signature Capture V1 brief.

## Source Checks

- The failing POST validates only request ID, capture/settings versions, strokes, and points; academic year and member metadata are not part of the save body.
- The generic `Validation failed` response is emitted by the shared Zod handler before `saveSignatureCapture` or private Blob storage runs.
- The current signature-specific limits are 32 strokes and 2,000 points per stroke, while the route separately enforces a streaming 1 MB request ceiling.
- The client does not warn or prevent a signer from crossing either stroke-shape limit.

## Stop Conditions

- Stop if current production evidence identifies a non-stroke validation field or a storage/commit error instead.
- Do not weaken the 1 MB streaming body limit, private artifact path, optimistic capture version, request idempotency, or pen-only input contract.

## Slices

- [x] Reproduce the freshman-shaped high-stroke/high-sample request rejection in focused schema coverage.
- [x] Raise the redundant per-stroke shape ceilings to accommodate deliberate printed/slow signatures while retaining the 1 MB total request bound and explicit validation messages.
- [x] Verify the focused Signature suite, TypeScript, lint, app build, docs/codemap, and final scoped diff.
- [ ] Record authenticated WHKY save and physical iPad acceptance separately from local source proof.

## Verification

- [x] `npx vitest run tests/signature-capture.test.ts tests/signature-member-route.test.ts tests/signature-service.test.ts tests/signature-storage.test.ts`
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint -- --quiet`
- [x] `npm run build:app`
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `git diff --check`
- [ ] Authenticated `WHKY / 2026-27` iPad save, or record why that gate remains operator-blocked.

## Review

- Shipped: Local capture validation accepts deliberate printed and slow Pencil signatures up to 128 strokes and 10,000 samples in one continuous stroke; the streaming 1 MB request ceiling is unchanged.
- Verified: 98 focused Signatures tests, TypeScript, quiet full lint, and `npm run build:app` with all 251 static pages generated.
- Deferred: deployment and a real authenticated `WHKY / 2026-27` save/artifact readback.
- Blocked: physical acceptance requires the target iPad and Apple Pencil; production promotion requires explicit release authorization.
- Proof artifacts: `tests/signature-capture.test.ts` covers the former 33-stroke and 2,001-sample failures plus the retained ceilings.
- Next slice or stop: stop locally for deployment authorization, then complete operator iPad acceptance on `WHKY / 2026-27`.
