# Audit: / (dashboard, web) — 2026-04-24

**MVP verdict:** READY — 0 P0, all P1 addressed (2026-04-24)
**Ship bar:** all staff + students, zero hiccups

## P0 — blocks MVP
_None._ Dashboard has been through V2/V3 polish, BRK-001..004 stress tests, and React Query migration. Auth and RBAC are solid (every API uses `withAuth`; `nudge` uses `requireBookingAction("nudge")` which gates STAFF+).

## P1 — polish before ship
- [x] [Hardening] No rate limit on `/api/dashboard` (heavy multi-query) or `/api/dashboard/stats` — `src/app/api/dashboard/route.ts:64`, `src/app/api/dashboard/stats/route.ts:9`
      Why: With every staff/student logged in, a tab left open polls stats every 60s; a misbehaving client or stuck refetch could thrash the DB. Full payload runs 10+ queries + a heavy raw-SQL aggregation. Same gap we just closed on licenses.
      Suggested fix: Per-user limiter — `dashboard:full:<userId>` (e.g. 30/min) and `dashboard:stats:<userId>` (e.g. 90/min) using the existing `checkRateLimit` helper.

- [x] [Hardening] No rate limit on `/api/bookings/[id]/nudge` — `src/app/api/bookings/[id]/nudge/route.ts:7`
      Why: Nudge writes a notification AND will eventually push (today the dedupe key throttles to once-per-hour-per-booking, but a staff member can still hit the endpoint in a tight loop, and as soon as push integration extends here it becomes spammable). Limit per-user to a few per minute.
      Suggested fix: `checkRateLimit('nudge:<userId>', { max: 30, windowMs: 60_000 })`.

- [x] [Flows] `isStudent` flicker — admin/staff buttons flash for students on warm cache load — `src/app/(app)/page.tsx:188, 216-221`
      Why: On a return visit with only `liveStats` cached, `data` is null until the full payload arrives, so `isStudent = data?.role === "STUDENT"` is false → "New checkout" and "New reservation" buttons render for what may actually be a student. RBAC is server-enforced so it's not a security bug, but the buttons appear-then-disappear which is exactly the kind of jank a teacher would screenshot. Same `isStudent` value gates the right column too.
      Suggested fix: Cache `role` separately (e.g. localStorage on first successful load, or include in the stats endpoint payload — the stats endpoint already runs auth so adding `role` is free) and use it as the early-render source. Until role is known, render neither the staff buttons nor the team column — show a thin placeholder/spacer instead.

- [x] [Flows] Overdue banner row uses nested interactive elements (button > link + button) — `src/app/(app)/dashboard/overdue-banner.tsx:86-156`
      Why: Each overdue row is `<button onClick=onSelectBooking>` containing inner `<Link>` (Check in) and `<Button>` (Nudge). Nested clickables break keyboard tab order, confuse screen readers, and HTML spec disallows interactive content inside `<button>`. Browsers swallow inner clicks via the `e.stopPropagation()` workaround already in place — fragile.
      Suggested fix: Make the row a `<div role="button" tabIndex={0}>` with onKeyDown for Enter/Space, OR move inline actions to a hover-revealed row affordance outside the button (matches MyGearColumn pattern).

## P2 — post-MVP
- [ ] [Flows] Dead branch in `handleExtend` — `src/app/(app)/page.tsx:122-124` builds `/api/reservations/${id}/extend` if `booking.kind === "RESERVATION"`, but no such route exists (only `/api/bookings/[id]/extend`). Dashboard never invokes Extend on reservations today, so this is dead but a footgun for whoever next wires reservation-extend.
- [ ] [Flows] When stats happen to be all-zero on a returning user, the first-run "Welcome to Wisconsin Creative" banner can flash before the full payload reveals real activity — `page.tsx:189-195`. Cosmetic.
- [ ] [Parity] iOS dashboard exists but does not yet expose nudge / extend / convert inline actions — covered by `audit-page-ios dashboard` later.
- [ ] [UI] `OverdueBanner` and `MyGearColumn` row strings concatenate inline (`requesterName – itemCount items`) — fine, but no consistent locale-aware separator. Cosmetic.

## Acceptance criteria status (from docs/AREA_DASHBOARD.md:130-139)
- [x] AC-1 Reach checkout/reservation action in one click — proven by `MyGearColumn` row click → BookingDetailsSheet, hover Extend/Convert
- [x] AC-2 Overdue banner and overdue list counts consistent — both derived from same `total_overdue` raw SQL count in `dashboard/route.ts:99` and `dashboard/stats/route.ts:33`
- [x] AC-3 Lanes show max 5 + View all — `take: 5` on every lane query, "View all N →" link below
- [x] AC-4 Reservations within 7 days — enforced in count and lane queries (`startsAt: { gte: now, lte: sevenDaysFromNow }`) at `dashboard/route.ts:106, 146, 189`
- [x] AC-5 Permission-restricted actions hidden — `canAction={!isStudent}` on banner, `isStaff` gate on team column inline buttons (note P1 #3: hidden in UI but UI flickers on cold load)
- [x] AC-6 Drafts resumable — `drafts` map + `Continue` link with `?draftId=` param at `my-gear-column.tsx:262`
- [x] AC-7 Refresh failures preserve visible data — `useDashboardData` toast on error, no replace
- [x] AC-8 AbortController on fetch — `useQuery` with `AbortSignal` via `queryFn`
- [x] AC-9 Optimistic draft delete with rollback — `page.tsx:90-104`
- [x] AC-10 "Updated X ago" tooltip — `page.tsx:213`

## Lenses checked
- [x] Gaps
- [x] Flows
- [x] UI polish
- [x] Hardening
- [x] Breaking
- [x] Parity (informational)

## Files read
- docs/AREA_DASHBOARD.md
- prisma/schema.prisma (booking models referenced earlier this session)
- src/app/(app)/page.tsx
- src/app/(app)/dashboard/overdue-banner.tsx
- src/app/(app)/dashboard/my-gear-column.tsx
- src/app/(app)/dashboard/team-activity-column.tsx
- src/app/api/dashboard/route.ts
- src/app/api/dashboard/stats/route.ts
- src/app/api/bookings/[id]/nudge/route.ts
- src/hooks/use-dashboard-data.ts (top half)

## Notes
- Page is in much better shape than licenses was. P1 set is short and tightly scoped.
- shadcn coverage is good — Card, Badge, Button, Tooltip, ToggleGroup, DropdownMenu all in use. No custom primitives needing replacement.
- Spacing/breathing room is consistent across the page; no obvious density regressions.
- shadcn migration (2026-03-22) and CSS variable cleanup (2026-04-09) already addressed most polish-tier debt.
- `useDashboardData` already has 401 → /login redirect + error classification, which is the v2-quality this skill normally flags as missing.
