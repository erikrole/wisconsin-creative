# Calendar sync hardening — execution plan

Date: 2026-09-29
Status: Ready for implementation; planning only in this turn.
Owner: Events / Calendar Sources. Execute one slice at a time.

## Outcome and scope

Daily and manual calendar refresh preserve staff decisions, cannot race each other, reject unsafe or malformed feeds, and report only committed results. Stay within Vercel Hobby and the existing operational model.

This plan covers calendar ingestion and its manual/cron callers. The preceding morning-refresh hardening is already present locally and must be preserved; it is not deployed proof. The checkout contains substantial unrelated work: inspect fresh status and diffs before each slice, edit bounded paths, and do not stage, commit, push, merge, provision, or invoke production mutations as part of execution without that authorization.

## Contracts and guardrails

- D-026: existing daily 08:00 UTC morning refresh, sequential source processing, disabled sources skipped, manual refresh retained, source lease, repeated hard-failure admin alerts.
- D-035: one consolidated maintenance route; independent failures must not suppress unrelated maintenance.
- `docs/AREA_EVENTS.md` AC-3/AC-6: idempotent observable sync; real changes produce audit history, unchanged rows do not.
- Staff title, timing, location, and home/away/site locks win over upstream values, including concurrent edits. Preserve captured results when the feed omits them.
- Missing upstream events remain review-only. Never auto-delete or mass-cancel because a feed is empty, truncated, or incomplete.
- Keep existing schedules, no new cron, paid service, high-frequency polling, or new notifications. Do not change publication, crew timing, or cancellation propagation policy in this hardening slice.
- Reuse existing `syncLeaseOwner`, `syncLeaseUntil`, and event fields. No migration expected; stop and amend the plan if one becomes necessary.
- Retain the existing eight-second cron admission budget and 20-second fetch ceiling initially. Neither proves whole-route completion. Measure actual runtime before changing duration configuration; do not promise Hobby execution fits merely because these constants exist.
- Manual permission and rate-limit checks remain at the route boundary. Maintain its response envelope and tolerant additive fields.

## Verified source facts

- `src/lib/services/calendar-sync.ts`: existing event rows and lock flags are read outside update transactions; update batches write by ID without rechecking those locks. Venue-mapping read failure continues with an empty mapping set. Fetch validates only the initial hostname, follows redirects, buffers the full body, then compares character length with a byte cap. `updated` includes unchanged and failed updates; cancellation counts are planned rather than committed. Source metadata persistence failures are swallowed.
- `src/app/api/calendar-sources/[id]/sync/route.ts`: the manual route owns the ten-minute source lease and holds it through shift generation; lease-release failure can override the completed response.
- `src/app/api/cron/morning-refresh/route.ts`: calls sync and shift generation without that lease. Local hardening already separates generation failures from calendar health and reports deferred work.
- `src/lib/security/ssrf.ts`: checks one DNS resolution separately from the subsequent connection. Redirect validation alone does not close DNS rebinding.
- `src/app/(app)/settings/calendar-sources/calendar-source-sync-copy.ts`: consumes event counters and errors; calls `updated` events “refreshed.”
- `src/lib/services/calendar-sync-health.ts`: repeated admin escalation is based on hard source errors. Busy/deferred work must not increment this streak.
- Existing bounded-download examples: `src/lib/resource-import-images.ts` and `src/lib/signatures/uwbadgers.ts`. Inspect their full contracts before reusing; do not widen their behavior unintentionally.
- Historical `tasks/archive/ics-hardening-plan.md` is completed background, not the owner ledger for this follow-up. No dedicated calendar-sync brief was found; D-026, D-035, and AREA_EVENTS own this work.

## Slice 1 — Preserve saved data under failures and concurrent edits

Files: calendar-sync service; owning sync/audit tests; disposable PostgreSQL tests where needed. Inspect the manual calendar-event PATCH consumer before editing.

- [ ] Abort source mutation when venue mappings fail to load. Return a source error and retain all existing event locations/site values; an actually empty successful mapping result remains valid.
- [ ] Keep fetch/parse outside transactions. In each bounded write transaction, reread current event state, recompute the diff against current lock flags/values, and write changes plus before/after audit snapshots atomically.
- [ ] Use SERIALIZABLE transactions with the existing bounded retry convention. Every retry must reread and recompute; retry only recognized serialization conflicts. Never retry the external fetch inside a database transaction.
- [ ] Preserve uniqueness through database constraints and duplicate-safe creates. Do not replace batching with one transaction or read per event.
- [ ] Verify two connection interleavings: manual edit commits before sync writes, and conflicting edit commits during sync. Final staff-locked fields must survive; unchanged rows produce no update audit. An exhausted retry is a reported failed chunk, not success.
- [ ] Verify mapping failure makes zero event writes, and failed transaction rolls back both writes and audit rows.

Exit: saved-data preservation proven by service tests and real disposable-Postgres contention/rollback evidence. Mocks alone do not close the concurrency gate.

## Slice 2 — One lease for manual and scheduled sync

Files: proposed `src/lib/services/calendar-source-refresh.ts`; manual sync route; morning-refresh route; calendar-source-sync-lock and morning-refresh tests.

- [ ] Extract shared orchestration for lease acquisition → sync → shift generation → owner-checked release. Both callers use it; remove route-local duplicate lease logic.
- [ ] Preserve ten-minute expiry initially. Acquire atomically using existing fields; release only when the owner token still matches. Verify ownership before entering writes if work could outlive the lease; an old worker cannot proceed under a replacement owner's lease.
- [ ] Manual busy result remains HTTP 409. Cron records a distinct busy/deferred source result and continues; do not treat busy as a hard feed failure or reset an existing failure streak.
- [ ] Missing/disabled sources perform no fetch or generation. Preserve the manual response envelope and explicit error detail.
- [ ] Preserve independent shift-generation error reporting. Hard sync failures skip generation; successful/partially committed sync may generate from committed events. Document this rule in the response contract.
- [ ] Release failure must be visible separately without erasing committed sync results. Expiry is recovery for abandoned owners, not permission to release another owner's lease.
- [ ] Prove manual/manual and manual/cron contention allow exactly one fetch/generation sequence, unrelated sources remain independent, expired leases recover, and stale release cannot clear a new owner.

Exit: route behavior and database lease contention verified; repeated-failure notification behavior unchanged.

## Slice 3 — Safe bounded feed ingestion

Files: calendar-sync service; focused calendar-fetch helper if needed; SSRF helper only if required by connection safety; owner-boundary fetch tests.

- [ ] Use explicit redirect handling with at most three redirects. Resolve relative Location URLs; validate HTTP(S), reject URL credentials and private/non-routable destinations on every hop. Preserve webcal-to-HTTPS normalization.
- [ ] Ensure the actual connection uses a validated public address, with correct TLS hostname/SNI, or an equivalent approved transport guarantee. Checking DNS then allowing fetch to resolve again is insufficient. Inspect installed transport support before choosing the implementation; do not weaken this requirement to fit a helper.
- [ ] Apply one total fetch deadline across redirects and body consumption. Stream bytes with the existing 10 MiB ceiling; cancel the reader/request when exceeded, including missing or false Content-Length and decoded compressed bodies. Do not buffer first and measure later.
- [ ] Validate a complete VCALENDAR envelope before mutations. Reject HTML, non-calendar text, and truncated calendars even on HTTP 200. Permit a valid empty calendar, report it explicitly, and leave existing events untouched; preserve missing-event review diagnostics.
- [ ] Bound event/error processing and diagnostic samples within the response cap. Reject invalid time windows and define deterministic duplicate UID handling: conflicting duplicate records fail validation rather than arbitrary last-writer results. Do not introduce recurrence expansion in this slice.
- [ ] Test allowed relative redirects, redirect loops/cap, private redirect targets, rebinding/address changes at connection time, streamed oversize/multibyte bodies, total timeout, HTML 200, truncated and valid-empty calendars, duplicate IDs, and reversed dates. Use controlled transports, not live hostile endpoints.

Exit: no unsafe connection or unbounded body buffering, no event writes for invalid input, and existing valid ICS fixtures still parse correctly.

## Slice 4 — Honest results and operator health

Files: calendar-sync service; calendar-sync-health; shared orchestration; settings sync copy and its tests; morning-refresh tests. Inspect all result consumers before changing semantics.

- [ ] `added`: committed inserts; `updated`: committed changed existing rows; additive `unchanged`: valid rows requiring no mutation. `cancelled`: committed transitions into cancellation, not repeated already-cancelled rows. Count failed validation/create/update records separately from successful work; bound error samples without losing total counts.
- [ ] Increment counters only after commit. Duplicate-safe inserts skipped due to concurrent presence must not inflate additions or cancellations. Replay of the same valid feed yields zero changed rows/audits.
- [ ] Preserve existing response fields/envelope; add fields tolerantly. Update Settings copy to distinguish changed, unchanged, and failed records without exposing internal enums.
- [ ] Expose metadata/lease-release failures as partial operational failures even after event commits. Do not lose event counts, hide failures in a success toast, or count an infrastructure cleanup issue as a new hard feed failure.
- [ ] Preserve existing hard-error escalation thresholds and recipients. Busy/deferred work does not change source failure streaks; event-level warnings remain distinct from a hard fetch/validation failure.
- [ ] Verify mixed successful and rolled-back chunks, cancellation replay, all-unchanged runs, and successful event writes followed by metadata/release failure. Extend the canonical service and copy tests rather than duplicating assertions across layers.

Exit: response, job history, source health, and Settings feedback agree about committed work. User-visible copy changes require authenticated browser evidence and a gt-ui-review page.

## Slice 5 — Integration, runtime budget, and closeout

- [ ] Exercise manual and scheduled entry points against an isolated authenticated preview and controlled feed. Verify preserved locks, no duplicate generation, failure recovery, partial-result display, and other maintenance completing after a source fails.
- [ ] Measure a representative feed and a slow/failed feed: full route duration, query/chunk counts, sources processed/deferred, and subsequent-run recovery. Verify actual configured Vercel function duration and Hobby scheduling constraints before a deploy-shaped verdict.
- [ ] If runtime exceeds the deployed limit, do not add cron frequency or silently enlarge compute. Record the measured bottleneck and prepare the smallest bounded continuation/workflow design using existing infrastructure; that is a separate implementation slice with its own acceptance gate.
- [ ] Update AREA_EVENTS acceptance/changelog; update D-026 with shared lease and committed-counter semantics, without changing schedule cadence. Add a GAPS_AND_RISKS entry for any unclosed concurrency/network/runtime gate. Regenerate codemaps only when needed.
- [ ] Review the final bounded diff; record local vs authenticated preview vs deployed proof separately. Archive this plan only after required implementation and acceptance are complete.

## Verification commands and evidence

Before authoring tests, apply `gt-test-audit`. Each regression must fail on baseline for its intended reason. No production-only seams for tests.

Core focused suite (add the slice's new test files explicitly):

```sh
npx vitest run tests/calendar-sync.test.ts tests/calendar-sync-audit.test.ts tests/calendar-source-sync-lock.test.ts tests/calendar-sync-health.test.ts tests/morning-refresh-route.test.ts tests/calendar-event-integrity.test.ts tests/vercel-cron-hobby-contract.test.ts
npx tsc --noEmit --pretty false
npx eslint src/lib/services/calendar-sync.ts 'src/app/api/calendar-sources/[id]/sync/route.ts' src/app/api/cron/morning-refresh/route.ts
npm run build:app
git diff --check
npm run verify:docs
```

Include every additional touched TS/test file in lint. Run `npm run codemap` before retrying stale codemap checks. Run affected Settings copy tests and authenticated browser checks for slice 4; use gt-ui-review for matched before/after captures (or clearly label unavailable baseline).

Real PostgreSQL proof: inspect `scripts/test-custody-postgres.mjs` and `vitest.postgres.config.ts` before extending the existing disposable-cluster harness with calendar tests. `npm run test:postgres:custody` currently runs that isolated configuration; keep its no-external-URL safety contract and document any generalized command before relying on it. Never point contention tests at hosted databases. Missing local PostgreSQL tools leave the database gate open; do not call mocks equivalent proof.

No Swift changes are anticipated; if API consumer discovery requires Swift edits, add affected source-contract tests and the mandated Xcode build. No schema changes are anticipated; a migration requires a revised schema slice. Use full `npm run build` only for authorized shipping/deploy-shaped verification in a controlled migration-safe environment.

## Execution state and stop conditions

All five slices are pending. No new calendar-sync implementation or runtime validation was performed while writing this plan. The earlier daily-cron changes remain local with their previously reported verification.

Start with slice 1; proceed sequentially after its gates pass. No unresolved product decision blocks local implementation. Stop the dependent slice if preserving staff overrides requires changing schedule publication semantics, transport safety cannot be established, the database proof environment is missing, or measured runtime needs a new architecture. Continue independent preparation and report the precise remaining gate. Preview provisioning, deployment, and production invocation require their own existing or explicit authorization.
