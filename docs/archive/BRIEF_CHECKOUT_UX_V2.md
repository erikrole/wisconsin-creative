# Feature Brief: Checkout UX V2

## 1) Feature Header
- Feature name: Checkout UX V2 (Event-Default, Integrity-Safe)
- Owner: Wisconsin Athletics Creative Product
- Date: 2026-03-02
- Priority: `High`
- Target phase: `Now`
- Status: **Shipped** (PRs 20–25)

## 2) Problem
- Current pain: Checkout creation and action handling are too generic and can produce inconsistent operational behavior.
- Why now: Dashboard and user tier model are now defined; checkout is the highest-impact execution workflow.
- Who is blocked: Staff running game-day operations and students handling checkout/check-in tasks.

## 3) Outcome
- Expected behavior after release: Checkout flow supports fast event-linked creation, clear state actions, safe extend/check-in, and predictable permission gating.
- Success signal: Operators can complete checkout actions from dashboard/detail with fewer conflict failures and no authorization leakage.

## 4) Scope
### In scope
- Event-default checkout creation with ad hoc fallback.
- State-based action gating for `BOOKED`, `OPEN`, `COMPLETED`, `CANCELLED`.
- Extend and check-in behavior with conflict and partial-return safety.
- Role and ownership enforcement aligned with Users policy.

### Out of scope
- Booking engine rewrite.
- Kiosk mode.
- New analytics/reporting features.

## 5) Guardrails (Project Invariants)
- Asset status is derived from active allocations, never authoritative stored status.
- Keep booking integrity protections intact (SERIALIZABLE + overlap prevention).
- Preserve audit logging coverage for new mutation paths.
- Maintain mobile-first usability and clear student flows.
- Do not rewrite booking engine unless explicitly approved.

## 6) Affected Areas
- Domain area: `Bookings`
- User roles affected: `ADMIN`, `STAFF`, `STUDENT`
- Location impact: `Mixed`

## 7) Data and API Impact (High-Level)
- Data model impact: no required architectural model rewrite; enforce transition and action rules on existing booking/allocation structures.
- Read-path impact: checkout list/detail and dashboard action rows need deterministic state and action eligibility data.
- Write-path impact: create, edit, extend, check-in, cancel, and state transitions require stricter validation paths.
- External integration impact: event linkage uses existing normalized event feed context.

## 8) UX Flow
1. Create checkout from event-default flow with optional ad hoc fallback.
2. Execute allowed actions per state from list/detail/dashboard.
3. Complete partial or full check-in with safe transition to completed state.

## 9) Acceptance Criteria (Testable)
1. Event-linked checkout can be created without manual title/date entry.
2. Ad hoc checkout path works when event linkage is disabled.
3. Extend action blocks on overlap and explains conflicting window/item.
4. Partial check-in keeps record `OPEN` until all items are returned.
5. Permission and ownership gates match `AREA_USERS.md`.
6. All mutations emit audit events.
7. Mobile list and action-sheet behavior matches `AREA_MOBILE.md`.

## 10) Edge Cases
- No events found for sport in selection window.
- Event missing opponent or end time.
- Concurrent extend requests on same allocations.
- Student attempts to edit non-owned checkout.
- Multi-location return under exception approval.

## 11) File Scope for Claude
- Allowed files to modify:
  - `AREA_CHECKOUTS.md`
  - `AREA_DASHBOARD.md`
  - `AREA_MOBILE.md`
  - `AREA_USERS.md`
  - `DECISIONS.md`
- Forbidden files:
  - Any non-doc/config/script/test file not explicitly listed above

## 12) Developer Brief (No Code)
1. Implement event-default creation with deterministic prefill and ad hoc fallback.
2. Enforce state and role-based action gating consistently across list/detail/dashboard.
3. Harden extend and check-in flows against overlap races and partial-return bugs.
4. Preserve audit and integrity guarantees for every mutation path.

## 13) Test Plan (High-Level)
- Unit: action eligibility matrix by state/role/ownership.
- Integration: create, extend, partial check-in, full check-in, and cancel flows.
- Regression: overlap race, stale event context, unauthorized mutations.
- Manual validation: desktop and mobile action parity.

## 14) Risks and Mitigations
- Risk: overlap race under concurrent extends.
  - Mitigation: SERIALIZABLE enforcement and conflict-first error handling.
- Risk: permission leakage in UI actions.
  - Mitigation: row-level action filtering plus server-side authorization enforcement.

## Claude Handoff Prompt (Copy/Paste)

```text
You are implementing one scoped feature in Wisconsin Creative.

Rules:
- Do not redesign architecture.
- Honor project invariants exactly.
- Stay within listed allowed files only.
- Keep output concise.

Output format:
1) Plan (<=200 tokens)
2) Open questions (only blockers)
3) Risks
4) Unified diff only

Limits:
- Max files changed: 5
- Max plan tokens: 200
- No unrelated refactors

Project invariants:
- Asset status is derived from active allocations.
- Preserve SERIALIZABLE booking mutation behavior.
- Preserve overlap-prevention constraints.
- Preserve audit logging integrity.

Feature brief:
Use /Users/erole/GitHub/gear-tracker/docs/BRIEF_CHECKOUT_UX_V2.md as source of truth.

Allowed files:
- /Users/erole/GitHub/gear-tracker/docs/AREA_CHECKOUTS.md
- /Users/erole/GitHub/gear-tracker/docs/AREA_DASHBOARD.md
- /Users/erole/GitHub/gear-tracker/docs/AREA_MOBILE.md
- /Users/erole/GitHub/gear-tracker/docs/AREA_USERS.md
- /Users/erole/GitHub/gear-tracker/docs/DECISIONS.md

Forbidden files:
- app code outside allowed list
- prisma schema/migrations
- package.json, tsconfig, next.config, env files
- scripts/tests/CI files
```
