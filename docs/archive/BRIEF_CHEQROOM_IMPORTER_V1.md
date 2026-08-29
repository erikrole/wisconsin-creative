# Feature Brief: Cheqroom CSV Importer V1

## 1) Feature Header
- Feature name: Cheqroom CSV Importer V1 (Lossless)
- Owner: Wisconsin Athletics Creative Product
- Date: 2026-03-01
- Priority: `High`
- Target phase: `Now`

## 2) Problem
- Current pain: Existing inventory must be migrated from Cheqroom CSV with many columns and mixed data quality.
- Why now: Items domain is defined and needs real data to validate workflows.
- Who is blocked: Staff cannot complete migration without a reliable importer.

## 3) Outcome
- Expected behavior after release: CSV rows import into Wisconsin Creative items with deterministic mapping, full diagnostics, and no silent data loss.
- Success signal: Full file parses with actionable report and mapped records aligned to item-kind rules.

## 4) Scope
### In scope
- CSV parser and header normalization.
- Lossless row handling with mapped fields plus source payload preservation.
- Serialized vs bulk branching and validation.
- Dry run, create-only, and upsert modes.
- Import report with row-level warnings/errors.

### Out of scope
- Historical booking reconstruction from checkout snapshot fields.
- Interactive UI mapper for arbitrary source schemas.
- Remote attachment ingest pipeline beyond field linkage.

## 5) Guardrails (Project Invariants)
- Asset status is derived from active allocations, never authoritative stored status.
- Keep booking integrity protections intact (SERIALIZABLE + overlap prevention).
- Preserve audit logging coverage for new mutation paths.
- Maintain mobile-first usability and clear student flows.
- Do not rewrite booking engine unless explicitly approved.

## 6) Affected Areas
- Domain area: `Assets`
- User roles affected: `ADMIN`, `STAFF` (import execution), `STUDENT` (read results only)
- Location impact: `Mixed`

## 7) Data and API Impact (High-Level)
- Data model impact: requires import staging and source payload persistence for row traceability.
- Read-path impact: none required for end-user list behavior.
- Write-path impact: item create/update with validation and dedup strategy.
- External integration impact: none beyond CSV file ingestion.

## 8) UX Flow
1. Staff uploads CSV.
2. System runs dry-run validation and returns report.
3. Staff resolves blocking errors and reruns.
4. Staff executes import (create-only or upsert).
5. System returns final report and audit log summary.

## 9) Acceptance Criteria (Testable)
1. Every source column is parsed and preserved via mapping or source payload.
2. Source `Status` is never written as authoritative asset status.
3. Serialized vs bulk rows enforce separate validation.
4. Duplicate key collisions are deterministic and clearly reported.
5. Dry run and final run produce consistent counts when input is unchanged.
6. Import report includes row number and reason for each issue.

## 10) Edge Cases
- Header variants and whitespace differences.
- Invalid dates and currency strings.
- Duplicate codes across rows.
- Rows with empty name but populated tracking identifiers.
- Invalid URLs in image/product link columns.

## 11) File Scope for Claude
- Allowed files to modify:
  - `AREA_IMPORTER.md`
  - `AREA_ITEMS.md`
  - `DECISIONS.md`
- Forbidden files:
  - Any non-doc/config/script/test file not explicitly listed above

## 12) Developer Brief (No Code)
1. Implement staged CSV ingestion with raw-row retention.
2. Implement deterministic mapping and lossless preservation.
3. Split hard errors and soft warnings with row-level reporting.
4. Implement dry-run and import modes with consistent behavior.
5. Add audit events for each import run and summary statistics.

## 13) Test Plan (High-Level)
- Unit: header normalization, field parsers, dedup key selection.
- Integration: dry-run/import mode parity and row reporting.
- Regression: malformed rows, mixed kinds, duplicate identifiers.
- Manual validation: sample Cheqroom exports from production.

## 14) Risks and Mitigations
- Risk: malformed source data causing partial import confusion.
  - Mitigation: strict diagnostics with clear blocking vs warning categories.
- Risk: status drift from imported status labels.
  - Mitigation: never use source status as authoritative target state.

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
- Max files changed: 3
- Max plan tokens: 200
- No unrelated refactors

Project invariants:
- Asset status is derived from active allocations.
- Preserve SERIALIZABLE booking mutation behavior.
- Preserve overlap-prevention constraints.
- Preserve audit logging integrity.

Feature brief:
Use /Users/erole/GitHub/gear-tracker/docs/BRIEF_CHEQROOM_IMPORTER_V1.md as source of truth.

Allowed files:
- /Users/erole/GitHub/gear-tracker/docs/AREA_IMPORTER.md
- /Users/erole/GitHub/gear-tracker/docs/AREA_ITEMS.md
- /Users/erole/GitHub/gear-tracker/docs/DECISIONS.md

Forbidden files:
- app code outside allowed list
- prisma schema/migrations
- package.json, tsconfig, next.config, env files
- scripts/tests/CI files
```
