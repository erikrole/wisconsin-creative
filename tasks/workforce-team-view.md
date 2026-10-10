# Workforce team view

Status: implemented and locally verified; awaiting authenticated managed-preview proof and deployment. Owner: Codex. User direction: 2026-10-01.

## Outcome

Workforce is the creative team's day-to-day staffing and intern organization view across past, current, and upcoming terms. Hiring is a supporting workspace for openings and applicants. Keep the existing admin gate and person/profile ownership.

## Bounded implementation

1. Add a pure term-aware team projection and a team-by-area page with academic-year and term selection. Staff above interns; show recorded manager names without inventing reporting lines. Current roster uses active profiles with selected-term placements where recorded; history uses recorded placements only, including inactive former interns. Future terms use explicit placements or active-profile start/graduation projections, with uncertainty visible.
2. Refresh the existing person drawer after edits and preselect the viewed term. Show past versus current profile facts honestly. No historical staff membership or manager relationships are inferred.
3. Use hiring-cycle targets to show hires still needed in Planning; keep headcount projections and applicant pipeline distinct.
4. Improve the supporting Hiring workspace with quick views, a Review next action, remembered URL filters/sort/cycle, and accurate linked-material signals.
5. Verify meaningful projection/target/filter rules, type checking, lint, app build, and sanitized rendered examples. Record authenticated preview limits. Preserve all prior uncommitted work; no schema migration, commit, push, or deployment.

## Contracts and files

- `src/lib/workforce/team.ts`, `src/app/(app)/workforce/{page,TeamView,PersonCard,WorkforceNav}.tsx`.
- Existing User/StudentTermPlacement schema and placement routes; no new persistence.
- `src/lib/workforce/planning.ts` and Planning page, using HiringCycleSlot as the hiring-target owner.
- Hiring client/cards and list material projection.
- Relevant tests, brief/decision amendments, area doc, local UI proof.

## Acceptance boundary

Recorded placements establish historical intern membership. Current profile names and graduation dates can change, so history is not an immutable snapshot. Staff history has no stored source. Unknown graduation remains an explicitly uncertain future projection. No silent snapshot/backfill writes.

## Verification

- 220 focused Hiring/Workforce tests and 11 CLI tests passed. Moved one formatting-pinned graduation test into the team projection’s behavioral tests; year-only graduation remains year-only.
- Type checking and touched-file lint passed. Final app build passed after placement-prefill and URL-input validation fixes. Existing unrelated Sidebar unused-variable warning remains.
- Actual TeamView, PersonCard, and HiringClient components rendered with fictional data and in-memory API/navigation adapters. Planning markup was extracted unchanged with fixture projection input. No production credentials or data used.
- Matched original/current team captures at 1440×1200; supplemental future, history, empty history, person drawer, dark, 390px mobile, Hiring, and Planning captures. Nine UI checks passed without browser errors, including preserving existing placement fields, filter behavior, missing-history distinctions, future graduates, and URL-backed hiring review order.
- Browser interactions do not prove Next routing integration, authenticated permissions, or persisted mutations. No managed preview exists for the merged branch; no manual environment was created.
- No production data mutations, schema migration, commits, push, or deployment in this slice.

Review: `archive/proofs/workforce-team-2026-10-01/review.html`.

## Follow-ups

Populate older term rosters where records are missing; staff/manager history needs a separate durable source if required. Specialty shortlist and revisit flags remain separate later slices. Do not treat annual profile-based projections as recorded term history.
