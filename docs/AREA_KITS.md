# AREA: Kits Management

## Document Control
- Area: Kits Management
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-09-21
- Status: Active
- Version: V1
- Brief: `BRIEF_KIT_MANAGEMENT_V1.md`
- Decision Refs: D-020 (historical sequencing), D-062 (calling, exclusive membership, pickup aliases)

## Direction
Enable staff to name the cameras, lenses, and batteries each gameday position uses. Anyone who can create a reservation can call that kit from web, native iOS, or kiosk checkout. Selecting the kit expands every member into the booking’s item list on reservation create, or becomes the kiosk scan plan. `Booking.kitId` remains provenance (“this plan started from SLOW1”); the reserved/checked-out gear is the expanded serialized items and item families. The booking title stays the event name.

## Core Rules
1. Kit is a named group of serialized items (via `KitMembership`) and/or bulk SKUs (via `KitBulkMembership`).
2. Kits are location-scoped (tied to a `Location`). Camp Randall and Camp Randall Stadium are the same pickup for membership and calling.
3. Staff (ADMIN/STAFF) can create, rename, describe, assign an optional sport, assign a football gameday job (SLOW1, SLOW2, BENCH, ROAM1–ROAM4), duplicate, add/remove members, archive kits. Duplicate copies batteries and sport, not cameras and not the football job.
4. Anyone with `kit.view` or collaborator `RESERVATION_CREATE` can list and call active kits. Students cannot include archived kits. Calling pickers hide empty kits and sort football jobs SLOW1 → ROAM4.
5. Serialized membership is exclusive within a sport: two Football kits cannot share a camera; a Basketball kit may use that same body. Kits without a sport exclusive among themselves.
6. At a pickup, including Camp Randall aliases, only one active kit may own each football job. Photo kits stay un-roled.
7. Archived kits are hidden by default but can be shown with filter toggle.
8. Kit member count is displayed inline.
9. Kit with zero members shows "Empty" status; non-empty kits show "Ready".
10. Selecting a kit on reservation create expands current members into booking lines when the client sent no equipment. An edited client list is kept as the source of truth. Empty and archived kits cannot be used. Direct kiosk checkout records `kitId` as provenance and still requires scanned items; the kit is the remaining-item checklist, not a silent cart fill.
11. Reservation and kiosk calling can suggest the current kit for the requester’s last football job at that pickup.
12. Kit member writes stay location-scoped: serialized items and item families must belong to the kit’s pickup group.

## Routes

### `/kits`
- **Page:** `src/app/(app)/kits/page.tsx`
- **Auth:** Staff/Admin only (`src/app/(app)/kits/layout.tsx` requires `kit.create`). Students and collaborators call kits from reservation create, not this authoring surface.
- **Type:** List view with search, location filter, show archived toggle, pagination
- **Components:**
  - `PageHeader` with "New Kit" button opens `NewKitSheet`
  - Summary cards for matching, active, archived, and empty kits
  - Search input (case-insensitive name/description search via `useKitsQuery`, URL-backed as `q`)
  - Location filter dropdown (loads from `/api/locations`)
  - Show archived checkbox
  - Clear filters button resets search, location, archived visibility, and sort state
  - Desktop table: columns are Name (with description), Location, Sport, Job, Contents count, Status, Updated date, Action
  - Mobile card layout: compact link card per kit with name, status, content count, sport, job, location
  - Pagination: shows the visible result range and total
- **Behaviors:**
  - Name and Open actions navigate to kit detail via real links
  - Empty states: "No kits yet" (no filters) or "No kits match filters" (with filters)
  - Load error state with retry button
  - Sort by Name, Contents count, or Updated date with URL-backed `sort`/`order`
  - Content counts combine serialized `KitMembership` rows and `KitBulkMembership` rows
- **Data:** `/api/kits?q=...&location_id=...&include_archived=...&sort=...&order=...`

### `/kits/[id]`
- **Page:** `src/app/(app)/kits/[id]/page.tsx`
- **Type:** Detail view — kit settings, member list (serialized), bulk member list
- **Sections:**
  1. **Header:** Shared `PageHeader` with kit name, location/job/content-count summary, duplicate, archive/restore, delete, and back actions. Kit name, description, sport, football job, location, and created date remain editable/visible in the info card.
  2. **Serialized Items:** Table of kit members (asset tag, name, brand/model, type, status, date added). Location-scoped search adds items at this kit’s location. Remove button per row.
  3. **Bulk Members:** Table of bulk SKU members (SKU name, category, unit, quantity). Search bar. Add bulk SKUs (quantity picker). Remove button per row.
  4. **Actions:** Duplicate, archive/unarchive, delete kit (deletes all memberships).
- **Behaviors:**
  - All edits are inline (name/description via `SaveableField` component)
  - Add serialized items through location-scoped search
  - Bulk operations: confirm dialog before remove/delete
  - 401 redirect on all mutations
  - Error toast + retry on mutation failure
- **Data:**
  - GET `/api/kits/[id]` → `KitDetail` with members and bulkMembers arrays
  - PATCH `/api/kits/[id]` → name, description, active flag, optional sport, optional football job
  - POST `/api/kits/[id]/clone` → duplicate kit, members, and item-family quantities at the same location
  - POST `/api/kits/[id]/members` → add serialized item (assetId)
  - DELETE `/api/kits/[id]/members/[membershipId]` → remove item
  - POST `/api/kits/[id]/bulk-members` → add bulk SKU (skuId, quantity)
  - DELETE `/api/kits/[id]/bulk-members/[membershipId]` → remove bulk SKU

### `/kits/new`
- **Sheet:** `src/app/(app)/kits/new-kit-sheet.tsx` (opened via button on `/kits`)
- **Type:** Modal dialog
- **Fields:** Name (required), description (optional), location (dropdown), optional sport, optional football job (SLOW1, SLOW2, BENCH, ROAM1–ROAM4) when the sport is Football
- **Behaviors:** Submit creates kit; client/server validation appears inline; on success, the sheet shows explicit handoff actions to open the kit, return to the refreshed kits list, or create another kit.

## Data Model

**Key tables:**
- `Kit` — name, description, optional `sportCode`, optional `gamedayRole` (football jobs SLOW1, SLOW2, BENCH, ROAM1–ROAM4), active (boolean), location FK, timestamps
- `KitMembership` — kit FK, asset FK, timestamps (one-to-many to Kit). Same-sport exclusivity is enforced in `SERIALIZABLE` kit writes, not a unique index, so Basketball and Football may share a camera.
- `KitBulkMembership` — kit FK, bulk SKU FK, quantity, timestamps (one-to-many to Kit)

## Hardening Notes

See `AREA_ITEMS.md` 2026-04-06 entry for kit detail page hardening work:
- All 6 mutations wrapped with `requireAuth()` + 401 redirect
- Kits list page already uses `useFetch` hook (AbortController, 401 handling, focus refresh)
- 2026-05-10 list hardening: summary and status counts include serialized and bulk kit contents, description search is supported, and create-sheet field validation is visible.

## Acceptance Criteria
- [x] AC-1: Staff can create, rename, describe, and archive kits
- [x] AC-2: Kits can contain serialized items and bulk SKUs
- [x] AC-3: Kit membership add/remove with error handling
- [x] AC-4: Kit QR generation for direct checkout flow (D-020)
- [x] AC-5: Selecting a kit expands members into the reservation equipment list on web and native iOS; kiosk uses the kit as a scan checklist plus `kitId` provenance; the booking title stays the event name
- [x] AC-6: Mobile kit list responsive; detail scrollable
- [x] AC-7: Football kits can own SLOW1, SLOW2, BENCH, or ROAM1–ROAM4 at a pickup; calling surfaces hide empty kits and can suggest last week’s job

## Change Log
- 2026-09-21: **Football job names stay all caps.** Web, native iOS, and kiosk label the jobs SLOW1, SLOW2, BENCH, and ROAM1–ROAM4, matching the kit names. Choosing a job still fills that name. Photo kits stay un-roled. Production rows now mark SLOW1, SLOW2, BENCH, and ROAM1–ROAM3 as those football jobs. The Football Travel Case keeps the 24-105 and the pooled batteries (24 Sony, 4 gold mount, 2 FX6, 2 monitor) and no longer repeats personal cameras. PHOTO1 and SLOW2 still share FB 70-200 1. Local source/test; authenticated browser, iPhone 16 Pro, and physical kiosk proof remain open.
- 2026-09-17: **Football kits are Slow 1, Slow 2, Bench, and Roam 1–4.** Staff assign one of those jobs per pickup, including Camp Randall aliases. Duplicate copies batteries and sport, not the job. Reservation and kiosk pickers hide empty kits, label Slow 1–Roam 4, and suggest this week’s kit from the requester’s last football job. Photo kits stay un-roled. Local source/test; migrations `0149_kit_sport_code` and `0150_kit_gameday_role` are not applied to production; authenticated browser, iPhone 16 Pro, and physical kiosk proof remain open.
- 2026-09-17: **Anyone can call a kit; exclusive per sport.** Active kits are callable from web reservation create, native iOS create, and kiosk checkout by any actor who can make a reservation. Authoring stays staff/admin. Optional `sportCode` scopes exclusive serialized membership so two Football kits cannot share a camera while Basketball may. Camp Randall and Camp Randall Stadium share kit pickup. Duplicate copies batteries and sport, not cameras. Reservation and checkout titles stay the event name. Kiosk kit pick is a scan checklist plus `kitId` provenance; scans remain the cart. Local source/test; authenticated browser, iPhone 16 Pro, and physical kiosk proof remain open.
- 2026-09-16: **Gameday kit expansion.** Kits are named position templates. Reservation/checkout create expands current members into serialized and item-family booking lines; `kitId` stays provenance. The reservation wizard loads those items for review, kit detail can duplicate a kit and searches only the kit location, and member writes reject cross-location gear. Direct kiosk checkout still does not pick a kit; pickup uses the expanded reservation list.
- 2026-07-10: **Kits operational status rail.** Active kit count now anchors the shared rail, empty kits surface as the actionable warning, and matching, active, archived, and empty totals remain under Details with the existing archived toggle and filters intact.
- 2026-07-10: **Kits search typing stability.** The Kits list search now uses the shared `DebouncedSearchInput` and `useKitsQuery` keeps previous rows visible (`keepPreviousData`) while a changed search/filter refetches, so the full-page skeleton (which previously unmounted the search field and dropped focus on every committed keystroke) only appears on true first load. Regression guard: `tests/search-input-focus-stability.test.ts`.
- 2026-06-20: Kit detail inline-edit rows inherit the refreshed shared `SaveableField` dirty-row treatment, preserving name/description save semantics while making pending save/cancel actions visually explicit and 40px target sized.
- 2026-06-20: Kit detail search misses and empty item-family membership now use shared inline `EmptyState` treatment instead of text-only placeholders, keeping serialized-item search, item-family search, and empty membership recovery copy aligned.
- 2026-06-06: Booking wizard kit lookup recovery shipped. Shared checkout/reservation creation now distinguishes a failed `/api/kits?location_id=...` read from a true no-kit location, showing retryable inline copy while keeping kits optional and preserving the existing `Booking.kitId` payload behavior.
- 2026-06-03: Kit detail can now add item families (bulk SKUs), closing the long-standing gap where AC-2/AC-3 and the `POST /api/kits/[id]/bulk-members` route existed but had no UI (the 2026-05-24 batch had removed the empty-state copy that promised the missing control). The Bulk Items card now has a search field that lazy-loads the kit location's active item families, filters client-side, excludes already-added families, and adds each with a per-row quantity (1-999) via optimistic cache update. Active-kit gated; no backend or schema change. Verified with `npx tsc --noEmit`, `npm run db:migrate:check`, `git diff --check`, and `npx next build`.
- 2026-05-25: Web bug sweep Batch 54 made kit location loading explicit. `/kits` now shows a retryable locations-load failure instead of treating the location filter and New Kit assignment picker as empty, while still letting the existing kit list render.
- 2026-05-25: Web bug sweep Batch 33 hardened the shared form-submit hook used by New Kit. Successful or failed kit-create responses now flow through shared safe JSON parsing, preserving the existing post-create handoff and form-level errors even if an upstream proxy returns an unreadable body.
- 2026-05-25: Web bug sweep Batch 24 hardened URL-backed kit list state. Search, location, archived visibility, and sort controls now rehydrate from browser back/forward and external URL changes through the shared `useUrlState` hook.
- 2026-05-24: Web bug sweep Batch 13. Kit detail inline saves, serialized member add/remove, bulk member removal, archive/restore, delete, and add-member search now use shared auth/error/safe-JSON handling where applicable. Duplicate member/archive/delete actions are ref-guarded, search failures no longer masquerade as empty results, the empty bulk-family copy no longer promises a missing add control, and New Kit fields expose stable form names for browser metadata checks.
- 2026-05-21: Kit detail now uses the shared `PageHeader` structure, keeps archive/delete/back actions at the 40px operational target baseline, and replaces the add-member search clear affordance with a named shadcn icon button.
- 2026-05-21: Kit detail member tables now use the shared `OperationalRowActions` overflow trigger for serialized and bulk member removal. Bulk member removal now confirms the exact item family/quantity, parses API errors, and the API verifies the membership belongs to the current kit before deletion.
- 2026-05-21: Kits list summary metrics now use the shared `OperationalMetricCard` primitive instead of a route-local metric card while preserving filter-aware helper copy.
- 2026-05-12: Creation flow standardization. New Kit now uses the shared post-create handoff pattern so operators can open the created kit, return to the refreshed list, or create another kit without an automatic redirect.
- 2026-03-16: Kit CRUD API and detail page shipped (D-020 implementation). Kit member add/remove with equipment picker reuse. Archive toggle. Hardening: 401 guards on all mutations, AbortController cleanup on list page.
- 2026-04-06: Kits detail page hardening (5-pass audit) — 401 redirect on all 6 mutations (save name, save description, add member, remove member, toggle archive, delete). Kits list page already uses `useFetch` hook.
- 2026-04-09: Doc sync — created AREA_KITS.md as formal feature area documentation.
- 2026-05-10: Kits list polish pass shipped summary metrics, URL-backed search/sort/filter state, real detail links, filtered-empty recovery, bulk-aware content counts/status, description search, and visible New Kit validation.
