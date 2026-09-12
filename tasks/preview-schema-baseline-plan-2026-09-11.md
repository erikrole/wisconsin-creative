# Preview schema baseline — 2026-09-11

Owner: this task. Scope: explicitly approved Preview-only baseline and migrations
0144–0146. Production, deployment, guide publication, and storage writes excluded.

The user approved preserving historical receipts while accepting a verified
present-day schema checkpoint with unknown original provenance. This supersedes
the original-execution-evidence requirement only for `br-morning-surf-aiuyphxx`,
database `gear-tracker`, endpoint `ep-winter-leaf-ai0eekhl`.

## Bounded plan and contracts

- [x] Recover available Git evidence and inspect live receipts; 43 lack usable
  hashes, and 0071 matches its original Git version before `IF NOT EXISTS` was added.
- [ ] Compare the live catalog with the declared schema; rehearse reviewed forward
  SQL on disposable PostgreSQL 17. Never bootstrap the populated Preview database.
- [ ] Record an immutable, target-bound checkpoint outside `_prisma_migrations`.
  Preserve all old rows, including rolled-back attempts and original timestamps.
- [ ] Make health/deploy recognize only the exact reviewed checkpoint and frozen
  receipt snapshot. New failures, changed SQL, changed receipts, or another branch
  must fail closed. Do not infer that historical SQL was verified.
- [ ] Apply only reviewed 0144–0146 through atomic guarded migration plans; verify
  receipts, catalog, nullability, indexes, and allocation exclusion afterward.
- [ ] Run regression, source, documentation, and compile gates; record outcomes.

Affected contracts: D-006 exclusion protection; migration direct URL and strict
history wrappers; nullable unique `Resource.importKey`; six declared lookup
indexes. No schema.prisma, historical SQL, application data, or API edits planned
in this slice. Existing importer and unrelated kiosk work remain untouched.

## Acceptance / evidence

Pending. This is an operational schema checkpoint, not proof of original migration
execution and not a rewritten Prisma migration baseline. Production remains strict.
