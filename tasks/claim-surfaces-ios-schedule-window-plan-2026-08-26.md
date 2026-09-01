# Claim surfaces and complete iOS Schedule window — 2026-08-26

Status: Local implementation complete; authenticated and production proof pending

## Outcome

Make the student claim path current and consistent: the web Schedule
disclosure and Event detail own open-shift claims; the legacy Schedule side
panel is read-only context. Make native iOS Schedule load the complete
today-forward event window (and the staff/admin past window), while keeping
the approval-first claim contract and Admin-only open-slot request notifications.

## Bounded slices

1. Add a shared web `ClaimShiftAction` for open Student slots, pending-request
   state, refresh, and the canonical pickup route. Render it in the expanded
   Schedule rows and Event detail crew table; remove claim controls from the
   legacy shift side panel.
2. Add a current-user-only `viewerRequest` field to the shift-group list
   response so both web surfaces can distinguish an open slot from a request
   already awaiting approval. Preserve active assignment privacy and the
   existing approval-first server gate.
3. Make `/api/calendar-events` and `/api/my-shifts` total-aware from iOS and
   load all pages. `includePast` remains staff/admin-only in the native UI;
   Students keep the today-forward visibility contract.
4. Carry `viewerRequest` into native shift models so Event detail does not
   offer duplicate claims while a request is pending.
5. Add source/service/native contract coverage, update area/notification
   documentation, and record proof gates separately: focused tests, TypeScript
   and build, authenticated web render, deployment, and device acceptance.

## Files and contracts in scope

- Web: `src/components/ClaimShiftAction.tsx`, Schedule `ListView`, Event
  detail `ShiftCoverageCard`, `ShiftDetailPanel`/shift-detail children.
- API/service: `src/app/api/shift-groups/route.ts`, `/api/my-shifts`, and the
  existing pickup notification fanout.
- Native: `ios/Wisconsin/Core/APIClient.swift`,
  `ios/Wisconsin/Models/ScheduleModels.swift`, and native schedule/event
  detail claim state.
- Proof/docs: focused `tests/` contracts plus `docs/AREA_SHIFTS.md`,
  `docs/AREA_EVENTS.md`, `docs/AREA_NOTIFICATIONS.md`, and the relevant risk
  or decision entry if the new surface contract is durable.

## Acceptance gates

- A student sees Claim/Awaiting approval only in the expanded Schedule row or
  Event detail, never in the legacy side panel.
- A submitted open-slot claim remains `REQUESTED`, refreshes the two surfaces,
  and creates durable in-app plus push review notifications for active
  ADMIN reviewers.
- iOS Schedule requests all event pages in the selected scope and all of the
  caller's active shift pages; no one-month/first-page ceiling remains.
- Focused tests, `npx tsc --noEmit --pretty false`, lint, `npm run build:app`,
  and the exact iPhone 16 Pro Xcode gate are attempted and reported honestly.

## Verification state — 2026-08-26

- **Passed:** 95 focused native/web/API contract tests; `npx tsc --noEmit
  --pretty false`; `npm run lint`; `npm run build:app`; `npm run verify:docs`;
  `npm run ios:project:check`; and the exact `iPhone 16 Pro, iOS 26.5`
  Simulator Xcode build.
- **Passed:** authenticated local preview in Admin → Student read-only role
  preview. Schedule read two calendar/shift pages and the expanded Schedule
  row plus Event detail rendered `Claim shift` for future published Student
  slots. No claim, withdrawal, assignment, or other task-data mutation was
  performed.
- **Recorded:** `tasks/archive/proofs/claim-surfaces-ios-schedule-window-2026-08-26/index.html`
  contains the UI review notes. A matched before/after pair is intentionally
  not claimed because this checkout already contains unrelated parallel UI
  edits and reconstructing a clean baseline would overwrite them.
- **Open:** deployment and production read-back, push-delivery confirmation,
  and physical-device acceptance. The broader `schedule-timeline-source` test
  still expects a stale AppShell class string from unrelated parallel work;
  the 95-test slice above is green.

## Reviewer notification correction — 2026-08-27

- Superseded by the complete Admin-only boundary below. Both open-slot and
  Trade Board reviewer delivery, approval permission, reviewer payloads, and
  review queues are Admin-only. Staff retain ordinary scheduling tools, and
  the requesting student continues to receive their own lifecycle notifications.

## Admin-only claim review boundary — 2026-08-27

### Goal

- Make Admin the only human reviewer for both Trade Board claims and open-slot
  requests. Staff retain ordinary Schedule and Trade Board visibility, posting,
  cancellation, and other existing staffing tools, but receive no claim-review
  alerts, reviewer payloads, queue affordances, or approve/decline authority.

### Source checks

- The shared permission map now grants both approval permissions only to
  `ADMIN`; all four review routes enforce those permission keys.
- `schedule-open-work` returns every pending open-slot request only to Admins;
  other roles receive only their own pending request.
- Initial and deadline-driven reviewer fanout for both claim kinds now queries
  active visible Admin users only.

### Stop conditions

- Preserve Student claim/withdraw behavior, Staff non-review Schedule tools,
  automatic deadline approval, serializable mutation/audit contracts, and the
  Trade Board's ordinary read surface.
- Stop rather than changing schema, scheduling class, claim state, or deadline
  policy; none is required for this role-boundary correction.

### Slices

- [x] Restrict `shift_trade.approve` and `shift_assignment.approve` to Admin.
- [x] Restrict initial and deadline-driven reviewer notifications to active
  visible Admins for both claim kinds.
- [x] Return all pending open-slot requests only to Admins and remove Staff
  review actions/queues from web and native Trade Board surfaces.
- [x] Replace student-facing "Staff approval" copy with "Admin approval" and
  synchronize current decisions, area docs, risks, tests, and this ledger.

### Verification

- [x] Focused permission, Open Work, Trade Board, notification, and workflow
  tests, including explicit Staff denial and Admin allowance (62 focused tests
  pass before the broader verification sweep).
- [x] `npx tsc --noEmit --pretty false`
- [x] Focused and full ESLint plus `git diff --check`. `npm run verify:docs`
  was attempted and is blocked by pre-existing parallel drift in four generated
  codemaps; they were intentionally not regenerated over shared work.
- [x] `npm run build:app`; iOS project/drift/source checks and the exact iPhone
  16 Pro simulator build because native reviewer controls change.
- [ ] Authenticated Admin/Staff/Student browser proof or an explicit blocker;
  production notification delivery and physical-device proof remain separate.

### Local evidence

- 225 focused permission, route/source, Open Work, Trade Board, notification,
  workflow, assignment, and iOS contract tests pass across 12 files.
- TypeScript, focused and full ESLint, `build:app`, Xcode project integrity,
  iOS drift/audit checks, and the exact iPhone 16 Pro iOS 26.5 build pass.
- A valid matched `gt-ui-review` pair is blocked in this shared dirty checkout:
  the claim surfaces and fixture harness already contained uncommitted parallel
  work before this boundary changed, so `HEAD` is not a truthful baseline and
  the review skill forbids reconstructing one from memory.

## Trade Board inventory separation follow-up — 2026-08-31

### Goal

- Let a student distinguish a shift another student explicitly posted for trade
  from a published Student slot that was never assigned. Keep both claim paths
  in the same Trade Board sheet, but never merge them into one available-work
  section.

### Source checks

- `/api/shift-trades` already owns student-posted trades and
  `/api/schedule/open-work` already owns unassigned published Student slots.
- Both paths are approval-first under D-055 and already carry separate mutation,
  withdrawal, error-recovery, and partial-load contracts.
- Web and iOS currently erase that distinction by concatenating both sources
  under `Available Now`; no schema or response-shape change is required.

### Stop conditions

- Preserve the Admin review queue, personal waiting state, claim deadlines,
  role/scheduling-class eligibility, and existing serializable service paths.
- Stop rather than changing assignment or trade lifecycle policy; this slice is
  information architecture and consequence clarity only.

### Slices

- [x] Render student-posted trades in a dedicated `Trade Posts` section with
  poster-oriented copy and its own count.
- [x] Render unassigned published slots in a dedicated `Open Shifts` section
  with open-slot-oriented copy and its own count.
- [x] Apply the same source distinction on web and native iOS, including empty,
  partial-source, pending, blocked, and accessibility/source-contract coverage.
- [x] Sync shifts/mobile docs and record verification and remaining runtime
  gates without claiming deployment or physical-device acceptance.

### Verification

- [x] Focused Trade Board, Open Work, iOS field, and review-surface tests.
- [x] `npx tsc --noEmit --pretty false`, lint, and `npm run build:app`.
- [x] `npm run ios:project:check`, `npm run drift:ios`, native gap checks, and
  the pinned iPhone 16 Pro Simulator build.
- [x] `npm run codemap`, `npm run verify:docs`, and `git diff --check`.
- [x] Deterministic native runtime review. Authenticated web runtime remains a
  separate unavailable gate; the web source/build path is verified locally.

### Review

- **Shipped locally:** web and native iOS render claimable student-posted work
  under `Trade Posts` and claimable unassigned Student slots under `Open Shifts`,
  with independent counts and consequence copy. The native summary now counts
  opportunities rather than flattening both records into generic shifts.
- **Verified:** 35 focused tests, TypeScript, full ESLint, `build:app` across 253
  pages, Xcode project/drift/audit checks, the pinned iPhone 16 Pro iOS 26.5
  build, codemap/docs checks, and whitespace checks pass. A deterministic UI
  test passed on the source-control baseline and changed source using the same
  role, records, device, and scroll actions.
- **Proof artifact:**
  `tasks/trade-board-inventory-separation-review-2026-08-31/index.html`.
- **Unchanged:** API response shapes, claim eligibility, serializable mutation
  paths, withdrawal, deadlines, Admin review, and D-055 approval-first policy.
- **Open external gates:** authenticated web rendering, deployment/production
  read-back, TestFlight, and physical-device acceptance.

## Claimable area visibility follow-up — 2026-08-31

### Goal

- Keep a Student's Trade Board focused on shifts they may actually claim:
  their primary area only, except Photo and Graphics students may claim across
  the Photo/Graphics pair.

### Source checks

- Trade claims currently treat any `StudentAreaAssignment` as claim permission,
  so a secondary-area assignment widens both the list affordance and the direct
  mutation path.
- Open Work currently returns every published open Student slot and does not
  enforce an area membership check inside `pickupOpenShift`.
- Web and iOS already render the server-owned Trade Board/Open Work payloads;
  filtering the student payload at the service boundary keeps both clients in
  sync without a response-shape or schema change.

### Stop conditions

- Preserve Admin and Staff global review/read visibility, pending personal
  claims, My Posts, history, approval-first lifecycle, availability/conflict
  checks, and serializable mutations.
- Stop rather than inferring another cross-area pairing. Photo and Graphics are
  the only accepted exception.

### Slices

- [x] Add one shared primary-area claim rule with a symmetric Photo/Graphics
  exception and no secondary-area widening.
- [x] Filter Student claimable trade posts and open shifts with that rule while
  retaining personal pending/posts/history records needed to understand state.
- [x] Enforce the same rule in direct trade/open-slot claim mutations and Admin
  approval revalidation.
- [x] Add focused service/source contracts and sync Shifts/Mobile/decision docs.

### Verification

- [x] Focused Trade Board, Open Work, route/source, and native contracts.
- [x] `npx tsc --noEmit --pretty false`, lint, and `npm run build:app`.
- [x] iOS project/drift/gap checks and the pinned iPhone 16 Pro Simulator build.
- [x] `npm run codemap`, `npm run verify:docs`, and `git diff --check`.
- [x] Authenticated Student browser/native proof is explicitly deferred: no
  authenticated Student session was available, and this service-only follow-up
  did not justify mutating shared Schedule data solely for proof.

### Review

- **Shipped locally:** Students receive only primary-area claim opportunities;
  Photo and Graphics share the sole cross-area pool. Other-area open work is
  removed before web/iOS rendering, and unrelated secondary-area assignments no
  longer grant claim permission.
- **Protected:** direct Trade Board claims, direct open-slot requests, Trade
  approval, and open-slot approval revalidate the same shared rule. Staff/Admin
  global reads, personal pending/posts/history, approval-first lifecycle,
  availability, conflicts, and serializable transactions remain intact.
- **Verified:** 158 focused tests across eight files, TypeScript, full ESLint,
  `build:app` across 253 pages, iOS project/drift/gap checks, the pinned iPhone
  16 Pro iOS 26.5 Simulator build, codemap/docs verification, and whitespace
  checks pass.
- **Open external gates:** authenticated Student web/native rendering,
  deployment/production read-back, TestFlight, and physical-device acceptance.
