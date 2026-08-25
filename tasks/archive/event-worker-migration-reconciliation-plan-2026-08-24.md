# Event worker migration reconciliation

## Goal

Reconcile the deployed `0131_event_credits` migration with the current event-worker schema without rewriting applied migration history or interrupting the currently deployed application.

## Verified starting state

- Production had recorded `0131_event_credits`.
- The local migration chain had renamed that applied migration to `0131_event_workers`, so migration health reported one pending local migration and one database-only migration.
- The current Prisma schema maps `EventWorker` to `event_workers` and uses `added_by_id`.
- The application deployed before this reconciliation maps the old model to `event_credits` and `created_by_id`.

## Completed slices

1. Restored the immutable `0131_event_credits` migration exactly as applied.
2. Added `0134_event_workers_rename` to rename the table, column, indexes, and constraints in place, then expose an updatable `event_credits` compatibility view for the previously deployed code.
3. Verified Prisma formatting and validation, the migration-prefix check, focused event-worker tests, TypeScript, and production migration health.
4. Committed only the migration reconciliation as `81ac56e9`, pushed it to `origin/main`, and deployed it through Vercel production deployment `dpl_8jrrpXVhE8LTqewRgwNHvh4M2boN`.

## Acceptance evidence

- `0131_event_credits` remains byte-for-byte identical to the applied migration.
- Production records all 139 local migrations, including `0134_event_workers_rename`; there are no pending or database-only migrations.
- The production deployment reached `Ready` and owns the canonical `wisconsincreative.com` alias.
- The compatibility view keeps the previous event-credit model usable during the event-worker application rollout.

## Remaining product proof

The event-worker application surface remains a separate dirty-tree slice. Its area-document acceptance state should change only after that code is shipped and visually verified in an authenticated production session.
