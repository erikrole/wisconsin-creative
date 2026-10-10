# Remove Premier Events Plan

> **Closed 2026-10-06** in the open-task audit: remaining boxes are stale (work shipped in source or superseded). Evidence is in the audit report; nothing here is open.

Started: 2026-07-02

## Scope

Remove the vestigial premier-event approval concept from Schedule end-to-end.

Confirmed product decision: all open Student shift pickups become instant `DIRECT_ASSIGNED` claims. Do not create new `REQUESTED` pickup rows from Open Work. Keep existing `REQUESTED` assignment status and approve/decline routes only for legacy or historical rows until a later pure cleanup can prove they are empty in production.

Schema decision: drop both `shift_groups.is_premier` and `shift_trades.requires_approval`. Keeping `requires_approval` would preserve a dead approval branch in the Trade Board read model and native contracts.

## Audit Notes

- Touched models: `ShiftGroup.isPremier @map("is_premier")`, `ShiftTrade.requiresApproval @map("requires_approval")`.
- Existing status enum `ShiftAssignmentStatus.REQUESTED` remains because approval routes, exports, and historical rows still reference it.
- Open Work claim path changes from request-vs-claim branching to direct assignment for every claimable published Student shift.
- Trade claim path changes from conditional review to immediate swap for every open trade.
- Docs requiring sync: `docs/AREA_SHIFTS.md`, `docs/GAPS_AND_RISKS.md`, task ledgers.

## Implementation

- [x] Remove Prisma fields from `schema.prisma`.
- [ ] Generate the migration with `npm run db:migrate:new -- --name remove_premier_events`. Blocked locally because the command targets remote Neon through `prisma migrate dev`; sandbox run failed with a schema-engine error and escalation was rejected as remote mutation risk.
- [x] Remove `isPremier` and `requiresApproval` from Schedule services, API payloads, exports, and web Schedule components.
- [x] Remove premier/request grouping and copy from native iOS Schedule/Open Work models and Trade Board sheet.
- [x] Update pinned student field contract tests.
- [x] Sync docs and close the task review.

## Verification

- [x] `npx prisma format`
- [x] `npx prisma validate`
- [x] `npm run db:migrate:check`
- [x] Focused Vitest contracts for Schedule/Open Work/iOS student field surfaces
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run drift:ios`
- [x] `npm run audit:ios:gaps`
- [x] `npm run codemap`
- [x] `npm run verify:docs`
- [x] `git diff --check`
- [x] `npm run build:app`

## Review

- Removed the premier-event concept from active code and active docs. `shift_groups.is_premier` and `shift_trades.requires_approval` are removed from Prisma schema and generated client usage. Open Work claims now always create acknowledged `DIRECT_ASSIGNED` assignments and decline legacy pending requests on the same shift. Trade claims now execute swaps immediately. Web Schedule and native iOS no longer show approval-required or staff-review sections for open work.
- Migration generation remains the only blocked item. The project-approved generator command failed in sandbox and could not be escalated because it can mutate the configured remote Neon database. Do not hand-create the migration directory; rerun with an explicitly approved safe local/shadow database or explicit approval for the remote `migrate dev` risk.
