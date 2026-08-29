# Student Shift Calendar — Implementation Plan

## Context

UW Athletics currently uses Asana to schedule student/staff coverage for sporting events (Video, Photo, Graphics, Comms positions). Asana isn't built for shift scheduling, and the previous tool (WhenToWork) got too expensive. This feature brings shift scheduling into Wisconsin Creative — auto-generating shifts from synced calendar events, supporting hybrid assignment (staff picks from sport-specific student pools + student self-request for premier events), and providing a shared calendar view for everyone.

## Data Model

### New Enums

```prisma
enum ShiftArea {
  VIDEO
  PHOTO
  GRAPHICS
  COMMS
}

enum ShiftWorkerType {
  FT   // Full-time staff
  ST   // Student
}

enum ShiftAssignmentStatus {
  DIRECT_ASSIGNED  // Staff manually assigned
  REQUESTED        // Student requested (pending approval)
  APPROVED         // Staff approved a request
  DECLINED         // Staff declined a request
  SWAPPED          // Replaced by a swap
}
```

### New Models

**SportConfig** — Per-sport settings (one row per sport that has shift coverage):
- `id`, `sportCode` (unique), `active`, `createdAt`, `updatedAt`
- Relation to `SportShiftConfig[]` and `StudentSportAssignment[]`
- The central place for sport-level configuration in Settings

**SportShiftConfig** — Per-sport, per-area shift counts for home and away:
- `id`, `sportConfigId` (FK), `area` (ShiftArea), `homeCount` (Int), `awayCount` (Int)
- `@@unique([sportConfigId, area])`
- Example: Football → VIDEO: home=3, away=2 | PHOTO: home=2, away=1 | GRAPHICS: home=1, away=1 | COMMS: home=2, away=1
- Replaces the old ShiftTemplate concept with richer per-area counts + home/away distinction

**ShiftGroup** — 1:1 with CalendarEvent, container for shifts:
- `eventId` (unique FK → CalendarEvent), `isPremier` (enables student requests), `notes`, `generatedAt`, `manuallyEdited`
- Cascade delete from CalendarEvent

**Shift** — Individual position within a group:
- `shiftGroupId` (FK), `area`, `workerType`, `startsAt`, `endsAt`, `notes`
- Times default to event times but can be overridden (e.g., arrive 2h early)

**ShiftAssignment** — Links user to shift:
- `shiftId` (FK), `userId` (FK → User), `status`, `assignedBy` (FK → User), `swapFromId` (self-FK for swap chain), `notes`
- Multiple assignments per shift for swap history; only one non-terminal active

**StudentSportAssignment** — Maps students to their sports:
- `userId` (FK → User), `sportCode`
- `@@unique([userId, sportCode])`

**StudentAreaAssignment** — Maps students to their work areas (Video, Photo, etc.):
- `userId` (FK → User), `area` (ShiftArea), `isPrimary` (Boolean, default false)
- `@@unique([userId, area])`
- A student has one primary area (default assignments) + optional secondary areas (can pick up trades)
- Trade board filters by area: video students see video trades, etc.

**ShiftTrade** — A shift posted for trade on the trade board:
- `id`, `shiftAssignmentId` (FK → ShiftAssignment, the assignment being traded)
- `postedByUserId` (FK → User), `claimedByUserId` (FK → User, nullable)
- `status`: OPEN, CLAIMED, APPROVED, COMPLETED, CANCELLED
- `requiresApproval` (Boolean — derived from shift group's `isPremier` flag or configurable per trade)
- `postedAt`, `claimedAt`, `resolvedAt`, `notes`
- When claimed without approval needed → status goes OPEN → COMPLETED, swap executes immediately
- When claimed with approval needed → OPEN → CLAIMED → staff approves → COMPLETED

### User model additions (inline on existing user detail page)
- New fields on `User`: `phone` (String?), `primaryArea` (ShiftArea?), `secondaryAreas` stored via `StudentAreaAssignment`
- For student users, the user detail page (`/users/[id]`) shows inline:
  - **Contact info**: phone number (new field)
  - **Primary area**: single ShiftArea select
  - **Secondary areas**: multi-select checkboxes
  - **Assigned sports**: list with add/remove (synced from SportConfig roster)
- Staff/admin can edit these fields. Students can view their own.

### Relations added to existing models
- `User` gets: `shiftAssignments`, `shiftAssignedBy`, `sportAssignments`, `areaAssignments`, `tradesPosted`, `tradesClaimed`
- `CalendarEvent` gets: `shiftGroup`

## Reusable Components (from existing codebase)

| Component | File | Reuse For |
|-----------|------|-----------|
| `FilterChip` | `src/components/FilterChip.tsx` | Sport, area, status, date range filters |
| `EmptyState` | `src/components/EmptyState.tsx` | No-shifts views (has calendar icon) |
| `ConfirmDialog` | `src/components/ConfirmDialog.tsx` | Delete/cancel shift confirmations |
| `Toast` | `src/components/Toast.tsx` | Action feedback (assign, approve, etc.) |
| `Skeleton` / `SkeletonTable` | `src/components/Skeleton.tsx` | Loading states for calendar + list |
| `Modal` | `src/components/Modal.tsx` | User picker for assignments |
| `DataList` | `src/components/DataList.tsx` | Shift detail key-value pairs |
| `BookingDetailsSheet` pattern | `src/components/BookingDetailsSheet.tsx` | Slide-out shift detail panel |
| `BookingListPage` pattern | `src/components/BookingListPage.tsx` | Sortable table, mobile cards, context menu (⋮), filter bar |
| Calendar grid | `src/app/(app)/events/page.tsx` (lines 604-631) | Month grid: `calCells`, `calEventsByDay` map, 7-col CSS grid, overflow "+N more" |
| Status badges | CSS classes `.badge-green`, `.badge-orange`, `.badge-red` | Coverage indicators |
| Context menu | `BookingListPage.tsx` (lines 896-966) | Per-shift row actions |

## Service Layer

### `src/lib/services/shift-generation.ts`
- **`generateShiftsForEvent(eventId, actorUserId)`** — Loads `SportConfig` + `SportShiftConfig` for event's sportCode. Uses `isHome` flag to pick `homeCount` vs `awayCount` per area. Creates ShiftGroup + N Shifts per area in one transaction.
- **`generateShiftsForNewEvents(sourceId)`** — Post-sync hook: finds events without ShiftGroups, batch-generates shifts. Loads all sport configs once, creates in chunked `createMany` (~7 queries total, well within 50 subrequest limit)
- Skips events that already have a ShiftGroup (idempotent). Respects `manuallyEdited` flag.
- Hooks into `calendar-sync.ts` after sync completes

### `src/lib/services/shift-assignments.ts`
- `directAssignShift(shiftId, userId, actorUserId)` — Staff assigns
- `requestShift(shiftId, userId)` — Student requests (premier events only)
- `approveRequest(assignmentId, actorUserId)` / `declineRequest(...)`
- `initiateSwap(assignmentId, targetUserId, actorUserId)` — Marks old as SWAPPED, creates new
- All mutations use SERIALIZABLE transactions + audit logging (following `bookings.ts` pattern)

### `src/lib/services/sport-configs.ts`
- CRUD for sport configurations (shift counts per area for home/away)
- Roster management: add/remove users from sport, sync to `StudentSportAssignment`
- Query: `getConfigWithRoster(sportCode)`, `getAllConfigs()`, `updateShiftCounts(sportCode, area, homeCount, awayCount)`

### `src/lib/services/shift-trades.ts`
- `postTrade(shiftAssignmentId, userId)` — Student posts their assigned shift to the trade board. Creates ShiftTrade with OPEN status. Validates the user owns the assignment.
- `claimTrade(tradeId, userId)` — Another student (in the same area) claims. If `requiresApproval` → status CLAIMED. If not → status COMPLETED + swap executes immediately.
- `approveTrade(tradeId, actorUserId)` / `declineTrade(...)` — Staff approves/declines claimed trades. On approve → swap executes.
- `cancelTrade(tradeId, userId)` — Poster withdraws trade before it's claimed.
- Trade board query: filter by area (primary + secondary areas), status (OPEN only), date range. All students can see all shifts on the main schedule, but the trade board is area-filtered.

## API Routes

| Route | Methods | Access | Purpose |
|-------|---------|--------|---------|
| `/api/sport-configs` | GET, POST | ADMIN, STAFF | List all sport configs, create new |
| `/api/sport-configs/[sportCode]` | GET, PATCH | ADMIN, STAFF | Get/update sport config + shift counts per area |
| `/api/sport-configs/[sportCode]/roster` | GET, POST, DELETE | ADMIN, STAFF | Manage students/staff assigned to a sport (syncs to user profiles) |
| `/api/student-sports` | GET, POST, DELETE | ADMIN, STAFF (manage), STUDENT (view own) | Student-sport mapping |
| `/api/student-sports/bulk` | POST | ADMIN, STAFF | Bulk assign |
| `/api/shift-groups` | GET | ALL | List with coverage summary, filtered by date/sport/area |
| `/api/shift-groups/[id]` | GET, PATCH | ALL (view), STAFF (edit isPremier/notes) | Detail + update |
| `/api/shift-groups/[id]/regenerate` | POST | ADMIN, STAFF | Re-apply templates |
| `/api/shifts` | POST | ADMIN, STAFF | Add shift to group |
| `/api/shifts/[id]` | PATCH, DELETE | ADMIN, STAFF | Edit/remove shift |
| `/api/shift-assignments` | POST | ADMIN, STAFF | Direct assign |
| `/api/shift-assignments/request` | POST | STUDENT | Self-request |
| `/api/shift-assignments/[id]/approve` | PATCH | ADMIN, STAFF | Approve request |
| `/api/shift-assignments/[id]/decline` | PATCH | ADMIN, STAFF | Decline request |
| `/api/shift-assignments/[id]/swap` | POST | ALL | Initiate swap |
| `/api/shift-trades` | GET, POST | STUDENT (post own), ALL (view) | Trade board: list open trades (area-filtered for students), post a shift for trade |
| `/api/shift-trades/[id]/claim` | POST | STUDENT | Claim an open trade |
| `/api/shift-trades/[id]/approve` | PATCH | ADMIN, STAFF | Approve a claimed trade |
| `/api/shift-trades/[id]/decline` | PATCH | ADMIN, STAFF | Decline a claimed trade |
| `/api/shift-trades/[id]/cancel` | PATCH | STUDENT (owner) | Cancel own posted trade |
| `/api/student-areas` | GET, POST, DELETE | ADMIN, STAFF (manage), STUDENT (view own) | Student-area mapping (primary/secondary) |
| `/api/shifts/backfill` | POST | ADMIN | One-time backfill for existing future events |

## UI

### New top-level page: `/shifts` (`src/app/(app)/shifts/page.tsx`)

**Calendar View (Month):**
- Reuses calendar grid pattern from existing `/events` page
- Events show colored coverage dots: green (all filled), orange (partial), red (unfilled)
- Click event → shift detail panel

**List/Table View:**
- Rows grouped by event, sorted by date
- Columns: Event | Date | Video FT/ST | Photo FT/ST | Graphics FT/ST | Comms FT/ST
- Each cell shows assigned name or empty/requested badge
- Filter chips: sport, area, assignment status, date range

### `ShiftDetailPanel` component
- Slide-out panel (follows `BookingDetailsSheet.tsx` pattern)
- Event header + grid of positions (area × worker type)
- Staff: assign (user picker filtered by role + sport pool), approve/decline requests
- Student: request shift (premier events), initiate swap
- Shows equipment checkouts for same event alongside (no auto-link)

### Trade Board (`/shifts/trades` or tab within `/shifts`)
- Area-filtered view: students see trades only for their primary + secondary areas
- Each trade card shows: event name, date, area, worker type, posted by, time remaining
- "Claim" button → instant swap (no approval) or pending approval (premier events)
- Staff view shows all trades + pending approvals with approve/decline buttons
- Status badges: OPEN (green), CLAIMED/PENDING (yellow), COMPLETED (gray)

### Settings: Sports Configuration (`/settings/sports` or section in Settings)
- Lists all 23 sports (from `SPORT_CODES` in `src/lib/sports.ts`)
- Click a sport → expandable or detail panel showing:
  - **Shift counts grid**: 4 rows (Video, Photo, Graphics, Comms) × 2 columns (Home count, Away count). Number inputs.
  - **Roster**: Students and staff assigned to this sport. Add/remove with user picker. Changes sync bidirectionally to user profiles.
  - **Active toggle**: Enable/disable shift generation for this sport

### User detail page enhancements (`/users/[id]`)
- For STUDENT users, add inline section below existing info:
  - **Contact**: Phone number field
  - **Primary Area**: Single select (Video / Photo / Graphics / Comms)
  - **Secondary Areas**: Multi-checkbox (remaining areas)
  - **Assigned Sports**: Read from `StudentSportAssignment`, with links to sport config. Staff can add/remove here too (syncs to sport roster).

### Nav integration
- New "Schedule" item in Sidebar nav (`src/components/Sidebar.tsx`)
- Visible to all roles

## Hardening

### Concurrency & Data Integrity
- All assignment mutations wrapped in SERIALIZABLE transactions (following `src/lib/services/scans.ts:133-195` pattern)
- 409 Conflict response when shift already has active assignment (prevent double-booking)
- Validate shift doesn't overlap with user's existing shifts in same transaction
- Batch shift generation uses `WRITE_CHUNK_SIZE = 50` (matching `calendar-sync.ts:95`)

### Permissions (add to `src/lib/permissions.ts` PERMISSIONS map)
```typescript
shift: { view: [ADMIN, STAFF, STUDENT], create: [ADMIN, STAFF], edit: [ADMIN, STAFF], delete: [ADMIN, STAFF] }
shift_assignment: { view: [ALL], assign: [ADMIN, STAFF], request: [STUDENT], approve: [ADMIN, STAFF] }
sport_config: { view: [ADMIN, STAFF], manage: [ADMIN, STAFF] }
student_sport: { view: [ALL], manage: [ADMIN, STAFF] }
shift_trade: { view: [ALL], post: [STUDENT], claim: [STUDENT], approve: [ADMIN, STAFF] }
```

### Input Validation (Zod schemas in `src/lib/validation.ts`)
- All API inputs validated: `.cuid()` for IDs, `.nativeEnum()` for ShiftArea/ShiftWorkerType, `.max(5000)` on notes
- Date strings validated via existing `parseDateRange()` helper

### Audit Logging (following `src/lib/audit.ts` pattern)
- Every mutation: `createAuditEntry({ actorId, actorRole, entityType, entityId, action, before, after })`
- Actions: `shift_group_created`, `shift_assigned`, `shift_request_approved`, `shift_swapped`, etc.
- Actor role always included in `after` JSON (per D-001)

### Notifications (following `src/lib/services/notifications.ts` deduplication pattern)
- Trigger on: shift assignment, request approved/declined, swap completed
- Deduplication key: `${shiftId}:${action_type}`
- Channel: IN_APP (email deferred to Phase B per GAPS_AND_RISKS.md)

### Cascade Rules
- CalendarEvent delete → cascades to ShiftGroup → cascades to Shifts → cascades to ShiftAssignments
- User delete → cascades to StudentSportAssignment; ShiftAssignment.userId set to null (preserve history)
- Template delete → no cascade (existing shifts unaffected)

### Edge Runtime Safety
- All services use edge-compatible APIs only (no `fs`, `crypto` Node APIs)
- `export const runtime = "edge"` on all route files
- All DB operations batched within 50 subrequest limit

## UI Considerations

### Mobile
- List view uses mobile card layout (`.booking-mobile-list` pattern from `BookingListPage.tsx`)
- Calendar view shows "switch to list view" hint on small screens (existing pattern in events page)
- Shift detail panel is full-screen on mobile (following `BookingDetailsSheet` responsive behavior)
- No new bottom nav item (5-item limit already reached) — access via sidebar "Schedule"

### Loading & Empty States
- `SkeletonTable` while shift list loads; skeleton grid while calendar loads
- `EmptyState` with calendar icon + "Configure shift templates" CTA when no templates exist
- `EmptyState` with "No shifts for this period" when filters return empty

### Interactions
- Context menu (⋮) on each shift row: View details, Assign, Mark premier, Delete
- Sort headers on all list columns (following `BookingListPage` `.sort-header` pattern)
- Sticky filter bar at top of list view
- Click-to-assign: clicking empty assignment cell opens user picker directly
- Color-coded assignment cells: green (filled), yellow (requested/pending), gray (empty)

### Calendar View Specifics
- Multi-day events span across day cells (following existing event calendar behavior)
- Day cells show max 3 events with "+N more" overflow
- Coverage indicator dots next to each event: green/orange/red
- "Today" highlighting + month navigation (prev/next/today buttons)

## Thin Slice Plan

| Slice | Scope | Deliverable | Testable? |
|-------|-------|-------------|-----------|
| 1 | Schema + migration | New tables, enums, relations, User.phone field. Clean build. | `prisma db push` + `npm run build` |
| 2 | Sport config API + settings UI | Admin configures per-area home/away shift counts per sport | Set counts via settings UI |
| 3 | Sport roster + user profile enhancements | Assign students/staff to sports from sport config OR user detail page (bidirectional sync). Student area assignment (primary + secondary). Contact info. | Assign via either page → reflected on both |
| 4 | Shift generation + sync hook | Shifts auto-generate on ICS sync | Sync calendar → verify shifts created |
| 5 | Assignment API | Staff assign, student request, approve/decline, swap | API-level CRUD |
| 6 | Shifts calendar UI (calendar + list) | Everyone sees shift calendar | Navigate /shifts, see data |
| 7 | Shift detail panel + staff assignment UI | Staff manages shifts from UI | Click event → assign users |
| 8 | Request + swap workflow UI | Student self-service for premier events | Student requests → staff approves |
| 9 | Student-area mapping + trade board API | Students assigned to areas, trade service | Post trade → claim → approve via API |
| 10 | Trade board UI | Area-filtered trade board for students, approval UI for staff | Student posts shift → another claims → staff approves |
| 11 | Event detail enhancement + polish | Shifts visible on event detail page, mobile pass | End-to-end flow |
| 12 | Hardening | Audit logs, cascades, batch optimization, notifications | Full regression |

## Migration Strategy

- **Backfill**: Admin-only `POST /api/shifts/backfill` generates shifts for future events (`startsAt >= now()`) that have sportCode + matching templates
- **Ongoing**: After Slice 4, new events auto-generate during ICS sync
- **Past events**: No backfill (forward-looking only)
- **Events without sportCode**: Appear in calendar without shifts; staff can manually create
- **Template changes post-generation**: Existing shifts preserved. "Regenerate" adds missing positions only, doesn't remove assigned ones.

## Key Files to Modify

- `prisma/schema.prisma` — New models/enums/relations
- `src/lib/services/calendar-sync.ts` — Hook shift generation post-sync (~line 546)
- `src/lib/permissions.ts` — New permission entries for shift resources
- `src/lib/validation.ts` — New Zod schemas for shift inputs
- `src/components/Sidebar.tsx` — Add "Schedule" nav item (line ~30, nav items array)
- `src/app/(app)/events/page.tsx` — Reference pattern for calendar grid UI
- `src/app/(app)/events/[id]/page.tsx` — Add shift coverage section to event detail
- `src/app/(app)/users/[id]/page.tsx` — Add inline scheduling section (contact, area, sports) for student users
- `src/app/(app)/settings/page.tsx` — Add Sports Configuration section

### New Files to Create

- `src/lib/services/shift-generation.ts` — Shift auto-generation from events
- `src/lib/services/shift-assignments.ts` — Assignment CRUD + swap logic
- `src/lib/services/sport-configs.ts` — Sport configuration + roster management
- `src/lib/services/shift-trades.ts` — Trade board service
- `src/app/(app)/shifts/page.tsx` — Main schedule page (calendar + list)
- `src/components/ShiftDetailPanel.tsx` — Shift detail slide-out
- `src/app/api/sport-configs/route.ts` — Sport config list + create API
- `src/app/api/sport-configs/[sportCode]/route.ts` — Sport config detail + update API
- `src/app/api/sport-configs/[sportCode]/roster/route.ts` — Sport roster API
- `src/app/api/shift-groups/route.ts` — Shift group API
- `src/app/api/shift-groups/[id]/route.ts` — Shift group detail API
- `src/app/api/shift-groups/[id]/regenerate/route.ts` — Regenerate API
- `src/app/api/shifts/route.ts` — Shift CRUD API
- `src/app/api/shifts/[id]/route.ts` — Individual shift API
- `src/app/api/shift-assignments/route.ts` — Assignment API
- `src/app/api/shift-assignments/request/route.ts` — Student request API
- `src/app/api/shift-assignments/[id]/approve/route.ts` — Approve API
- `src/app/api/shift-assignments/[id]/decline/route.ts` — Decline API
- `src/app/api/shift-assignments/[id]/swap/route.ts` — Swap API
- `src/lib/services/shift-trades.ts` — Trade board service
- `src/app/api/student-sports/route.ts` — Student-sport mapping API
- `src/app/api/student-sports/bulk/route.ts` — Bulk assignment API
- `src/app/api/student-areas/route.ts` — Student-area mapping API
- `src/app/api/shift-trades/route.ts` — Trade board list + post API
- `src/app/api/shift-trades/[id]/claim/route.ts` — Claim trade API
- `src/app/api/shift-trades/[id]/approve/route.ts` — Approve trade API
- `src/app/api/shift-trades/[id]/decline/route.ts` — Decline trade API
- `src/app/api/shift-trades/[id]/cancel/route.ts` — Cancel trade API
- `src/app/api/shifts/backfill/route.ts` — One-time backfill API

## Verification

1. Configure templates for 2+ sports via settings UI
2. Assign students to those sports
3. Trigger ICS sync → verify shifts auto-generated with correct positions
4. Staff assigns student from pool via shift detail panel
5. Mark event as premier → student requests shift → staff approves
6. Student initiates swap → verify assignment chain
7. Calendar view shows correct coverage indicators
8. Student posts assigned shift to trade board → appears for students in same area only
9. Another student (same area) claims trade → instant swap (non-premier) or pending approval (premier)
10. Staff approves pending trade → swap executes, both students notified
11. `npm run build` passes at every slice
12. All mutations produce audit log entries
