# Feature Brief: Reservations Lifecycle V1

## 1) Feature Header
- Feature name: Reservations Lifecycle V1 (Transition-Safe)
- Owner: Wisconsin Athletics Creative Product
- Date: 2026-03-02
- Priority: `High`
- Target phase: `Now`
- Status: **Shipped** (PRs 33–38)

## 2) Problem
- Current pain: Reservation transitions and edit behavior can drift without explicit guardrails.
- Why now: Role model and dashboard action model are defined; reservations need hardened lifecycle rules.
- Who is blocked: Staff coordinating pre-event planning and students managing own reservations.

## 3) Outcome
- Expected behavior after release: Reservation lifecycle transitions are explicit, auditable, and protected from invalid or unsafe state changes.
- Success signal: Fewer transition errors, clear conflict feedback, and no unauthorized reservation edits.

## 4) Scope
### In scope
- Transition rules for `BOOKED`, `OPEN`, `COMPLETED`, `CANCELLED`.
- Conflict revalidation on reservation edits.
- Ownership and role-based mutation gating.
- Safe conversion from reservation to active checkout.
- Reservation detail surface with `Info`, `Attachments`, `History` tabs.
- Equipment panel conflict badges and state-aware actions menu.
- Reservations list surface with status scope, search, filters, sort, and required columns.

### Out of scope
- External multi-calendar sync.
- New approval workflow system.
- Template/assistant features.
- Spotcheck creation from reservation action menu.
- PDF generation from reservation action menu.
- Bulk mutation actions from multi-select rows.

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
- Data model impact: no major model change required; enforce transition validation on existing booking structures.
- Read-path impact: lifecycle action eligibility and conflict state visibility.
- Write-path impact: create/edit/cancel/transition actions require strict guards.
- External integration impact: optional event context linkage with graceful degradation.

## 8) UX Flow
1. Create reservation in `BOOKED` state.
2. Edit reservation with automatic conflict revalidation.
3. Start checkout transition (`BOOKED` -> `OPEN`) for handoff.
4. Complete lifecycle through return/check-in to `COMPLETED`.
5. Use reservation detail page tabs and action menu for operational execution.
6. Manage upcoming work from reservations list controls and row navigation.

## 9) Acceptance Criteria (Testable)
1. Reservation creation defaults to `BOOKED`.
2. Edit operations revalidate conflicts for date/location/item changes.
3. `OPEN` reservations are not directly cancelable in normal flow.
4. Transition behavior is enforced by state and role policy.
5. All transitions and denials are audited.
6. Reservation detail exposes `Info`, `Attachments`, and `History` tabs.
7. Equipment panel shows inline conflict badge when reserved item is unavailable.
8. Actions menu shows only state-valid actions and hides deferred actions.
9. Reservations list includes required columns and control set.
10. Export action is available to `STAFF`/`ADMIN` and hidden for `STUDENT`.
11. Mobile row interactions and action-sheet behavior match `AREA_MOBILE.md`.

## 10) Edge Cases
- Cross-midnight reservation edits.
- Owner reassignment during active lifecycle.
- Concurrent edits from multiple operators.
- Event link removed after reservation creation.
- Student attempts to edit non-owned reservation.
- Reserved item becomes unavailable before checkout starts.
- Attachment exists but actor lacks attachment permission.
- Student attempts to access export flow from direct route/action.
- Row thumbnail missing or image load failure in items column.

## 11) File Scope for Claude
- Allowed files to modify:
  - `AREA_RESERVATIONS.md`
  - `AREA_MOBILE.md`
  - `AREA_USERS.md`
  - `DECISIONS.md`
- Forbidden files:
  - Any non-doc/config/script/test file not explicitly listed above

## 12) Developer Brief (No Code)
1. Define and enforce explicit reservation transition guardrails.
2. Add conflict revalidation on all availability-impacting edits.
3. Enforce ownership and role checks at mutation boundaries.
4. Preserve audit completeness for transitions and denials.
5. Build reservation detail tab model and searchable equipment section.
6. Implement state-aware action menu mapping for reserve again, repeat, cancel, and proceed to checkout.
7. Implement reservations list control bar, columns, and role-aware export visibility.

## 13) Test Plan (High-Level)
- Unit: transition guard matrix and permission checks.
- Integration: create/edit/start-checkout/cancel/check-in lifecycle path.
- Regression: concurrent edit collisions and unauthorized edit attempts.
- Manual validation: action visibility and error messaging across roles.
- Manual validation: tab content parity and equipment conflict-badge behavior.
- Manual validation: list search/filter/sort behavior and row-to-detail navigation.

## 14) Risks and Mitigations
- Risk: invalid state transitions from edge path mutations.
  - Mitigation: centralized transition policy with hard guards.
- Risk: user confusion on blocked transitions.
  - Mitigation: explicit blocking reason with conflict metadata.

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
- Max files changed: 4
- Max plan tokens: 200
- No unrelated refactors

Project invariants:
- Asset status is derived from active allocations.
- Preserve SERIALIZABLE booking mutation behavior.
- Preserve overlap-prevention constraints.
- Preserve audit logging integrity.

Feature brief:
Use /Users/erole/GitHub/gear-tracker/docs/BRIEF_RESERVATIONS_V1.md as source of truth.

Allowed files:
- /Users/erole/GitHub/gear-tracker/docs/AREA_RESERVATIONS.md
- /Users/erole/GitHub/gear-tracker/docs/AREA_MOBILE.md
- /Users/erole/GitHub/gear-tracker/docs/AREA_USERS.md
- /Users/erole/GitHub/gear-tracker/docs/DECISIONS.md

Forbidden files:
- app code outside allowed list
- prisma schema/migrations
- package.json, tsconfig, next.config, env files
- scripts/tests/CI files
```
