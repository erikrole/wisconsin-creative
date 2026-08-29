# Wisconsin Creative Feature Brief Template (Claude-Optimized)

## How To Use This Template
1. Fill only what is required for the current feature.
2. Keep each section short and concrete.
3. Copy the "Claude Handoff Prompt" section into Claude Opus.
4. Limit Claude to scoped files and bounded output.

---

## 1) Feature Header
- Feature name:
- Owner:
- Date:
- Priority: `High | Medium | Low`
- Target phase: `Now | Next | Later`

## 2) Problem
- Current pain:
- Why now:
- Who is blocked:

## 3) Outcome
- Expected behavior after release:
- Success signal (one measurable result):

## 4) Scope
### In scope
- 
- 

### Out of scope
- 
- 

## 5) Guardrails (Project Invariants)
- Asset status is derived from active allocations, never authoritative stored status.
- Keep booking integrity protections intact (SERIALIZABLE + overlap prevention).
- Preserve audit logging coverage for new mutation paths.
- Maintain mobile-first usability and clear student flows.
- Do not rewrite booking engine unless explicitly approved.

## 6) Affected Areas
- Domain area: `Bookings | Assets | Events | Notifications | Mobile Operations | Platform Integrity`
- User roles affected:
- Location impact: `Camp Randall | Kohl Center | Mixed`

## 7) Data and API Impact (High-Level)
- Data model impact:
- Read-path impact:
- Write-path impact:
- External integration impact:

## 8) UX Flow
1. 
2. 
3. 

## 9) Acceptance Criteria (Testable)
1. 
2. 
3. 
4. 

## 10) Edge Cases
- 
- 
- 

## 11) File Scope for Claude
- Allowed files to modify:
  - 
  - 
- Forbidden files:
  - Any non-doc/config/script/test file not explicitly listed above

## 12) Developer Brief (No Code)
1. 
2. 
3. 
4. 

## 13) Test Plan (High-Level)
- Unit:
- Integration:
- Regression:
- Manual validation:

## 14) Risks and Mitigations
- Risk:
  - Mitigation:
- Risk:
  - Mitigation:

---

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
- Max files changed: [N]
- Max plan tokens: 200
- No unrelated refactors

Project invariants:
- Asset status is derived from active allocations.
- Preserve SERIALIZABLE booking mutation behavior.
- Preserve overlap-prevention constraints.
- Preserve audit logging integrity.

Feature brief:
[Paste completed sections 1-14 here]

Allowed files:
[Paste exact file paths]

Forbidden files:
- app code outside allowed list
- prisma schema/migrations
- package.json, tsconfig, next.config, env files
- scripts/tests/CI files
```

---

## Token-Saving Execution Pattern
1. Pass 1: Data/model contracts only.
2. Pass 2: API/validation behavior.
3. Pass 3: UI behavior.
4. Pass 4: Tests and regression fixes.
5. Final pass: cleanup only within touched files.

## Handoff Checklist
- Scope is explicit and bounded.
- Acceptance criteria are testable.
- Edge cases are listed.
- Allowed file list is exact.
- Invariants are included.
- No unnecessary context included.
- Cross-area sync checked (`PRODUCT_SCOPE.md`, `DECISIONS.md`, and impacted `AREA_*.md` files).
