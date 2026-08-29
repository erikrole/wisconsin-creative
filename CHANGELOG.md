# Changelog

All notable changes to Wisconsin Creative are documented here.

Versioning: [CalVer](https://calver.org/) — `YYYY.MM.DD.N` (N = build number that day).

---

## 2026.03.27.1 — Beta Release

The first official Beta release. Wisconsin Creative is ready for daily operational use by Wisconsin Athletics Creative.

### What's New

**Core Workflows (Phase A — shipped)**
- Serialized asset reservations and checkouts with QR scan enforcement
- Bulk inventory pools with optional numbered unit tracking for loss detection
- Partial check-in with automatic booking state transitions
- Equipment guidance rules (body-needs-batteries, lens-needs-body, audio-with-video)
- Draft bookings with auto-save on cancel and dashboard resume

**Dashboard & Navigation**
- Role-adaptive dashboard: students see "My Gear" only; staff see global ops
- Sport and location filter chips with saved views
- Overdue banner with count and top items
- Command palette (Cmd+K) with type-to-search, "who has my gear," recent searches
- Sidebar notification badges (overdue checkouts, unread notifications)

**Scheduling & Events**
- ICS calendar sync with daily cron (6 AM UTC) and manual refresh
- Unified schedule page merging events + shifts
- Auto-shift generation from sport configs
- Shift trade board with area eligibility enforcement
- Event Command Center with missing gear detection

**Inventory & Kits**
- DataTable with sorting, filtering, column visibility, and 9-field search
- Kit management: CRUD, member management, derived availability
- Kit-to-booking integration (kit selector in checkout creation, kit badge on detail)
- Parent-child accessory relationships
- CSV importer with Cheqroom preset, dry-run preview, and lossless parsing

**Notifications & Escalation**
- In-app + email dual-channel (Resend)
- 4-stage escalation: -4h warning, 0h due, +2h overdue, +24h admin escalation
- Admin-configurable fatigue controls and dedup
- Overdue nudge button for staff

**Reports**
- 5 report types: checkouts, overdue, utilization, audit, scans
- Charts: utilization donut, checkout trends, overdue bars
- Drill-down links from metrics to filtered lists
- URL-persisted filters and data freshness indicator

**Search**
- Debounced auto-search across assets, checkouts, reservations, users
- Recent searches in localStorage
- "Who has my gear" in Cmd+K

**Users & Security**
- Tiered RBAC: ADMIN > STAFF > STUDENT with inheritance
- SERIALIZABLE transactions on all booking mutations
- PostgreSQL exclusion constraints for overlap prevention
- Audit logging on all mutations with actor, diff, and timestamp
- Privilege escalation prevention (STAFF cannot edit ADMIN profiles)

**Mobile**
- 44px+ tap targets, iOS input zoom prevention, overscroll fix
- Role-adaptive actions (students see only their work)
- Camera permission UX with specific instructions on denial

**Design System**
- Full shadcn/ui adoption (42 components)
- Dark mode support throughout
- High-fidelity skeleton loading on all pages
- Error differentiation (network vs server) with retry

**Infrastructure**
- React Query for cross-page data caching
- Shared hooks: `useFetch`, `useUrlState`, `useFormSubmit`, `useScanSession`, `useScheduleData`
- AbortController + Page Visibility API refresh on all pages
- Vercel deployment with Neon serverless PostgreSQL
- Sentry error tracking (optional)
- Vercel Blob for image uploads

### Architecture
- 34 pages, 110+ API routes, 33 Prisma models
- 27 architectural decisions (D-001 through D-027)
- All pages hardened (5-pass audit on critical paths)
- Zero P0 bugs remaining

### What's Next (Post-Beta)
- Student availability tracking
- Shift email notifications
- Inline dashboard actions (extend/checkin without navigation)
- Game-Day Mode (readiness score, time-of-day adaptation)
