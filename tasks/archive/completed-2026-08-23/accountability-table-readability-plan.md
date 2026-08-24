# Accountability Table Readability Plan - 2026-08-23

Status: Completed 2026-08-23

## Goal
- Make the full Accountability leaderboard faster to scan and easier to understand without changing ranking, evidence, permissions, or the playful top-three spotlight.

## Route
- Owner area: Reports and Analytics
- Secondary area: web design language
- Ledger: `tasks/accountability-table-readability-plan.md`
- Existing plan/archive reference: `tasks/archive/completed-2026-08-23/accountability-leaderboard-plan.md`

## Source Checks
- The current desktop summary carries eight columns (`#`, Person, Late events, Overdue now, Total late, Worst, On time, disclosure) while the Person subline repeats checkout count, typical lateness, and last incident. The result gives primary and diagnostic values nearly equal weight.
- Expanded incident rows are forced across the parent table's statistic columns, which separates booking identity, late duration, state, and Admin actions instead of presenting each incident as one readable record.
- The current desktop table starts at `md`, even when the open sidebar leaves too little content width for eight columns. The canonical Users page uses explicit column priorities and a card fallback; the live Overdue report keeps its leaderboard summary to four concepts plus disclosure.
- `GET /api/accountability` already returns every field needed for a clearer client hierarchy. No API, service, schema, permission, export, or jeer-selection change is required.
- The worktree contains unrelated Scoreboard, Reports, typography, iOS, globals, codemap, test, and task changes. This slice owns only the Accountability client, its focused source contract, Reports documentation, this plan, and its proof artifacts.

## Stop Conditions
- Stop if the cleanup would hide the current-overdue signal, the active ranking value, or any expandable checkout evidence.
- Stop if the selected design requires changing the shared Table primitive, report kit, API payload, or ranking calculation.
- Record browser proof as blocked rather than substituting build output if the existing isolated Creative Admin preview cannot render the current working-tree baseline.

## Slices
- [x] Slice 1: Capture the current authenticated table baseline, then rebuild the desktop summary around person, late events, late-time pattern, return record, and an explicit 40px history disclosure; move incident detail into one coherent expanded panel and use the stacked-card treatment below `xl`.
- [x] Slice 2: Pin the simplified hierarchy and responsive/accessibility behavior with focused contracts, authenticated desktop/tablet proof, matched review captures, and Reports-area closeout documentation.

## Verification
- [x] Focused Accountability UI/source-contract tests
- [x] `npx tsc --noEmit --pretty false`
- [x] Focused ESLint for touched source/tests
- [x] `npm run build:app` from an isolated temporary copy while the shared dev server owned the repository `.next`
- [x] `npm run verify:docs` (`codemap:check` confirmed current generated maps)
- [x] `git diff --check` for the owned source, test, document, and plan
- [x] Authenticated 1440x1000 and 1024x900 browser proof with zero document overflow, no console warnings/errors, a measured 40px native-button disclosure, and grouped incident read-back
- [x] Matched before/after captures and `gt-ui-review` page

## Review
- Shipped: Reduced the desktop leaderboard from eight columns to five scan targets; made return record prominent with a percentage-length bar whose color clamps to red at 50%, interpolates continuously in OKLab, and reaches green at 100%; moved widths below `xl` to structured cards; replaced row/card pseudo-buttons with explicit 40px history controls; and grouped each checkout into one complete incident record. The stable shared jeers remain in the top-three spotlight.
- Verified: 65 focused tests, TypeScript, focused ESLint, codemap/docs verification, targeted whitespace check, 238-page isolated `build:app`, authenticated 1440x1000 and 1024x900 renders, zero browser console issues, live color-mix read-back, 40px disclosure measurement, and four-link/four-action expanded-history read-back.
- Deferred: Production deployment and separate Staff/Student browser renders were not requested; shared-role jeers, capability redaction, and role access remain covered by focused route/RBAC tests.
- Blocked: After authenticated proof completed, the pre-existing local dev process exited. The managed sandbox denied the final localhost port bind, so the live preview could not be restored in this turn; the static review remains available.
- Proof artifacts: `tasks/archive/proofs/accountability-table-readability-2026-08-23/`
- Next slice or stop: Stop. The requested first-class, playful, readable leaderboard and continuous return-rate color scale are complete without ranking, API, permission, export, or jeer-selection changes.
