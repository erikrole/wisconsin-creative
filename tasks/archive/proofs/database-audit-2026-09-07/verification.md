# Database audit verification — 2026-09-07

Local PostgreSQL used a disposable cluster under `/tmp/wc-database-audit-pg.uBbGLO`,
Unix socket only (`listen_addresses=''`, port 55439). No production connection
string was used. The cluster was stopped after verification.

Fixture setup:

```sql
CREATE TABLE asset_allocations (
  id text PRIMARY KEY,
  asset_id text NOT NULL,
  starts_at timestamp(3) NOT NULL,
  ends_at timestamp(3) NOT NULL,
  active boolean NOT NULL DEFAULT true
);
```

Applied `prisma/migrations/0144_restore_asset_allocation_overlap_guard/migration.sql`,
then [overlap-fixture.sql](overlap-fixture.sql), then reapplied the migration.

Observed:

```text
PASS: overlapping insert rejected
PASS: conflicting reactivation rejected
PASS: overlapping extension rejected
PASS: adjacent windows, inactive history and different assets retained
Repeat migration: CREATE EXTENSION (already exists), DO; exit 0
```

Two negative rehearsals ran inside explicit transactions, with `psql
ON_ERROR_STOP=1` and connection close rolling back on failure:

- Removed the fixture guard, inserted an overlapping row, and reapplied migration.
  PostgreSQL refused constraint creation because keys conflict. A subsequent read
  confirmed the original four rows, no conflicting test row, and the original guard.
- Replaced the fixture guard with a same-named CHECK constraint, then reapplied.
  Migration raised `Unexpected asset_allocations_no_overlap definition` and left
  the original constraint intact after rollback.

The first negative-test harness expected insertion-time wording; PostgreSQL emits
`could not create exclusion constraint` during constraint creation. The harness
was corrected to that observed failure; no migration weakening was needed.

Source gates: 69 focused tests; TypeScript, repository lint, app build (259 pages),
schema validation, 150 local migration-prefix validation, docs verification and
diff whitespace validation passed. Production remains unchanged.
