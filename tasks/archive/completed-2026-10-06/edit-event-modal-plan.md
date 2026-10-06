# Edit Event Modal Plan

> **Closed 2026-10-06** in the open-task audit: remaining boxes are stale (work shipped in source or superseded). Evidence is in the audit report; nothing here is open.

**Goal:** Single "Edit Event" modal consolidating title, subtitle, home/away/neutral, and location.
**Fixes:** Notre Dame toggle missing (sportCode=null gates it out); location overwrites on sync.

## Root Cause: Notre Dame
`event.sportCode` is likely null for Football vs Notre Dame (ICS sport parsing failed).
Current toggle gate: `isStaffOrAdmin && event.sportCode` — so null → no toggle.
Fix: show home/away toggle in modal unconditionally for staff.

## Slices

### Slice 1 — Schema (migration 0072)
- [ ] Add `locationLocked Boolean @default(false) @map("location_locked")` to CalendarEvent

### Slice 2 — API & Sync
- [ ] `calendar-sync.ts`: add `locationLocked` to ExistingEventRow select + guard in splitEventsForSync
- [ ] `CalendarEvent` type in `_utils.ts`: add `locationLocked: boolean`
- [ ] PATCH schema: add `locationId: z.string().uuid().nullable().optional()` and `revertLocation: z.literal(true).optional()`
- [ ] PATCH handler: handle locationId (lock) + revertLocation (unlock, restore raw locationId from ICS sync)
- [ ] GET select: include `locationLocked`

### Slice 3 — UI
- [ ] Replace pencil button + inline ToggleGroup with single "Edit" button
- [ ] Keep read-only Badge display for non-staff
- [ ] Edit modal fields: title, subtitle, home/away/neutral (no sportCode gate), location picker
- [ ] Location display: prefer `location.name` when `locationLocked`, else `rawLocationText ?? location?.name`
- [ ] Fetch `/api/locations` inside modal (only when open)

## Key Decisions
- home/away shown unconditionally in modal for staff — no sportCode gate
- locationLocked follows same pattern as summaryLocked/isHomeLocked
- rawLocationText stays untouched (display logic uses locationLocked to pick which wins)
- Revert location = unlock + clear locationId so sync can repopulate
