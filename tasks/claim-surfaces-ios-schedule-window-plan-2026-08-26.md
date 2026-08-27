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
