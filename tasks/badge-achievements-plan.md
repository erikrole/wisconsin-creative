# Badge Achievements Plan v7 (proposal)

Revised: 2026-08-19
Status: All fifteen are implemented locally across migrations 0117-0122, with
thresholds calibrated against real history. Two badges have no possible holder
yet for reasons calibration cannot fix. Migration application and rollout remain
out of scope.

## v7 Goal

Add fifteen harder automatic badges -- ten visible challenges and five hidden
easter eggs -- using only facts Wisconsin Creative already captures. The v6 catalog
recognises volume (counts and ladders) and single-checkout composition. It does
not yet recognise breadth across the Schedule half of the product, custody
duration, or the return moment itself, and it has exactly one easter egg.

## v7 Product Rules

- Every badge is automatic. None appear as staff-awarded definitions.
- Every rule derives from an existing trigger: `checkout:opened`,
  `checkout:returned`, `trade:completed`, `shift:completed`, or `app:opened`.
- Checkout rules read credited `BadgeEventReceipt` rows so ownership transfer
  cannot move or duplicate credit, matching the v6 rule.
- No new event source, no client claim, no client clock.
- `CalendarEvent.result` is deliberately unused. The column exists but nothing
  in `src` writes it, so a win/loss badge would never award.
- `ShiftAssignment.attended` is deliberately unused. Descriptions say assigned
  to a completed shift, never attended, per the v6 language correction.
- Names stay rooted in gear and production work.

## v7 Proposed Catalog

Sort order continues the v6 fun block. Hidden keys must also be added to
`HIDDEN_BADGE_KEYS` in `src/lib/badges/display.ts`.

### Visible challenges

| Key | Name | Requirement | Trigger | Rule key | Threshold | Icon / SF Symbol |
|---|---|---|---|---|---|---|
| `season_pass` | Season Pass | Assigned to completed shifts across 8 distinct sports | `shift:completed` | `shift_sports` | 8 | `Ticket` / `ticket.fill` |
| `utility_crew` | Utility Crew | Assigned to completed shifts in 4 distinct shift areas | `shift:completed` | `shift_areas` | 4 | `Shuffle` / `shuffle` |
| `doubleheader` | Doubleheader | 5 separate days holding 2 or more completed assignments | `shift:completed` | `shift_doubleheader_days` | 5 | `Repeat` / `repeat` |
| `under_the_lights` | Under the Lights | 5 completed assignments whose shift ended at or after 10 p.m. local | `shift:completed` | `shift_after_22` | 5 | `Sunset` / `sunset.fill` |
| `short_notice` | Short Notice | Completed 3 trades claimed less than 24 hours before the shift started | `trade:completed` | `trade_short_notice` | 3 | `AlarmClock` / `alarm.fill` |
| `deep_inventory` | Deep Inventory | 25 distinct serialized items across credited checkouts | `checkout:opened` | `checkout_distinct_assets` | 25 | `Warehouse` / `building.2.fill` |
| `regular_rotation` | Regular Rotation | Opened checkouts in 8 distinct local calendar weeks | `checkout:opened` | `checkout_weeks` | 8 | `CalendarRange` / `calendar.badge.clock` |
| `kit_complete` | Kit Complete | Opened 10 checkouts built from a saved kit | `checkout:opened` | `checkout_from_kit` | 10 | `PackageOpen` / `shippingbox.fill` |
| `long_haul` | Long Haul | Returned 3 checkouts held 7 days or longer with nothing damaged or missing | `checkout:returned` | `return_long_haul` | 3 | `Truck` / `truck.box.fill` |
| `round_trip` | Round Trip | 20 checkouts opened and returned inside the same local day | `checkout:returned` | `return_same_day` | 20 | `ArrowLeftRight` / `arrow.left.arrow.right` |

### Hidden easter eggs

| Key | Name | Requirement | Trigger | Rule key | Threshold | Icon / SF Symbol |
|---|---|---|---|---|---|---|
| `buzzer_beater` | Buzzer Beater | 3 returns completed inside the final five minutes before due | `checkout:returned` | `return_buzzer_beater` | 3 | `Timer` / `timer` |
| `old_faithful` | Old Faithful | Checked out one specific item 25 times | `checkout:opened` | `checkout_same_asset` | 25 | `Camera` / `camera.fill` |
| `battery_run` | Battery Run | Opened 5 checkouts containing nothing but batteries | `checkout:opened` | `checkout_batteries_only` | 5 | `BatteryLow` / `battery.25` |
| `take_thirteen` | Take Thirteen | Opened the app on a Friday the 13th | `app:opened` | `local_friday_13` | RULE | `Clapperboard` / `clapperboard.fill` |
| `holiday_hours` | Holiday Hours | Opened the app on December 25 or January 1 in institution time | `app:opened` | `local_holiday` | RULE | `Gift` / `gift.fill` |

## v7 Source Checks

- `onCheckoutOpened` selects only category shape from credited bookings. Four
  rules need more columns on that same query: `serializedItems.assetId`
  (`deep_inventory`, `old_faithful`), `startsAt` (`regular_rotation`), `kitId`
  (`kit_complete`), and the existing family set (`battery_run`).
- `onShiftsWorked` selects `callStartsAt`, `startsAt`, and `event.isHome`. The
  four shift rules additionally need `shift.endsAt`, `shift.area`,
  `event.sportCode`, and the event's local date.
- The return lane has no measured-rule path. `onCheckoutReturned` awards through
  `awardThresholdBadges` with a fixed `ON_TIME` category, so `long_haul`,
  `round_trip`, and `buzzer_beater` need either a `MILESTONE` measured-rule call
  on `checkout:returned` or a category argument on the existing helper.
- `onCheckoutReturned` returns early when `wasOnTime` is false. `round_trip` and
  `long_haul` must be evaluated before that early return, next to the existing
  damage-free lane.
- `onAppOpened` returns early unless the local hour is 2. Date-based eggs need
  the rule check restructured into a list of matchers, each claiming its own
  receipt source key.
- `ShiftTrade` stores `claimedAt` and reaches the shift through
  `shiftAssignment.shift.startsAt`, so `short_notice` needs no new column.
- `CalendarEventResult` is now written by calendar sync from the source
  `[W]`/`[L]` marker, so an outcome-keyed rule can read `CalendarEvent.result`
  instead of adding a column. Coverage is only as good as the feed's markers,
  and pre-0106 rows without a captured marker stay unknown.

## v7 Calibration Requirement

The v6 thresholds were calibrated so each challenge had proof of attainability
while only one to three current users qualified. The numbers above are design
intent, not measured values, and must be checked against production history
before any seed migration is written. Any rule where zero users qualify ships as
an unreachable badge; any rule where most users already qualify is not a
challenge.

## v7 Slices

- [x] Shift breadth slice: `season_pass`, `utility_crew`, `doubleheader`, and
      `under_the_lights`. Extended the completed-assignment select in both the
      evaluator and the profile progress query, added the four lanes to
      `shiftAutomaticRuleCounts`, seeded migration `0117_badge_shift_breadth`
      with a historical backfill, mirrored `prisma/seed.mjs`, added web icons
      and iOS SF Symbols, and added `tests/badge-shift-breadth.test.ts`.
- [x] Checkout slice: `deep_inventory`, `regular_rotation`, `kit_complete`, and
      the hidden `old_faithful` and `battery_run`. Extended the credited-checkout
      select in both call sites, passed the institution timezone into
      `checkoutAutomaticRuleCounts`, seeded migration
      `0118_badge_checkout_breadth` with a historical backfill, added the two
      hidden keys, added the `BatteryLow` icon on web and iOS, and added
      `tests/badge-checkout-breadth.test.ts`.
- [x] Return slice: `long_haul`, `round_trip`, and hidden `buzzer_beater`.
      Added `returnAutomaticRuleCounts`, widened the completed-checkout read and
      moved it above the on-time early return, seeded
      `0119_badge_return_moment` with a custodian-side backfill, and added
      `tests/badge-return-moment.test.ts`.
- [x] App-open slice: hidden `take_thirteen` and `holiday_hours`. Restructured
      `onAppOpened` into `APP_OPEN_RULES`, preserved the `local-hour-2:` receipt
      prefix, and seeded `0120_badge_app_open_eggs` with no backfill.
- [x] Trade slice: `short_notice`. `onTradeCompleted` reads trade rows instead
      of counting, and `0122_badge_short_notice` backfills claimer-side history.
- [x] Hidden keys, web icons, iOS SF Symbols, and area-doc sync.
- [x] Calibrate all thirteen counted thresholds. Measured per-user totals and
      structural ceilings against the preview Neon branch (30 active users, 165
      checkouts, 112 assignments, 10 staffed sports, 5 staffed crew areas, 23
      weeks of checkout history, 78 distinct assets ever handled).
- [x] Split the catalog between four day-one awards and nine long-run goals set
      above the current leader, on the product call that larger numbers are
      wanted. Calibration is what makes those goals reachable rather than
      arbitrary: each sits under its ceiling and within one to two seasons of
      the current leader, on five months of history.
- [ ] Decide whether to launch `kit_complete` and `short_notice`. No checkout
      has ever used a saved kit and the `shift_trades` table is empty, so both
      sit at zero holders regardless of threshold. The same emptiness leaves the
      pre-existing `first_trade`, `trade_5`, and `trade_10` unearned.
- [ ] Re-run calibration against production before enablement if the preview
      branch has drifted from it.
- [ ] Sync D-034.

---

# Badge Achievements Plan v6

Revised: 2026-08-10 (v6 ownership, completion, catalog, and easter eggs)
Status: Implemented locally; migration and runtime rollout remain open

## v6 Goal

- Make checkout badge credit stable across ownership transfer.
- Retire successful-scan achievement metrics while preserving earned history.
- Guarantee that server-derived completed progress has a durable award before a
  badge profile is returned.
- Add ten automatic, captured-data fun badges and one server-authoritative
  app-open easter egg across web and native iOS.
- Improve completion and shelf language so manual, hidden, and retired awards
  do not behave like required goals.

## v6 Product Rules

- A transfer before a checkout opens transfers future earning opportunity.
- A transfer after opening leaves checkout count and category breadth with the
  original opener. The new custodian receives return, on-time, and damage-free
  outcomes.
- Scan events remain operational evidence. They no longer drive badge counters,
  streaks, definitions, or kiosk reward reads.
- The ten fun badges are automatic. Eight derive from immutable credited
  checkout contents and two derive from confirmed ended shift assignments.
  They use no staff-award action or invented client claim. Thresholds are
  calibrated from current production history so every challenge has proof of
  attainability while only one to three current users qualify for each. The
  names stay rooted in gear and production work, not the game that inspired
  the achievement-system idea. `Go To Bed` is hidden and automatic only when
  the authenticated app opens during the 2 a.m. hour in the configured
  institution timezone.
- Profile completion counts visible automatic goals only.

## v6 Slices

- [x] Use canonical checkout IDs in durable receipts and backfill original
  opener credit only from the first transfer recorded after a kiosk-open audit;
  pre-open and ambiguous legacy transfers remain with the current requester.
- [x] Read checkout progress and category breadth from immutable receipts.
- [x] Add profile-boundary award reconciliation and migration backfills for
  currently completed automatic thresholds.
- [x] Retire all six scan definitions and remove scan badge event wiring while
  retaining ScanEvent evidence, historical streak rows, and earned awards.
- [x] Add ten automatic definitions, shared evaluator/profile derivation,
  historical backfill, web icons, native symbols, and reward-popup coverage.
- [x] Add hidden `go_to_bed`, an authenticated app-open route, server-time rule
  evaluation, and cursor-safe web/iOS foreground calls.
- [x] Rename the scan shelf to Legacy Scan Awards and exclude legacy, manual,
  and hidden awards from completion percentage.
- [x] Change shift descriptions from worked to assigned to completed events so
  copy does not claim attendance evidence the system does not have.
- [x] Sync D-034, Badge area truth, tests, and this plan.

## v6 Verification

- [x] Focused badge, kiosk, route, catalog, and iOS source-contract Vitest.
- [x] Prisma format and validation plus migration prefix validation.
- [x] Focused ESLint for changed web and server files.
- [ ] Standalone TypeScript remains blocked only by the pre-existing null
  fixtures in `tests/schedule-publication.test.ts` at lines 733 and 743.
- [x] Production-shaped web build.
- [x] Exact Wisconsin iPhone 16 Pro simulator build and kiosk generic simulator
  build.
- [ ] Authenticated web, signed-in native, and managed kiosk visual proof.
- [x] A scoped badge commit was authorized separately on 2026-08-10.
- [ ] Migration application, deployment, flag changes, distribution, and push
  remain outside this slice.

---

# Badge Achievements Plan v5

Revised: 2026-08-10 (v5 reward and reliability follow-up)
Status: Implemented locally; original GA rollout gates remain open

## v5 Goal

- Make a newly earned badge visible at the moment it is earned on web, native
  iOS, and the staffed kiosk without weakening the operational mutation that
  caused it.
- Fix verified earning/idempotency defects before adding presentation polish.
- Add a few attainable bridge milestones to the existing count ladders without
  inventing new event sources or changing D-034's profile-first direction.

## v5 Route

- Owner area: Badges.
- Secondary areas: Kiosk, Mobile, Notifications, Schedule, and Reports.
- Ledger: this existing active plan remains the badge source of truth; do not
  create a parallel reward plan.
- Existing references: D-034, `docs/AREA_BADGES.md`, and
  `tasks/archive/badges-redesign-plan.md`.

## v5 Source Checks

- Automatic awards are durable `StudentBadge` rows, but evaluator methods
  currently return `void`, kiosk mutation responses contain no earned-badge
  metadata, and web/native shells have no recent-award intake path.
- `BadgeStreak.lastSourceKey` only remembers the latest event. An older event
  retried after a newer event can mutate the streak again, so the documented
  "repeated handling is a no-op" rule is not globally true.
- Direct kiosk checkout scans derive the source key from user plus scan value.
  A later legitimate checkout can therefore collide with the user's prior
  final scan of the same item.
- The current automatic ladders have large early gaps: on-time 1 to 10, scans
  1 to 25, shifts 10 to 50, and trades 1 to 10.
- Kiosk already owns a five-second success moment. Badge celebration should
  extend that moment, not interrupt scan capture or create a second custody
  confirmation screen.

## v5 Stop Conditions

- Stop if a response change would make custody success depend on celebration
  rendering or badge evaluation failure.
- Stop if a new badge cannot be earned from an existing D-034 event and a real
  database-backed counter.
- Stop before deployment, migration application, flag enablement, commit,
  push, or production mutation without separate authorization.
- Preserve current uncommitted report, iOS performance, companion, and docs
  work; merge only additive changes in overlapping files.

## v5 Slices

- [x] Slice 8: Add durable event receipts for request-scoped badge events and a
  per-attempt direct-checkout scan key so delayed/reordered retries cannot
  change streaks twice or suppress a later legitimate scan.
- [x] Slice 9: Add an authenticated recent-awards feed plus additive
  `earnedBadges` fields on kiosk responses, keeping feature-flag-off responses
  empty and operational success independent from display.
- [x] Slice 10: Add one shared web earned-badge celebration and a native
  SwiftUI reward presentation. Queue multiple awards, respect reduced motion,
  initialize cursors without replaying a user's full history, and include the
  kiosk success surface.
- [x] Slice 11: Add `on_time_5`, `scan_10`, `shift_25`, and `trade_5` as bridge
  milestones through one forward migration plus the canonical seed mirror.
- [x] Slice 12: Reconcile D-034, sync the Badge and Kiosk area docs plus
  generated codemaps, add source-contract tests, and complete the review below.
  D-034 remains compatible without amendment: the profile stays primary, no
  hero or top-level navigation was added, and reward chrome is post-award.

## v5 Verification

- [x] Focused badge evaluator, service, route, kiosk scan, catalog, web source,
  and iOS source-contract Vitest suites.
- [x] `npx prisma format && npx prisma validate`
- [x] `npm run db:migrate:check`
- [ ] `npx tsc --noEmit --pretty false` is blocked by two pre-existing
  `tests/schedule-publication.test.ts` fixture errors at lines 733 and 743;
  the production Next.js build type gate passes.
- [x] Focused ESLint for changed web/server files.
- [x] `npm run ios:project:check`
- [x] `npm run drift:ios`
- [x] `npm run audit:ios:gaps` reports 53 of 53 audit-worthy surfaces covered;
  concurrently added `ReportsView.swift` remains an unrelated unregistered warning.
- [x] `Wisconsin` builds on `platform=iOS Simulator,name=iPhone 16 Pro`.
- [x] `WisconsinKiosk` builds for `generic/platform=iOS Simulator`; the required
  iPhone 16 Pro destination is ineligible because the kiosk target is iPad-only.
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `npm run build:app`
- [x] `git diff --check`
- [ ] Authenticated web smoke for the celebration and simulator kiosk/main-app
  proof, or record the exact session/runtime blocker.
- [ ] Do not run full `npm run build` because deploy-shaped migration work is
  not authorized in this slice.

## v5 Review

- Shipped locally: durable event receipts, collision-free direct-scan attempt
  IDs, recent-award cursor API, queued web and native celebrations, kiosk reward
  success state, and four attainable bridge badges.
- Verified: 108 focused tests in 18 files, focused ESLint, Prisma format and
  validation, migration numbering, production Next.js build, codemap/docs
  verification, XcodeGen parity, iOS drift and gap audits, exact Wisconsin
  iPhone 16 Pro simulator compile, generic WisconsinKiosk simulator compile,
  and clean diff whitespace.
- Deferred: production flag enablement, preview rollback drill, migration
  application, deployment, physical kiosk proof, and real-device haptics.
- Blocked: authenticated web reward rendering has no local smoke credential;
  the iPad-only kiosk cannot use the contract's iPhone 16 Pro destination and
  still needs its managed landscape-iPad reward walkthrough. Standalone `tsc`
  remains red only on the two unrelated Schedule test-fixture nullability errors.
- Proof artifacts: `prisma/migrations/0110_badge_rewards`, focused Vitest output,
  `npm run build:app`, Xcode build logs, and the updated Badge/Kiosk area docs.
- Next slice or stop: stop before migration application, deployment, flag
  enablement, or distribution. Resume with preview migration plus authenticated
  web and managed-iPad reward acceptance.

---

## v4 Historical Plan

Created: 2026-04-27
Revised: 2026-05-09 (v4)
Status: Implemented baseline with GA rollout gates still open

---

## Background

PR #123 previously implemented a full badge system with 42 badges, evaluation
engine, streak tracking, staff dashboard, and profile integration. It was
merged to main and reverted because it mixed too many touchpoints in one slice,
conflicted with route refactors, used a sub-daily cron that does not fit Vercel
Hobby, and coupled badge rules directly into booking, scan, and shift handlers.

v2 fixed the cron and big-bang rollout problem. v3 corrected the event boundary
and UI model (kiosk-first, no scattered route hooks, profile-tab UI). v4 closes
schema and idempotency gaps surfaced in review, locks down ambiguous decisions
that were blocking later slices, and tightens the verification checklist.

Sources preserved for implementation:
- Current plan history: `tasks/badge-achievements-plan.md`
- Kiosk canonical API surface: `docs/AREA_KIOSK.md`
- Scan route contract: `docs/AREA_SCAN.md`
- Legacy app scan stub: `src/app/api/checkouts/[id]/scan/route.ts`
- Profile redirect: `src/app/(app)/profile/page.tsx`
- User detail shell and tabs: `src/app/(app)/users/[id]/page.tsx`
- Reports nav: `src/lib/nav-sections.ts`
- Badge primitive: `src/components/ui/badge.tsx`
- Booking completion paths: `src/lib/services/bookings-checkin.ts`
- Trade completion paths: `src/lib/services/shift-trades.ts`
- Notification preferences JSON on `User.notificationPrefs`: `prisma/schema.prisma`
- Current schema: `prisma/schema.prisma`
- API/service patterns: `tasks/lessons.md`

---

## Design Principles

1. **Domain outcome boundary, not route sprinkling.** Badge calls attach to
   service-level outcomes or kiosk flow outcomes where the product event is
   actually known. Avoid scattering badge logic across leaf routes.
2. **Single source of truth per transition.** When more than one code path can
   produce the same logical event (e.g. `markCheckoutCompleted` and
   `maybeAutoComplete` both flipping a booking to `COMPLETED`), the badge call
   fires from the actual status-flip site, not from each call site.
3. **Kiosk-first event model.** Kiosk checkout, pickup, return, and scan are
   first-class badge inputs. Legacy web scan stubs are explicitly not badge
   inputs.
4. **No cron dependency.** Evaluate badges inline on the event that already
   happened. No sub-daily Vercel cron. No Node `EventEmitter`.
5. **Feature flag from day one.** `BADGES_ENABLED !== "true"` must return before
   any badge DB query or side effect.
6. **Idempotent at every layer.** `StudentBadge` unique on `(userId, definitionId)`
   protects awards. Streak increments are protected by an explicit per-event
   dedupe key. Duplicate event handling is a no-op, not an error.
7. **Progressive slices.** Each slice must be mergeable, testable, and
   doc-synced on its own.
8. **Restrained UI.** Badges are a profile-tab recognition layer for all users,
   not a top level app destination and not chrome in the profile hero.
9. **User-wide recognition.** Staff and admins earn badges too. The table is
   still legacy-named `StudentBadge`, but product behavior treats it as user
   awards keyed by `userId`.
10. **Fail loud in dev, fail safe in prod.** `safeCall` swallows errors only in
   production; tests and dev throw so evaluator bugs are visible.

---

## Event Architecture

### Public badge service

The route or domain service calls a narrow, safe public API. The public wrapper
short-circuits while disabled and catches evaluator failures so badge bugs never
break checkout, scan, shift, or trade work — but only in production.

```ts
type BadgeEvaluator = (...args: any[]) => Promise<void>;

function safeCall<F extends BadgeEvaluator>(fn: F): F {
  return (async (...args: Parameters<F>) => {
    if (process.env.BADGES_ENABLED !== "true") return;
    try {
      await fn(...args);
    } catch (error) {
      // Dev/test: throw so evaluator bugs are caught by the test suite.
      if (process.env.NODE_ENV !== "production") throw error;
      // Prod: report to Sentry if configured, otherwise structured log.
      const sentry = await import("@/lib/observability").catch(() => null);
      if (sentry?.captureBadgeError) {
        sentry.captureBadgeError(error, { evaluator: fn.name });
      } else {
        console.error("event=badge_evaluator_failed", {
          evaluator: fn.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }) as F;
}

export const badges = {
  onCheckoutOpened: safeCall(_onCheckoutOpened),
  onCheckoutReturned: safeCall(_onCheckoutReturned),
  onScanResult: safeCall(_onScanResult),
  onTradeCompleted: safeCall(_onTradeCompleted),
};
```

Notes on the wrapper:
- The wrapper preserves `Promise<void>` only — evaluators must not return
  values. The constraint is enforced at the type and at runtime.
- The flag is read on every call so a Vercel env flip takes effect on the next
  warm invocation without redeploy.
- `@/lib/observability` is the indirection point — slice 1 stubs it; slice 7
  wires it to the existing Sentry setup if present, else keeps structured logs.

### Event inputs

| Service method | Current repo source (file:symbol) | Payload |
|---|---|---|
| `onCheckoutOpened` | `kiosk/checkout/complete` creates an `OPEN` checkout; `kiosk/pickup/[id]/confirm` flips `PENDING_PICKUP` to `OPEN` | `{ userId, bookingId, source: "kiosk_checkout" \| "kiosk_pickup", sourceKey: bookingId }` |
| `onCheckoutReturned` | `bookings-checkin.ts` status flip into `COMPLETED` (single emit point inside `markCheckoutCompleted` and `maybeAutoComplete`'s "just transitioned" branch) | `{ userId, bookingId, completedAt, wasOnTime, sourceKey: bookingId }` |
| `onScanResult` | `kiosk/checkout/scan`, `kiosk/pickup/[id]/scan`, `kiosk/checkin/[id]/scan` | `{ userId, bookingId?, phase: "checkout" \| "pickup" \| "checkin", ok, errorCode?: BadgeScanErrorCode, sourceKey }` |
| `onTradeCompleted` | `shift-trades.ts` at the line that flips status to `COMPLETED` (one helper, called from both `claimTrade` immediate-complete and `approveTrade`) | `{ userId, tradeId, sourceKey: tradeId }` |

Required for every event payload:
- `sourceKey: string` — stable identifier of the underlying domain event used
  for streak dedupe. Streak math must use this key, not `Date.now()`.
  For scan routes, use an existing `ScanEvent.id` when one is created. Otherwise
  use deterministic `phase:bookingId-or-userId:normalizedScanValue:ok/errorCode`
  so retries of the same attempt do not double-bump streaks.
- `wasOnTime` is computed against `booking.endsAt` with a 15-minute grace
  window (decision recorded in `docs/DECISIONS.md` slice 1). All comparisons in
  UTC.
- `errorCode` for scan results uses a new `BadgeScanErrorCode` type in
  `src/lib/badges/types.ts`. Route-specific messages map into this stable enum;
  free-form error strings are not accepted by the badge service.

### Single-emit rule

`onCheckoutReturned` MUST be emitted exactly once per booking transition into
`COMPLETED`. Implementation:

- A private helper `_emitReturnedIfTransitioned(tx, booking, prevStatus)` lives
  in `bookings-checkin.ts` and is called by both `markCheckoutCompleted` and
  `maybeAutoComplete` after the update. It checks `prevStatus !== "COMPLETED"`
  before emitting.
- Same pattern for `onTradeCompleted` inside `shift-trades.ts`.

This is the only correct way given two paths can race for the same booking.

### Explicit non-events

- Do not wire `src/app/api/checkouts/[id]/scan/route.ts`; it is a kiosk-gated
  403 stub and must keep awarding nothing.
- Do not award shift completion badges from `shift-assignments/[id]/approve`.
  Approval is not a badge event, and attendance-based shift badges are out of
  scope.
- Do not add an app-level nav item for badges.

---

## Schema

```prisma
model BadgeDefinition {
  id          String   @id @default(cuid())
  key         String   @unique
  name        String
  description String
  icon        String
  category    BadgeCategory
  kind        BadgeKind
  trigger     String
  threshold   Int?
  ruleKey     String?
  active      Boolean  @default(true)
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now()) @map("created_at")
  awards      StudentBadge[]
  @@map("badge_definitions")
}

enum BadgeCategory   { CHECKOUT ON_TIME SCAN SHIFT TRADE STREAK MILESTONE }
enum BadgeKind       { COUNT STREAK RULE }
enum BadgeSource     { AUTO MANUAL }
enum BadgeStreakType { ON_TIME_RETURN SCAN_CLEAN SHIFT_ATTENDANCE }

model StudentBadge {
  id            String          @id @default(cuid())
  userId        String          @map("user_id")
  definitionId  String          @map("definition_id")
  awardedAt     DateTime        @default(now()) @map("awarded_at")
  source        BadgeSource     @default(AUTO)
  awardedById   String?         @map("awarded_by_id")
  note          String?         // staff context for MANUAL awards; null for AUTO
  user          User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  definition    BadgeDefinition @relation(fields: [definitionId], references: [id], onDelete: Restrict)
  awardedBy     User?           @relation("BadgeAwardedBy", fields: [awardedById], references: [id], onDelete: SetNull)
  @@unique([userId, definitionId])
  @@index([userId, awardedAt(sort: Desc)])
  @@index([definitionId, awardedAt(sort: Desc)])
  @@map("student_badges")
}

model BadgeStreak {
  id             String          @id @default(cuid())
  userId         String          @map("user_id")
  streakType     BadgeStreakType @map("streak_type")
  current        Int             @default(0)
  longest        Int             @default(0)
  lastEventAt    DateTime?       @map("last_event_at")
  lastSourceKey  String?         @map("last_source_key")
  user           User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, streakType])
  @@index([userId])
  @@map("badge_streaks")
}
```

Add these relations to `User`:

```prisma
badges            StudentBadge[]
badgesAwardedByMe StudentBadge[] @relation("BadgeAwardedBy")
badgeStreaks      BadgeStreak[]
```

Add to `SystemConfig` via a JSON key, not a new one-field settings model:

```ts
key: "badges.peerVisible"
value: true
```

This is the single switch that decides whether non-staff peers can see another
user's badges tab. Default true; staff can flip it off without code changes.
Shipping it now avoids a slice-4 migration.

Decisions baked into v4:
- Badge definitions are retired with `active = false`, never deleted.
- `source`, `awardedById`, and `note` ship in slice 1 — manual awards do not
  need a later migration.
- No retroactive backfill at launch. Recorded in `docs/DECISIONS.md`.
- Deactivated users keep historical badges.
- Badge `key` is an immutable identifier. Renames happen via `name`,
  `description`, or `icon`. A typo in `key` is corrected by retiring the old
  definition and seeding a new one. Recorded in `docs/AREA_BADGES.md`.
- `wasOnTime` grace window is 15 minutes after `booking.endsAt`. Recorded in
  `docs/DECISIONS.md`.

---

## Starting Badge Set

Ship 20 starter definitions, seeded idempotently by `key` from `prisma/seed.mjs`
(the existing seed entrypoint — no parallel `seed-badges.ts`).

### Checkout

| Key | Name | Threshold | Trigger |
|---|---|---:|---|
| `first_checkout` | First Checkout | 1 | `checkout:opened` |
| `checkout_5` | Gear Regular | 5 | `checkout:opened` |
| `checkout_25` | Gear Veteran | 25 | `checkout:opened` |
| `checkout_100` | Gear Master | 100 | `checkout:opened` |

### On-time return

| Key | Name | Threshold | Trigger |
|---|---|---:|---|
| `on_time_1` | Punctual | 1 | `checkout:returned` with `wasOnTime` |
| `on_time_10` | Reliable | 10 | `checkout:returned` with `wasOnTime` |
| `on_time_50` | Clockwork | 50 | `checkout:returned` with `wasOnTime` |

### Scan

| Key | Name | Threshold | Trigger |
|---|---|---:|---|
| `first_scan` | Scanner | 1 | `scan:success` |
| `scan_25` | Scan Pro | 25 | `scan:success` |
| `scan_100` | Scan Master | 100 | `scan:success` |
| `zero_errors` | Clean Scanner | 10 consecutive successes | `scan:rule` |

### Trade

| Key | Name | Threshold | Trigger |
|---|---|---:|---|
| `first_trade` | Team Player | 1 | `trade:completed` |
| `trade_10` | Trade Expert | 10 | `trade:completed` |

### Streak

| Key | Name | Threshold | Trigger |
|---|---|---:|---|
| `streak_on_time_5` | On a Roll | 5 | on-time return streak |
| `streak_on_time_10` | Locked In | 10 | on-time return streak |

---

## UI Direction

Badges should feel like lightweight recognition inside an ops app.

- Add a `Badges` tab to `/users/{id}` for students, staff, and admins.
  `/profile` already redirects there, so do not build a separate profile badge
  page.
- The profile **hero is operational** — overdue, owed gear, status. No badge
  count, no recognition chrome. The count is visible only inside the badges
  tab. This avoids diluting ops signal with achievement signal.
- Visibility rules:
  - Staff/admin can always see any user's badges tab.
  - Users can see their own badges tab via the `/profile` redirect.
  - Peer visibility (one user viewing another user's tab) is gated by the
    `SystemConfig` key `badges.peerVisible`, default true.
- The badge grid uses shadcn primitives. Each earned badge shows a rarity-aware
  medallion, name, one-line description, earned date, and manual note when one
  exists. Locked badges are muted.
- Progress bars appear only for threshold badges backed by real counters or
  streak rows. Manual badges must not show invented progress.
- A few surprise badges remain hidden until earned, but the available section
  shows the count of hidden surprise badges so completion does not feel
  misleading.
- Manual award lives in the existing admin actions menu and opens a dialog
  that supports an optional `note`. Do not add a permanent hero button.
- `/reports/badges` is staff analytics: leaderboard, recent awards,
  distribution, underused definitions, manual award rate, and recent manual
  recognition. It follows existing report metric/table patterns and is added to
  `REPORT_SECTIONS` in `src/lib/nav-sections.ts` (becomes the 7th entry, after
  Audit). Not added to the sidebar.
- Award notifications are persistent inbox entries (no toast), respecting
  `User.notificationPrefs`. Extend the JSON shape with a `badges` preference key
  so users can mute badge notifications specifically. The notification links to
  `/users/{userId}?tab=badges`. APNs push is a v2 follow-up — explicitly
  deferred, not "out of scope".
- No top-level sidebar item for badges.

---

## Slices

### Slice 1: Schema, seed, service skeleton, AREA doc, decisions

- [x] Add Prisma models, enums (`BadgeStreakType` included), `User` relations,
  `SystemConfig` seed/default for `badges.peerVisible`, hot-path indexes on `StudentBadge`, and
  `BadgeStreak.lastSourceKey`.
- [x] Add migration `0055_add_badges`. `prisma migrate dev` was blocked because it would apply to the configured Neon database, so Slice 1 saved the SQL artifact manually and validated it with Prisma/schema checks.
- [x] Add `BADGES_ENABLED` to `.env.example`; default off.
- [x] Add `src/lib/badges/index.ts`, `evaluator.ts`, `queries.ts`, `types.ts`,
  and a stub `src/lib/observability.ts` with `captureBadgeError`.
- [x] Add idempotent seed entries for the 20 definitions in the existing
  `prisma/seed.mjs`.
- [x] Add `docs/AREA_BADGES.md` with scope, ACs, rollout, UI direction,
  visibility rules, key-immutability rule, and a source-of-truth flow table
  (file:symbol for every emit point).
- [x] Record in `docs/DECISIONS.md`: no-backfill launch, 15-minute on-time
  grace, key immutability, single-emit rule on status-flip helpers,
  peer-visibility default.

### Slice 2: Checkout opened and returned badges

- [x] Wire `onCheckoutOpened` in `src/app/api/kiosk/checkout/complete/route.ts`
  after the `OPEN` checkout is created and audit entry succeeds.
- [x] Wire `onCheckoutOpened` in
  `src/app/api/kiosk/pickup/[id]/confirm/route.ts` after the
  `PENDING_PICKUP -> OPEN` update succeeds.
- [x] Add returned event emission from the status-transition boundary in
  `bookings-checkin.ts`.
- [x] Wire returned event at every flip into `COMPLETED`
  (`markCheckoutCompleted`, `maybeAutoComplete`).
- [x] Compute `wasOnTime` from `booking.endsAt` with the 15-minute grace.
- [x] Streak increment uses `sourceKey = bookingId` and updates only when
  `lastSourceKey != bookingId`.
- [x] Test: duplicate source handling awards exactly once and does not double-bump
  the on-time streak.
- [x] Update `docs/AREA_BADGES.md`.

### Slice 3: Kiosk scan badges

- [x] Wire `onScanResult` from kiosk checkout scan, pickup scan, and check-in
  scan routes.
- [x] Add `BadgeScanErrorCode` in `src/lib/badges/types.ts` and map each
  route's success/failure outcome into that stable enum so analytics are stable.
- [x] `zero_errors` rule increments on `ok=true`, resets on `ok=false`. Streak
  increment is keyed on the scan source-key rule defined above.
- [x] Confirm legacy app scan stub remains 403 and awards nothing.
- [x] Update `docs/AREA_BADGES.md` and cross-reference `docs/AREA_SCAN.md` if
  the scan contract changes.

Slice 3 implementation notes:
- Direct checkout scans now accept optional `actorId`. The native kiosk checkout
  flow sends the selected student id, while older clients without `actorId`
  preserve scan behavior without badge attribution.
- Pickup and check-in scans attribute to the booking requester. Serialized
  successful scans use `ScanEvent.id` as `sourceKey`; deterministic source keys
  cover bulk scans and failed attempts.
- `BadgeStreakType.SCAN_SUCCESS_COUNT` tracks lifetime successful scan counts
  separately from `SCAN_CLEAN`, which resets on failed scans.

### Slice 4: Profile API and profile UI

- [x] Add `GET /api/badges` (catalog).
- [x] Add `GET /api/badges/user/[userId]` with visibility check
  (self / staff / `SystemConfig["badges.peerVisible"] === true`).
- [x] Add user-wide `Badges` tab to `/users/{id}`.
- [x] Keep `/profile` as redirect-only.
- [x] Profile badge load uses a single query joining definition rows; no N+1.
- [x] Update `docs/AREA_BADGES.md`.

Slice 4 implementation notes:
- `/api/badges/user/[userId]` serves badge profiles for any user role. It
  allows self and staff/admin access, and allows peer comparison only while
  `SystemConfig["badges.peerVisible"]` is not `false`.
- With `BADGES_ENABLED` off, badge APIs return disabled/empty payloads before
  user, config, definition, or award queries. This preserves the zero badge-query
  rollback path and keeps un-migrated local/preview databases from failing when
  the profile tab renders.
- The profile tab fetches one badge profile payload that includes active
  definitions and historical earned inactive definitions. The profile hero
  remains unchanged and badge-free.
- Existing `/profile` behavior remains a redirect to `/users/{currentUserId}`.

### Slice 5: Trade badges and manual awards

- [x] Add `_emitTradeCompletedIfTransitioned(tx, trade, prevStatus)` in
  `shift-trades.ts`. Wire from `claimTrade` immediate-complete branch and from
  `approveTrade` when status flips to `COMPLETED`.
- [x] Add `POST /api/badges/award` for admins only, accepting
  `{ userId, definitionId, note? }`.
- [x] Add manual-award dialog launched from existing user admin actions; the
  dialog includes an optional note field.
- [x] Add inbox notification on award (no toast), respecting notification
  prefs JSON, linking to `/users/{userId}?tab=badges`.
- [x] Update `docs/AREA_BADGES.md` and `docs/AREA_NOTIFICATIONS.md`.

Slice 5 implementation notes:
- Trade completion badge events are queued from the transaction and fired after
  the trade status update commits. Both poster and claimer receive trade event
  credit, with `StudentBadge` uniqueness keeping awards idempotent.
- Manual awards are admin-only, flag-gated before badge service work, and reject
  duplicate `(userId, definitionId)` awards so the original staff note remains
  authoritative.
- Award notifications use `Notification.payload.href` for the profile badge tab
  destination and respect `notificationPrefs.badges`, defaulting old preference
  shapes to enabled.
- Manual awards can target any active user, including staff and admins.

### Slice 6: Retired shift attendance badges

- [x] Do not wire request approval.
- [x] Retire attendance-based shift badge definitions from the active catalog.
- [x] Keep shift attendance tracking out of badge scope unless a future product
  decision explicitly reopens it.

### Slice 7: Staff report, hardening, GA

- [x] Add `/reports/badges` and add to `REPORT_SECTIONS` in
  `src/lib/nav-sections.ts`.
- [x] Report includes leaderboard (uses
  `@@index([definitionId, awardedAt desc)]`), recent awards, and distribution.
- [x] Wire `src/lib/observability.ts:captureBadgeError` to the existing Sentry
  setup if present, else keep structured logs.
- [ ] Verify production latency impact from logs before flipping the flag.
- [ ] Run rollback drill on Vercel preview: flip `BADGES_ENABLED=true`,
  exercise kiosk + trade + manual flows, flip back to `false`, confirm new
  awards stop and existing data is intact.
- [ ] Set `BADGES_ENABLED=true` in Vercel production only after preview
  verification.
- [ ] Update `docs/GAPS_AND_RISKS.md` if this closes the gamification gap.
- [ ] Move this plan to `tasks/archive/` after all slices ship.

Slice 7 implementation notes:
- The staff analytics surface is live as `/reports/badges`, added after Audit in
  the shared report tab list. It remains outside top-level navigation.
- The report includes total awards, 30-day award volume, active definition count,
  manual award count/rate, user leaderboard, badge distribution, underused
  active definitions, recent manual recognition, recent awards, and CSV export.
- Front-end polish added schema-free rarity medallions, profile grid motion,
  manual note display, recent-award state, surprise-badge count, and real
  supported progress. The legacy `StudentBadge` model/table name remains a
  deferred dedicated migration cleanup rather than part of the UI polish slice.
- Badge evaluator transactions now run at Serializable isolation with one retry
  for Prisma `P2034` write conflicts. Duplicate source-key retries re-read the
  streak row before mutating, and `captureBadgeError` forwards evaluator
  failures to Sentry when `SENTRY_DSN` is configured while preserving structured
  logs.
- GA rollout work remains pending: production latency review, preview rollback
  drill, Vercel flag enablement, and final archive.

---

## Acceptance Criteria

- [x] `BADGES_ENABLED=false` causes zero badge transaction work and zero side
  effects before evaluator execution.
- [x] Kiosk checkout completion awards checkout count badges exactly once per
  booking, even under retry.
- [x] Kiosk pickup confirmation awards checkout count badges exactly once for
  pre-created reservations moving into active checkout, and does not
  double-count if the booking later passes through `markCheckoutCompleted`.
- [x] Kiosk check-in completion awards return and on-time badges exactly once,
  whether the path is `markCheckoutCompleted` or `maybeAutoComplete`.
- [x] On-time computation uses 15-minute grace and UTC comparison.
- [x] Auto-completion via partial serialized or bulk check-in awards return
  badges exactly once.
- [x] Kiosk scan successes count toward scan badges; the streak is keyed on
  the deterministic source key so retries do not double-bump.
- [x] Kiosk scan failures reset the `zero_errors` rule state.
- [x] Legacy app checkout scan stub remains 403 and awards no badges.
- [x] Trade badges award once per status flip, regardless of whether the flip
  came from `claimTrade` or `approveTrade`.
- [ ] Shift badges do not award on request approval.
- [x] Manual awards persist `awardedById` and an optional `note`.
- [x] Deactivated users keep historical badges.
- [x] Inactive definitions are hidden from discovery UI but historical awards
  still display.
- [x] User profile badge grid uses shadcn primitives; the hero shows no
  badge count or chrome.
- [x] User profile badge cards show rarity-aware medallions, manual notes,
  recent-award state, surprise-badge count, and real progress where supported.
- [x] Staff and admins can earn, view, and compare badges on the same profile
  tab surface as students.
- [x] Peer visibility respects `SystemConfig` key `badges.peerVisible`.
- [x] `/reports/badges` follows existing report layout patterns and appears as
  the 7th entry in `REPORT_SECTIONS`.
- [x] `/reports/badges` includes staff insight sections for manual award rate,
  underused definitions, and recent manual recognition.
- [x] Award notifications use the persistent inbox channel and respect
  the `badges` key in `User.notificationPrefs`.

---

## Verification Checklist

Run these per slice as applicable:

- [x] `npx prisma validate`
- [x] `npm run db:migrate:check`
- [x] `npm run db:migrate:status` (repo health checker compares local migrations with live Neon migration history through `DIRECT_URL`)
- [ ] `npm run lint`
- [x] `npm test` (Vitest — badge evaluator, checkout, scan, trade, UI API)
- [x] Slice 3 focused tests: `npm test -- tests/badge-evaluator.test.ts tests/badges-service.test.ts tests/kiosk-bulk-detail-routes.test.ts tests/kiosk-checkout-scan-badges.test.ts tests/scan-route-gate-contract.test.ts`
- [x] Slice 4 focused tests: `npm test -- tests/badges-routes.test.ts tests/badges-service.test.ts`
- [x] Slice 5 focused tests: `npm test -- tests/badge-evaluator.test.ts tests/badges-manual-awards.test.ts tests/shift-trades.test.ts tests/badges-award-route.test.ts tests/badges-routes.test.ts tests/badges-service.test.ts`
- [x] Slice 7 report route test: `npm test -- tests/badges-report-route.test.ts`
- [x] Concurrency test: two parallel calls for the same `(userId, sourceKey)`
  award exactly one badge and bump streak by exactly one.
- [x] Flag-off snapshot test: `BADGES_ENABLED=false` produces zero badge
  transactions in a Vitest harness.
- [x] `npx tsc --noEmit`
- [x] `npx next build` (historical Slice 1 check; follow-up 2026-05-13: `npm run build` now runs the shared Prisma/Neon migration wrapper before Next build)
- [ ] iOS simulator build (blocked for Slice 3: XcodeBuildMCP has no configured project/scheme defaults in this session, and this checkout exposes no `.xcodeproj`, `.xcworkspace`, or `Package.swift`)
- [ ] `npm run lint` (blocked: `next lint` is deprecated and opens an interactive ESLint setup prompt)
- [x] Manual or browser smoke for `/users/{id}?tab=badges` and
  `/reports/badges` after UI slices.
- [ ] Slice 7 only: rollback drill on a Vercel preview deployment.

---

## Claude Code Review

Status: Blocked on local Claude auth (last attempted 2026-05-09).

When Claude Code is logged in:

1. Check availability with `command -v claude`.
2. Run a read-only Claude Code review against this plan asking it to find
   stale assumptions, missed current repo flows, UI clutter risks, schema/API
   gaps, and verification gaps.
3. Save the review in `tasks/badge-achievements-plan-claude-review.md` if it is
   longer than a short note. Otherwise append the review summary here.
4. If Claude Code is unavailable, record that here and stop.

---

## Resolved in v4 (was Open Questions in v3)

1. ~~Should staff eventually manage badge definitions through UI?~~ Out of scope
   for v1; revisit only if seeded definitions prove insufficient.
2. ~~Should award notifications include APNs push?~~ Deferred to v2 follow-up
   (the iOS app already has push capability — the gap is server-side fan-out).
3. ~~Should badges be visible to all signed-in users?~~ Yes by default, gated by
   `SystemConfig["badges.peerVisible"]`. Staff can flip without code changes.

---

## Changelog

- v4 (2026-05-09): Closed schema gaps (typed streak enum, hot-path indexes,
  `note`, `lastSourceKey`, `SystemConfig["badges.peerVisible"]`); enforced single-emit rule via
  status-flip helpers; tightened `safeCall` (fail loud in dev); pinned
  visibility, on-time grace, key immutability, notification channel; added
  observability indirection; expanded verification (lint, test, concurrency,
  flag-off snapshot, rollback drill).
- v3 (2026-04-27 → 2026-05-09): Kiosk-first event model; profile-tab UI;
  removed sidebar item; staff report under existing reports.
- v2: Removed cron and big-bang rollout; introduced sliced rollout.
- v1: Reverted PR #123.
