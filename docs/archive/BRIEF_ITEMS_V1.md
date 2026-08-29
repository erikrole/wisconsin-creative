# Feature Brief: Items List + Create + Detail V1

## 1) Feature Header
- Feature name: Items V1 (Tag-First, Policy-Safe)
- Owner: Wisconsin Athletics Creative Product
- Date: 2026-03-09
- Priority: `High`
- Target phase: `Now`
- Status: **Shipped** (PRs 31–32)

## 2) Problem
- Current pain: Item workflows can become metadata-heavy, inconsistent, and disconnected from operational actions.
- Why now: Dashboard, reservations, and checkout specs are hardened; items now need equivalent list/create/detail rigor.
- Who is blocked: Staff managing inventory quality and students needing reliable read visibility.

## 3) Outcome
- Expected behavior after release: Items list, create, and detail flows are fast, consistent, and aligned to tag-first operational identity.
- Success signal: Operators find and act on items quickly, while status and permission behavior remain correct.

## 4) Scope
### In scope
- Items list page controls, columns, row behavior, and role-based top actions.
- Create item flow with serialized vs bulk mode.
- Item detail page structure with dashboard-style `Info` tab, linked status line, actions menu, calendar/history/settings tabs, and item information card.
- Safe metadata/image prefill behavior.

### Out of scope
- Procurement lifecycle.
- Depreciation accounting.
- Advanced customizable analytics view.
- Bulk mutation actions beyond basic import/export.

## 5) Guardrails (Project Invariants)
- Asset status is derived from active allocations, never authoritative stored status.
- Keep booking integrity protections intact (SERIALIZABLE + overlap prevention).
- Preserve audit logging coverage for new mutation paths.
- Maintain mobile-first usability and clear student flows.
- Do not rewrite booking engine unless explicitly approved.

## 6) Affected Areas
- Domain area: `Assets`
- User roles affected: `ADMIN`, `STAFF`, `STUDENT`
- Location impact: `Mixed`

## 7) Data and API Impact (High-Level)
- Data model impact: no major model rewrite required; enforce item-kind-specific validation and identity constraints.
- Read-path impact: list rows and detail header must display derived status, deep-linked booking context, and tag-first identity.
- Write-path impact: create/edit/import/export paths require role and validation guards, including QR uniqueness and policy-safe delete rules.

## 8) UX Flow
1. Find item via list filters/search/table.
2. Create new serialized or bulk item through item-kind-guided form.
3. Open detail page and land on the `Info` dashboard view with checkout/reservation overview on the left and item information on the right.
4. Use linked status states and `Actions` menu for duplication, retirement, maintenance, and policy-safe deletion.
5. Edit metadata, QR/tracking code, and policy toggles by role, with audit history.

## 9) Acceptance Criteria (Testable)
1. Item list includes required filters and columns.
2. Serialized rows show `tagName` as primary label.
3. Create form enforces required fields by item kind.
4. Item detail exposes `Info`, `Check Outs`, `Reservations`, `Calendar`, `History`, and `Settings` tabs.
5. Header status line supports `Available`, `Check Out by {user}`, `Reserved by {user}`, `Checking Out`, `Needs Maintenance`, and `Retired`, with links where booking context exists.
6. `Info` tab shows both operational overview cards and the item information card by default.
7. `Actions` menu includes Duplicate, Retire, Delete, and Needs Maintenance, with policy-safe delete gating.
8. Category and fiscal-year-purchased fields use controlled dropdowns; fiscal-year options follow a July 1 rollover, so March 9, 2026 maps to FY `2026`.
9. QR code thumbnail renders from stored text code, and items without one support unique generation or manual entry.
10. Empty optional values render as inline `Add ...` prompts instead of blank fields.
11. Status displays are derived and cannot be directly edited.
12. Export/import visibility is role-correct.
13. Prefill behavior never overwrites `tagName`.
14. Mutations are auditable.
18. Mobile items list behavior follows `AREA_MOBILE.md` (search-first, action-sheet parity).

## 10) Edge Cases
- Missing row thumbnails.
- Duplicate serialized identifiers.
- Student attempts item edit via deep link/API.
- Asset with active allocations receives metadata edit request.
- Item has no QR code and needs generation or manual entry.
- Item has no purchase metadata and should show inline `Add ...` prompts.
- Item has historical bookings, so `Delete` must be blocked and `Retire` used instead.

## 11) File Scope for Claude
- Allowed files to modify:
  - `AREA_ITEMS.md`
  - `AREA_MOBILE.md`
  - `AREA_USERS.md`
  - `DECISIONS.md`
- Forbidden files:
  - Any non-doc/config/script/test file not explicitly listed above

## 12) Developer Brief (No Code)
1. Implement item list controls and role-aware top actions.
2. Implement item-kind-aware create flow and validation.
3. Implement item detail information architecture, linked status line, and action mapping.
4. Enforce derived status display, QR uniqueness, delete gating, and mutation authorization policy.
5. Add regression tests for identity collisions, permission bypass, QR uniqueness, delete gating, and prefill safety.

## 13) Test Plan (High-Level)
- Unit: item-kind validation and role-action matrix.
- Integration: list filtering, create flows, detail actions, and metadata edits.
- Regression: duplicate tag collisions, unauthorized edits, stale status display.
- Manual validation: table usability, detail navigation, image handling.

## 14) Risks and Mitigations
- Risk: status drift from policy toggles and real allocation state.
  - Mitigation: separate eligibility toggles from derived status display.
- Risk: identity inconsistency from imports and manual edits.
  - Mitigation: enforce serialized identity rules and clear validation errors.

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
Use /Users/erole/GitHub/gear-tracker/docs/BRIEF_ITEMS_V1.md as source of truth.

Allowed files:
- /Users/erole/GitHub/gear-tracker/docs/AREA_ITEMS.md
- /Users/erole/GitHub/gear-tracker/docs/AREA_MOBILE.md
- /Users/erole/GitHub/gear-tracker/docs/AREA_USERS.md
- /Users/erole/GitHub/gear-tracker/docs/DECISIONS.md

Forbidden files:
- app code outside allowed list
- prisma schema/migrations
- package.json, tsconfig, next.config, env files
- scripts/tests/CI files
```
