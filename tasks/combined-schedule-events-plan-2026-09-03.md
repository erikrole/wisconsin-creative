# Combined Schedule Events Plan - 2026-09-03

## Goal
- Let Staff/Admin combine two overlapping source events at the same venue into one operational Schedule event with one shared crew, while retaining both imported event records for sync and history.
- Use the 2026-09-04 Women's/Men's Cross Country Badger Classic pair as the acceptance case.

## Route
- Owner area: Events and Shift Calendar & Scheduling.
- Ledger: this active plan plus `tasks/todo.md` closeout notes.
- Existing references: `docs/AREA_EVENTS.md`, `docs/AREA_SHIFTS.md`, D-026/D-042/D-046, and `docs/BRIEF_MULTI_EVENT_BOOKING_V1.md` for the precedent that source-event identity remains additive rather than being overwritten.

## Source Checks
- `CalendarEvent` is source-owned and idempotently synced by `(sourceId, externalId)`; deleting or rewriting one imported event would not be durable.
- `ShiftGroup` is currently one-to-one with `CalendarEvent`, and working-copy/publication behavior is group-owned.
- Preview data has two overlapping Badger Classic events at the same normalized venue. The Women's event owns the published three-person crew; the Men's event has an unpublished working copy and no active assignments.
- The existing Cross Country settings group already treats `MXC` and `WXC` as one operational sport family for staffing defaults.
- The combine dialog currently requires operators to discover the pair manually and hides a second event until the first strict same-venue/overlap candidate is chosen. Same-day same-family suggestions can reduce that discovery cost without weakening server validation.
- The first suggestion pass still buries discovery under the More menu, requires a second Review click, does not name the crew consequence until preview returns, and has no recovery action after apply.
- The combine transaction retains the secondary working copy at a superseding version and archives only an unpublished/unassigned group, so an audited uncombine can safely restore that group without publishing its draft.

## Stop Conditions
- Stop if the selected events do not overlap, do not resolve to the same venue, are the same record, or already belong to incompatible combined-event relationships.
- Stop if the secondary event has a published crew or active assignments; the combine action must never silently choose between two live crews.
- Stop if a pending secondary working copy changes between preview and apply.
- Stop before production migration/deployment or live event mutation unless explicitly requested.

## Slices
- [x] Slice 1: Add a nullable self-relation from a secondary `CalendarEvent` to its operational parent, with mapped index and safe `SET NULL` deletion behavior.
- [x] Slice 2: Add preview/apply service and authenticated route. Select the canonical parent deterministically, verify overlap/venue/family, retire only an unpublished unassigned secondary crew, and audit the full before/after state.
- [x] Slice 3: Return combined-member metadata from Calendar Event reads and collapse the pair into one Schedule entry whose window spans both events and whose crew is the parent's crew.
- [x] Slice 4: Add a Staff/Admin shadcn combine dialog on Schedule with candidate filtering, preview warnings, explicit apply, and refresh/recovery behavior.
- [x] Slice 5: Add focused service/API-source/projection tests and sync Events, Shifts, Decisions, Gaps/Risks, task ledger, and codemaps.
- [ ] Slice 6: Produce the required matched UI review artifact and authenticated browser smoke, or record the exact runtime blocker.
- [x] Slice 7: Suggest standalone same-day, same-sport-family event pairs at the top of the combine dialog, require the existing venue/overlap/opponent heuristics, and let an operator prefill the existing preview-first flow without changing mutation eligibility.
- [x] Slice 8: Surface suggestion count and a dismissible inline Schedule prompt, and make suggestion selection open the server preview immediately with explicit keep/retire crew counts.
- [x] Slice 9: Add a serializable, permissioned, audited uncombine transition that restores only the secondary archived group and retained draft with automatic release still disabled.
- [x] Slice 10: Show the canonical and combined source-event identities with individual times on Event detail, including the guarded Undo combination action for Staff/Admin.

## Verification
- [x] Focused Vitest service, API-source, merge-projection, and UI source-contract tests.
- [x] `npx prisma format`
- [x] `npx prisma validate`
- [x] `npm run db:migrate:check`
- [x] `npm run db:migrate:guard`
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [x] `npm run codemap`
- [x] `npm run verify:docs`
- [x] `git diff --check`
- [x] `npm run build:app`
- [ ] Matched before/after `gt-ui-review` page.
- [ ] Authenticated browser smoke for `/schedule`, or record why unavailable.
- [x] Focused uncombine service/API-source and Schedule/Event-detail QoL tests.
- [ ] Live migration health and deploy only when rollout is explicitly in scope.

## Review
- Shipped: implemented locally only; no commit, push, migration application, deployment, or live event mutation.
- Verified: 44 focused tests, including deterministic suggestions, exact preview consequences, audited combine, draft-safe Undo, projection, and source contracts; Prisma format/validate and migration prefix/schema guards; TypeScript; full lint; codemaps/docs; diff hygiene; and the production-shaped app build. The QoL follow-up re-ran the focused suite, TypeScript, full lint, codemaps/docs, diff hygiene, and `build:app` successfully.
- Deferred: native iOS combined-row and recovery presentation are tracked by D-060 and GAP-75.
- Blocked: matched UI review and authenticated browser smoke require migration `0142` to be applied before the compatible local app can query the database; applying it and changing the live Cross Country pair are outside this implementation-only slice.
- Proof artifacts: command evidence in this task; no matched runtime capture claimed.
- Next slice or stop: apply migration `0142`, perform authenticated preview/apply/readback, then add native combined-row parity before production closeout.
