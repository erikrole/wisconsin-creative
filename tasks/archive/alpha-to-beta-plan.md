# Alpha → Beta Release Plan

## Document Control
- Date: 2026-03-27
- Status: Active
- Branch: `claude/alpha-to-beta-release-0o5yo`

---

## What "Beta" Means

Wisconsin Creative moves from Alpha (feature buildout, rapid iteration, frequent breaking changes) to Beta (stable core, hardened workflows, ready for daily operational use by Wisconsin Athletics Creative).

### Beta Criteria — All Met
- [x] All P0 bugs resolved (dashboard filter, importer lossless, settings auth guard, notification icons, cron schedule)
- [x] All core workflows hardened (checkout, check-in, reservation, scan, dashboard, schedule, items, users)
- [x] Consistent patterns across all pages (shared hooks, AbortController, error differentiation, skeletons)
- [x] Security audit complete (SERIALIZABLE transactions, privilege escalation blocked, TOCTOU fixed, audit logging on all mutations)
- [x] Mobile-first validated (44px+ tap targets, iOS fixes, role-adaptive dashboard, scan permissions UX)
- [x] shadcn/ui design system fully adopted (42 components, zero custom primitives)
- [x] Documentation in sync with shipped code (AREA_*.md, DECISIONS.md, GAPS_AND_RISKS.md)

---

## Slices

### Slice 1: Doc Sync
- [x] Close stale gaps in GAPS_AND_RISKS.md (GAP-24, 25, 26 already shipped)
- [x] Update NORTH_STAR.md Phase B to reflect shipped items
- [x] Update system-roadmap.md with Beta milestone

### Slice 2: Version & Changelog
- [x] Bump package.json version 0.1.0 → 0.2.0
- [x] Create CHANGELOG.md with Beta release notes
- [x] Update todo.md with Beta context

### Slice 3: Verify & Ship
- [x] Run `npm run build` — clean compilation required
- [x] Commit and push to branch

---

## What's NOT in Beta (deferred)

### Remaining V2 Items (post-Beta polish)
- Inline dashboard actions (extend/checkin on overdue rows)
- Cross-page state awareness (eventId propagation, scroll preservation)
- Student availability tracking (new schema)
- Shift email notifications (extends Resend)

### V3 Items (future releases)
- React Query migration
- Game-Day Mode
- Unified Search V2
- Automation (auto-generate bookings, bulk check-in)
- Operational Intelligence (usage analytics, health scoring)

---

## Change Log
- 2026-03-27: Plan created for Alpha → Beta transition
