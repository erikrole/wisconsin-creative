# Schedule stabilization - 2026-09-04

## Goal and scope
Make staff and student scheduling trustworthy with real operational data. Exports and feature expansion are excluded. Owner: AREA_SHIFTS; secondary owner: AREA_MOBILE. This incident-driven pass complements the existing event-shift working schedule and timeline plans.

## Evidence and contracts
- User reports two weeks of real use and unexpected bugs/edge cases; no named individual incident has been supplied in this task.
- Confirmed source defects: crew read failures become empty crews; cached web data suppresses refresh errors; Open Work offers claims during private edits that submission rejects; call-time forms dismiss before save confirmation; mutation network copy asserts no change despite an indeterminate response; elapsed countdown asserts notifications occurred.
- D-046 keeps future edits private for ten minutes, then releases the exact version; past corrections are immediate and silent. D-055 approval-first claims and existing working-copy mutation guards remain authoritative.
- Native Schedule already retains previous data and reports refresh errors. Shared server changes must preserve old-client decoding and private working payload boundaries.
- Production investigation is read-only. No repair, migration, release, or real notification is authorized by this plan.

## Slices
- [x] Read-only live evidence: pending release state, claim/assignment counts and overlap with pending crews; separate snapshots from causes.
- [x] Complete Schedule reads and visible stale/error recovery across List/Week/Calendar; no fabricated empty crew or health queue.
- [x] Align student claim availability with existing pending-edit guards and use recoverable student-facing wording.
- [x] Preserve call-time edits through rejected saves; verify uncertain mutation outcomes before retry, without automatic resubmission.
- [x] Report scheduled release versus confirmed release truthfully; preserve notification policy.
- [ ] Focused regressions, authenticated web staff/student journey proof, iPhone 16 Pro build/runtime proof, matched review page, docs closeout.

## Verification
- Reproduce each selected bug with executable tests before fixing it.
- Focused Vitest, TypeScript, ESLint, migration-prefix check, app-only build, codemap/docs check, final diff check.
- Use isolated authenticated target plus response interception for failure/mutation scenarios; do not change production records to reproduce defects.
- Native proof uses platform=iOS Simulator,name=iPhone 16 Pro. Source tests/builds do not prove notifications or device behavior.
- UI review captures compare the same role/data/failure state before and after the change.

## Stop conditions
Reconcile policy contradictions before changing semantics. Never bypass working-copy guards or expand roles to make a test pass. If a verification environment cannot support the workflow, record the exact gate and continue independent source/test work.

## Findings and evidence

| Finding | Evidence | Local resolution / remaining boundary |
| --- | --- | --- |
| Failed crew reads fabricated empty crews and setup actions | Actual fetch regression rejected neither a 503 nor a truncated crew result before the fix; authenticated HEAD capture showed “Nothing needs attention”, “Crew covered”, and “Set up crew” | Reject the incomplete snapshot; retain complete cached data and identify stale or unavailable reads across all three views |
| Cached failures hid uncertainty | Authenticated browser forced a successful read followed by a crew 503 | Visible stale warning; retained crew and retry; suppress unreliable health/readiness queues |
| Claim availability contradicted submission | Service test: published open slot plus private working copy returned canAct=true although pickup guard rejects it | Server returns action=none and a generic staff-updating explanation; no private working-copy JSON in the response; native consumes existing canAct/reason fields |
| Call-time failures lost input | Browser PATCH 409 reproduced modal dismissal after its close animation | Both bulk and individual forms await a confirmed response and preserve input during refresh; uncertain-save review is available inside the form |
| Lost mutation response falsely asserted no change | Browser simulated a committed pickup whose POST response was aborted; exactly one submission | Trade Board reloads both sources with no-store, flags unknown outcome and requires review before another action; parent Schedule refresh is separate from mutation success |
| Countdown claimed notification delivery | Unit/source regression at elapsed deadline expected “notified now” before the fix | Copy now reports release scheduled, elapsed awaiting confirmation, or no timer; main Schedule exposes blocked releases for staff |

### Read-only production snapshot
At 2026-09-04 23:09 UTC, there were three working copies: one overdue, two with recorded errors, and two without timers. These counts overlap and do not mean three broken releases.

- Men's Hockey vs Robert Morris (`cmsoe6k300001la042i8l9jw2`), event starts 2026-10-03 00:00 UTC: working version 2, base/published version 0, release timer 2026-08-17 22:43:40.480 UTC. Recorded error: “Nolan Kromke: User already has a shift during this time (PHOTO)”. Four open Student slots. **Confirmed blocked release; whether the conflict is valid, stale provenance, or another window issue remains unclassified.** No automatic removal, repair, or release was attempted.
- Men's Cross Country vs Badger Classic (`cms8ooryy0001kt04xgl3q8ow`): working version 9, no timer, “Retired when this event was combined into a shared crew.” Intentionally retired context, not evidence that a release workflow failed.
- Women's Soccer vs St Thomas exhibition (`cmpvcnaai0002ju04w81q36oy`), past August 5 event: version 8, no timer or recorded error. Historical pending data; no conclusion about current staff intent.

### Verification and environment
- 566 tests in 67 Schedule/Shift/Trade files pass, including service eligibility, window/conflict, release, working-copy, and native source contracts. The old timeline source test explicitly demanded swallowing crew failures; it now rejects that behavior, backed by executable read/browser tests.
- Authenticated isolated web: Admin passed four scenarios at desktop and narrow widths (8 runs); actual Staff passed cold failure, stale refresh, and rejected call-time save at both widths (6 runs); actual Student passed pending-request and blocked-claim presentation at both widths (2 runs). Staff additionally passed uncertain-save in-form review at both widths (2 runs), with rejected-save scenarios repeated after that refinement. These are real role/session gates with deterministic intercepted scheduling responses, not proof of database mutations or durable workflows.
- Xcode WisconsinPerformance build/test on required iPhone 16 Pro, iOS 26.5: ScheduleScreenshotUITests/testScheduleListCaptures and TradeBoardReviewScreenshotUITests/testStudentAvailableInventoryCaptures pass. Rendered screenshots inspected. Native tests use DEBUG fixtures, not authenticated production or isolated-network mutations. No Swift source changed.
- TypeScript and full ESLint pass; changed files rechecked after the final recovery refinement. Migration prefix check: 149 migrations, no collisions. No schema change or migration deployment.
- Matched HEAD/current web captures use the same authenticated Admin, fixture event, crew/health 503 responses, 1440×1000 viewport, date window and scroll. Three misleading signals become one explicit loading-failure state with retry. See [review page](archive/proofs/schedule-stabilization-2026-09-04/review.html).
- The local file named `.env.preview.local` pointed to the production endpoint. It was not used for authenticated mutation tests. Created and retained isolated Neon branch `br-old-mouse-aij6d8j3` (`codex/schedule-stabilization-2026-09-04`) from production; local dev used that branch, with synthetic Staff/Student accounts and no production delivery credentials. Do not treat the filename as proof of isolation. Local server stopped before app build.
- App-only production build passes (259 generated pages); regenerated codemaps and docs verification pass. No commit, push, deployment, production business mutation, or real notification sent.

## Remaining acceptance and next slice

The full trust guarantees are **not yet accepted**. Existing GAP-60 remains open.

1. Highest risk: replay the Hockey blocked release on the isolated branch through the real preflight and working-copy services. Classify the exact overlapping assignment/window and provenance before fixing or proposing a live correction. Verify a superseded timer cannot release an older version and a rejected release leaves published reads unchanged.
2. Complete uncertain-outcome recovery and current eligibility on contextual Schedule/Event-detail ClaimShiftAction, pending-request withdrawal/review rows, native mutations, and working-copy rebase/revert. Those paths were traced but are not covered by this first fix. Do not infer withdrawal success from absence in a paginated pending list.
3. Run real isolated staff edit → student published read → exact-version release → approved/withdrawn request journeys on authenticated web and native. Include event reschedule/cancellation, two staff editing, claim/withdraw/approval races and timer supersession. Existing unit tests passing does not close this runtime gate.
4. Verify durable workflow execution, deduplicated in-app receipts, and actual push/email delivery independently; then physical iPhone behavior. No delivery or physical-device acceptance is claimed here.
5. Follow up incomplete candidate pagination and native combined-event parity without expanding policy or features.

### Execution prompt for the next slice
Continue from this ledger and the current diff. Exclude exports and feature expansion. Start with the recorded Hockey release and read-only preflight on the isolated branch; classify the conflict using exact assignment identities, effective windows, draft provenance, and publication version. Reproduce a verified cause before changing it. Preserve ten-minute exact-version release, silent past corrections, Admin-only approval, primary-area eligibility, availability and privacy policies. Then close current-eligibility and uncertain-response recovery across contextual web and native claim/withdraw flows. Never auto-resubmit an indeterminate mutation or infer success from filtered-list absence. Verify the staff/student lifecycle on authenticated isolated web and iPhone 16 Pro, record notification and physical-device gates separately, and identify what remains unverified before any release claim.
