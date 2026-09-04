# Checkouts Area Scope (V1 Hardened)

## Document Control
- Area: Checkouts
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-09-04
- Status: Active — V1 Shipped
- Version: V1

## Direction
Maintain the custody ledger for gear that has physically left or returned through kiosk-controlled handoff flows. App and web surfaces can read, report, edit allowed metadata, extend, cancel where policy permits, and recover exceptions, but they do not create direct checkout custody or return gear.

## Core Rules
1. Checkout records use the unified Booking model and states: `PENDING_PICKUP`, `OPEN`, `COMPLETED`, `CANCELLED`.
2. Direct checkout creation is kiosk-only. App/web creation routes should send users to reservation creation unless the user is physically at a kiosk.
3. Event or purpose context is required for direct kiosk checkout; event linkage remains optional for ad hoc kiosk checkout when a typed purpose exists.
4. Status and availability logic remain derived from allocations, never authoritative stored status.
5. Role and ownership controls follow `AREA_USERS.md`.
6. `PENDING_PICKUP` checkout allocations block overlapping serialized-item reservations and checkouts because custody has not transferred yet but the gear is already committed.
7. Serialized booking windows include a 60-minute turnaround buffer before the next pickup/reservation start in both directions: a new start must follow an existing return by at least 60 minutes, and a new return must precede an existing next start by at least 60 minutes. The narrow exception is extending an existing `OPEN` checkout: its due time may move up to the next booking's actual start, but never through it. Bulk/countable availability remains overlap-based against committed quantities.
8. Kiosk scan preflight gives item-level feedback for conflicts, shortages, unavailable assets, and turnaround risk immediately after an item is staged; completion still performs the authoritative transactional check.
9. Checkout creation is guarded at the shared service boundary: non-kiosk callers must not create checkout custody, kiosk/source creates require at least one equipment item, duplicate multi-event links and duplicate bulk lines are rejected, invalid windows fail before availability work, and DB overlap races return booking conflict responses. The single exception is the admin-only reservation force-checkout path, which still requires a reason, availability checks, exact numbered-unit binding, and transactional audit evidence.
10. Checkout custody is either `PERSON` or `SHARED`. A shared checkout such as `Football Travel Case` owns the case/truck manifest without presenting a borrower; cameras, lenses, or other gear carried separately remain on distinct personal checkouts. Pooled and numbered batteries packed with the travel case remain on the shared manifest rather than being assigned to individuals.
11. A shared checkout created from reservation pickup or admin force checkout inherits `SHARED` from its source reservation. The identified kiosk/admin operator is audit provenance only and never becomes the owner or badge recipient.
12. Staff/Admin may explicitly preview and merge 2–25 compatible `OPEN` event-linked checkouts from the Checkouts list. The records must match on event set, title, requester compatibility metadata, custody scope, and location; direct kiosk handoffs may have different `startsAt` timestamps because each start records when that checkout was created. Return-window and source-reservation differences are surfaced in a review modal where staff choose or edit the surviving context. The selected return time must remain a valid, overlap-safe booking window. The oldest checkout survives; custody-linked item, stock, scan, report, photo, and return-notification rows move inside one serializable transaction, while partially returned, staged, completed, excluded, duplicate-item, and otherwise incompatible records are blocked. Checkout creation is never auto-merged.

## V1 Workflow

### Create Checkout (Kiosk-Only)
Direct checkout is the "I need this now" gear-room handoff path and runs through the native iOS kiosk. It requires kiosk authentication, student identity selection, event or purpose context, scan evidence, availability checks, and kiosk location evidence before the booking enters custody.

App/web must not expose `/checkouts/new` as a normal creation surface. Users away from the kiosk reserve gear for a future claim through `/reservations/new`.

Legacy documentation below describes the retired web wizard contract and is preserved only for migration/history work:

**Step 1 — Context & Details:**
1. Event tie-in defaults ON. Select sport → event (next 30 days) → auto-fills title, dates, location.
2. If no event: manual title + optional sport.
3. Select requester (borrower), location, optional kit, start/end dates.
4. Client-side validation: title, requester, location required; dates must be valid range.
5. The page title uses the selected event/booking title once available; the checkout badge carries the booking kind so the flow does not need a generic creation hero.
6. Context copy stays compact: it names event-linked versus ad hoc state and reserves longer guidance for real load errors or review.
7. Manual date edits preserve duration when the Pickup/Start value changes, matching the native calendar-app behavior; invalid existing windows still remain invalid so validation can block them.

**Step 2 — Equipment:**
1. Full `EquipmentPicker` with quiet section chips, search, availability conflict markers, QR scan-to-add, and deliberate per-item selection.
2. Equipment guidance warns about compatible battery availability and support gear. Battery units are selected by quantity here; kiosk pickup scans bind the actual numbered units.
3. On mobile checkout: scan-first UI (camera open by default).
4. The Step 2 header shows selected count. Warning/status chrome appears only for unavailable stale selections, hard conflicts, needed-next notices, turnaround warnings, or active availability rechecks.

**Step 3 — Confirmation:**
1. Apple-like review panel leads with the selected window, requester, location, pending-pickup status, linked event, and equipment count.
2. Submit → POST `/api/checkouts`. 409 conflicts shown inline (returns to Step 2).
3. Retired: checkout used to be created with status `PENDING_PICKUP`. Under D-040, app/web users create reservations instead; kiosk pickup is the custody boundary.
4. Confirmation repeats selected availability warnings only when warnings exist, and the checkout notice stays concise: kiosk scan starts custody.

**Deep-link parameters:** `?title`, `?startsAt`, `?endsAt`, `?locationId`, `?newFor` (pre-select asset), `?eventId`, `?sportCode`, `?requesterUserId`, `?draftId`.

**Draft persistence:** "Save draft & exit" persists via `/api/drafts`. Resumable via `?draftId=`. Multi-event drafts persist ordered `BookingEvent` links, return ordered `events[]` on resume, and keep `Booking.eventId` as the chronologically first linked event for legacy readers.

### Edit Checkout
1. User opens checkout detail via BookingDetailsSheet.
2. Safe metadata fields respect role and ownership and save as single-field audited patches.
3. Active checkout equipment remains read-only on web. Item additions, removals, and exact-unit custody corrections run through the identified-student kiosk flow.
4. Schedule mutations must preserve overlap and transaction constraints.
5. Staff/Admin may change an active checkout between personal and shared custody. The mutation changes attribution only: requester history, gear, allocations, scans, location, event links, and lifecycle remain intact. Students and Collaborators never gain mutation rights from the retained requester/creator fields while a checkout is shared.

### Extend Checkout
1. `OPEN` checkouts can be extended through free time before upcoming demand; the existence of a later booking does not remove Extend.
2. The new due time may equal the next booking's start. Any true overlap still blocks and must show the blocking item and conflicting booking window.
3. Web due-back and Extend controls use forward-only 15-minute steps. Extend opens at the first valid quarter-hour after both the stored due time and now; an untouched stored timestamp is never rewritten merely by opening a detail surface.
4. Reservation creation and editing continue to enforce the standard 60-minute serialized turnaround buffer. Bulk shortages continue to block extensions, and extension writes retain serializable isolation, optimistic freshness, database overlap protection, audit history, and Live Activity refresh.

### Check In
1. Partial check-in allowed for multi-item allocations.
2. Checkout remains `OPEN` until all allocated items are returned.
3. Auto-transition to `COMPLETED` when full return is confirmed.
4. Standard return execution is kiosk-owned. Web detail surfaces return progress and admin override controls only where explicitly gated; it must not present desktop return buttons as the normal custody path.
5. Admins can close an `OPEN` checkout without scan only as an exception after physically verifying all gear is back. The action requires a reason, marks serialized items and numbered bulk units returned/available, writes an override record plus audit entry, and does not re-enable the retired app/web check-in endpoints.

### Cancel Checkout
1. Allowed only by policy and role.
2. Canceled records remain auditable.
3. No hard delete.
4. Cancelling a legacy `PENDING_PICKUP` checkout releases serialized allocations,
   cancels open scan sessions, restores held bulk stock with a compensating
   `CHECKIN` stock movement, and releases any staged numbered units before the
   booking moves to `CANCELLED`. An `OPEN` checkout carries physical custody and
   cannot use normal cancellation; it must be returned at a kiosk or closed by
   the reasoned admin exception.

## Equipment Picker (V2 — Multi-Select, Search, Availability Preview, Scan-to-Add)

The equipment picker is a standalone component (`src/components/EquipmentPicker.tsx`) extracted from BookingListPage. It uses a sectioned flow with free tab navigation. Supporting libraries: `src/lib/equipment-sections.ts`, `src/lib/equipment-guidance.ts`.

> **Component Roadmap:** See `tasks/item-picker-roadmap.md` for the V1→V2→V3 evolution plan covering decomposition, shadcn alignment, compound component API, and generic picker abstraction.

### Section Order
1. **Cameras** — camera bodies, camcorders, cinema cameras, DSLRs, mirrorless
2. **Lenses** — lenses
3. **Batteries** — batteries, chargers, power supplies, V-mount, gold mount
4. **Accessories** — monitors, recorders, rigs, cages, gimbals, transmitters
5. **Others** — cables, audio, tripods, and catch-all items

All section tabs are freely navigable (no forward-lock). Section tabs are labels only; selected counts live in the step header and selected shelf instead of the tab rail.

### Checkbox Multi-Select
- Each serialized asset row has a checkbox for toggle selection (replaces one-click-to-add).
- Operators select deliberately by row, search, or scan. The picker intentionally does not expose a select-all-visible action.
- "Clear section" button clears all selections in the current section.
- Selected items tray shows compact removable chips for selected serialized items and bulk quantities so selection review does not duplicate the full picker rows.
- Bulk items retain their quantity stepper pattern. Numbered batteries are quantity-only at creation and bind to specific unit numbers at kiosk pickup.

### Per-Section Search
- Each section has a persistent search input (switching tabs preserves each section's search term).
- Client-side filter on tagName, productName, brand, model, serialNumber.
- Match count displayed when search is active.
- No 50-item cap — search makes the full list manageable.

### Section Classification
Assets are classified into sections by keyword matching against the asset's `type` field (from Cheqroom category import). Classification is case-insensitive substring matching. Implementation: `classifyAssetType()` in `src/lib/equipment-sections.ts`.

### Equipment Guidance Rules
Context-aware hints appear per section based on what has already been selected in other sections. All matching rules for the active section are shown simultaneously. Implementation: `getActiveGuidance()` in `src/lib/equipment-guidance.ts`.

Current rules:
- `body-needs-batteries` (warning): camera body selected, check compatible battery availability before checkout.
- `lens-needs-body` (warning): "You've added lenses but no camera body."
- `audio-with-video` (info): "Don't forget audio gear."

Adding new rules: add entries to `EQUIPMENT_GUIDANCE_RULES` array in `src/lib/equipment-guidance.ts`. No schema changes required.

### Availability Preview Badges
When a booking date window is set (startsAt/endsAt), the picker calls `POST /api/availability/check` with all asset IDs to detect scheduling conflicts. Results are shown as:
- Red conflict badge on each conflicting item row with booking title, date range, and the recovery action when the conflict is outside the requested window.
- Blue "Back before" badge when an item is free for the selected window but already needed by the next future booking.
- Separate orange/red badges for timing, transfer, and condition risk when a technically valid booking has an operational concern: short time until the next need, the next need at another location, or a recent damage/lost report. Bulk turnaround notices appear only when the requested quantity would consume stock needed by the next same-location booking.
- Known serialized conflicts are disabled before selection; a conflict discovered after selection remains removable and blocks review. The server still rechecks the final payload authoritatively.
- Future-booking context also appears in the booking detail Equipment tab for active checkouts so extend decisions show the next needed time before action.
- Badges update automatically when the date range changes (debounced 500ms).
- When no dates are set, falls back to current derived-status dots only.

### Scan-to-Add
- "Scan" button in the picker header opens a camera overlay (modal, not full-page navigation).
- Scanning a QR code (`bg://item/<uuid>`, `bg://case/<uuid>`, or raw asset tag) matches against loaded assets.
- Matching asset is auto-selected and the picker navigates to the correct section tab.
- Bulk bin QR codes are also supported — adds the bulk SKU with quantity 1.
- Camera stays open for continuous scanning (2s debounce). Close button dismisses overlay.
- Success/error feedback shown inline below the camera. Haptic vibration on success.
- Camera permission denied handled with error feedback.

### DRAFT Booking State
- `DRAFT` is a pre-BOOKED state for interrupted checkout creation flows
- Allowed actions on DRAFT: `edit`, `cancel`
- DRAFT records appear in dashboard Drafts section for recovery
- DRAFT records can appear in the unified All Active recovery view, but are not shown in the default Checkouts work queue
- Auto-created when checkout creation is interrupted before final save
- Implementation: `BookingStatus.DRAFT` in `src/lib/services/checkout-rules.ts`

---

## Action Matrix by State

Source of truth: `src/lib/services/booking-rules.ts` — `STATE_ACTIONS[CHECKOUT]`

### `DRAFT`
- Allowed actions:
  - Edit (resume)
  - Cancel (discard)
  - Transfer owner (staff/admin-only)

### `PENDING_PICKUP`
- Compatibility or staged handoff state, not the normal result of app/web checkout creation.
- Allocations and bulk stock held immediately
- Kiosk pickup requires successful scan evidence for every serialized item before confirmation can transition the checkout to `OPEN`.
- Auto-expires after 48 hours past `startsAt` during `morning-refresh` if the student never picks it up. Expiry cancels the checkout, releases serialized allocations, restores held bulk stock, releases scanned numbered units, cancels open scan sessions, and writes a system audit entry.
- Allowed actions:
  - View
  - Edit (staff+/owner)
  - Cancel (staff+/owner)
  - Transfer owner (staff/admin-only)
  - Change personal/shared custody (staff/admin-only)
  - Pickup at kiosk → transitions to `OPEN`

### `OPEN`
- Allowed actions:
  - View
  - Edit (staff+ or owner)
  - Extend (staff+ or owner)
  - Transfer owner (staff/admin-only)
  - Change personal/shared custody (staff/admin-only)
  - Check in at kiosk
  - Close without scan (admin-only exception with required reason)

### `COMPLETED`
- Allowed actions:
  - View only

### `CANCELLED`
- Allowed actions:
  - View only

## List and Detail UX Requirements
1. Checkout list is action-first and grouped by urgency.
2. Default active Checkouts view includes `OPEN` custody records and any remaining `PENDING_PICKUP` compatibility/staged pickup records because both are daily checkout work.
3. Row click opens BookingDetailsSheet.
4. Desktop and mobile row overflow actions use the shared `OperationalRowActions` trigger; right-click context menus keep the same action policy.
5. Mobile uses the same overflow action behavior.
6. Event badge is informational only and must not block operations if source event changes.
7. Mobile list cards and quick actions follow `AREA_MOBILE.md`.
8. Staff/Admin can select compatible `OPEN` event-linked checkouts and use an explicit `Merge matching checkouts` repair action. The review modal lists each available return time, permits an adjusted due-back, and resolves differing reservation links before confirmation. The source records remain visible in audit history as cancelled merge sources, and any changed surviving due time writes a due-date history row.
9. Card-grid selection checkboxes and overflow actions share a reserved top-right action rail so neither control obscures the other; the list view keeps selection and row actions in separate table cells.

## Checkout Detail Page (Unified with Reservations)

The checkout detail page (`/checkouts/[id]`) uses the shared `BookingDetailPage` component with `kind="CHECKOUT"`. See `src/app/(app)/bookings/BookingDetailPage.tsx`.

### Architecture
- **Route**: `src/app/(app)/checkouts/[id]/page.tsx` — thin wrapper passing `kind="CHECKOUT"`
- **Shared component**: `BookingDetailPage` serves both checkout and reservation detail
- **Hooks**: `useBookingDetail` (fetch + reload + optimistic patch), `useBookingActions` (all action handlers)
- **API**: All reads and inline field saves go to `/api/bookings/[id]` (GET + PATCH)
- **Old route**: `GET /api/checkouts/[id]` redirects (308) to `/api/bookings/[id]`

### Checkout-Specific Behavior
- The shared header follows the native booking hierarchy: lifecycle state and live due/pickup timing lead, a personal checkout names the requester, and a shared checkout uses package identity plus `Shared checkout` / `Travel case & equipment truck` without exposing the retained requester as owner. A compact operational summary keeps the handoff time, pickup location, physical gear count, and linked event context visible before the denser web detail columns.
- Web-only operator breadth remains below and beside that summary: inline editing, equipment custody context, nudge/extend/transfer/admin-repair actions, sync health, and complete activity history.
- Status badge shows display labels through the shared booking status display helper: `PENDING_PICKUP` -> "Pending Pickup", `OPEN` -> "Checked out".
- "Due back" countdown rendered as urgency-colored Badge (red/orange/yellow/neutral)
- Action buttons: `[Actions ▼] [Edit] [Extend]` for app-owned actions. Custody pickup/return scans happen at the kiosk.
- Actions dropdown contains: Nudge borrower, Close without scan, Transfer owner,
  Duplicate, and legacy staged-checkout Cancel when each action is allowed.
  `OPEN` custody never exposes normal Cancel. Close without scan is admin-only,
  requires a reason, records an override event, and must not link to
  `/scan?checkout=...`.
- Staff/Admin also receive `Make shared checkout` or `Make personal checkout` on eligible active checkouts. Shared custody removes borrower nudge and owner transfer because it has no personal custodian.
- Equipment tab shows returned progress and item context, but standard return execution remains at the kiosk.
- Equipment rows show hover-reveal "..." menu (View item)
- Checkin progress bar in equipment header: `████░░░░ 12/30 returned`
- Optimistic UI: returned items show immediately before API confirms
- Success toasts on all web-owned actions (extend, cancel, complete/admin override)
- Returned items show green checkmark and muted row background
- Breadcrumb handled by global `PageBreadcrumb` in AppShell (no duplicate)

### BookingDetailsSheet quick view
1. Due back is the stable schedule headline, with weekday-first dates and urgency aligned to the dashboard rail.
2. Title, due date, and notes edit in context through single-field patches with explicit confirmation. Checkout start remains read-only because custody already began.
3. Equipment remains readable with thumbnails, return progress, and direct numbered-unit identities. Active checkout equipment editing is not exposed on web.
4. Full history and broader workflows remain on the full checkout detail page.

### Inline Editing
- Title: `InlineTitle` component with save status indicator (spinner/check/error)
- Notes: blur-save via `useSaveField` pattern
- PATCH `/api/bookings/[id]` with single-field partial update
- Audit entries capture before-snapshot for field-level diffs
- "Refreshing…" spinner shown during data reload after actions

## Bug Traps and Mitigations

### Trap: Double submit creates duplicate checkouts
- Mitigation:
  - Idempotency token on create requests.
  - Disable submit during in-flight mutation.

### Trap: Extend passes UI but fails at commit due to overlap race
- Mitigation:
  - Keep SERIALIZABLE mutation handling.
  - Retry-safe error path with explicit conflict feedback.

### Trap: Partial check-in incorrectly flips to `COMPLETED`
- Mitigation:
  - Completion state requires zero active allocations.
  - Add invariant check before state transition.

### Trap: Stale event metadata blocks checkout operations
- Mitigation:
  - Treat event link as contextual metadata.
  - Checkout edit/check-in flows cannot depend on event feed availability.

### Trap: Student edits non-owned checkout via direct request
- Mitigation:
  - Server-side ownership enforcement on every mutation.
  - Audit denied attempts.

### Trap: Accidental duplicate event checkout splits custody across records
- Mitigation:
  - Keep repair explicit and staff/admin-only from the Checkouts list.
  - Require exact event, requester metadata, custody, location, source-reservation, title, and window compatibility.
  - Rehome custody and history rows transactionally; block partial returns, duplicate physical items, accountability exclusions, and completed checkouts.

## Edge Cases
- No events in next 30 days for selected sport.
- Event missing opponent, venue, or end time.
- Cross-midnight checkouts and DST boundaries.
- Multi-location allocations on one checkout.
- Borrower reassignment mid-lifecycle.
- Check-in at alternate location due to approved exception.

## Acceptance Criteria
- [x] AC-1: Event-linked checkout can be created without manual title/date entry.
- [x] AC-2: User can create ad hoc checkout without event linkage.
- [x] AC-3: State-based actions are enforced exactly by lifecycle state.
- [x] AC-4: Partial check-in does not complete booking until all items are returned.
- [x] AC-5: Extend flow blocks cleanly with actionable overlap details.
- [x] AC-6: Permission and ownership gates match `AREA_USERS.md`.
- [x] AC-7: Every mutation emits audit records with actor and diff context.
- [x] AC-8: Non-kiosk app/web callers cannot create checkout custody or perform normal return flows; kiosk-authenticated routes own standard custody mutation, with a separate admin-only close-without-scan exception requiring reasoned override evidence.
- [ ] AC-9: Existing `PENDING_PICKUP` records remain visible and recoverable during rollout without presenting web/app checkout creation as the forward path.
- [ ] AC-10: Shared travel-case custody is source-complete and passes the web build with custodian-neutral web/kiosk presentation, no personal accountability/badge/My Gear attribution, and identified-operator kiosk return; migration `0143_shared_checkout_custody` is applied, while native build, compatible app deployment, authenticated visual proof, and physical kiosk acceptance remain rollout gates.
- [ ] AC-11: Staff/Admin can explicitly preview and merge compatible `OPEN` event-linked checkouts while preserving custody and audit history; the review modal resolves return-time and source-reservation differences while hard custody conflicts remain blocked. Local source/tests are complete, while deployment and authenticated UI proof remain tracked under GAP-77.

## Dependencies
- Event normalization read model from `AREA_EVENTS.md`.
- Equipment selection behavior from `AREA_ITEMS.md`.
- Permission policy from `AREA_USERS.md`.
- Integrity constraints and audit requirements from `DECISIONS.md` (D-001, D-006, D-007).
- Mobile operations contract from `AREA_MOBILE.md`.
- Kiosk custody boundary from `DECISIONS.md` (D-028, D-030, D-040).

## Roadmaps
- `tasks/item-picker-roadmap.md` — EquipmentPicker V1→V2→V3
- `tasks/booking-details-sheet-roadmap.md` — BookingDetailsSheet V1→V2→V3

## Out of Scope (V1)
1. Booking engine rewrite.
2. Reintroducing app/web checkout creation or return execution outside kiosk.
3. Advanced automation flows.

## Developer Brief (No Code)
1. Preserve deterministic kiosk checkout creation with event or purpose context.
2. Enforce state transition rules and action gating by state, role, and ownership.
3. Implement safe extend and kiosk-owned return flows with overlap-aware conflict handling.
4. Preserve transaction integrity and derived-status invariants in every mutation.
5. Add regression coverage for race conditions, partial returns, non-kiosk custody attempts, and permission bypass attempts.

## Change Log

- 2026-09-04: **Checkout merge conflicts now resolve in an explicit modal locally.** Staff/Admin review the available return windows, can choose or edit the surviving due-back, and can choose which reservation link remains when duplicate checkouts came through different reservation records. The mutation validates the selected window against combined availability, updates active allocation due times, records `BookingDueDateChange`, and audits the selected context. Partial/returned/duplicate custody and different-person/event/location records remain blocked; deployment and authenticated proof remain open under GAP-77.
- 2026-09-04: **Card-grid selection and overflow controls are separated locally.** The merge checkbox and three-dot actions now sit beside each other in a reserved top-right rail, preserving the card header's duration layout and keeping both controls reachable. Deployment and authenticated browser proof remain separate acceptance gates.
- 2026-09-04: **Separate kiosk handoffs no longer block duplicate-checkout repair locally.** Same-event checkouts created minutes apart can now merge even when their pickup `startsAt` timestamps differ; the initial merge slice enforced exact return/source context, with the explicit conflict-resolution modal now handling those two repair choices. Deployment and authenticated browser proof remain open under GAP-77.
- 2026-09-04: **Added explicit duplicate-checkout repair locally.** Staff/Admin can select 2–25 compatible `OPEN` event-linked checkouts and merge them into the oldest record. The service preserves custody, numbered units, stock movements, scan/history rows, and return-notification bookkeeping in one serializable transaction, cancels only emptied sources with audit receipts, and blocks partial returns, completed rows, mismatched event/person/location/window/source context, duplicate physical items, and accountability exclusions. No automatic merge or kiosk-flow change was added; deployment and authenticated browser proof remain open under GAP-77.
- 2026-09-03: **Shared travel-case custody now begins at reservation creation locally.** Normal and partial kiosk pickup plus admin force checkout inherit the source reservation's `SHARED` scope. Kiosk scans and confirmation require an identified active operator for audit, while shared handoff remains excluded from personal badge and owner attribution.
- 2026-09-03: **Added custodian-neutral shared travel-case checkout behavior locally and applied its enum rename.** Staff/Admin can mark an eligible active checkout such as `Football Travel Case` shared without changing its manifest, lifecycle, location, event, scan, allocation, or retained requester history. Shared rows use package identity, suppress borrower/owner actions and personal My Gear/accountability/badge/requester-notification attribution, and let any identified active kiosk operator return the case while preserving actor audit evidence. Gear carried separately remains on a distinct personal checkout. Production migration `0143_shared_checkout_custody` is applied with its exact local checksum; compatible app deployment, authenticated web proof, real checkout conversion, and physical kiosk acceptance remain separate gates.

- 2026-09-03: **Active checkout extensions can use the remaining pre-booking window.** An upcoming serialized booking no longer removes Extend or consumes a mandatory 60-minute buffer when the current booking is an `OPEN` checkout. The borrower or operator may choose a due time up to the next booking's actual start; true overlap and bulk shortages still block. Reservation creation/editing retain the standard turnaround buffer, while optimistic freshness, serializable mutation handling, database overlap protection, audit history, and Live Activity scheduling remain unchanged. Native Booking Detail keeps Extend visible and names the next-needed boundary before the sheet opens.
- 2026-08-26: **Availability feedback now distinguishes blockers from advisories.** Reservation and checkout pickers surface known serialized conflicts before selection, show conflict windows with return-by/available-after recovery guidance, and block review only for actual conflicts or an unavailable availability check. Kiosk scans announce item-specific conflict, shortage, transfer, condition, and timing feedback immediately; capacity-aware bulk turnaround notices avoid warnings when on-hand stock covers both requests. Final kiosk completion and server booking writes remain authoritative.
- 2026-08-26: **Web due-back edits now match the kiosk's forward-only quarter-hour contract.** Shared booking detail, quick-view, legacy edit, and Extend controls continue to offer `00/15/30/45`, but off-grid values now round forward across hour/day boundaries instead of rounding backward or producing an invalid `:60` selection. Active checkout minimums start at the first valid quarter-hour after both checkout start and now, and Extend opens on the next valid step after the later of the stored due time or now. Existing timestamps remain unchanged until an operator confirms an edit. API, permission, audit, availability, and kiosk custody contracts are unchanged. Focused tests, TypeScript, full lint, and the app build pass; authenticated isolated-browser proof is unavailable in this workspace.
- 2026-08-25: **Kiosk scans now explain item conflicts immediately.** A staged item receives item-specific feedback for unavailable status, serialized booking conflict, bulk shortage, or tight turnaround instead of only an unconditional success receipt; the cart remains editable and completion-time transactional availability enforcement is unchanged. Next-needed web rows now state the needed-at and return-by times, with a critical advisory for handoffs within two hours. The shared serialized buffer is enforced on both sides of a new booking window.
- 2026-08-25: **Committed booking edits no longer fall through to false error feedback locally.** Shared checkout title, due-back, notes, owner-transfer, cancellation, and linked-event writes now use a 30-second mutation budget instead of the generic 8-second read timeout. Detail-sheet and linked-event success callbacks run after the request error boundary, so a committed server response cannot be relabeled as a network/save failure by local refresh or close work. A Dia production reproduction also isolated a platform HTTP 412 on the web `If-Unmodified-Since` header even though application stale-write responses are HTTP 409; web mutations now use the application-owned `X-Booking-Updated-At` header, while the API retains legacy-header compatibility for native clients. Real validation, permission, timeout, and optimistic-lock failures remain errors. Focused booking coverage and TypeScript/lint checks pass; deployment and post-deploy acceptance remain open.
- 2026-08-24: **Linked-event capacity expanded.** Checkout records can carry up to 5 scheduled event links through the shared reservation-to-checkout handoff and active-booking relinking, matching the shared API, draft, web, and native picker contracts. Direct kiosk checkout entry remains the single event-or-purpose custody path; the `BookingEvent` junction, chronologically-first `Booking.eventId` primary, gear window, custody state, and return evidence are unchanged. The server/web slice is deployed in `dpl_9cFHwpSQA9QjsQTV3GF3uKf65QtE`; authenticated five-link interaction remains a separate acceptance gate.

- 2026-08-20: **Linked-event editing now stays in the present and future.** The shared booking detail dialog no longer loads unrelated scheduled events that already ended, while existing historical links remain available so operators can review or remove them. The event-link API, booking lifecycle, authorization, allocations, and kiosk custody boundaries are unchanged.

- 2026-08-10: **Badge credit now survives owner transfer.** Opening a checkout writes immutable badge credit keyed to that checkout and opener. A transfer before opening moves future credit; a transfer after opening leaves checkout-count and category-breadth credit with the original opener while the current custodian receives return, on-time, and damage-free outcomes. Migration `0110_badge_rewards` reconstructs a prior opener only from the first ownership transfer recorded after the first kiosk-open audit; pre-open and ambiguous legacy transfers remain with the current requester.

- 2026-08-07: Reconciled checkout cancellation and edit boundaries with D-012
  and D-040. Normal `OPEN -> CANCELLED` is now blocked in both action policy and
  the transaction service; active custody closes only through kiosk return or
  the reasoned admin exception. Unified web/app PATCH rejects checkout equipment
  changes and reservation-only requester, location, or start fields instead of
  silently accepting or mutating custody outside the kiosk. Edit, extend,
  event-link, and transfer services also recheck the edited snapshot inside the
  serializable transaction, and shared edit audit history is written once by
  the service transaction rather than duplicated after commit.

- 2026-08-04: **Booking detail mutation freshness hardened.** Inline title, schedule, and notes saves now apply the server-returned booking snapshot, including `updatedAt`, so a following rename or owner transfer uses the current optimistic-lock value. Owner-transfer retries for the already-committed target now return the committed booking while true stale competing transfers remain conflicts.
- 2026-07-31: **Snow Leopard web contract hardening.** Booking-list quick extend now sends the required `If-Unmodified-Since` value from the row's `updatedAt`, so the shared optimistic-lock route can accept the action instead of returning a missing-header response. Collaborator booking actions remain individually capability-gated, and `DRAFT` rows stay out of the default active booking work queue while remaining recoverable through the Drafts surface.
- 2026-07-21: Direct kiosk checkout suppresses bulk-family turnaround advisories for scanned numbered batteries while preserving hard quantity shortages and exact-unit availability. Future reservations remain family quantity intent until kiosk binding, so a nearby future family booking no longer labels the currently scanned battery group Tight turn. Serialized turnaround behavior and web reservation planning advisories are unchanged.
- 2026-07-21: **Shared web booking detail now uses the native hierarchy without losing control-room depth.** Checkout detail names the requester beside booking identity and surfaces live due or pickup time, pickup location, physical gear count, and linked event context in one compact summary. Inline editing, equipment custody context, operator actions, sync health, and activity history remain web-owned; API payloads, permissions, checkout lifecycle, and kiosk-only custody are unchanged.
- 2026-07-21: The staff/admin `Nudge borrower` action on an overdue `OPEN` checkout now creates its durable inbox reminder and attempts an iOS push through the requester's checkout-overdue preference. The push opens the booking through the existing `bookingId` route and does not change checkout status, due time, allocations, or kiosk return ownership.
- 2026-07-16: **Shared Bookings list interaction-detail polish.** The unified `/bookings` surface now keeps Active/Past and card/list controls, reservation creation, filter recovery, sortable headers, and pagination on the 40px desktop target baseline. Sort headers are keyboard-operable buttons with accessible sort state and contextual icons that transition without replaying on initial render. Booking cards and mobile rows use precise 0.96 press feedback, cards gain restrained hover lift, and requester photos use neutral black/white image outlines. Checkout visibility, action permissions, lifecycle policy, kiosk custody, filters, and list data are unchanged.
- 2026-07-16: **Quick-view equipment identity cleanup.** Serialized equipment rows now pair the Gotham asset tag with the product name as supporting context. Brand/model remains a fallback when a product name is absent, while the serial number is no longer repeated in the quick-view row. Numbered family units remain directly visible, and custody behavior is unchanged.
- 2026-07-16: **Checkout quick-view custody alignment.** The shared sheet now uses urgency-aligned status color, weekday-first schedule formatting, explicit inline title/date/notes saves, and direct numbered-unit labels. It removes broad Edit booking and active-checkout Edit equipment controls; kiosk remains the only normal surface for changing checkout contents, while Open full booking and permission-gated secondary actions remain available.
- 2026-07-16: **Shared booking sheet hierarchy refresh.** Checkout sheets now lead with the due window and urgency, condense pickup and creation context, and keep equipment as the main working section. Full detail remains directly available; transfer, event relinking, and cancellation move into the named More actions menu without changing their permission or mutation contracts.
- 2026-07-15: Booking titles now normalize at every current checkout title write path, including kiosk event/purpose creation, reservation pickup through the shared lifecycle service, shared booking edits, and active-kiosk edits. Canonical UW sport codes remain uppercase while ordinary all-caps or lowercase words become title case; connectors such as `at` and `vs` stay lowercase, whitespace is collapsed, and camel-case product names are preserved.
- 2026-07-10: **Booking equipment tab annotation polish.** Upcoming-commitment and risk annotations on equipment rows move from raw Tailwind color literals to semantic status tokens (`--blue-text`, `--orange-text`, `--red-text`) at readable 11px. Visual only.
- 2026-07-10: **Bookings list visual refresh shipped.** Shared booking list rows/cards (`/bookings` table, card grid, and mobile rows) now show status as the semantic `Badge` variant beside the ref number under the title, replacing the tiny uppercase letterspaced mono ref/status lines. COMPLETED rows no longer render at 60% opacity, so the Past scope reads as data instead of a disabled page (muted title is kept; CANCELLED keeps strikethrough). The table's Items column now shows the item thumbnail stack (shared `GearAvatarStack`) with the count, and date/duration cells drop the forced mono styling for standard tabular text. No behavior, data, or route changes. The booking detail activity timeline now annotates return rows (`kiosk_checkin`, `checkin_completed`, `items_returned*`) that land after the booking's final due date with an amber "N minutes/hours/days late" note (Cheqroom-inspired; compares against `booking.endsAt`, which extends keep current). `auto_completed_by_kiosk_checkin` / `_bulk_checkin` now render as "Booking completed by the kiosk/bulk return" with the kiosk scan icon instead of raw fallback text, and the collapsed activity preview line labels the auto-complete actions properly.
- 2026-07-09: **Kiosk active-checkout item editing polish shipped.** Scans now add immediately through the existing custody mutation, and exact active serialized assets or numbered units can be selected and removed from the equipment list with confirmation. Existing location scope, availability checks, serializable transactions, stock/allocation updates, and audit evidence are unchanged.
- 2026-07-09: **Checkout event relink hardening shipped.** Stale duplicate event-link saves now return success when the requested event set already matches the current checkout, while true stale conflicts still return 409. Regression coverage pins route validation, missing-event handling, terminal booking rejection, active checkout support, and the invariant that relinking only updates event context rows.
- 2026-07-09: **Checkout event relinking shipped.** Existing editable checkouts now expose `Edit events` from the full detail page and shared detail sheet. `POST /api/bookings/[id]/events` relinks up to 3 scheduled events with the existing `Booking.eventId` primary plus `BookingEvent` junction contract and `events_updated` audit history. Relinking does not change checkout custody, item allocations, return evidence, gear window, or kiosk return execution.
- 2026-07-09: **Booking owner transfer correction shipped.** Student requesters/creators can now transfer their own active bookings; staff/admin can still transfer any active booking. Checkout custody, kiosk return execution, item allocations, and creator provenance remain unchanged.
- 2026-07-09: **Booking owner transfer shipped.** Shared checkout detail exposes `Transfer owner` when `allowedActions` includes `transfer-owner`. The action posts to `POST /api/bookings/[id]/transfer-owner` with the same `If-Unmodified-Since` optimistic-lock contract as edit/extend, updates only `Booking.requesterUserId`, preserves `createdBy`, validates the target user is active and visible, and writes an `owner_transferred` audit entry. It does not change kiosk custody, item allocations, return evidence, or creator provenance. New coverage: `tests/booking-transfer-owner-route-contract.test.ts`, `tests/transfer-booking-owner.test.ts`, and `tests/decision-contracts.test.ts`.
- 2026-07-08: **Extend optimistic-lock parity shipped.** Same shared fix as `AREA_RESERVATIONS.md` — `POST /api/bookings/[id]/extend` now requires and validates `If-Unmodified-Since` matching the main PATCH route's contract (428 missing, 400 invalid, 409 stale), closing a fresh-audit finding where a stale tab's quick-extend could silently succeed against a checkout someone else had just changed. New coverage: `tests/booking-extend-route-contract.test.ts`.
- 2026-07-06: **Check-in ledger unification shipped.** Bulk returns now restock stock at the moment of physical return on every path (kiosk unit scans, admin-override scans, web partial bulk check-in), and all completion paths (`maybeAutoComplete`, `markCheckoutCompleted`, `forceCompleteCheckout`) reconcile outstanding stock from movement truth via `settleBulkLedgerAtCompletion` instead of field math, ending the double-restock/under-restock split that corrupted on-hand balances when a checkout mixed kiosk and web return paths. Serialized check-in flows were audited and unchanged (membership, already-returned, and SERIALIZABLE guarantees were already sound). Full detail in `AREA_BULK_INVENTORY.md` and `tasks/archive/checkin-hardening-plan.md`.
- 2026-07-06: **Booking lifecycle hardening shipped.** Checkout equipment edits are now diff-based instead of delete-all-rebuild: bulk quantity changes write matching CHECKOUT/CHECKIN stock movements so `BulkStockBalance` (which availability reads) stays true, SKU rows with kiosk custody activity (checked-out quantities, partial check-ins, numbered unit allocations) reject web edits with a 409 that routes staff to kiosk check-in, already-returned serialized items can no longer be silently flipped back to active by an equipment edit, and unchanged rows are left untouched so unit-allocation custody history survives. Also: extend now rejects bulk shortages in the extended window (not just serialized conflicts), createBooking and reservation requester changes validate the requester exists and is active (FK 500s and inactive custodians eliminated), and the unused `status` passthrough on reservation updates is removed. Plan: `tasks/archive/bookings-hardening-plan.md`.
- 2026-07-03: Checkout return Live Activities now support server push-to-start. The app registers ActivityKit start tokens for the signed-in borrower, the server starts due or recently overdue `OPEN` checkout return cards by APNs liveactivity pushes, and APNs-started cards register their per-activity update token so return-time changes, Extend, cancel, or kiosk/admin return completion can still update or dismiss the card. Return execution stays kiosk/admin-owned under D-040.
- 2026-07-03: Kiosk direct checkout location scope hardened. Kiosk checkout availability preflight and completion now ignore client-supplied `locationId` and use the authenticated kiosk session location as the source of truth, while keeping the older payload field tolerated for rollout skew.
- 2026-07-03: Shared booking edit and extend mutations now map commit-time SERIALIZABLE conflicts and allocation/exclusion constraint races to controlled 409 booking conflict responses. Checkout due-date, location, and equipment edits keep the same preflight availability checks and audits, but a race that happens between preflight and commit no longer leaks as an internal error.
- 2026-07-02: Native iOS Bookings list freshness pass prevents checkout ghost rows by removing normal-list rendering from the 24-hour SwiftData booking cache. The Bookings tab now uses a native `Mine / All / Attention` scope, synthesizes attention checkout rows from existing overdue, due-today, and active pending-pickup reads, shows a quiet updated/refreshing footer, and keeps direct checkout creation out of app/web by labeling the toolbar action `New Reservation`.
- 2026-07-01: Shared booking PATCH now treats stale duplicate edits as idempotent only when the submitted fields already match the current checkout, including due-back changes. The first save still owns the audit entry, while real stale competing due-date edits continue to return 409 conflict responses.
- 2026-06-30: Checkout title and notes-only edits no longer rerun availability checks or rebuild equipment rows. Due-date, location, and equipment edits still revalidate availability and update allocation windows, but harmless metadata edits can no longer fail with conflict copy on an already-live checkout.
- 2026-06-30: Native iOS booking detail action styling now uses SwiftUI bordered system buttons for Extend and Cancel instead of glass/custom-looking buttons. The action matrix, duplicate-submit guards, kiosk custody boundaries, and destructive cancellation semantics are unchanged.
- 2026-06-29: Native iOS checkout detail now guards Save, Extend, and Cancel handlers before sending booking mutations. A rapid duplicate tap can no longer make a successful due-back edit show the stale-write "modified by someone else" message or duplicate adjacent checkout actions while the first request is in flight.
- 2026-06-29: Native iOS checkout detail notes editing now uses a multiline editor and preserves the existing optimistic-lock PATCH path while sending an explicit empty string when notes are cleared. This fixes the native clear-notes path without changing checkout lifecycle, kiosk custody, or server mutation contracts.
- 2026-06-28: Native iOS checkout-return Live Activities shipped for active borrower checkouts. The ActivityKit surface watches the user's most urgent `OPEN` checkout, starts inside the 30-minute return window or earlier for near next-use gear, shows exact return time plus minute/second countdown behavior by system surface, gates Extend when upcoming commitments exist, and registers Live Activity push tokens so kiosk/admin checkout completion can send an APNs `end` event and dismiss the card. Standard return execution remains kiosk-owned under D-040.
- 2026-06-27: Shared booking-list extension and initial-load failures now use checkout-safe recovery copy that says the booking was not extended or the list should be retried before acting, replacing generic network and temporary-error wording.
- 2026-06-26: Checkout list and full checkout detail now surface the shared booking-change sync health via the shadcn-backed status indicator. This keeps checkout freshness visible on the operator list/detail surfaces while preserving D-040: checkout custody creation and standard returns remain kiosk-owned.
- 2026-06-26: Equipment picker asset-tag sorting now uses the refined family-group comparator, so repeated lenses and bodies stay in readable blocks such as unprefixed `70-200` copies followed by `FB 70-200` copies instead of alternating by unit number.
- 2026-06-26: Equipment picker serialized and bulk row sorting now uses the shared Items asset-tag comparator. The picker no longer uses hidden checkout popularity as its default ordering, so prefixed team/department rows such as `FB FX3 2` group with the real `FX3` family instead of drifting away from related gear.
- 2026-06-26: Shared EquipmentPicker serialized selection is now window-aware. Current `CHECKED_OUT`, `PENDING_PICKUP`, or active `RESERVED` holdings are selectable for future reservation windows when the holder's due-back time is at least 60 minutes before the requested start; tighter handoffs, maintenance/retired/unavailable capability states, and overlapping conflicts remain blocked.
- 2026-06-25: Admin close-without-scan exception shipped. Checkout detail now exposes an admin-only reasoned override for `OPEN` checkouts when all gear has been physically verified but cannot be scanned. `POST /api/bookings/[id]/force-complete` marks serialized items returned, restores outstanding bulk stock, marks returned numbered units available, closes open check-in scan sessions, writes `OverrideEvent` plus audit evidence, emits returned badge events, and leaves retired app/web check-in endpoints blocked.
- 2026-06-24: Booking real-time sync Slice 4. Checkout list/dashboard read freshness now shares the booking-change signal used by reservations; while the browser smoke used a reservation mutation, the same shared `/bookings` list hook invalidates checkout tabs and dashboard checkout rows from committed booking-change evidence without adding app/web custody mutation paths.
- 2026-06-22: Booking status display cleanup. Checkout detail helpers, booking-list rows/cards, and item booking history now resolve labels and badge/status colors through `src/lib/booking-status-display.ts`, preserving D-025 display-only labels without route-local booking status switches.
- 2026-06-22: Booking action policy cleanup. Booking-list UI actions now use the same shared app/web action policy as server-side booking rules, so OPEN checkouts no longer advertise app/web check-in actions under the D-040 kiosk-only return contract.
- 2026-06-20: Checkout list filters inherit the refreshed shared `FilterChip` and active-filter chip treatment: lighter borders, 40px removable targets, active underline, and quieter applied-filter buttons while preserving the existing clear behavior and booking filter semantics.
- 2026-06-20: Checkout list filters inherit the lighter shared `OperationalToolbar` shell, keeping existing search/filter semantics while reducing the card-like frame around the command row.
- 2026-06-20: Checkout detail inline-edit rows inherit the refreshed shared `SaveableField` dirty-row treatment, keeping title/notes save semantics while making pending save/cancel actions visually explicit and 40px target sized.
- 2026-06-15: Kiosk-only custody Slice 3. Web and non-kiosk iOS no longer expose checkout creation, reservation-to-checkout conversion, or return controls; checkout pages remain available for active custody visibility and history, while `/checkouts/new` redirects to reservation creation.
- 2026-06-15: Server-side kiosk-only custody boundary shipped. `/api/checkouts` POST now rejects app/web checkout creation, app/web checkout pickup/return scan-session and completion routes reject custody mutation, and the shared `createBooking()` service refuses checkout creation unless the caller explicitly marks kiosk custody. Focused regressions cover checkout creation, retired reservation conversion, action gating, and blocked web return routes.
- 2026-06-15: Accepted the kiosk-only custody contract (D-040). Checkout records remain the custody ledger, but direct checkout creation and return are kiosk-only; app/web creation becomes reservation-first. `PENDING_PICKUP` remains only as compatibility/staged handoff work, not the normal result of app/web checkout creation.
- 2026-06-10: Web checkout Step 1 now preserves the booking duration when the Pickup/Start time changes, matching the iOS reservation sheet behavior. Verified with focused Vitest coverage, TypeScript, whitespace check, and authenticated local browser smoke on `/checkouts/new`; the smoke also found no visible `\u2026` escape literals or console warnings/errors.
- 2026-06-10: Web checkout creation audit/polish pass (refresh Slice 6). Fixed Step 1 requester/location placeholders and the Step 3 empty-equipment notice rendering literal `\u2026`/`\u2014` escape text (JSX attributes/text do not process JS escapes), aligned the header kind badge to the canonical blue (was red), aligned the Step 3 notes card and availability alert to the review panel width, removed a dead nested notes conditional, switched Step 1 event loading to geometry-preserving skeleton rows, and raised step chips, picker tabs, tray chip remove buttons, and quantity steppers to the 40px hit-target baseline with a more prominent final submit action.
- 2026-06-08: Web checkout creation visual refresh shipped. `/checkouts/new` now promotes the selected event/booking title instead of a generic New Checkout hero, uses a quieter creation-page breadcrumb, replaces dense Step 1 admin rows with local stacked field groups, compresses Step 2 helper copy, removes unused picker tab counts and select-visible action, uses row skeletons for picker loading, keeps footer navigation tied to review instead of category browsing, compresses selected equipment into removable tray chips, and presents confirmation as a calmer Apple-like review panel while preserving multi-event, draft, availability, and kiosk-pickup contracts.
- 2026-06-06: Web checkout creation kit-list recovery shipped. `/checkouts/new` now treats failed location-scoped kit reads as a retryable inline optional-kit error instead of silently removing the Kit control, while preserving true no-kit behavior, ad hoc/event-linked creation, drafts, equipment selection, and checkout payload contracts.
- 2026-06-06: Web checkout creation event-list recovery shipped. `/checkouts/new` now treats failed upcoming-event reads as a retryable inline calendar error instead of the same state as no upcoming events, while preserving the ad hoc booking path, multi-event selection, draft behavior, and checkout payload contract.
- 2026-06-05: iOS Bookings empty-state recovery shipped for native checkouts. Search-empty states now offer Clear search and Mine-only empty states offer Show all visible bookings, so checkout users can recover from filters without leaving the list.
- 2026-06-03: iOS Create Booking control clarity shipped for the native reservation create sheet used by mobile field flows. The sheet now names the next step as Choose Equipment, names submit as Create Reservation, and keeps selected equipment visible with Remove controls while preserving checkout custody and scan recovery contracts.
- 2026-06-03: iOS Booking Detail control clarity shipped. Native checkout detail now shows a labeled `Edit` toolbar action when editing is allowed, and owner-access checkouts that are no longer editable show an `Editing locked` notice pointing to Extend Return Date or kiosk pickup/return instead of silently removing the edit affordance.
- 2026-06-03: iOS checkout edit contract aligned with shared booking hardening. Native `BookingDetailView` now decodes the booking snapshot `updatedAt` defensively and sends it as `If-Unmodified-Since` on `/api/bookings/[id]` PATCH calls, so checkout edits use the same stale-write rejection path as web while older payloads can still decode.
- 2026-06-03: iOS active Checkouts list contract aligned with web and this area spec. `APIClient.checkouts(activeOnly: true)` now requests `status_in=OPEN,PENDING_PICKUP` so awaiting-pickup checkouts stay visible in the native Checkouts work queue instead of only appearing on Home or kiosk surfaces. No server contract change required.
- 2026-06-02: Manual multi-day all-day event linkage support shipped for checkout creation. Linked all-day events now keep their manual summary, derive the booking window from the full event span without timed-game buffers, and show all-day range copy in the event picker and confirmation review while preserving existing `eventIds[]`, `Booking.eventId`, and `BookingEvent` semantics.
- 2026-06-02: Custody confidence slice 5. Shared checkout detail sheet history pagination now surfaces stale-cursor, access-change, server, network, and malformed-response failures inline, with retry or refresh recovery instead of silently hiding older audit entries.
- 2026-06-02: Custody confidence slice 4. Successful checkout cancellation from the `/bookings` active list now removes the row from the visible work queue and refreshes the list, so operators do not keep seeing a cancelled checkout inside Active Checkouts after the server accepts the mutation.
- 2026-06-02: Custody confidence slice 2. Full checkout detail no longer passes the bulk check-in mutation into the desktop equipment table, so open checkouts show kiosk return handoff instead of a contradictory `Return All` web button. Shared detail/sheet action copy now describes reservation conversion as a pending pickup whose custody still begins at kiosk pickup.
- 2026-06-02: Custody confidence slice 1. Checkout creation now preserves explicit multi-event `eventIds[]` payloads when `sportCode` is present instead of synthesizing a legacy `eventId`, preventing valid event-linked pickup creation from failing before the pending-pickup record is created.
- 2026-05-30: Battery adjustment follow-through. Battery Ops now shows both unit-tracked and quantity-tracked battery families so staff can correct counts with audited reasons before those live counts feed checkout creation.
- 2026-05-30: Battery bulk-item hardening started. Checkout picker bulk counts now come from no-store form options, selected battery quantities show requested versus currently available counts, and refreshed lower availability automatically clamps or removes selected bulk quantities with visible recovery copy.
- 2026-05-30: Booking create UX ownership pass. Checkout creation now shows event-linked versus ad hoc context before Step 1 completion, carries selected hard-conflict, next-use, and turnaround warning counts through Step 2 and confirmation, and improves success feedback before opening `/bookings` with the new pickup highlighted.
- 2026-05-30: Booking create hardening. Shared checkout creation now rejects empty non-source payloads, duplicate `eventIds`, duplicate bulk lines, and invalid create windows before booking writes. Exclusion-constraint and serializable overlap races now return 409 conflict responses instead of leaking server errors.
- 2026-05-25: Web bug sweep Batch 29. Checkout row overflow and context-menu "Check in" now opens the booking detail sheet directly at the Equipment section instead of dropping operators at the top of the sheet.
- 2026-05-25: Web bug sweep Batch 28. Booking detail sheet deep links now preserve `sheetTab=equipment|history` through `/bookings` mounted-route handoff, clear the consumed URL parameter, and focus the requested detail section after the sheet data loads.
- 2026-05-25: Web bug sweep Batch 21. Shared checkout/booking lists now safe-parse list responses, context-menu mutations use a ref-backed duplicate-submit guard, and menu extend actions always release their busy state through `finally`. Full checkout detail actions now also clear action locks through `finally`, expired-session inline saves throw instead of locally patching false success, extend presets safe-parse their settings response, and shared edit/search/date controls expose stable form metadata.
- 2026-05-24: Web bug sweep Batch 18. Checkout creation, EquipmentPicker search/scan/hydration, event context loading, kit loading, draft resume/save, form-options, booking detail reads, and equipment conflict previews now use shared auth redirects and safe response parsing where applicable. Malformed JSON on checkout create, draft save, and availability check routes now returns 400 before booking, draft, or availability service work.
- 2026-05-24: Web bug sweep Batch 7. Shared checkout detail sheets now safe-parse detail, form-options, audit-log, edit, equipment-save, and conversion responses, and their mutation handlers use ref-backed guards so stale React state cannot double-submit save, extend, cancel, convert, or admin check-in actions.
- 2026-05-21: Design language Area 6 shared-component consolidation. Checkout list filters now use `OperationalToolbar`, shared active-filter chips, and 40px shared filter controls instead of the previous route-local card-header filter row.
- 2026-05-21: Design language Area 5 state/copy audit. Shared booking detail copy now names checkout cancellation, kiosk custody handoff, check-in, equipment-save, and extension consequences instead of using generic failure or yes/no confirmation text.
- 2026-05-21: Shared checkout `EquipmentPicker` controls now follow the 40px operational target baseline for search clear, scanner close, select-visible, clear-section, bulk quantity, selected-shelf remove, and clear-all actions.
- 2026-05-20: Booking row overflow actions now use the shared `OperationalRowActions` trigger in table rows, mobile rows, and booking cards while preserving right-click context menus and booking action policy.
- 2026-05-13: EquipmentPicker battery guidance now recommends compatible battery families when cameras are selected, keeps battery selection quantity-first, labels selected item-family quantities as requested, and reminds staff that exact units are scanned at kiosk pickup.
- 2026-05-13: **Pending-pickup auto-expiry** - GAP-33 closed. Morning-refresh now cancels `PENDING_PICKUP` checkouts older than 48 hours after `startsAt`, releases serialized allocations, restores held bulk stock, releases any scanned numbered units, cancels scan sessions, and writes a system audit entry.
- 2026-05-10: **Status/data wiring ship fixes** - Cancelling `PENDING_PICKUP` and `OPEN` checkouts now restores outstanding bulk stock, releases scanned numbered units, and clears allocations/scan sessions atomically. Booking list route semantics now preserve explicit status filters instead of widening special filters over them, and search/calendar surfaces only pull schedule-active booking states by default.
- 2026-03-01: Initial standalone area scope created.
- 2026-03-01: Rewritten into hardened V1 workflow, logic, and failure-mode spec.
- 2026-03-02: Added explicit mobile contract dependency and list-action alignment.
- 2026-03-09: Added Equipment Picker section (kit-first sectioned flow, locked progression, guidance rules, conflict feedback). Added DRAFT booking state. Reflected shipped implementation from PRs 22–25.
- 2026-03-11: Docs hardening — added `booking-rules.ts` as action matrix source of truth. Added cancel-on-OPEN staff-only rule. Updated AREA_PLATFORM_INTEGRITY ref to DECISIONS.md. Marked V1 as shipped.
- 2026-03-15: Equipment Picker V2 — extracted into standalone component. Added checkbox multi-select, per-section search, availability preview badges, and scan-to-add QR overlay.
- 2026-03-16: Booking reference numbers (D-024) — CO-XXXX format, global sequence, searchable, monospace badge in list/detail.
- 2026-03-17: **Shift context banner** — when creating a checkout tied to an event, shows "Your shift: AREA time–time" banner with gear status if user has a shift assignment for that event.
- 2026-03-22: **Unified detail page** — Checkout and reservation detail pages unified via shared `BookingDetailPage` component. Extracted `useBookingDetail` + `useBookingActions` hooks. Old `/api/checkouts/[id]` GET redirects to `/api/bookings/[id]`. PATCH returns enriched detail with before-snapshot audit. Shared `InlineTitle` component. Accessibility + dark mode hardening.
- 2026-03-22: **Detail page UX polish (3 rounds)** — (1) Auto-select all returnable items, info card heading, mobile-friendly buttons, faster countdown tick, reload spinner, consistent padding, InlineTitle save feedback, collapsible history preview, hover consistency. (2) Optimistic checkin, progress bar, success toasts, quick-extend from picker value, re-select after partial return. (3) shadcn Breadcrumb/Collapsible/ToggleGroup/Alert replacements. Status vocabulary: OPEN→"Checked out". Action buttons redesigned: `[Actions ▼] [Edit] [Extend] [Check in]`. Equipment row context menus. Avatar initials on people fields. Due-back as urgency Badge. Natural-language activity labels.
- 2026-03-22: **iPhone mobile polish** — Detail page header stacks title above buttons on mobile (`flex-col sm:flex-row`). Equipment card header stacks title above return actions on mobile. Row action menus always visible on touch (hover-reveal only on sm+).
- 2026-03-23: **Scan page hardening (5-pass)** — (1) Design system: Progress bar, Badge, Alert, Skeleton replace custom CSS (-35 lines dead CSS). (2) Data flow: refresh-preserves-data, 401 handling on all endpoints, double-click ref guards, processingRef consistency. (3) Resilience: auto-clear scan feedback (5s/8s), try/catch/finally on numbered bulk flow, spam-click guards on unit picker. (4) UX: optimistic checklist update on scan success, Loader2 spinners on all async buttons.
- 2026-03-24: **Equipment Picker: shadcn alignment + performance + a11y** — (1) Replaced raw HTML checkboxes with shadcn `Checkbox`, raw buttons with shadcn `Button`, status "Added" span with `Badge`. (2) Added `assetById`/`bulkById` Maps for O(1) lookups replacing O(n) `.find()` in render loops. (3) Full ARIA: `role="tablist/tab/tabpanel/listbox/option/dialog"`, `aria-selected`, `aria-pressed`, keyboard nav (Arrow keys for section tabs, Space/Enter for item toggle, Escape for scanner). (4) `cn()` for all className merging. CSS updated for shadcn Button reset in footer tags.
- 2026-03-24: **Item Picker — global search, photos, bulk toggle fix** — (1) Cross-section global search: persistent search bar above tabs filters all assets across every section simultaneously. Arrow key navigation + Enter to select/deselect highlighted item. Section badge shown per result. Escape clears search. (2) Asset thumbnails in chosen items footer: selected item tags now show imageUrl thumbnail (18×18px) when available, both in open picker footer and closed summary. (3) Bulk item toggle fix: clicking a selected bulk item now deselects it (previously no-op with `if (isSelected) return`). (4) API: form-options now includes `imageUrl` in asset select.
- 2026-03-24: **Equipment Picker stress test** — (1) Scan-to-add now checks `computedStatus` before selecting — MAINTENANCE/CHECKED_OUT items rejected with status feedback. (2) Rapid-scan race condition fixed with callback-level duplicate guard. (3) Bulk quantity stepper capped at `currentQuantity` with qty/max display.
- 2026-03-24: **BookingDetailsSheet stress test** — (1) CRITICAL: `cancelBooking()` and `cancelReservation()` upgraded from READ_COMMITTED to SERIALIZABLE isolation, matching all other booking mutations. Prevents concurrent cancel race creating duplicate audit entries. (2) HIGH: null-safe guards on `enterEquipEditMode` array access. (3) MEDIUM: double-submit guards on `handleSave`/`handleEquipSave`. (4) MEDIUM: empty-payload PATCH skipped with "No changes to save" toast.
- 2026-03-24: **BookingDetailsSheet hardening (4-pass)** — (1) Design system: custom tab buttons → shadcn Tabs, Spinner → Skeleton, raw textarea → shadcn Textarea, .conflict-error → shadcn Alert, .progress-* → shadcn Progress, .filter-chips → ToggleGroup, .timeline-* → Tailwind with cn(). Removed ~120 lines dead CSS. (2) Data flow: AbortController on fetchBooking prevents stale data overwrite, all 7 fetch calls use fetchWithTimeout, silent refresh after mutations preserves visible content, 401 handling redirects to login on all endpoints. (3) Resilience: Retry button on fetch error, null-safe guards (?? []) on all booking arrays, checkinLoading guard on handleCheckinItem. (4) UX: extend toast shows new date ("Extended to Mar 28"), cancel confirmation names type and consequence, checkin toast includes item tag.
- 2026-03-24: **Equipment Picker hardening (4-pass)** — (1) Design system: removed 48 lines dead CSS (old picker styles, raw checkbox styles, broken `:has(input:disabled)` selector), removed dead `highestReached` state + `sectionIndex` import. (2) Data flow: `selectedIdSet` (Set) replaces O(n) `.includes()` per row; AbortController on availability fetch prevents stale response overwrite on rapid date changes. (3) Resilience: scan already-selected items shows "already selected" feedback; availability errors show orange "retry" link; scan feedback timer cleaned on unmount. (4) UX: scan "not found" gives location context; empty section with "Only available" active links to "show all"; availability retry inline.
- 2026-03-25: Doc sync — standardized ACs to checkbox format, all 7 checked.
- 2026-03-25: **Booking page hardening (5-pass)** — (1) Design system: error state → shadcn Alert with destructive variant, removed dead `statusBadge` config and duplicate export. (2) Data flow: `useBookingDetail` rebuilt with AbortController (prevents stale data on rapid id changes), 401/403 redirect, differentiated error types (not-found/network/auth/server), reload-preserves-data pattern. `BookingListPage` list fetch hardened with AbortController + 401 redirect + skeleton-only-on-initial-load. `useBookingActions` callAction + saveField: 401 redirect on all mutation endpoints. (3) Resilience: all 4 context menu handlers (cancel/convert/duplicate) upgraded with 401 redirect via fetchAction helper, success toasts on cancel/duplicate, cancel confirmations state irreversibility, null-safe checkin guard. (4) UX: manual refresh button with RefreshCw icon + tooltip, extend toast shows new date ("Extended to Mar 28").
- 2026-03-25: **Kit-to-booking integration (GAP-18)** — `kitId` FK on Booking model, kit selector in CreateBookingSheet, kit badge on booking detail page.
- 2026-03-25: **Overdue priority sort** — Overdue bookings now float to top of checkout and reservation list pages via client-side re-sort in `BookingListPage`. Longest-overdue items appear first within the overdue group. Time labels switched to explicit format ("3 days 2 hours overdue").
- 2026-03-26: **BookingListPage hardened (5-pass)** — Extend action now shows success toast ("Extended by N day(s)"). Error state differentiates network ("You're offline" + wifi-off icon) from server ("Failed to load" + clipboard icon). All 8 resilience scenarios verified.
- 2026-03-31: **Booking sheet deep links** — (1) Redirect pages forward all URL search params to `/bookings`. (2) Dashboard buttons ("New checkout", "New reservation", "Prep gear", event dropdown) open CreateBookingSheet in-place on the dashboard — no page navigation. (3) Event-context buttons auto-fill sport, event tie-in, title, dates, and location. (4) Item detail "Check out"/"Reserve" deep-link with `?newFor=assetId` to pre-select the asset. (5) `initialEventId`/`initialSportCode` props added to CreateBookingSheet for event auto-selection.
- 2026-03-30: **Photo requirement + scan-only checkin (D-028)** — (1) New `BookingPhoto` model stores condition photos per booking per phase (CHECKOUT/CHECKIN). (2) Camera-only `PhotoCapture` component captures still frames via `getUserMedia`. (3) `PhotoCaptureDialog` intercepts completion flow on scan page — photo must be taken and uploaded before checkout/checkin can complete. (4) Photos uploaded to Vercel Blob (`bookings/{id}/{phase}/`), stored as `BookingPhoto` records. (5) `completeCheckoutScan()` and `completeCheckinScan()` now enforce photo existence (admin override bypasses). (6) Manual checkbox-based item return removed from `BookingEquipmentTab` — all checkins now require scan-based flow. (7) "Complete check in" dropdown action removed from detail page. (8) Condition photos displayed in booking info tab with checkout/checkin grouping, actor attribution, and clickable full-size view.
- 2026-04-06: **Auth permission gates** — (1) `GET /api/bookings/[id]/audit-logs` now enforces `requireBookingAction(id, user, "view")` — students can only see audit logs for their own bookings. (2) `POST /api/checkouts/[id]/photo` now checks student ownership — students can only upload photos for their own checkouts.
- 2026-04-09: **Booking flow overhaul** — (1) Creation flow moved from side-sheet to full-page 3-step wizard at `/checkouts/new`. Steps: Context & Details → Equipment → Confirmation. (2) BookingDetailsSheet gains 3rd "Equipment" tab with unreturned badge count, scan-to-return (inline camera, local QR lookup, audio/haptic feedback), and full EquipmentPicker in edit mode (QR scan-to-add, section tabs, availability conflicts). (3) `CreateBookingSheet` and `BookingEquipmentEditor` deleted — replaced by wizard pages and EquipmentPicker respectively. (4) Asset thumbnails (`<AssetImage size={36}>`) added to all equipment rows (items, editor, picker). (5) Bulk qty stepper capped at `currentQuantity`, touch targets 32px→44px. (6) Stress-tested: 12 issues found, 8 fixed (broken redirect URL, stale scan state, date validation, audit log deps, draft save await, form-options error state).
- 2026-04-09: **EquipmentPicker rebuild + hardening (5-pass)** — (1) Rebuilt from scratch: full-row button toggles (no separate Checkbox — fixes double-fire bug), CheckCircle2/Circle selection icons, selected items shelf at bottom with thumbnails + remove buttons. (2) Extracted `useConflictCheck` hook — availability re-fires on selectedAssetIds changes (was stale ref bug). Removed 3 deprecated no-op props (visible, onDone, onReopen). Removed dead legacyMode path. (3) Dead `sectionCounts` useMemo removed. (4) `usePickerSearch` now tracks `searchError` state — picker shows "Failed to load equipment" instead of misleading "Nothing available" on 500/network errors. (5) Wizard Step 2 now requires ≥1 item before advancing. 401 handling + res.json() crash guard added to wizard submit. `initialSheetTab` cleared on sheet close to prevent stale tab persistence.
- 2026-04-24: **Multi-event booking V1 (D-031)** — Checkouts and reservations can now link up to 3 calendar events via the new `BookingEvent` junction table. Wizard Step 1 multi-select with chip strip + cap-enforced rows. `startsAt`/`endsAt` auto-derive min-to-max across selected events with the existing travel buffer. API accepts `eventIds[]` (mutually exclusive with legacy `eventId`); `POST /api/bookings/[id]` response includes `events[]` sorted by ordinal. `Booking.eventId` preserved as the primary (ordinal 0) so all 36+ existing readers keep working unchanged. Migration `0042_booking_events` backfills a junction row for every legacy booking.
- 2026-04-29: **Wizard polish + notes surfaced** — `notes` (10k chars, optional) is now editable in Step 1 textarea, persisted through draft save/load (`/api/drafts` schema updated), and shown in Step 3 confirmation. Step 3 multi-event display gains per-event date, home/away badge, and a `Primary` tag on the chronologically-first event for clarity in 2- and 3-event bookings. Required-field asterisks on title/requester/location/dates. Draft-banner dismissal persists 1h via sessionStorage to reduce nag for users who intentionally abandoned a draft. Inline comment in `BookingWizard.tsx` now states the multi-event contract explicitly (always `eventIds[]`, never `eventId`).
- 2026-04-30: **Booking + scan hardening wins** — (1) Booking detail condition photos now use `next/image` in `BookingInfoTab` (removed lint bypass for raw `<img>`). (2) `useScanSubmission` and `useBookingActions` now use shared safe JSON parsing helpers from `src/lib/errors.ts` instead of ad-hoc `.json().catch(() => ({}))` swallowing. (3) Added operational DB indexes for `notifications.sent_at`, `override_events.created_at`, and `bulk_stock_balances.bulk_sku_id` (migration `0049_add_operational_indexes`).
- 2026-05-05: **Event command checkout context** — Missing-gear "Create checkout" links now preserve `requesterUserId` through the booking list redirect into `/checkouts/new`, so the wizard opens for the assigned crew member instead of defaulting back to the current user.
- 2026-05-05: **Bulk battery creation hardening** — Battery selection remains quantity-only at booking creation. Camera body battery guidance is now a warning, and compatible battery low-stock warnings appear when available units fall below threshold.
- 2026-05-05: **Camera battery compatibility mapping** — Creation warnings now match the current import snapshot for Sony NP-FZ100 bodies (FX3, A7/A1/A9 family) and Sony BP-U bodies (FX6). The same compatibility rules also feed the admin Battery Cockpit low-family panel as of 2026-05-06. Drone/action/JVC battery reporting remains deferred until matching SKUs exist.
- 2026-05-06: **Booking filter HTML cleanup** — Shared `FilterChip` active clear controls are now sibling buttons instead of nested buttons inside the popover trigger, clearing the booking-list hydration warning. Booking search fields now carry stable `id`/`name` attributes.
- 2026-05-06: **Bookings ownership pass** — `/bookings` tab changes now update URL state for shareable All/Checkouts/Reservations views. The All tab is active-only by default (`DRAFT`, `BOOKED`, `PENDING_PICKUP`, `OPEN`) until a separate past toggle is shipped, and it uses each row's real checkout/reservation kind for allowed actions. Desktop equipment counts now include bulk planned quantities instead of counting one bulk SKU as one item. The page-level tabs and view switcher now match the local shadcn tab underline and ToggleGroup patterns.
- 2026-05-07: **Avatar and shadcn cleanup** — Booking cards now render equipment through the shared item thumbnail stack instead of person-avatar primitives, and booking list filter clears use shadcn `Button` variants instead of one-off raw buttons.
- 2026-05-07: **Bookings past-scope toggle** — `/bookings` now has a URL-backed Active/Past scope. The All tab remains active-only by default through `active=true`; switching to Past sends `past=true` through combined, checkout, and reservation list APIs so completed/cancelled records are intentionally separated from daily active work.
- 2026-05-07: **Booking creation ownership pass** — `/checkouts/new` now uses the documented 30-day event picker window in the browser, and draft save/resume preserves multi-event links through `/api/drafts` so interrupted event-linked checkouts reopen with their selected events intact.
- 2026-05-07: **Booking creation shadcn alignment** — Checkout creation now follows the Items list standard more closely: shared `PageHeader`, shadcn `Switch`/`Button`/`Badge` primitives, item-form section headings and rows, quiet bordered card surfaces, exact transitions, and browser-clean field labels.
- 2026-05-07: **Booking creation item picker flow** — Checkout creation `EquipmentPicker` now hydrates deep-linked selected assets outside the current section, uses shadcn `Tabs`/`Input`/`Checkbox`/`Button`/`Item`/`Empty` composition, restores scan-to-add inside Step 2, adds select-visible and clear-section actions, and lets users review as soon as the selection is valid instead of forcing a pass through every section.
- 2026-05-07: **Booking creation item picker hardening** — Checkout creation picker availability now checks visible-section assets plus selected assets, preserves search text per equipment section, keeps conflict-warning rows selectable, and passes `excludeBookingId` from booking-detail equipment edit so a booking does not conflict with itself.
- 2026-05-07: **Booking creation stale selection recovery** — Checkout creation now surfaces unresolved deep-linked or draft asset IDs as removable unavailable rows, and unresolved serialized assets no longer count toward review readiness, confirmation totals, draft saves, or create payloads.
- 2026-05-07: **Booking creation Step 2 UX polish** — Checkout creation Step 2 now shows a compact valid/warning/unavailable selection summary and uses state-aware footer copy such as "Review with warnings" or "Remove unavailable item" so students get clearer recovery and staff keep a faster review path.
- 2026-05-07: **Booking creation final-screen polish** — Checkout confirmation now leads with kiosk handoff expectations, pickup location, due-back timing, and a clearer pending-pickup notice. The submit button now says "Create pickup" because custody still starts at kiosk scan.
- 2026-05-07: **Check-in report photo evidence** — Damaged/lost item reports can include optional photo evidence stored on `CheckinItemReport.imageUrl`; this supports exception review without restoring the scrubbed checkout/check-in condition-photo gates.
- 2026-05-10: **EquipmentPicker component audit closeout** — Scan-to-add now rejects unavailable serialized gear instead of silently selecting it, caps scanned bulk quantities at available stock, adds in-place retry for picker load failures, gives empty states direct recovery actions for search and available-only filters, and keeps the selected shelf actions stable while availability rechecks run.
- 2026-05-10: **Booking row action semantics cleanup** — Booking cards and mobile booking rows now use a real primary open button with overflow menus as sibling controls, and desktop booking table rows expose keyboard open behavior through the primary title cell instead of a fake button row that also contains an action menu.
- 2026-05-10: **Bookings mounted-route polish** — `/bookings` now responds to tab, Active/Past, search, status, location, requester, special-filter, create, `highlight`, and legacy `id` URL changes after the page is already mounted. Booking view preference now loads after mount to avoid first-render `localStorage` drift, and cross-page links such as search results and activity timeline booking links hydrate the list/sheet without a hard refresh.
- 2026-05-10: **Bookings state polish** — `PENDING_PICKUP` is now first-class in the web list/detail UI: client row actions match the server matrix (`edit`, `cancel` before kiosk pickup), list dots use the orange status token, detail and report badges show display labels instead of raw enum text, and dashboard Awaiting Pickup links deep-link to `/bookings?tab=checkouts&status=PENDING_PICKUP`. Reservation detail reads now mark past-due `BOOKED` reservations as overdue, matching the list/API filters.
- 2026-05-10: **Bookings status ship fixes** — The default Checkouts tab now queries both `OPEN` and `PENDING_PICKUP` records so active checkout work is visible without coming from the dashboard. Explicit status filters still narrow to one state.
- 2026-05-10: **Scan handoff cleanup** — Checkout detail no longer links to app `/scan?checkout=...` for pickup or return. Open checkout detail shows the kiosk return handoff, pending-pickup checkout detail shows the kiosk pickup handoff, and app `/scan` remains lookup-only.
- 2026-05-08: **API hardening Wave 13** — Booking search now has trigram indexes, booking edits require `If-Unmodified-Since` conflict headers, edit audits store a full before snapshot, draft listing prunes drafts older than 30 days, check-in reports dedupe rapid repeats, and failed report persistence cleans newly uploaded evidence blobs.
- 2026-05-08: **Kiosk pickup scan guard** — Pickup confirmation now requires successful serialized checkout scan evidence for every serialized item, and kiosk scan lookup recognizes asset tag, primary scan code, QR value, `qr-` fallback, and serial number values. Browser/API smoke verified confirm-without-scan returns 409, serial scan succeeds, confirm opens the checkout, and cleanup restores the item to available.
- 2026-05-08: **Busy-day availability stress** — Live overlap smoke verified overlapping reservations/checkouts block on `BOOKED`, `PENDING_PICKUP`, and `OPEN` serialized allocations, while non-overlapping same-day reservations passed under the then-current half-open contract. Bulk reservation commitments subtract overlapping `BOOKED` reservation quantities from on-hand availability before create. Superseded 2026-06-26 by the 60-minute serialized turnaround buffer.
- 2026-05-08: **Future booking context** — Availability checks now return the next future serialized commitment per item, and checkout creation/edit plus active checkout equipment rows surface a blue "Back before" badge with the exact next needed time.
- 2026-05-08: **Turnaround risk guard** — Availability checks now return advisory serialized and bulk turnaround risks, and checkout creation/edit plus active checkout equipment rows surface compact "Turnaround" warnings for short handoffs, next-use location transfers, recent damage/lost reports, and tight future bulk bookings.
- 2026-05-09: **Badge achievements Slice 2** — checkout completion paths now emit feature-flagged returned badge events from the status-transition boundary: `markCheckoutCompleted`, partial serialized auto-complete, bulk auto-complete, and kiosk check-in auto-complete. On-time uses the D-034 15-minute UTC grace window.
- 2026-06-11: **Duplicate creation audit entry fix** — Checkout creation no longer writes a second route-level audit entry; `createBooking()`'s in-transaction `created` entry is the single source, so new checkouts show one "created booking" history line instead of two. Equipment detail rows also no longer show "Qty: 0" + "Returned" for bulk items on not-yet-picked-up checkouts (`checkedOutQuantity` defaults to 0, it is never null, so the old `??` fallback never fired).
- 2026-06-11: **Booking detail visual refresh** — Checkout detail page and the quick-view sheet now match the booking creation wizard's visual language: wizard-style inline section headers with secondary count badges (replacing the red-bar uppercase section bands in the sheet), `rounded-xl border-border/50 shadow-xs` cards, normalized spacing, and staggered entrance motion on the equipment list. Shared components, so reservations get the same treatment. (Code shipped within commit 1eba91b4 alongside parallel iOS scan work; docs in this commit.)
- 2026-06-11: **Requester avatar restored on booking detail** — `getBookingDetail`'s shared `bookingInclude.requester` select was missing `avatarUrl` (only `id/name/email`), while `creator` selected it — so the booking detail page/sheet showed the requester's real photo only for the creator and fell back to initials for the requester. Added `avatarUrl` to the shared requester select; the web "User" row and the iOS booking detail requester both now show the real headshot. Fixes the same gap on `/api/bookings/[id]`, which iOS `BookingDetailView` consumes.
- 2026-06-11: **Status label + booking-detail consistency pass (web + iOS)** — `PENDING_PICKUP` now renders as **"Awaiting Pickup"** everywhere (the canonical term, already used on dashboard/items/reports). Retired the divergent "Pending Pickup" from `statusLabel()` (helpers.ts), the booking-list status visual (booking-list/types.ts), iOS `BookingStatus.label`, and admin settings prose. iOS booking-detail per-item badges now reflect the booking lifecycle instead of the raw allocation flag: items show "Reserved" before pickup, "Out" only once the checkout is OPEN, and "Returned" after return -- so a badge never contradicts an "Awaiting Pickup" booking (previously every item read "Out"). iOS booking detail also folds serialized + bulk into a single "Equipment" list (count = combined total), matching the web detail page instead of the old "Equipment" / "Consumables" split.
