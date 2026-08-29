# Feature Brief: Shift Scheduling Redesign V2

## 1) Feature Header
- Feature name: Shift Scheduling Redesign (WhenToWork Replacement)
- Owner: Wisconsin Athletics Creative Product
- Date: 2026-03-26
- Priority: `High`
- Target phase: `Now`

## 2) Problem
- **Current pain:** The shift scheduling system works but is rigid and impractical for daily operations. Shifts auto-generate from sport config templates (fixed home/away counts per area), but no two events are the same. Staff need to manually add or remove shifts per event. Assignment is restricted to sport rosters, but in practice any student or full-time staff member can be assigned to any event. The current assignment UI (a text-searchable user list in ShiftDetailPanel) is slow — staff want an avatar-based, visual process for adding/removing people from shifts.
- **Why now:** The team previously used WhenToWork (scheduling app) but dropped it due to cost. Wisconsin Creative's shift system was built to replace it but stopped at "functional" — not "fast and pleasant." This is the #1 daily friction point for the scheduling coordinator.
- **Who is blocked:** Full-time staff who coordinate shift schedules across 10+ events per week. Students who need clear shift visibility and easy trade workflows.

## 3) Outcome
- **Expected behavior after release:** Staff can visually assign any user to any shift on an event using an avatar-based picker. Shifts can be added or removed per-event without touching sport config templates. The trade board remains the mechanism for shift swaps. The schedule page feels like a proper shift management tool, not just a calendar overlay.
- **Success signal:** Time to fully staff a 4-shift event drops from ~3 minutes (current: search + assign × 4) to under 30 seconds (click avatars).

## 4) Scope

### In scope
- **Per-event shift editing**: Add/remove individual shifts from any event's ShiftGroup (not locked to sport config template)
- **Universal user assignment**: Any active user (student or staff) can be assigned to any shift, regardless of sport roster
- **Avatar-based assignment UI**: Visual user picker with avatar grid — click to assign, click to remove
- **Quick-add shift controls**: "+Shift" buttons per area (VIDEO, PHOTO, GRAPHICS, COMMS) on the ShiftDetailPanel. All areas are optional — no shift or area is required for any event.
- **Per-shift removal**: Delete individual shifts from a ShiftGroup (with cascade to assignments)
- **Trade board integration**: "Post to trade board" action accessible from the assignment UI
- **`manuallyEdited` flag**: When staff edits shifts on a ShiftGroup, flag it so auto-generation doesn't overwrite on next sync

### Out of scope
- Student availability/unavailability calendar (Phase B deferred)
- Shift email notifications (Phase B deferred — in-app only for V2)
- Game-Day Readiness Score (Phase C)
- Shift templates / saved shift presets
- Recurring shift patterns (weekly schedules)
- Time-clock / hours tracking
- Bulk assignment across multiple events

## 5) Guardrails (Project Invariants)
- Asset status is derived from active allocations, never authoritative stored status.
- Keep booking integrity protections intact (SERIALIZABLE + overlap prevention).
- Preserve audit logging coverage for new mutation paths.
- Maintain mobile-first usability and clear student flows.
- Do not rewrite booking engine unless explicitly approved.
- **Shift-specific:** Preserve existing auto-generation from ICS sync — it remains the default for new events. Manual edits override but don't disable the pipeline.
- **Shift-specific:** ShiftAssignment status flow (DIRECT_ASSIGNED → active, REQUESTED → APPROVED/DECLINED) remains unchanged.

## 6) Affected Areas
- Domain area: `Events | Shifts`
- User roles affected: ADMIN, STAFF (primary), STUDENT (secondary — visibility + trade)
- Location impact: `Mixed` — all venues

## 7) Data and API Impact (High-Level)

### Data model impact
- **No new models needed.** Existing schema supports everything:
  - `ShiftGroup.manuallyEdited` (Boolean, already exists) — set to `true` when staff adds/removes shifts
  - `Shift` already supports create/delete per ShiftGroup
  - `ShiftAssignment` already supports any `userId` (no FK to sport roster — roster is a UI filter, not a DB constraint)
- **Potential addition:** Consider adding a `ShiftGroup.templateOverrides` JSON field to record which areas were manually adjusted (for diffing against sport config). Low priority.

### Read-path impact
- **User search API**: Existing `/api/users` endpoint already supports search. May need to add a lightweight `/api/users/avatars` endpoint that returns `{id, name, initials, avatarUrl, primaryArea}[]` for the picker (to avoid loading full user records).
- **ShiftDetailPanel data**: Already fetches full shift group detail. No changes needed.

### Write-path impact
- **New: POST `/api/shift-groups/[id]/shifts`** — Add a shift to an existing ShiftGroup (area, workerType, startsAt, endsAt). Sets `manuallyEdited = true`.
- **New: DELETE `/api/shift-groups/[groupId]/shifts/[shiftId]`** — Remove a shift. Cascades to assignments. Sets `manuallyEdited = true`.
- **Existing: POST `/api/shift-assignments`** — Remove sport roster validation. Currently validates user exists + no time conflict + no duplicate. Keep those. Drop any roster-membership check.
- **Existing: POST `/api/shift-assignments/[id]/swap`** — No changes needed.

### External integration impact
- **ICS sync (calendar-sync.ts):** Modify `generateShiftsForEvent()` to skip regeneration when `ShiftGroup.manuallyEdited === true`. Currently the function is idempotent (skips if ShiftGroup exists), so this is already safe — but worth explicit guarding.

## 8) UX Flow

### Flow A: Staff assigns users to an event (avatar-based)
1. Staff opens ShiftDetailPanel from schedule page (click coverage badge or event row)
2. Panel shows shift grid: areas as rows (VIDEO, PHOTO, GRAPHICS, COMMS), each with filled/empty slots
3. Empty slot shows "+" button → opens avatar picker overlay
4. Avatar picker shows grid of user avatars (all active users, searchable by name)
5. Staff clicks avatar → user is assigned (DIRECT_ASSIGNED) → avatar appears in slot
6. To remove: staff clicks assigned avatar → confirmation → assignment deleted
7. Panel footer shows "Post to trade board" action for any filled slot

### Flow B: Staff adds/removes shifts on an event
1. In ShiftDetailPanel, each area row has a "+" button to add a shift
2. Clicking "+" creates a new shift for that area (defaults to ST worker type, event time range)
3. Each shift has a "×" delete button (only visible when shift is unassigned or after confirmation)
4. Removing a shift with an active assignment warns: "This shift has an assigned worker. Remove anyway?"
5. `manuallyEdited` flag is set on the ShiftGroup

### Flow C: Default shift generation (unchanged)
1. ICS sync creates CalendarEvent
2. Post-sync hook calls `generateShiftsForEvent()`
3. If no ShiftGroup exists → create from sport config template (home/away counts)
4. If ShiftGroup exists AND `manuallyEdited === false` → skip (idempotent)
5. If ShiftGroup exists AND `manuallyEdited === true` → skip (preserve manual edits)

## 9) Acceptance Criteria (Testable)

### Slice 1: Per-Event Shift Editing
- [ ] AC-1: Staff can add a shift to any area on an existing ShiftGroup via the ShiftDetailPanel
- [ ] AC-2: Staff can remove an unassigned shift from a ShiftGroup
- [ ] AC-3: Removing a shift with an active assignment shows a confirmation dialog before proceeding
- [ ] AC-4: Adding or removing a shift sets `ShiftGroup.manuallyEdited = true`
- [ ] AC-5: ICS sync does not overwrite shifts on a `manuallyEdited` ShiftGroup

### Slice 2: Universal User Assignment
- [ ] AC-6: Staff can assign any active user to any shift, regardless of sport roster membership
- [ ] AC-7: The user picker shows all active users (not filtered by sport roster)
- [ ] AC-8: Time conflict validation still prevents double-booking a user across overlapping shifts

### Slice 3: Avatar-Based Assignment UI
- [ ] AC-9: ShiftDetailPanel displays an avatar grid picker when assigning a user to a shift
- [ ] AC-10: Avatar picker supports search-by-name filtering
- [ ] AC-11: Assigned users display as avatars in the shift slot (not just text names)
- [ ] AC-12: Clicking an assigned avatar shows options: "Remove" and "Post to trade board"
- [ ] AC-13: The picker is responsive and usable on mobile (375px viewport)

## 10) Edge Cases
- **Event with no sport config**: No shifts auto-generated. Staff must manually add shifts. This is valid — some events (e.g., special shoots) have no sport. Every shift and area is optional; nothing is required.
- **Manually edited event re-synced**: ICS sync updates event metadata (time, location) but must NOT regenerate shifts. Guard on `manuallyEdited` flag.
- **Removing the last shift in an area**: Allowed. Area row shows empty state with "+" add button.
- **Assigning a user who already has a shift at the same time**: Time conflict check blocks with clear error message: "User has a conflicting shift at [Event Name] from [time]–[time]"
- **Deleting a shift that has a pending trade**: Trade should be auto-cancelled (status → CANCELLED) before the shift is deleted. Wrap in transaction.
- **ShiftGroup with 0 shifts**: Valid state — shows as "No shifts configured" with area-level add buttons.
- **Student POV**: Students should NOT see add/remove shift controls. They only see assigned avatars and their own request/trade options.
- **Mobile**: Avatar picker should use a bottom sheet pattern on small screens, not an inline popover.

## 11) File Scope for Claude

### Allowed files to modify
- `src/app/api/shift-groups/[id]/shifts/route.ts` — new (add shift)
- `src/app/api/shift-groups/[groupId]/shifts/[shiftId]/route.ts` — new (delete shift)
- `src/app/api/shift-assignments/route.ts` — relax roster constraint
- `src/components/ShiftDetailPanel.tsx` — avatar picker, add/remove shift UI
- `src/components/shift-detail/` — new directory for extracted subcomponents (AvatarPicker, ShiftSlot, AreaRow)
- `src/lib/services/shift-generation.ts` — guard `manuallyEdited` on regeneration
- `src/app/(app)/schedule/_components/types.ts` — type updates if needed
- `docs/AREA_SHIFTS.md` — changelog
- `docs/GAPS_AND_RISKS.md` — update deferred items

### Forbidden files
- `prisma/schema.prisma` — no schema changes needed (existing models sufficient)
- Booking engine (`src/lib/services/bookings.ts`)
- Calendar sync service (`src/lib/services/calendar-sync.ts`) — only `shift-generation.ts` changes
- Authentication / RBAC infrastructure

## 12) Developer Brief (No Code)

### Slice 1: Per-Event Shift Editing (API + backend)
1. Create `POST /api/shift-groups/[id]/shifts` — accepts `{area, workerType, startsAt?, endsAt?}`. Defaults startsAt/endsAt to the parent event's times. Creates shift, sets `manuallyEdited = true` on the ShiftGroup. Returns the new shift.
2. Create `DELETE /api/shift-groups/[groupId]/shifts/[shiftId]` — validates shift belongs to group. If shift has active assignments, require `?force=true` query param. Cancel any open trades for this shift's assignments. Delete shift (cascades to assignments). Set `manuallyEdited = true`.
3. In `shift-generation.ts`: add explicit guard in `generateShiftsForEvent()` — if ShiftGroup exists and `manuallyEdited === true`, skip with log message.
4. Add audit logging to both new endpoints.

### Slice 2: Universal User Assignment (API change)
1. In `POST /api/shift-assignments` — remove or make optional any sport roster membership check. The only hard constraints should be: user exists, user is active, shift exists, no duplicate active assignment on this shift, no time conflict.
2. Add a lightweight user search endpoint or reuse `/api/users?search=X&limit=20` with a projection that returns only `{id, name, initials, avatarUrl, primaryArea, role}`.

### Slice 3: Avatar-Based Assignment UI (frontend)
1. Extract ShiftDetailPanel (577 lines) into subcomponents before adding new UI:
   - `ShiftAreaRow` — renders one area's shifts with slots
   - `ShiftSlot` — renders one shift position (empty or assigned avatar)
   - `AvatarPicker` — the user search + avatar grid overlay
2. `AvatarPicker` component: shadcn `Popover` (desktop) or `Sheet` (mobile) containing a search input + scrollable avatar grid. Each avatar is a `Button` with `Avatar` + name tooltip. Clicking assigns.
3. `ShiftSlot` component: when empty, shows dashed circle with "+" icon (click opens AvatarPicker). When filled, shows user Avatar with name tooltip (click shows Popover with "Remove" and "Post to trade board" actions).
4. Add "+Shift" button per area row that calls the new POST endpoint.
5. Add "×" button per shift that calls the new DELETE endpoint (with confirmation dialog if assigned).

### Slice 4: Hardening
1. SERIALIZABLE transactions on new add/delete shift endpoints
2. Mobile testing: avatar picker bottom sheet at 375px
3. Optimistic UI: assignment appears immediately, rolls back on error
4. AbortController on all new fetch calls
5. Error differentiation (network vs server vs 401)

## 13) Test Plan (High-Level)
- **Unit:** `formatExplicitDuration` edge cases (if touched), shift generation guard logic
- **Integration:** Add shift → verify DB state. Delete shift with assignment → verify cascade + trade cancellation. Assign non-roster user → verify success.
- **Regression:** Existing auto-generation still works for non-edited ShiftGroups. Existing trade board still works. Existing premier request flow unchanged. Time conflict validation still blocks.
- **Manual validation:** Staff assigns 4 users to a 4-shift event in under 30 seconds using avatar picker. Student sees shifts but cannot add/remove. Mobile avatar picker is usable at 375px.

## 14) Risks and Mitigations

- **Risk:** Removing sport roster constraint means the avatar picker shows ALL users (could be 30+)
  - Mitigation: Search-first UX. Show "Recently assigned" or "Recommended" (users with matching primaryArea) at top of picker. Paginate or virtualize if >50 users.

- **Risk:** `manuallyEdited` flag is permanent — once set, auto-generation never updates shifts even if sport config changes
  - Mitigation: Add a "Reset to template" button in ShiftDetailPanel that clears `manuallyEdited`, deletes existing shifts, and regenerates from sport config. This is a destructive action with confirmation.

- **Risk:** ShiftDetailPanel is already 577 lines — adding more UI makes it unmanageable
  - Mitigation: Slice 3 begins with extracting subcomponents (ShiftAreaRow, ShiftSlot, AvatarPicker) before adding new features. Target: ShiftDetailPanel.tsx < 200 lines after extraction.

- **Risk:** Deleting a shift with active assignment + pending trade creates orphaned state
  - Mitigation: Wrap delete in SERIALIZABLE transaction. Cancel open trades first, then delete assignment, then delete shift. All-or-nothing.

- **Risk:** Avatar picker API call on every popover open could be slow
  - Mitigation: Cache user list in React state for the session. Only refetch on explicit search or after 5 minutes. The user list is small (<50 users for this org).

---

## Thin Slice Build Order

```
Slice 1: Per-Event Shift Editing (API + generation guard)
├── POST /api/shift-groups/[id]/shifts
├── DELETE /api/shift-groups/[groupId]/shifts/[shiftId]
├── shift-generation.ts manuallyEdited guard
└── Audit logging

Slice 2: Universal User Assignment
├── Relax roster constraint in POST /api/shift-assignments
└── User avatar search endpoint (or reuse /api/users with projection)

Slice 3: Avatar-Based Assignment UI
├── Extract ShiftDetailPanel → subcomponents (ShiftAreaRow, ShiftSlot, AvatarPicker)
├── AvatarPicker component (Popover desktop, Sheet mobile)
├── ShiftSlot component (empty → picker, filled → actions)
├── "+Shift" and "×" buttons per area/shift
└── "Post to trade board" action from avatar context menu

Slice 4: Hardening
├── SERIALIZABLE on new endpoints
├── Mobile testing (375px)
├── Optimistic UI + rollback
├── AbortController
└── Doc sync (AREA_SHIFTS.md, GAPS_AND_RISKS.md)
```

Each slice is independently mergeable and testable. Maximum one PR per slice.
