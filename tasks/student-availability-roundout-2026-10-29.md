# Student Availability roundout — 2026-10-29

## Scope and contracts

User requested end-to-end student entry, staff review and scheduling accuracy, and explicitly required preserving Claude's uncommitted paint roller feature.
Owners: `docs/BRIEF_STUDENT_AVAILABILITY_V1.md`, `docs/AREA_SHIFTS.md`, `docs/AREA_USERS.md`, `docs/AREA_MOBILE.md`.
Preserve Student scheduling-class ownership, Staff/Admin time-off review, ordinary advisory conflicts and approved-time-off blocking. Initial slice had no schema or publication changes; the explicitly authorized preview follow-up below adds migration 0213 and a PR-owned preview.

## Source and preservation

- Current isolated managed worktree: `/Users/role/.codex/worktrees/student-availability/wisconsin-creative`, branch `codex/student-availability`, safely fast-forwarded from the preserved baseline to `7ec52b645` before the preview follow-up.
- Original shared checkout: `/Users/role/Code/wisconsin-creative`, branch `claude/app-product-pages`, with unrelated dirty API/onboarding work. Only this task's initial edits were transferred out and removed from that checkout; unrelated work remains.
- Claude checkout: `/Users/role/Code/wisconsin-creative/.claude/worktrees/paint-roller-demo`, including its untracked `src/app/dev-paint-roller` demo. Unchanged. The integrated `src/components/availability/PaintWeek.tsx` is also unchanged in this slice.
- Verified recovery snapshots of both initial dirty states: `/Users/role/To Sort/Work Projects/Wisconsin Creative Recovery/2026-10-29-student-availability/`. Archives were reread and every member compared with its SHA-256 manifest. Ignored credentials were not copied.
- Initial slice was uncommitted; the follow-up now authorizes scoped commits/push, a PR and its managed preview. Production merge/deployment are not authorized.

## Completed bounded slice

- [x] Correct time-off authorization and review metadata. Student-created requests cannot be self-approved; a student's full edit resets time off to pending and clears prior review metadata.
- [x] Add status-only staff review and optional expected-update version. Stale supplied versions return 409 before side effects; both clients retain the draft and refresh the list for cancel/reopen.
- [x] Make create/update/delete, audit, review inbox insertion and conflict refresh atomic with SERIALIZABLE retry. Push dispatch occurs only after commit. A new review cycle can notify again.
- [x] Preserve paint interaction; submit selected weekdays in one request/transaction and retain failed drafts. Legacy single-day API clients remain compatible.
- [x] Validate real calendar dates and wall-clock times. Fix shared overlap evaluation across midnight, intermediate dates, term ends, DST gaps/repeated hours and exact exclusive boundaries.
- [x] Web pending-review queue, visible Approve/Deny and review note, current/history separation, weekday context, responsive rows, refreshed-cache mutation handling and truthful scheduling guidance.
- [x] Preserve native List design; add history, staff notes, Central date/time controls, optional version transport and stale-edit refresh.
- [x] Independent read-only review: fixed stale cache replacement, missing history weekday, stale-editor recovery guidance, pending-note and Staff-role copy findings. Its lost-response retry finding is now fixed and independently reviewed.

## Verification

- Focused Vitest: 73 tests across five Availability route/helper/UI/native-contract files. Sibling candidate-scoring, team-availability and iOS API contract suites: 63 tests across three files. Total 136 unique tests passed. The five native source-contract tests were rerun after the final Swift recovery change and passed.
- `npx tsc --noEmit --pretty false`: passed. Changed-file ESLint: passed. `npm run build:app`: passed without migration/deployment steps. Generated `next-env.d.ts` build-path changes were removed afterward.
- `npm run test:performance:web`: passed real Chromium fixture checks; shared stats request, zero hidden scheduled reads, in-flight resume and retained draft all passed.
- Required native build: `xcodebuild ... -scheme Wisconsin -destination 'platform=iOS Simulator,name=iPhone 18 Pro Max' build`: passed. Final Swift changes also compiled and passed the existing offline `WisconsinPerformance` Availability screenshot test (one test, zero failures) on UDID `795AB4E9-3E4A-4C13-9D4F-27FD822C190B`, iOS 27.0.
- iOS drift and project registration checks: passed. Migration-prefix check: 212 migrations, no collisions; no schema/migrations changed.
- Real browser component fixtures (synthetic data only): matched desktop/tablet/phone/editor/paint views, history and weekday context, status-only review payload, saved note, stale 409 draft preservation then fresh reopen, Student review denial in UI, painted weekday batching and failed-save draft retention. No page errors.
- UI review: `tasks/archive/proofs/student-availability-2026-10-29/review-index.html`. Web baseline is actual preserved paint-roller source. Native captures are explicitly after-only. Capture receipts bind matching inputs and PNG bytes; source snapshots are retained.
- `git diff --check`, docs verification and reference checks: recorded in proof README. Codemaps regenerated, including one pre-existing line-count drift for BrandAssetLibrary; no changes to that component.

## Remaining acceptance and next bounded slice

- [ ] Authenticated student entry → staff review → persisted Schedule conflict readback and in-app notification delivery in the authorized branch-owned preview. Real PostgreSQL rollback/concurrency now passes; managed preview creation awaits this PR and CI. No other branch’s environment or production credentials were used.
- [x] Durable create idempotency (follow-up): each mounted web/native create form retains a request UUID; migration 0213 records its actor, normalized payload hash and created IDs in the same transaction. Lost/concurrent retries return current entries once; changed payloads/deleted entries return 409. Older clients without the key retain legacy behavior. Six real-PostgreSQL regressions passed.
- [ ] Native authenticated edit/review handoff and distribution. The offline screenshot test proves layout/decoding, not live persistence, push or a released binary. Native stale-conflict recovery has build/source-contract proof, not a simulated HTTP 409 interaction.

Current next step: complete the authorized branch-owned preview acceptance below. Production merge/deployment are not authorized.

## Authorized preview follow-up — 2026-10-29

User requested fixing duplicate saves and getting the full flow into a preview. This authorizes the feature branch, scoped commits/push, PR and its managed preview; production merge/deployment remain outside the request.

Plan: add an actor-scoped create receipt keyed by a retained client save UUID, commit the receipt with all blocks/audits/conflict changes, and replay current saved entries when that key is retried. Cover weekly/away/profile web forms and native creation. Prove lost-response retry, concurrent submission, mismatched reuse and rollback with disposable PostgreSQL; then run normal gates, create the PR, add its release note, wait for CI and Managed previews, and exercise the authenticated student → staff → Schedule flow in the branch-owned environment.

Duplicate-save proof: `npm run test:postgres` passed all 19 tests, including six new Availability cases. The initial fixture used an invalid assignment enum; corrected to `DIRECT_ASSIGNED` before the passing run. The owned cluster was stopped and removed. An independent read-only review found no blocking defect.

Final local follow-up gates: 8,475 unit tests passed (13 existing skipped), all coverage floors passed; 19 PostgreSQL tests passed; full lint passed with its existing 121 warnings. Fixed the calendar-date source guard using one explicit encoded-date helper and restored 40px approval targets. Browser fixture retry checks passed with the same save UUID. Refreshed matched web evidence is in the review page. Required iPhone 18 Pro Max build, migration checks and schema validation passed.

Final app-only build and TypeScript passed. The sandboxed Turbopack run stalled idle and was stopped; the same build completed outside the process sandbox. No migration/deployment step ran. The review index loads all 12 images with no horizontal overflow.

Draft PR [#735](https://github.com/erikrole/wisconsin-creative/pull/735) is open for the authorized managed preview. Implementation commit: `3c80d9c2c`. Migration-pair guard passed against origin/main. Release-note registration follows with this PR number; hosted CI and preview acceptance remain pending.
