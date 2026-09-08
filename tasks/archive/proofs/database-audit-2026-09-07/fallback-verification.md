# Fallback and index repair verification — 2026-09-07

Used the same disposable Unix-socket PostgreSQL cluster as the first pass, with a
new `wc_fallback_followup` database. No Neon writes, live credentials or production
records were used. The cluster was stopped after the rehearsal.

Generated the full current schema offline with Prisma's empty-to-datamodel diff,
loaded it into the fixture, and created an empty Prisma receipt table. Removed only
the six fixture indexes represented by migration `0145` to reproduce the observed
production gap. Generated transactions from the actual exported
`buildFallbackTransaction` function, substituted fixture-only bound values as SQL
literals, and ran each batch inside `BEGIN ISOLATION LEVEL READ COMMITTED` / `COMMIT`
using `psql -X -v ON_ERROR_STOP=1`. This verifies PostgreSQL behavior; unit mocks
separately verify the Neon transaction adapter and lost-response handling.

```text
PASS: full schema fixture accepts both repairs; six missing indexes restored; DDL and receipts commit together
PASS: failed second statement rolls back earlier DDL and the migration receipt
PASS: stale same-migration plan cannot execute twice
PASS: concurrent runner refused immediately; exactly one completion receipt
PASS: unresolved history blocks DDL inside the locked transaction
```

Failure fixture: `CREATE TABLE fallback_partial (id integer)` followed by a SELECT
from a deliberately missing table. Read-back confirmed neither the first table nor
the attempt receipt persisted. Duplicate-plan rehearsal failed in the guard before
DDL. Concurrent rehearsal held the first transaction open with `pg_sleep(2)`, waited
until the advisory lock was visible in `pg_locks`, then submitted a second plan:
the second failed with `Another migration is running`, and the first committed one
receipt. An inserted fixture-only unfinished legacy receipt blocked subsequent DDL.

Unit coverage additionally verifies changed/empty/manual/DB-only migration history,
unsafe top-level transaction commands, concurrent index commands, nested comments,
exact-attempt receipt reconciliation after a lost HTTP response, missing/wrong
receipts, and a failed reconciliation read. No case automatically replays SQL.

96 focused tests, TypeScript, repository lint, app build (259 pages), 151 migration
prefixes, docs verification and diff whitespace checks passed. These checks do not
establish live Neon transport acceptance, production migration application, backup
configuration or a production restoration drill.

Read-only follow-up found no configured snapshot schedule, one manual production
snapshot dated 2026-05-01, and six genuine missing declared indexes after excluding
three equivalent indexes under legacy truncated names. See
[catalog evidence](followup-readonly.json).

Design references: [Neon non-interactive transactions](https://neon.com/docs/serverless/serverless-driver)
and [Prisma advisory-lock source discussion](https://github.com/prisma/prisma-engines/issues/5755).
