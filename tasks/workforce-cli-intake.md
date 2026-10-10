# Workforce applicant intake — bounded slice

Owner: Codex. Started 2026-10-01. Status: local implementation and verification in progress; not deployed.

## Accepted scope

The user narrowed the work from a general Workforce audit to quick applicant logging, then explicitly requested agent-driven parsing through a robust CLI and automation, with no mention of agents on the website. Parse submitted materials, add factual applicant records, and prepare an evidence-based shortlist covering all creative areas grouped by specialty. Preserve PageUp statuses and human review/interview/decision state.

## Files and contracts

- `scripts/workforce/`: admin-session CLI, PageUp board/material capture, negative/auth/identity tests.
- `src/lib/hiring/agent-import.ts`: versioned structured extraction and recognized HTTPS source-link projection.
- Hiring import route: structured intake shares dedupe, atomic batch writes, and audit evidence with CSV import.
- Hiring board/detail: source links, logged experience summaries, one-click Reviewed control, error recovery. No agent-facing product copy.
- Workforce person/placement routes: mutation and audit commit in one serializable transaction.
- `docs/WORKFORCE_CLI.md`: command and parsing contract.

## Deferred work

The roster table and placement editor changes were prepared before the user clarified applicant intake. They were removed from the active diff and preserved in `/private/tmp/workforce-roster-followup.patch`. Planning targets and placement precedence are deferred; no forecast/schema changes are included.

## Verification

- 183 focused Hiring/Workforce tests passed; 11 CLI tests passed.
- Type checking, touched-file lint, app build, diff whitespace checks, and docs verification passed.
- Production admin and PageUp sessions verified. The CLI retains session-only cookies privately and leaves the sign-in browser open; ordinary commands run headlessly.
- Hard-refreshed the Application Complete column, scrolled its lazy-loaded cards, and verified 77 IDs. Excluded Withdrawn. The initial loading zero is no longer accepted.
- Captured 77 forms, 77 resumes and 41 cover letters. Material redirects are limited to verified routes on the same PageUp origin. An image-only resume was reviewed visually.
- Created and read back the Fall 2026 cycle. Import preview: 76 creates, zero invalid rows, zero unresolved matches. Applied and verified all 76 canonical IDs through the existing production CSV API.
- One related submission was retained in its canonical applicant's note and verified by detail read-back. No fuzzy name merge was used.
- Live Hiring page rendered all 76 in Applied. Private screenshot and 25-person specialty shortlist saved outside the repository.
- Nightly automation updated to use background reading, CSV compatibility, canonical-note reconciliation, and private run reports. End condition remains cycle Closed/Archived; unchanged runs stay quiet.
- Hosted preview unavailable for the merged Workforce branch. No preview was manually provisioned. Matched desktop fixture captures and after-only mobile/dark captures now cover the actual card component and extracted board markup. Keyboard opening, review toggle, summary truncation, and local horizontal scrolling passed. Authenticated runtime proof of the changed UI remains unavailable; production screenshots prove live data on the currently deployed UI only.

Applicant logging and automation are authorized. No commit, push, merge or deployment was requested or performed. Spreadsheet and PageUp statuses were not changed. New site records start Applied/not Reviewed. In a subsequent explicitly authorized operation, copied 5 Round 1 decisions, 16 Decline decisions as Passed, and 1 Maybe note from the current sheet; all 22 read back successfully. Full-cycle read-back confirmed 76 records: 55 Applied, 5 Round 1, 16 Passed. Blank decisions and review flags were unchanged.

Review page: `archive/proofs/workforce-intake-2026-10-01/review.html`. Candidate artifacts remain private in the Work Projects recruiting folder, outside this repository.

## Card design follow-up

Requested stronger card design and layout. Extracted `ApplicantCard.tsx` with prominent wrapping names, primary specialty and secondary areas, readable three-line experience summaries, labeled material indicators, direct source links, and a separate review footer. Board columns have more breathing room and scroll within the page on narrow screens. Empty columns are explicit. No new schema or decision logic in the UI.

Matched review: `archive/proofs/workforce-cards-2026-10-02/review.html`. Fictional fixture data only; local redesign is not deployed. Current production decision updates were verified separately through the authenticated API and rendered board.
