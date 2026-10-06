# Native Schedule Edit Times and Post Trade Redesign - 2026-07-18

## Goal

- Finish the core native Schedule sheet redesign with a clear shift call-window editor and one consistent Trade Board posting flow from both Event detail and the Trade Board.

## Route

- Owner area: `AREA_SHIFTS`
- Secondary area: `AREA_MOBILE`
- Ledger: this plan plus `tasks/todo.md`
- Existing references: `tasks/ios-schedule-core-redesign-plan.md`, `tasks/ios-schedule-staff-authoring-redesign-plan.md`, `tasks/audit-event-detail-ios.md`, `tasks/audit-post-trade-ios.md`, and `tasks/archive/completed-2026-10-06/shift-trade-actions-plan.md`

## Source Checks

- Shift-time edits remain staff/admin-only and continue through `PATCH /api/shifts/[id]`; the server remains authoritative for persistence, permissions, and audit behavior.
- Trade posts continue through `POST /api/shift-trades`; the assignment owner remains scheduled until a claimant completes the existing trade workflow.
- Event detail currently uses a confirmation dialog with no note field while the Trade Board uses `PostTradeSheet`. This slice can remove that UI drift without changing the API or schema.
- Add Shift already establishes the native 15-minute call-window control and purple constructive-action treatment. Edit Shift Times should reuse that interaction language.
- Existing discard confirmation, in-flight guards, action-specific errors, role gates, and accessibility behavior are regression contracts.

## Stop Conditions

- Stop if a unified posting sheet would change who may post a shift, who remains assigned, or how a trade is claimed or approved.
- Stop if shift-time editing requires a new scheduling policy or server payload instead of the existing start/end contract.
- Preserve all existing Schedule, Availability, Trade Board, reservation, and unrelated dirty-worktree changes.

## Slices

- [x] Rebuild Edit Shift Times around event and slot context, explicit 15-minute Call and End controls, inline validation, one purple Save action, and retained input after failure.
- [x] Replace Event detail's bare trade confirmation with the same role-aware Post Trade sheet used by the Trade Board, including assignment context, optional notes, and clear ownership consequences.
- [x] Redesign Post Trade selection, empty, error, loading, discard, Dynamic Type, and VoiceOver states without changing permissions or trade policy.
- [x] Add source-contract coverage and sync the area docs, gaps, audits, and task ledgers.

## Verification

- [x] Focused Edit Shift Times, Event detail, Post Trade, Trade Board, and API source-contract tests.
- [x] Full `tests/ios-*.test.ts` native source-contract suite.
- [x] `npm run drift:ios`
- [x] `npm run audit:ios:gaps`
- [x] `npm run ios:project:check` (unblocked 2026-08-20: `xcodegen generate` resorted the hand-added `KioskOperatorHubView.swift` entries; the hand-maintained schemes were restored afterward).
- [x] Wisconsin Simulator and generic iOS device builds.
- [ ] Runtime inspection of both sheets without mutating production schedule data (blocked at Login after the simulator session reset).
- [x] `npm run codemap`, `npm run verify:docs`, and `git diff --check`.

## Review

- Shipped: Event-aware Edit Call Window and one role-aware Post to Trade Board sheet shared by Event detail and the Trade Board.
- Verified: 25 focused and 252 full native source contracts, iOS drift and gap audits, Simulator compilation, and unsigned generic-device compilation.
- Deferred: Authenticated visual inspection of the two sheets.
- Blocked: The simulator launches to Login because its authenticated session was reset. The XcodeGen drift that previously blocked `npm run ios:project:check` was cleared on 2026-08-20; the check now passes.
- Proof artifacts: Successful Simulator and generic-device Xcode builds; simulator launch screenshot at Login.
- Next slice or stop: Continue to the remaining secondary Schedule management sheets only if requested.
