# Smart Notifications Plan - 2026-06-12

## Goal
- Turn notifications into a role-aware operational layer for shifts, schedule changes, gear, pickup windows, returns, badges, trade board activity, licenses, and admin health.
- Avoid notification spam by requiring every trigger to have a source entity, recipient policy, channel policy, dedupe key, deep link, and expiry or suppression rule.
- Identify missing notification families before adding more one-off triggers.

## Source Checks
- `docs/AREA_NOTIFICATIONS.md`: notifications are action triggers, not passive info. Existing coverage includes checkout due/overdue escalation, reservation lifecycle, shift trade lifecycle, shift schedule changes, badge awards, native push delivery, calendar sync health, firmware releases, and per-user notification settings.
- `docs/AREA_SHIFTS.md`: Schedule owns assignments, call windows, availability conflicts, trade board state, schedule readiness, and My Shifts. Smart notifications should treat schedule changes as batchable operational deltas.
- `docs/AREA_CHECKOUTS.md`: `PENDING_PICKUP` checkouts expire after 48 hours past start, `OPEN` checkouts drive due/overdue behavior, and staff/admin can manually nudge borrowers.
- `docs/AREA_BADGES.md`: badge notifications exist for manual awards, but badges must remain evidence-backed and should not produce shame-based rankings or fake progress.
- `docs/AREA_LICENSES.md`: license rotation nags and expiry warnings already ship through daily notification cron.
- `docs/AREA_MOBILE.md`: iOS Home is action-first, iOS Schedule is first-class, and shift push tap-through exists. Smart notifications should preserve native routing context.
- `prisma/schema.prisma`: `Notification`, `DeviceToken`, and `User.notificationPrefs` provide current delivery state. `Booking`, `ShiftAssignment`, `ShiftTrade`, `LicenseCode`, and `StudentBadge` provide source entities for existing triggers.
- `src/lib/services/notifications.ts`: checkout escalation, shift gear-up, shift schedule changes, reservation lifecycle, check-in item report, and low-stock notifications already exist with varying channel and preference coverage.
- `src/lib/services/licenses.ts`: license expiry warnings and 2-day student license nags already exist.
- `src/app/api/notifications/nudge/route.ts`: staff/admin gear-up nudges already enforce actor, assignment, and recipient rate limits.

## Product Model

Working name: **Smart Alerts**.

Principles:
- In-app is the durable inbox. Push and email are delivery channels that respect preferences, categories, and future quiet hours.
- Every alert needs a reason a user can act on or trust: assigned, changed, due, expiring, claimed, approved, blocked, unhealthy, or ready.
- Every alert needs a destination: booking detail, event sheet, shift assignment, trade, license row, badge profile, checkout wizard, or admin queue.
- Alerts should be role-aware. Students get personal next actions. Staff/admin get exceptions, queues, and system health.
- Batch where humans experience the work as a batch, especially schedule posting and multi-shift edits.
- Do not use notification records as source-of-truth counts. Notifications explain and route; domain tables own state.

## User-Listed Families

### Shift Assignments
- Current state: direct assignment and approval notifications already exist.
- Needed next: batch assignment digest when a whole schedule is posted, plus a clear delta summary when multiple shifts change at once.

### Shift Modifications
- Current state: shift time and personal call-time changes already notify assigned users.
- Needed next: broader change taxonomy for location, role/area, event cancellation, source event reschedule, assignment moved to another slot, and notes that change operational expectations.

### Call Time Nudges
- Current state: call-time changes notify, and staff/admin can send a gear-up nudge for active future assignments.
- Needed next: proactive reminders such as 24 hours, 4 hours, 1 hour, and at call time, with suppression if the shift was recently changed or the user already opened/acknowledged the shift.

### Gear Return Nudges
- Current state: due/overdue checkout escalation exists, and manual borrower nudge exists.
- Needed next: smarter copy and priority when the gear is needed by another checkout, shift, or event soon. The alert should say why the return matters when that reason is safe to show.

### Badges
- Current state: manual badge awards create persistent in-app notifications.
- Needed next: optional push/email category support, badge-streak-at-risk nudges tied to real obligations, and staff award prompts after clean handoffs or clutch coverage.

### Trade Board
- Current state: claimed, completed, approved, and declined trade notifications already exist.
- Needed next: open-trade coverage risk, expiring trade posts before call time, nearby eligible replacement alerts, and staff/admin digest for stale or high-risk trades.

### Schedules Posted
- Current state: individual assignment notifications exist, but there is no single "your schedule is posted" product layer.
- Needed next: schedule published notifications for new visible windows, batch summaries by week, and admin/staff confirmation when a generated schedule has unresolved coverage gaps.

### Licenses
- Current state: 2-day student rotation nag and admin/staff expiry warnings exist.
- Needed next: license health digest, bulk-renew reminder, and optional notification when a slot becomes available for users who recently tried to claim one.

### Pickup Expiry
- Current state: pending-pickup checkout auto-expiry exists.
- Needed next: pre-expiry warning before the 48-hour cancellation, post-expiry explanation, and staff/admin digest for repeat or high-value expired pickups.

## Missing Notification Families

1. **Pre-shift reminders**: tomorrow, same-day, one-hour, and call-time reminders, ideally with local iOS support once widgets and cached shift snapshots exist.
2. **Schedule publish and delta digest**: "next week is posted" and "three of your shifts changed" instead of a burst of individual alerts.
3. **Calendar trust alerts**: student-facing warning when their Apple Calendar subscription may be stale, token was rotated, or upcoming shift count differs from Wisconsin Creative.
4. **Gear readiness for shifts**: no gear reserved for an upcoming shift, gear ready for pickup before call time, or gear still pending pickup close to call time.
5. **Return urgency tied to next use**: gear due soon because another event, person, or checkout needs it next.
6. **Pickup expiry warning**: 24-hour and 4-hour warnings before pending-pickup cancellation.
7. **Approval queue reminders**: guest requests, trade approvals, schedule requests, and future custody/football-owned acknowledgements sitting too long.
8. **Conflict and coverage alerts**: assignment created over availability, unfilled staff-needed slots, open trade near call time, or student removed from a shift that now needs coverage.
9. **Damage, lost, and repair workflow**: item reports already notify supervisors, but repair status, item returned from repair, and replacement-needed alerts are separate opportunities.
10. **Low stock and consumables**: low-stock alerts exist in code; add preference/category coverage, digesting, and reorder context.
11. **Firmware and device lifecycle**: firmware releases exist. Future device lifecycle adds warranty expiry, AppleCare, OS/security review, and replacement-cycle alerts.
12. **Custody review**: once direct custody ships, alert for overdue review dates, assigned gear on inactive users, and semester possession checks.
13. **Graduation/offboarding**: once Student Lifecycle ships, alert for graduating users with open gear, shifts, licenses, guest sponsorship, or allowed-email access.
14. **Guest request lifecycle**: submitted, more-info requested, approved, declined, converted, pickup ready, and return due for external partner requests.
15. **Football-owned gear guidance**: warning acknowledgement, repeated football-owned requests, and staff digest for patterns. Do not block unless a separate policy decision says so.
16. **Notification health**: push token revoked, email disabled, user muted a category, or admin system delivery failures.
17. **Resource or training requirement changes**: only if a resource becomes required for an operational flow. Do not notify for ordinary guide edits.
18. **Wrapped data health**: season recap readiness, missing telemetry, unclosed checkouts, and suspicious gaps before the June recap generation window.

## Thin Slice Order
- [ ] Slice 1: Notification taxonomy and delivery contract. Define type, source entity, actor, recipient, urgency, category, channel policy, dedupe key, deep link, expiry, and suppression.
- [ ] Slice 2: Preference matrix and quiet-hours/snooze design. Expand categories beyond checkout/reservation/license without breaking current defaults.
- [ ] Slice 3: Shift and schedule smart alerts. Add schedule-posted digest, assignment delta digest, and proactive call-time reminders.
- [ ] Slice 4: Gear pickup and return intelligence. Add pickup-expiry pre-warning and next-use return urgency.
- [ ] Slice 5: Trade board and approval queue reminders. Cover open trades near call time and stale approval queues.
- [ ] Slice 6: Badge and accountability nudges. Add evidence-backed streak-at-risk and optional badge delivery channels.
- [ ] Slice 7: Admin health digest. Roll up calendar health, licenses, firmware, low stock, damage/lost reports, and pending approvals.
- [ ] Slice 8: Future-roadmap hooks. Wire guest requests, direct custody, football-owned guidance, graduation/offboarding, device lifecycle, and Wrapped readiness after those slices exist.
- [ ] Slice 9: iOS notification polish. Standardize payloads, tap-through, local reminders where appropriate, and Widget/Home snapshot alignment.

## Verification
- [ ] Unit tests for each new notification type's recipient policy, dedupe key, payload, category, and deep link.
- [ ] Preference tests proving email/push respect category settings while in-app rows still create durable history.
- [ ] Quiet-hours/snooze tests once that layer exists.
- [ ] Batch/digest tests proving schedule posting does not create push storms.
- [ ] Role tests proving student alerts do not expose admin-only inventory, partner, or system-health data.
- [ ] Cron tests for bounded reads, idempotency, and partial-failure reporting.
- [ ] iOS tap-through tests for every new push payload family.
- [ ] `npx tsc --noEmit`.
- [ ] `git diff --check`.
- [ ] `npm run build` before any commit that ships functionality.

## Stop Conditions
- Stop if a notification lacks a source entity, dedupe key, recipient rule, category, and deep link.
- Stop if a new push/email path bypasses `notificationPrefs` or future quiet-hours logic.
- Stop if a notification query is unbounded, N+1-heavy, or depends on scanning all users without a narrow window.
- Stop if schedule publication creates one push per assignment instead of a digest when many shifts are created at once.
- Stop if negative badge/accountability alerts become public ranking or shame mechanics.
- Stop if guest, football-owned, or offboarding notifications reveal internal details to people who should not see them.

## Open Decisions
- How granular should notification categories be? Recommendation: start with domain categories (`shifts`, `gear`, `badges`, `licenses`, `adminHealth`) and add subpreferences only after usage proves a need.
- Should call-time reminders be server push, local iOS notifications, or both? Recommendation: server-driven initially, then local reminders for cached shift snapshots.
- Should schedule-posted notifications be sent immediately or at a configured summary time? Recommendation: immediate in-app row plus one push/email digest per publish operation.
- Should users be able to acknowledge critical alerts? Recommendation: add acknowledgement only for high-signal alerts like call-time changes, pickup expiry, and offboarding/custody tasks.

## Review
- Logged only. No implementation shipped.
- The strongest missing piece is not another one-off notification. It is a notification taxonomy and delivery contract that existing triggers can migrate toward.
- Near-term implementation should start with schedule-posted digest and pickup-expiry pre-warning because both map cleanly to known user pain and existing source entities.
