# Brief: Kit Management V1

## Document Control
- Owner: Wisconsin Athletics Creative Product
- Date: 2026-03-24
- Status: Active
- Decision Ref: D-062 (calling, exclusive membership, pickup aliases). D-020 is historical sequencing.

---

## Current state (2026-09-21)

Kits are named gameday templates. Staff author them. Anyone who can create a reservation can call an active kit from web, native iOS, or kiosk checkout. Serialized membership is exclusive within a sport. Football video kits can own one of SLOW1, SLOW2, BENCH, or ROAM1–ROAM4 at a pickup, and those names stay all caps on every calling surface. Camp Randall and Camp Randall Stadium are the same pickup. Checkout integration is reservation expansion plus a kiosk scan checklist; it is not a silent cart fill.

## Problem Statement

Staff frequently check out the same group of items together — e.g., an "Interview Kit" (camera body, lens, wireless mic, tripod, light panel) or a "Game Day Kit" (two bodies, three lenses, batteries, cards). Today there's no way to define these bundles. Staff must manually pick every item each time, which is slow, error-prone, and makes it hard to answer "is the Interview Kit available Thursday?"

Kits are distinct from accessories (D-023): accessories are physically attached to a parent item and always travel together. Kits are **logical groupings** of standalone items that are frequently checked out as a set but can also be used independently.

## Solution

Build a Kit CRUD interface scoped to the Admin section. Kits are named collections of assets, location-scoped, with derived availability. V1 focuses on kit definition and visibility — checkout integration (kit-as-fast-path in equipment picker) is deferred to V2.

---

## Scope (V1)

### 1. Kit List Page — `/kits` (Critical)
- Replace placeholder with full list page using DataTable (React Table)
- Columns: Name, Location, Member Count, Availability (derived badge), Updated
- Search by kit name
- Filter by location
- Sort by name, member count, updated date
- Pagination (server-side, 25 per page)
- "New Kit" button opens creation sheet

### 2. Kit Creation (Critical)
- Sheet/dialog with fields: Name (required), Description (optional), Location (required dropdown)
- After creation, redirect to kit detail page to add members
- Validate unique name per location (schema enforces, surface friendly error)
- Audit entry on create

### 3. Kit Detail Page — `/kits/[id]` (Critical)
- Inline-editable name and description (SaveableField pattern)
- Location shown as read-only badge (changing location is a destructive op — V2)
- **Members section**: table of member assets with columns: Tag, Name, Type, Status
- "Add Item" action — asset search picker (reuse equipment picker search, exclude already-added)
- "Remove" action per member (with confirmation)
- Members grouped by equipment section (Cameras, Lenses, Batteries, Accessories, Others)
- Audit entry on member add/remove

### 4. Kit Availability Derivation (Critical)
- Kit availability is **never stored** — always computed (Principle 1: derived status is law)
- A kit is **Available** when ALL members are available (no active allocation conflicts)
- A kit is **Partially Available** when some but not all members are available
- A kit is **Unavailable** when any critical member has a conflict
- V1: simple all-or-nothing availability badge on list page; detail page shows per-member status
- Availability check reuses `checkSerializedConflicts()` with kit member asset IDs

### 5. Kit API Routes (Critical)
- `GET /api/kits` — list with search, location filter, pagination
- `POST /api/kits` — create kit (name, description, locationId)
- `GET /api/kits/[id]` — detail with members and per-member availability
- `PATCH /api/kits/[id]` — update name, description, active flag
- `DELETE /api/kits/[id]` — hard delete (cascades memberships via schema)
- `POST /api/kits/[id]/members` — add asset(s) to kit
- `DELETE /api/kits/[id]/members/[membershipId]` — remove asset from kit

### 6. Kit Service Layer (Critical)
- `createKit(input)` — transaction: create kit + initial memberships + audit
- `updateKit(id, input, actorId)` — transaction: update fields + audit with diff
- `deleteKit(id, actorId)` — delete + audit
- `addKitMembers(kitId, assetIds, actorId)` — transaction: create memberships + audit
- `removeKitMember(membershipId, actorId)` — delete + audit
- `getKitWithAvailability(id)` — detail with derived member availability
- `listKits(params)` — paginated list with member counts

### 7. Sidebar Update (High)
- Remove "Soon" badge from Kits nav item when feature ships
- Keep under Admin group (ADMIN + STAFF only)

### 8. Kit Deactivation (Medium)
- `active` flag supports soft-archive (kit hidden from list by default)
- Toggle on detail page: "Archive Kit" / "Restore Kit"
- Archived kits accessible via filter toggle on list page
- Archived kits cannot be added to bookings (V2 checkout integration)

---

## Out of Scope (V1)
- **Kit-to-booking fast path** — selecting a kit to auto-populate equipment picker (V2)
- **Kit QR codes** — scanning a kit label to open kit or start checkout (V2)
- **Location reassignment** — moving a kit to a different location (V2, requires member validation)
- **Kit templates/cloning** — create new kit from existing kit (V2)
- **Student visibility** — students cannot see kits in V1 (admin/staff only)
- **Import integration** — Cheqroom CSV kit column mapping (V2, when import is revisited)
- **Kit-level maintenance status** — flag entire kit as out-of-service (V2)
- **Bulk operations** — bulk add/remove members, bulk archive (V2)

---

## Files Changed

### New Files
1. `src/lib/services/kits.ts` — Kit service (CRUD, availability derivation)
2. `src/app/api/kits/route.ts` — List + Create endpoints
3. `src/app/api/kits/[id]/route.ts` — Detail + Update + Delete endpoints
4. `src/app/api/kits/[id]/members/route.ts` — Add members endpoint
5. `src/app/api/kits/[id]/members/[membershipId]/route.ts` — Remove member endpoint
6. `src/app/(app)/kits/[id]/page.tsx` — Kit detail page
7. `src/app/(app)/kits/columns.tsx` — React Table column definitions
8. `src/app/(app)/kits/hooks/use-kits-query.ts` — Data fetching hook
9. `src/app/(app)/kits/new-kit-sheet.tsx` — Kit creation sheet

### Modified Files
10. `src/app/(app)/kits/page.tsx` — Replace placeholder with full list page
11. `src/components/Sidebar.tsx` — Remove "Soon" badge from Kits

---

## Acceptance Criteria
- [x] AC-1: Staff can create a kit with name, description, and location (2026-03-24)
- [x] AC-2: Kit name uniqueness per location is enforced with friendly error (2026-03-24)
- [x] AC-3: Staff can add assets to a kit via search picker (2026-03-24)
- [x] AC-4: Staff can remove assets from a kit (2026-03-24)
- [x] AC-5: Kit detail page shows members grouped by equipment section (2026-03-24)
- [x] AC-6: Kit list page shows availability badge per kit (2026-03-24)
- [x] AC-7: Kit detail page shows per-member status badge (2026-03-24)
- [x] AC-8: Kit list supports search, location filter, pagination (2026-03-24)
- [x] AC-9: Staff can archive/restore a kit via active toggle (2026-03-24)
- [x] AC-10: All kit mutations (create, update, delete, add/remove member) emit audit entries (2026-03-24)
- [x] AC-11: Kits nav item no longer shows "Soon" badge (2026-03-24)
- [x] AC-12: Build passes, no regressions (2026-03-24)

---

## Risk Assessment
- **Low risk**: Schema already exists and is production-ready — no migration needed
- **Availability derivation**: Reuses proven `checkSerializedConflicts()` — no new conflict logic
- **Performance**: Kit member counts are small (5-20 items typical) — N+1 not a concern at this scale. If kits grow large, add batch availability query in V2
- **Cascade safety**: Deleting a kit cascades memberships only (not assets). Deleting an asset cascades its memberships only (not the kit). Both are schema-enforced and safe
- **No checkout impact**: V1 is read-only from the booking perspective — zero risk to existing checkout flow
