# Item receiving workflow

Scope: all eight findings requested Sep 29. Preserve unrelated edits; local only, no commit/deployment.

Owners: new-item-sheet.tsx, SerializedItemForm.tsx, BulkItemForm.tsx, draft/image helpers; stock/units receipt transactions; existing label destinations.

- [x] Safe stock/unit retries using actor-scoped, body-bound receipts committed atomically with mutations; reconcile malformed success into handoff.
- [x] Recover draft identity, shipment details, tracking choice, and remote image across refresh/auth; disclose file reattachment.
- [x] Prominent product details while preserving optional tag-first intake.
- [x] Tracking choices explain real label/scan differences.
- [x] Existing-family unit receiving and explicit empty-family creation.
- [x] Attachment decision before standalone essentials.
- [x] Print labels for created records and numbered units.
- [x] Model-aware automatic image filtering, visible photo review, replace failed photo.

Proof: focused API/domain tests, tsc, scoped lint, build:app, docs checks, matched fixture review and authenticated draft checks. No production mutation; transaction fixture evidence separate from real database proof.

Acceptance: 78 focused tests and two real disposable PostgreSQL tests passed. Matched fixture review covers 1280/768/390px; authenticated 1280/768px drafts passed without inventory writes. TypeScript, scoped lint, application build and docs checks recorded in the proof directory. Live automatic search remains unavailable due to the invalid provider key; keyless B&H handoff is available. No commit or deployment.
