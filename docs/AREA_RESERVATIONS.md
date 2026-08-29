# Reservations Area Scope (V1 Hardened)

## Document Control
- Area: Reservations
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-08-26
- Status: Active — V1 Shipped (2026-03-10)
- Version: V1

## Direction
Make app and web reservation-first. A user who is not physically at a kiosk reserves gear for a future claim; the kiosk turns that reservation into active custody only when pickup scans pass.

## Core Rules
1. Reservations live in Booking with lifecycle states: `BOOKED`, `COMPLETED`, `CANCELLED`; `DRAFT` exists for interrupted creation.
2. Reservation creation typically starts as `BOOKED`.
3. Reservations do not become custody records in the normal flow. Kiosk pickup creates or opens the linked checkout custody record and closes the source reservation as fulfilled.
4. A `BOOKED` reservation enters the user-facing Pending Pickup phase when
   `startsAt` arrives. This starts the configured no-show clock without
   changing the stored reservation status or claiming custody.
5. Cancel and archive patterns are used in V1. No hard delete.
6. Role and ownership controls follow `AREA_USERS.md`.
7. Availability checks treat legacy overlapping `PENDING_PICKUP` checkout allocations as committed gear and subtract overlapping `BOOKED` bulk reservation quantities from available bulk stock.
8. Serialized booking windows include a 60-minute turnaround buffer before the next pickup/start in both directions: a new start must follow an existing return by at least 60 minutes, and a new return must precede an existing next start by at least 60 minutes. Bulk/countable availability remains overlap-based against committed quantities.
9. Browse-time previews check visible and selected serialized assets plus visible bulk SKUs before selection; known serialized conflicts, including the 60-minute buffer, are excluded from new selection and block review, while next-needed, transfer, condition, and close-turnaround notices remain explicit advisories and the server rechecks the final payload authoritatively.
10. Reservation creation is guarded at the shared service boundary: creates require at least one equipment item, duplicate multi-event links and duplicate bulk lines are rejected, invalid windows fail before availability work, and DB overlap races return booking conflict responses.
11. An event-linked reservation from an internal user also infers schedule work on the chronologically primary event: it reuses an active assignment or fills a safe slot using the requester’s staffing class and area. Explicit `shiftAssignmentId` links are validated for ownership, activity, and event scope. Reservation-managed links reconcile when events or owners change and release on cancellation, no-show expiry, or requester deactivation, while shared links, manual/auto-fill assignments, collaborator follow behavior, private working copies, and unconfigured crew setups remain protected.
12. Internal Students can read all visible reservations and check-outs from the web and native Bookings surfaces. The native iOS Home payload remains personal, and Student edit, cancel, transfer, creation, and kiosk-custody actions remain ownership-gated.

## V1 Workflow

### Create Reservation (Wizard — `/reservations/new`)
Multi-step wizard page (replaced the old side-sheet flow as of 2026-04-09):

**Step 1 — Context & Details:** Event tie-in (optional), title, requester, location, kit, start/end dates. Event picker uses the next 30 days and supports up to 5 linked events. The page title uses the selected event/booking title once available, while the reservation badge carries the booking kind. Manual date edits preserve duration when the Start value changes, matching the native calendar-app behavior. Web start/end controls use 15-minute choices; return suggestions round forward and the earliest end is the first valid quarter-hour after both the reservation start and now.
**Step 2 — Equipment:** Full `EquipmentPicker` with quiet section chips, search, availability conflict markers, QR scan-to-add, and deliberate per-item selection. Equipment requirements enforced. Warning/status chrome appears only for unavailable stale selections, hard conflicts, needed-next notices, turnaround warnings, or active availability rechecks.
**Step 3 — Confirmation:** Apple-like review panel leads with the selected window, requester, location, reserved status, linked event, and equipment count. Submit → POST `/api/reservations`. Save as `BOOKED`. Confirmation repeats selected availability warnings only when warnings exist.

**Deep-link parameters:** `?title`, `?startsAt`, `?endsAt`, `?locationId`, `?newFor`, `?eventId`, `?sportCode`, `?requesterUserId`, `?draftId`.

**Draft persistence:** "Save draft & exit" persists via `/api/drafts`. Resumable via `?draftId=`. Multi-event drafts persist ordered `BookingEvent` links, return ordered `events[]` on resume, and keep `Booking.eventId` as the chronologically first linked event for legacy readers. A consumed `sourceDraftId` is a permanent actor-scoped idempotency key: if the original success response is lost, retry returns the already-committed reservation and ignores a later changed payload rather than creating a duplicate.

### Native iOS Create Reservation
Native iOS creation mirrors the three-step reservation rhythm while staying mobile-first:
1. Details starts with the schedule source decision and fixes requester identity to the signed-in user without rendering a duplicate requester row. Manual reveals its editable title immediately; Event Linked waits until an event is selected, then reveals the event-derived title for live editing.
2. Event Linked and Manual are mutually exclusive setup modes. Event Linked supports up to 5 upcoming calendar events, requires an explicit picker confirmation, and filters the event list by All, Home, Away, Neutral, or Non-game. Game scopes require opponent context; practices and other entries without an opponent stay under Non-game. Each event row uses the Schedule rail color, puts Home, Away, Neutral, or Non-game beside the title, and gives date/time and venue their own supporting lines, such as `Wed, Aug. 5 at 1:00 PM` followed by `McClimon Soccer Complex`. When a calendar event has not yet mapped its raw venue to a Wisconsin Creative location, the picker still uses the cleaned raw calendar venue instead of dropping it. The selected event auto-fills the title and pickup/return window until the user edits those fields. Manual preserves duration when pickup moves and uses 15-minute time increments without quick-duration presets. Both paths keep the existing `eventIds[]`, prefilled `eventId`, and `shiftAssignmentId` contracts.
3. Pickup location is an inline Camp Randall or Kohl Center choice and is never copied silently from an event venue.
4. Equipment uses SwiftUI's native search field and one fixed browse taxonomy: All, Cameras, Lenses, Batteries, and Other. Other is the complement of Cameras, Lenses, and Batteries. All five compact category controls fit at normal text sizes, with an adaptive horizontal fallback for larger accessibility sizes. Category results preserve the mixed `/api/assets?sort=popular` `itemOrder` from recent booking and scan activity, so serialized assets and item families do not fall into separate alphabetical buckets. Both pickup rooms remain visible; rows from the other room are dimmed and labeled, cannot be added, and an already-selected mismatch stays recoverable in the cart after a location change. Review is blocked until every selected item matches pickup.
5. Camera and monitor selections surface compact bottom-anchored, location-valid power cards with explicit quantity steppers. Sony camera bodies recommend Sony Battery, FX6 bodies recommend Gold Mount Battery, and monitors recommend Monitor Battery. Multiple recommendations form one stack in the order their triggering gear was selected; a later recommendation joins from the bottom without replacing the first. Each card remains available after quantity changes and can be acknowledged independently by swiping down or closing it. Review catches the zero-power case once by switching to Batteries and resurfacing guidance, but advances normally after the user has added a battery because compatibility guidance is advisory. Suggestions add planning quantities only; exact numbered units still bind at kiosk pickup.
6. Equipment retains scan-to-add, countable bulk quantities from `/api/form-options`, SKU photos with box fallbacks, a compact selected summary, and a detailed cart editor. Counted-item result rows expose minus, selected quantity, and plus directly; quantity is never hidden behind an `x1` or row tap. Availability fractions use effective on-hand inventory as the denominator, so numbered-family unit records cannot produce impossible copy such as `46/30 available` when a stale balance is lower than the unit roster.
7. Review counts serialized assets plus selected bulk quantities, uses year-free pickup/return language, leads with requester identity, omits routine Reserved status, renders every thumbnail-led gear row, and submits typed `bulkItems` alongside `serializedAssetIds`. Battery rows omit the routine availability/scan subtitle so the power list stays compact; other counted products retain that useful context. The anchored create action uses reservation purple and known conflicts provide a direct route back to Gear.
8. Known serialized conflicts are visible before selection, cannot be newly selected, and block review until the item is removed or the dates change. Web and native picker rows carry the conflicting window plus return-by/available-after guidance into selected-gear review; timing, transfer, and condition notices remain advisory. Server-side availability and bulk shortage checks remain authoritative, and a structured create conflict returns to Gear with selections preserved. Other policy or concurrency conflicts remain in the submit error flow. Successful creation opens the new reservation detail from every production entry point, including Event Detail.

### Edit Reservation
1. Allowed fields depend on role, ownership, and lifecycle state.
2. Edit must re-run conflict checks for changed windows/items.
3. Edit path remains fully auditable.

### Kiosk Pickup From Reservation
1. App/web reservation detail should show pickup guidance, not a `Start checkout` custody action.
2. The user claims the reservation at the kiosk once the pickup window is due.
3. The kiosk validates identity, scans required serialized assets and numbered units, rechecks availability, and creates the linked checkout custody record only after required scan evidence passes.
4. The source reservation is marked `COMPLETED` because it was fulfilled, not cancelled.
5. Preserve allocation linkage, `sourceReservationId`, and audit trail.
6. Numbered-unit intent remains quantity-based on the reservation; exact unit binding happens only during kiosk pickup confirmation.

### Cancel Reservation
1. Allowed by role and policy.
2. Transition: `BOOKED` -> `CANCELLED`.
3. Canceled reservations remain visible for operations and audit.

## Reservation Detail Page (Unified with Checkouts)

The reservation detail page (`/reservations/[id]`) uses the shared `BookingDetailPage` component with `kind="RESERVATION"`. See `src/app/(app)/bookings/BookingDetailPage.tsx`.

### Architecture
- **Route**: `src/app/(app)/reservations/[id]/page.tsx` — thin wrapper passing `kind="RESERVATION"`
- **Shared component**: `BookingDetailPage` serves both checkout and reservation detail
- **Hooks**: `useBookingDetail` (fetch + reload + optimistic patch), `useBookingActions` (all action handlers)
- **API**: All reads and inline field saves go to `/api/bookings/[id]` (GET + PATCH)
- **Old routes**: `GET/PATCH /api/reservations/[id]` redirect (308) to `/api/bookings/[id]`

### Reservation-Specific Behavior
- The shared header follows the native booking hierarchy: lifecycle state and live timing lead, the requester is named beside the booking identity, and a compact operational summary keeps pickup time, pickup location, physical gear count, and linked event context visible before the denser web detail columns.
- Web-only operator breadth remains below and beside that summary: inline editing, equipment planning, linked-event management, transfer/cancel/duplicate actions, sync health, and complete activity history.
- Status badge shows "Confirmed" (not "BOOKED") through the shared booking status display helper.
- Primary custody guidance points to kiosk pickup when the reservation is due; app/web does not expose `Start checkout` as a normal action.
- Action buttons: `[Actions ▼] [Edit] [Extend]` for app-owned actions.
- Actions dropdown contains: Duplicate, Cancel
- No checkin checkboxes or scan buttons (those are checkout-only)
- Equipment tab shows Serial and Location columns (instead of checkout's Status column)
- Equipment rows show hover-reveal "..." menu (View item)
- Breadcrumb handled by global `PageBreadcrumb` in AppShell (no duplicate)

### Tabs
1. **Info** — Card with "Reservation details" heading. SaveableField rows: title (editable), location, from/to dates, requester (with avatar), creator (with avatar), notes (editable), created. Mixed-location Alert if applicable.
2. **Equipment** — Card with search (3+ items), serialized rows with context menu, item count
3. **History** — Collapsible section with one-line preview when collapsed, ToggleGroup filters (All / Booking changes / Equipment changes), natural-language action labels

### Inline Editing
- Title: `InlineTitle` component with save status indicator (spinner/check/error)
- Quick-view sheet title and notes use explicit save/cancel controls; Enter confirms the title and Command/Ctrl+Enter confirms notes.
- Reservation start and due-back dates use an explicit confirmation popover.
- PATCH `/api/bookings/[id]` with single-field partial update
- Audit entries capture before-snapshot for field-level diffs
- "Refreshing…" spinner shown during data reload after actions

## Reservations List Surface (V1)

### Top Bar Actions
1. `New reservation` primary CTA is always visible.
2. `Export` is visible to `STAFF` and `ADMIN`; hidden for `STUDENT`.
3. `Customize overview` deferred — not in V1.

### Filters and Controls
1. Status scope control (default `Upcoming`).
2. Search field matches reservation name, owner, and reservation id.
3. Filter button opens advanced filters:
   - Sport
   - Location
   - Owner
   - Date range
4. Sort control defaults to earliest `From` datetime.
5. View toggle can support list/card modes if trivial; list mode is required.
6. A `BOOKED` reservation whose `startsAt` has arrived is Pending Pickup. It
   appears in the orange pickup lane and remains eligible for kiosk
   fulfillment until the configured no-show window cancels and releases it.
   It never changes checkout-overdue custody counts.

### Table Columns (List Mode)
1. Selection checkbox
2. Name
3. From
4. To
5. Duration
6. User
7. Items (thumbnail strip + count fallback)

### Row Behavior
1. Row click opens reservation details.
2. Left-edge status color cue reflects reservation state.
3. Secondary line under name shows current state label (for example `Booked`).
4. Multi-select is allowed for future bulk actions; no bulk mutation actions in V1.
5. Mobile row interactions follow `AREA_MOBILE.md`:
   - Primary tap opens details.
   - Secondary actions open in action sheet.
   - Overdue or urgent states remain visually prioritized.
   - Native rows read as title, timing, then requester/location/item context, with explicit status pills reserved for lifecycle or urgency information not already carried by the section and leading rail.

### Pagination and Density
1. Show total rows summary: `Showing X to Y of Z`.
2. Rows-per-page control defaults to 25.
3. Persist user rows-per-page preference per user/session when feasible.

## State Transition Rules
1. `BOOKED` reservation -> linked checkout custody only through kiosk pickup.
2. `BOOKED` -> `CANCELLED` allowed.
3. `BOOKED` -> `COMPLETED` allowed when kiosk pickup fulfills the reservation and opens linked checkout custody.
4. `COMPLETED` and `CANCELLED` are terminal in V1.

## Action Matrix by State

Source of truth: `src/lib/services/booking-rules.ts` — `STATE_ACTIONS[RESERVATION]`

The access labels below describe state-machine actions, not list/detail reads. Internal Students, Staff, and Admins may open visible booking rows; Student actions remain limited to their own booking, while collaborators remain capability- and ownership-scoped.

### `DRAFT`
- Allowed actions: Edit, Cancel, Transfer owner
- Access: staff+ or owner

### `BOOKED`
- Allowed actions: Edit, Extend, Cancel, Transfer owner, view kiosk pickup guidance
- Access: staff+ or owner

### `COMPLETED`
- Allowed actions: View only

### `CANCELLED`
- Allowed actions: View only

**Note**: Reservations do not use the `OPEN` state in the normal flow; kiosk pickup creates or opens the linked checkout custody record via `sourceReservationId`.

## Actions Menu (V1 Shipped)
1. Edit — respects state + role gating
2. Pickup guidance — explains kiosk pickup when the reservation window is due; does not create checkout custody from app/web
3. Extend — extends booking window (conflict-checked)
4. Cancel reservation — soft cancel, record preserved for audit
5. Duplicate — clones a BOOKED reservation with same items, dates, and settings
6. Transfer owner — staff/admin or owner requester reassignment with optimistic-lock protection and `owner_transferred` audit history
7. Edit linked events — scheduled-event link, change, or clear action using the existing `Booking.eventId` primary plus `BookingEvent` junction contract
8. Deferred: Spotcheck creation, PDF generation

## Bug Traps and Mitigations

### Trap: Booking window edit bypasses conflict check
- Mitigation:
  - Run conflict check on every date, location, or item change.
  - Fail with explicit collision details.

### Trap: Concurrent edits cause silent overwrite
- Mitigation:
  - Preserve SERIALIZABLE behavior.
  - Add optimistic stale-write detection messaging where possible.

### Trap: Cancel on already-open handoff loses custody accountability
- Mitigation:
  - Disallow direct `OPEN` -> `CANCELLED` in normal path.
  - Require check-in completion path.

### Trap: Student edits non-owned reservation via deep link
- Mitigation:
  - Server-side ownership check on mutation endpoints.
  - Return consistent authorization error and audit event.

### Trap: Event record changed after reservation created
- Mitigation:
  - Reservation remains valid with stored contextual snapshot fields.
  - Event badge degrades gracefully if upstream event is missing.

### Trap: Reservation details and equipment state drift out of sync
- Mitigation:
  - Render item conflict badges from current availability checks.
  - Show stale-state notice and refresh action if read model is outdated.

### Trap: List results and detail state disagree after quick edits
- Mitigation:
  - Refresh affected list rows after mutation success.
  - Use the shared booking-change signal to refresh visible reservation lists and any open detail sheet for the changed booking id.
  - Surface shared booking-change sync health on reservation list/detail chrome so operators can see when freshness is current, paused, offline, or retrying.
  - Keep AC-12 open for an end-to-end kiosk pickup fulfillment proof.

## Edge Cases
- Cross-midnight reservations and timezone conversions.
- Reservation spans multiple locations with exception approval.
- Owner reassigned after creation.
- Linked scheduled event added, changed, or cleared after creation.
- Late edits close to handoff time.
- Reservation with mixed serialized and bulk equipment.
- Item shows in reservation list but is now unavailable at checkout time.
- Attachments exist but user lacks permission to download.
- Search query returns records user can view but not edit.
- Export requested by student role.
- Thumbnail image missing for one or more items in row.

## Acceptance Criteria
- [x] AC-1: `BOOKED` reservations can be fulfilled at kiosk pickup into linked checkout custody without data loss.
- [x] AC-2: Edit operations revalidate conflicts for all relevant field changes.
- [x] AC-3: `OPEN` records cannot be canceled directly in normal flow.
- [x] AC-4: Permission and ownership enforcement matches `AREA_USERS.md`.
- [x] AC-5: All transitions and edits emit audit records.
- [x] AC-6: Terminal states are immutable in V1.
- [x] AC-7: Reservation detail page exposes `Info`, `Equipment`, and `History` tabs.
- [x] AC-8: Equipment panel surfaces item-level conflict badges with actionable guidance. **(Verified 2026-04-06 — `BookingEquipmentTab.tsx:53-106` fetches conflicts for BOOKED/DRAFT bookings via `/api/availability/check` and renders per-row "Conflict" badges. iOS parity shipped 2026-05-28 — `BookingDetailView.ItemsSection` renders the same per-item conflict badge via `APIClient.checkAvailability`; closes GAP-35.)**
- [x] AC-9: Actions menu behavior matches state and policy mapping.
- [x] AC-10: Reservations list supports status scope, search, sort, and required columns.
- [x] AC-11: `Export` visibility follows role policy.
- [ ] AC-12: List and detail views remain consistent after edit, cancel, and kiosk pickup fulfillment. **(Partial proof 2026-06-24: authenticated browser smoke proved web reservation list/detail consistency after edit and cancel through `/api/bookings/changes`; kiosk pickup fulfillment proof remains.)**

## Dependencies
- Booking and allocation constraints from `DECISIONS.md` (D-001, D-006, D-007).
- User permission model from `AREA_USERS.md`.
- Event context behavior from `AREA_EVENTS.md`.
- Mobile operations contract from `AREA_MOBILE.md`.

## Change Log

- 2026-08-26: **Item conflict recovery now happens before review.** Web and native reservation pickers preflight visible items before selection, disable known serialized conflicts (including the turnaround buffer), and keep late-discovered conflicts removable while blocking review. Conflict rows state the conflicting window and the return-by or available-after recovery time. Kiosk scan feedback distinguishes conflicts, shortages, timing, transfers, and condition reports; bulk turnaround notices are emitted only when requested stock would affect the next same-location booking. Failed availability refreshes preserve the last known result and show retry instead of looking clear. Local source and build verification remain separate from authenticated browser, iPhone, and physical kiosk acceptance.
- 2026-08-26: **Web reservation return times now use the same forward-only quarter-hour policy as kiosk and native creation.** The existing `00/15/30/45` controls now normalize off-grid timestamps forward across hour/day boundaries, event-derived return buffers round forward, and new/detail/sheet edit surfaces prevent an end at or before the reservation start or current time. Opening an existing record does not save or rewrite its timestamp. Schedule and shift timing controls remain separate. Focused tests, TypeScript, full lint, and the app build pass; authenticated isolated-browser proof is unavailable in this workspace.
- 2026-08-26: **Native reservation timing parity is now visible before review.** The iOS availability client decodes the top-level conflict response with rollout-safe optional advisory arrays, previews visible serialized assets and counted supplies before selection, and carries needed-next, return-by, tight-gap, location-transfer, and recent-condition context into picker rows and the selected-gear drawer. Timing notices remain advisory, taps remain recoverable, and server-side create/update checks remain authoritative. The Wisconsin iOS build and focused source contracts pass; authenticated runtime proof remains separate.
- 2026-08-25: **Item conflict previews now work before selection.** Web availability consumers decode the top-level `/api/availability/check` result, native reservation browsing checks visible plus selected assets after each list load and pickup-location change, and the native client now sends the reservation kind for per-kind parity. Next-needed copy states the needed-at, return-by, and close-handoff timing. The 60-minute serialized buffer is now enforced symmetrically around a new window, and server-authoritative create checks remain in place; focused web/native source contracts pass, while authenticated browser and iPhone 16 Pro runtime proof remain separate gates.
- 2026-08-25: **Committed booking edits no longer fall through to false error feedback locally.** Shared reservation title, schedule, notes, equipment, owner-transfer, cancellation, and linked-event writes now use a 30-second mutation budget instead of the generic 8-second read timeout. Title/detail-sheet and linked-event success callbacks run after the request error boundary, so a committed server response cannot be relabeled as a network/save failure by local refresh or close work. A Dia production reproduction also isolated a platform HTTP 412 on the web `If-Unmodified-Since` header even though application stale-write responses are HTTP 409; web mutations now use the application-owned `X-Booking-Updated-At` header, while the API retains legacy-header compatibility for native clients. Real validation, permission, timeout, and optimistic-lock failures remain errors. Focused booking coverage and TypeScript/lint checks pass; deployment and post-deploy acceptance remain open.
- 2026-08-24: **Linked-event capacity expanded.** Reservation creation and active-booking relinking now allow up to 5 scheduled events through the shared web, draft, and native event pickers. The `BookingEvent` junction, chronologically-first `Booking.eventId` primary, event-window derivation, reservation lifecycle, and kiosk custody contracts are unchanged. The server/web slice is deployed in `dpl_9cFHwpSQA9QjsQTV3GF3uKf65QtE`; authenticated five-link interaction remains a separate acceptance gate.

- 2026-08-20: **Linked-event editing now stays in the present and future.** The shared booking detail dialog no longer loads unrelated scheduled events that already ended, while existing historical links remain available so operators can review or remove them. The event-link API, booking lifecycle, authorization, reservation state, and kiosk pickup boundaries are unchanged.

- 2026-08-09: **Native booking mutations now retain server truth.** The combined booking API includes per-user `allowedActions` without extra database reads, and native list/detail action visibility uses that policy whenever present. Edit now requires `If-Unmodified-Since`; Edit and Cancel join Extend and Transfer in decoding and immediately installing the enriched returned booking, preserving current lifecycle, action, and `updatedAt` state after success even when a follow-up refresh would fail. Older server responses remain decodable through a local fallback during rollout.

- 2026-08-07: **Booking API concurrency and boundary hardening.** Booking edit,
  extend, event-link, and owner-transfer services now recheck the edited
  `updatedAt` snapshot inside the same serializable transaction as the write,
  closing the route-to-service lost-update window while retaining committed
  retry behavior. Booking edit audit history is written once by the service
  transaction rather than duplicated after commit. The realtime change cursor
  now advances booking and audit streams independently with timestamp-plus-ID
  tie breakers, so bounded bursts and invisible audit rows cannot skip or stall
  refresh. Draft saves reject invalid timestamps and duplicate equipment lines;
  draft reads hide expired rows without performing unaudited deletion. Booking
  exports reject unknown kinds and invalid or inverted date ranges.

- 2026-08-07: **Canceled reservations release Schedule edit blockers.**
  Working-copy and publish guards now treat only active linked booking states
  as gear commitments. Canceled rows remain preserved for audit, and stale
  working-copy metadata is refreshed from live assignment relationships before
  unassign or replacement decisions.

- 2026-08-04: **Event-linked reservation scheduling shipped.** Internal reservations now reuse or create a direct assignment for the requester on the primary linked event inside the same serializable booking transaction, link `Booking.shiftAssignmentId`, enforce existing conflict and approved-time-off checks, and keep published schedule snapshots coherent. Explicit assignment links, collaborator follows, private working copies, and events without a safe crew setup remain unchanged.
- 2026-08-04: **Reservation schedule lifecycle hardening shipped.** Assignment provenance is durable, explicit links are validated at the booking transaction boundary, and event relinks, owner transfers, cancellation, no-show expiry, and requester deactivation reconcile only reservation-managed assignments. Shared links remain active for other reservations, working-copy changes become review-needed audit states, and worker notifications wait for commit.
- 2026-08-04: **Booking detail mutation freshness hardened.** Inline title, schedule, and notes saves now apply the server-returned booking snapshot, including `updatedAt`, so a following rename or owner transfer uses the current optimistic-lock value. Owner-transfer retries for the already-committed target now return the committed booking while true stale competing transfers remain conflicts.


- 2026-07-31: **Snow Leopard reservation boundary hardening.** Collaborator create, edit, extend, and cancel controls now require their exact server-backed capabilities, while direct requests use the same policy. The default active booking payload excludes `DRAFT` records; drafts remain available through the dedicated recovery path. Quick extend sends the shared optimistic-lock timestamp header from the current booking row.
- 2026-07-29: **Native reservation feature discovery.** TipKit now points
  eligible users to New Reservation and explains that an in-progress
  reservation can be minimized without losing work. After the Gear step is
  opened, a contextual prompt identifies its continuous scanner; after a
  reservation is minimized, the persistent draft card explains how to resume
  the same step. Every prompt stays on the existing native control, appears at
  most once, and completes when used. Reservation payloads, draft persistence,
  permissions, lifecycle, and kiosk custody are unchanged.
- 2026-07-23: **Pending Pickup reservation model consolidated.** A booked
  reservation now enters Pending Pickup at its scheduled start. The configured
  no-show window starts at that timestamp; daily maintenance cancels and
  releases reservations after the cutoff. Kiosk pickup still creates linked
  `OPEN` checkout custody and completes the reservation. Raw
  `PENDING_PICKUP` checkout rows remain rollout compatibility only.
- 2026-07-23: **Native missed-pickup presentation.** The iOS Bookings list
  turns a due `BOOKED` reservation orange, orders it by pickup time, and says
  `Pickup was due ...` without changing lifecycle or custody state.
- 2026-07-21: **Shared web booking detail now uses the native hierarchy without losing control-room depth.** Reservation detail names the requester beside booking identity and surfaces pickup time, pickup location, physical gear count, and linked event context in one compact summary. Inline editing, equipment planning, operator actions, sync health, and activity history remain web-owned; API payloads, permissions, reservation lifecycle, and kiosk pickup are unchanged.
- 2026-07-18: **Native reservation creation is visually and operationally consistent end to end.** Event selection reuses Schedule's rail colors, keeps scope beside the title, and gives abbreviated weekday/date/time and the full venue separate supporting lines, including a cleaned raw-calendar fallback for events awaiting venue mapping. Category tabs preserve the API's mixed serialized and item-family popularity order, with Other defined as every reservable result outside Cameras, Lenses, and Batteries. Reservation actions remain purple while destructive and urgent actions keep their status colors. Power guidance now stacks every applicable recommendation in triggering-gear order, animates later recommendations in from below, remains useful after quantity changes, and supports independent swipe or close dismissal. Battery rows show available over effective on-hand counts and matching purple quantity controls. Review catches zero selected power once, then advances after the user has acted instead of repeatedly returning to Batteries. Selected Gear remains one list, Review shows every selected product while omitting the routine secondary line from batteries, and event-launched reservations use the event title without a synthetic `Gear -` prefix. The active Icon Composer package uses the user's updated Block W scale. Multi-event limits, server availability authority, permissions, and kiosk custody are unchanged.
- 2026-07-17: **Native pickup and return editing works the same for Manual and Event Linked setup.** The reservation Details step now uses separate native date controls and fixed 15-minute time choices instead of the combined UIKit bridge. Pickup no longer silently moves return, invalid ordering is visible before Gear, and schedule edits refresh conflict guidance. Once an event is selected, the same editor appears with defaults of one hour before the first event and two hours after the last event; event-prefilled reservations receive those defaults after event data loads, and later user edits are preserved. Review shows the exact submitted window, including event-linked and all-day reservations. API payloads, multi-event constraints, availability enforcement, permissions, and kiosk custody are unchanged.
- 2026-07-17: **Native reservation decisions and gear guidance are explicit.** Details now asks Event Linked or Manual first. Event Linked hides the title until selection, uses a single-line Choose Event row, and filters upcoming events by All, Home, Away, Neutral, or Non-game before explicit confirmation. Gear preserves the API's usage-based popularity order, fits All, Cameras, Lenses, Batteries, and Other at normal text sizes, and gives counted items visible minus/quantity/plus controls. Power guidance moved from a list section to a dismissible bottom card with its own stepper; Review intercepts an unacknowledged recommendation, switches to Batteries, and keeps the user in Gear. Multi-event limits, payloads, server availability authority, permissions, and kiosk custody are unchanged.
- 2026-07-17: **Native reservation setup final polish.** Details now leads with the editable title and one Event or Manual mode, hides the always-self requester, confirms event selection explicitly, uses 15-minute manual times, and keeps Camp Randall or Kohl Center inline. Gear uses the fixed All, Cameras, Lenses, Batteries, and Other taxonomy, prioritizes camera bodies, shows other-location rows as unavailable context instead of hiding them, preserves mismatches for deliberate recovery, and blocks Review until pickup location and gear agree. Inline power guidance recommends Sony Battery for Sony camera bodies, Gold Mount Battery for FX6, and Monitor Battery for monitors using a matching SKU at the selected pickup location. Review replaces the decorative calendar tile with the requester avatar, omits routine Reserved status, and keeps the create action purple. API payloads, event limits, server availability authority, permissions, and kiosk custody are unchanged.
- 2026-07-17: **Native reservation completion and conflict recovery.** Event-launched gear setup now opens the created reservation and leaves a Gear reserved row behind instead of discarding the booking ID and showing the stale reserve action. Structured availability conflicts at create return to Gear with serialized and bulk selections preserved, refresh the advisory serialized check, and keep the server explanation visible until selection changes. Generic 409 policy and concurrency errors remain in the normal submit dialog. API payloads, authoritative server checks, role gates, and custody behavior are unchanged.
- 2026-07-17: **Numbered reservation quantities stay pickable.** Create and equipment-update transactions read each referenced family's actual `trackByNumber` state and reject a combined numbered quantity above 500. The limit is checked inside the booking transaction, preserves the 50-line planning cap, and does not restrict large quantity-tracked counts. Kiosk pickup uses the same 500-unit boundary so accepted reservations cannot later dead-end during handoff.
- 2026-07-17: **Native reservation Gear and Review polish.** Gear now keeps selected count and conflict status visible above the result list, retains its cart sheet for detailed removal and bulk quantities, and labels the review action when conflicts need attention. Review replaces the large confirmation hero and full equipment dump with compact editable Schedule and Gear cards, year-free dates, a three-row gear preview, explicit conflict recovery, and an anchored Create Reservation action. Availability hints remain advisory and the server remains authoritative at submit; search, scan, payload, permission, and custody contracts are unchanged.
- 2026-07-17: **Reservation-cap creation is atomic.** The active reservation count is read inside the same `SERIALIZABLE` transaction that creates the reservation, with one bounded serialization retry. Simultaneous requests cannot both pass a stale count check, conflicts return a user-safe response, and post-commit effects run only after a successful commit.
- 2026-07-17: **Native booking hierarchy alignment.** Native Bookings rows now match the Item Detail custody hierarchy with title first, live timing second, and requester plus location/item context third. Normal open checkouts use the blue leading rail without a redundant `Checked Out` pill; reservations and exceptional checkout states retain explicit status labels. List controls, record ordering, payloads, actions, and kiosk-only custody behavior are unchanged.
- 2026-07-16: **Shared Bookings list interaction-detail polish.** The unified `/bookings` surface now keeps Active/Past and card/list controls, reservation creation, filter recovery, sortable headers, and pagination on the 40px desktop target baseline. Sort headers are keyboard-operable buttons with accessible sort state and contextual icons that transition without replaying on initial render. Booking cards and mobile rows use precise 0.96 press feedback, cards gain restrained hover lift, and requester photos use neutral black/white image outlines. Reservation visibility, action permissions, creation, lifecycle policy, kiosk pickup, filters, and list data are unchanged.
- 2026-07-16: **Reservation quick-view inline editing.** The shared sheet keeps due back as the stable schedule anchor, formats dates weekday-first, and replaces the broad Edit booking mode with explicit inline title, start, due-back, and notes saves. Reservation equipment planning remains editable on web, while numbered units display directly when already bound by a custody flow.
- 2026-07-16: **Shared booking sheet hierarchy refresh.** Reservation sheets now lead with the reserved window and start timing, condense pickup and linked context, and keep equipment as the main working section. Full detail remains directly available; transfer, event relinking, and cancellation move into the named More actions menu without changing their permission or mutation contracts.
- 2026-08-13: Booking title and event-opponent projections now canonicalize known abbreviated team names (`TCU`, `USC`, `UCLA`, and peers) in all caps. New/edited booking writes use the shared rule, while booking/dashboard read models correct legacy display values without rewriting stored or audit data.
- 2026-07-15: Booking titles now normalize at write boundaries across reservation creation, drafts, shared edits, and kiosk checkout paths. Canonical UW sport codes remain uppercase (`MBB`, `WBB`, and peers), ordinary words use title case, common connectors such as `at` and `vs` stay lowercase, repeated whitespace collapses, and intentional camel-case names remain intact. Stored titles, audit history, notifications, search, and exports now share the same normalized value for new or edited bookings.
- 2026-07-10: Native reservation equipment selection now honors Reduce Motion for cart feedback and disables fully allocated bulk-family rows instead of accepting dead taps, while shared scalable typography and quieter card depth improve large-text hierarchy without changing reservation or custody contracts.
- 2026-07-10: **Bookings list visual refresh shipped.** Shared booking list rows/cards used by the Reservations tab now show status as the semantic `Badge` variant beside the ref number under the title, COMPLETED rows drop the 60% row opacity on the Past scope, and the table's Items column shows the item thumbnail stack with the count. Visual-only; see `AREA_CHECKOUTS.md` 2026-07-10 for full detail. Kiosk add/remove entries now persist the serialized tag or numbered-unit identity plus the kiosk name, and completed kiosk returns persist the returned item list plus kiosk name. Shared booking history now renders direct summaries such as `Added FX3 1 at the Video Office Kiosk` and `Returned Sony Battery #7 at the Video Office Kiosk`; historical rows with no stored identity keep the generic fallback.
- 2026-07-09: **Booking event relink hardening shipped.** Stale duplicate event-link saves now return success when the requested event set already matches the current booking, while true stale conflicts still return 409. The dialog now uses clearer stale-conflict copy, and focused route/service coverage covers route-boundary validation, missing events, terminal bookings, active checkout support, and event-context-only writes.
- 2026-07-09: **Booking event relinking shipped.** Editable active bookings can now link, change, or clear scheduled events after creation from the full detail page and shared detail sheet. The new `POST /api/bookings/[id]/events` route uses the same `If-Unmodified-Since` optimistic-lock contract as edit/extend/transfer, requires normal booking edit permission, caps `eventIds[]` at 3, sorts links chronologically, preserves `Booking.eventId` as the primary event, rewrites `BookingEvent` junction rows transactionally, and writes `events_updated` audit history. Student owners/creators can also transfer their own active bookings; staff/admin retain transfer access across active bookings. New coverage: `tests/booking-events-route-contract.test.ts`, `tests/update-booking-events.test.ts`, `tests/transfer-booking-owner.test.ts`, and `tests/decision-contracts.test.ts`.
- 2026-07-09: **Booking owner transfer shipped.** Shared reservation detail exposes `Transfer owner` when `allowedActions` includes `transfer-owner`. The action posts to `POST /api/bookings/[id]/transfer-owner` with the same `If-Unmodified-Since` optimistic-lock contract as edit/extend, updates only `Booking.requesterUserId`, preserves `createdBy`, validates the target user is active and visible, and writes an `owner_transferred` audit entry. New coverage: `tests/booking-transfer-owner-route-contract.test.ts`, `tests/transfer-booking-owner.test.ts`, and `tests/decision-contracts.test.ts`.
- 2026-07-08: **Extend optimistic-lock parity shipped.** `POST /api/bookings/[id]/extend` now requires and validates `If-Unmodified-Since` the same way `PATCH /api/bookings/[id]` already did — 428 if missing, 400 if invalid, 409 on a stale snapshot. Closes a fresh-audit finding (`tasks/audit-bookings-web.md`) where a stale tab's quick-extend action could silently succeed against a booking someone else had just changed, since the extend route only validated the new date against the live `endsAt` inside its transaction, not against what the client believed the booking's state was. New coverage: `tests/booking-extend-route-contract.test.ts`.
- 2026-07-07: **Availability preflight/commit parity shipped.** `/api/availability/check` now accepts an optional `kind` and applies the same per-kind `availableForCheckout`/`availableForReservation` gating the save path enforces, so the wizard and edit surfaces can no longer say an asset is available and then 409 at submit. Web callers send their kind (wizard sends RESERVATION, booking details sheet and equipment tab send `booking.kind`); iOS keeps omitting the field with unchanged legacy behavior until a parity pass. The route also gains the standard `requirePermission(booking, view)` check (all roles hold it; consistency only), and the equipment picker's "who has it" lookup now includes PENDING_PICKUP holders so staged pickups stop showing as unavailable-with-no-holder. Availability service core audited and unchanged: blocking statuses are consistent across conflicts/commitments/derived status, the 60m turnaround buffer applies on the query side, and bulk shortage math stays deliberately conservative. Plan: `tasks/archive/availability-hardening-plan.md`.
- 2026-07-06: **Reservation lifecycle hardening shipped.** `cancelReservation` now enforces terminal-state guards inside its SERIALIZABLE transaction (route policy reads outside it, so a reservation completed in that window could previously be flipped to CANCELLED), reservation requester changes validate the new requester exists and is active, and the unused `status` passthrough on reservation updates is removed. Details in `tasks/archive/bookings-hardening-plan.md`.
- 2026-07-03: Native iOS Create Reservation review all-day cleanup shipped. The confirmation step now keeps all-day linked reservations date-only and says `Return after event` instead of exposing midnight pickup/return timestamps.
- 2026-07-03: Native iOS Create Reservation attachment filtering shipped. The Equipment step now hides attachment categories from category chips and result groups, even where stored category values still use legacy `Accessories` naming, so attachments do not appear as independent reservation line items.
- 2026-07-03: Native iOS Create Reservation picker hit-area cleanup shipped. Requester and pickup picker rows now make the full visible row tappable, aligning the plain SwiftUI rows with native list-row expectations.
- 2026-07-03: Native iOS Create Reservation all-day header cleanup shipped. Linked all-day events now render date-only `All day` copy in the Details header instead of `12:00 AM` event times, while manual timed window edits still show exact pickup and return times.
- 2026-07-03: Native iOS Create Reservation Details row polish shipped. Shared form picker rows now keep labels such as `Pickup` on one line and let long selected values truncate, preserving native form readability on compact iPhone widths.
- 2026-07-03: Native iOS Bookings empty-state CTA cleanup shipped. The default empty All scope now shows one clear centered `New Reservation` recovery action instead of duplicating the same creation action in the toolbar, while creation remains available from the toolbar in populated and filtered list states.
- 2026-07-03: Shared booking edit and extend mutations now map commit-time SERIALIZABLE conflicts and allocation/exclusion constraint races to controlled 409 booking conflict responses. Reservation timing, location, and equipment edits still revalidate availability and audit changes, but a race that happens between preflight and commit now returns actionable conflict feedback instead of leaking an internal error.
- 2026-07-02: Native iOS reservation creation reworked around the search-select-search pattern. Equipment step: search-first results with tap-to-add (bulk SKUs add one unit, fine-tuned in the cart drawer), category filter chips while browsing, a pinned cart bar owning the Review action, and continuous tag scanning with in-scanner feedback. Details step: event linking leads (auto-fills title and window), quick duration presets, collapsed notes. Default browse is a flat Most popular list (supplies surface via search or category chips) and cart drawer rows show item thumbnails with a red X remove control. No server contract changes; availability is still rechecked at submit.
- 2026-07-02: Native iOS Bookings list freshness pass prevents reservation ghost rows by no longer rendering the 24-hour SwiftData booking cache as normal list content. The list now uses a native `Mine / All / Attention` scope, includes reservation starts that need attention through existing active/due/overdue list reads, shows live refresh state, and keeps creation visibly reservation-first with `New Reservation`.
- 2026-07-02: Native iOS Booking Detail now presents editable booking metadata as one clear Details card and sheet. `Edit Details` exposes title, pickup/return window, notes, and reservation pickup location through the existing optimistic-lock `/api/bookings/[id]` PATCH path; equipment remains read-only in the detail view with kiosk-owned handoff copy so item custody changes stay out of normal app detail.
- 2026-07-01: Shared booking PATCH now treats stale duplicate edits as idempotent only when the submitted fields already match the current reservation, including return-window changes. The first save still owns the audit entry, while real stale competing window edits continue to return 409 conflict responses.
- 2026-06-30: Reservation title and notes-only edits no longer rerun availability checks or rebuild equipment rows. Timing, location, and equipment edits still revalidate availability and update allocation windows, while harmless metadata edits stay out of conflict handling.
- 2026-06-30: Native iOS reservation creation now uses SwiftUI `.searchable` for the Equipment step instead of an inline custom search row. Scan-to-add, grouped asset rows, selected equipment recovery, bulk quantities, and server-side availability checks stay on the existing paths.
- 2026-06-29: Native iOS reservation detail now guards Save, Extend, and Cancel handlers before sending booking mutations. A rapid duplicate tap can no longer make a successful return-window edit show the stale-write "modified by someone else" message or duplicate adjacent reservation actions while the first request is in flight.
- 2026-06-29: Native iOS reservation detail notes editing now uses a multiline editor and preserves the existing optimistic-lock PATCH path while sending an explicit empty string when notes are cleared. This fixes the native clear-notes path without changing reservation lifecycle, kiosk pickup, or server mutation contracts.
- 2026-06-27: Shared booking-list extension and initial-load failures now use reservation-safe recovery copy that says the booking was not extended or the list should be retried before acting, replacing generic network and temporary-error wording.
- 2026-06-26: Reservation list and full reservation detail now surface the shared booking-change sync health via the shadcn-backed status indicator. The existing committed-change invalidation remains unchanged; this makes visible whether reservation freshness is live, paused, offline, or retrying.
- 2026-06-24: Booking real-time sync partial AC-12 proof. Web reservation list and an already-open detail sheet now refresh from committed edit/cancel changes without manual refresh via the shared booking-change signal; the browser smoke also caught and fixed the detail-sheet local-state gap. Kiosk pickup fulfillment remains the unproven part of AC-12.

## Out of Scope (V1)
1. Multi-calendar external reservation sync.
2. Approval workflows beyond current tier model.
3. Reservation templates and assistants.

## Developer Brief (No Code)
1. Implement explicit transition guardrails for booking lifecycle states.
2. Enforce conflict revalidation for every reservation edit that impacts availability.
3. Prevent cancel misuse by treating fulfilled reservations as `COMPLETED` and active custody as checkout-owned.
4. Preserve audit completeness for transitions, denials, and reassignment events.
5. Add regression coverage for concurrency races, permission bypass, and cross-midnight edits.
6. Implement reservation detail anatomy with tabbed context and searchable equipment panel.
7. Implement state-aware actions menu with duplicate behavior, kiosk pickup guidance, and deferred items hidden.
8. Implement list page controls and row behavior from V1 list surface spec.

## Change Log
- 2026-06-26: Reservation equipment picker now treats current holdings as time-bounded commitments instead of blanket disabled rows. Serialized gear held by someone else remains selectable when its active booking ends at least 60 minutes before the requested reservation starts, while tighter handoffs, overlapping allocations, and terminal item states stay blocked.
- 2026-06-26: Reservation linked-event picker now preserves full non-game event summaries even when sport metadata exists, so media-day events display and auto-fill as their actual event names instead of collapsing to only the sport label.
- 2026-06-22: Booking status display cleanup. Reservation detail helpers, booking-list rows/cards, upcoming item reservations, and item booking history now resolve labels and badge/status colors through `src/lib/booking-status-display.ts`, preserving D-025 display-only labels without route-local booking status switches.
- 2026-06-22: Booking action policy cleanup. Reservation/check-out list menus now resolve actions through the shared app/web booking policy, preserving D-040 by keeping custody conversion and return actions off regular app/web menus.
- 2026-06-20: Reservation list filters inherit the refreshed shared `FilterChip` and active-filter chip treatment: lighter borders, 40px removable targets, active underline, and quieter applied-filter buttons while preserving the existing clear behavior and reservation filter semantics.
- 2026-06-20: Reservation list filters inherit the lighter shared `OperationalToolbar` shell, keeping existing search/filter semantics while reducing the card-like frame around the command row.
- 2026-06-20: Reservation detail inline-edit rows inherit the refreshed shared `SaveableField` dirty-row treatment, keeping title/notes save semantics while making pending save/cancel actions visually explicit and 40px target sized.
- 2026-06-19: Native reservation creation showtime polish shipped. iOS event-linked reservation titles now use sport-code `vs`/`at` naming, selected events no longer overwrite pickup location with event venue, counted item families sit in the same Equipment flow as serialized assets, and the Confirm step uses pickup/return language with thumbnail-led equipment rows plus inline linked-event context.
- 2026-06-19: Native reservation creation now loads available serialized equipment for the selected pickup location in a bounded 300-row request, groups rows by category in the iOS Equipment picker, and shows search recovery copy if more matches exist past the cap.
- 2026-06-19: Native reservation creation now carries `BulkSku.imageUrl` through `/api/form-options` into iOS `FormBulkSku`, so battery and counted-item rows show SKU photos in the Equipment picker and selected list with the existing box fallback for photo-less SKUs.
- 2026-06-18: Kiosk-only custody Slice 4. Due `BOOKED` reservations now appear as pickup work in the kiosk student hub. Kiosk pickup detail, scan, and confirm accept reservations as well as legacy `PENDING_PICKUP` checkouts. Serialized and numbered-unit scans are staged on the source reservation; confirmation creates an `OPEN` checkout through `sourceReservationId`, binds exact numbered units, completes the source reservation, and writes kiosk pickup audit. AC-1 is now met; broader list/detail consistency after kiosk fulfillment remains tracked by AC-12.
- 2026-06-15: Kiosk-only custody Slice 3. App/web reservation flows are now the only remote booking creation path: dashboard, item detail, event missing-gear, bookings, and native non-kiosk surfaces point users to reservations, with pickup guidance instead of `Start checkout` actions.
- 2026-06-15: Server boundary for D-040 shipped. `/api/reservations/[id]/convert` now rejects app/web conversion into checkout custody, and fulfilled source reservations now close as `COMPLETED` when a kiosk-marked checkout creation path uses `sourceReservationId`.
- 2026-06-15: Accepted the reservation-first app/web contract (D-040). App/web reservation detail should no longer create checkout custody; kiosk pickup fulfills due reservations, creates or opens the linked checkout custody record, and closes the source reservation as `COMPLETED`.
- 2026-06-11: iOS native reservation creation event linking and showtime polish shipped. The Details step now loads upcoming events, supports up to 3 linked event selections, auto-fills context from the selected span while respecting user edits, and submits `eventIds[]` when events are selected. The native sheet keeps event-detail prep-gear legacy prefill behavior, scan-to-add, bulk/countable selection, and server-side availability enforcement unchanged.
- 2026-06-10: Web reservation creation inherits the shared Step 1 duration-preserving start-date behavior from the booking wizard. Moving Start now shifts End by the previous duration instead of making a valid window invalid.
- 2026-06-10: Web reservation creation audit/polish pass (refresh Slice 6). Same fixes as checkouts (escape-literal placeholders, layout alignment, hit targets, skeletons), plus the header kind badge now uses the canonical purple (was blue) and the Step 3 review icon uses the canonical calendar glyph per docs/COLOR_SYSTEM.md.
- 2026-06-08: Web reservation creation visual refresh shipped. `/reservations/new` now promotes the selected event/booking title instead of a generic New Reservation hero, uses a quieter creation-page breadcrumb, replaces dense Step 1 admin rows with local stacked field groups, compresses Step 2 helper copy, removes unused picker tab counts and select-visible action, uses row skeletons for picker loading, keeps footer navigation tied to review instead of category browsing, compresses selected equipment into removable tray chips, and presents confirmation as a calmer Apple-like review panel while preserving multi-event, draft, availability, and reservation payload contracts.
- 2026-06-06: Web reservation creation kit-list recovery shipped. `/reservations/new` now treats failed location-scoped kit reads as a retryable inline optional-kit error instead of silently removing the Kit control, while preserving true no-kit behavior, ad hoc/event-linked creation, drafts, equipment selection, and reservation payload contracts.
- 2026-06-06: Web reservation creation event-list recovery shipped. `/reservations/new` now treats failed upcoming-event reads as a retryable inline calendar error instead of the same state as no upcoming events, while preserving the ad hoc reservation path, multi-event selection, draft behavior, and reservation payload contract.
- 2026-06-05: iOS Bookings empty-state recovery shipped for native reservations. Search-empty states now offer Clear search, the Mine-only empty state offers Show all visible bookings, and an empty Reservations tab gives users a direct New Reservation action when creation is allowed.
- 2026-06-03: iOS Create Booking control clarity shipped for native reservations. CreateBookingSheet now uses visible Choose Equipment and Create Reservation actions, and the equipment step shows selected items with per-row Remove controls so users can correct selections without searching the list again.
- 2026-06-03: iOS Booking Detail control clarity shipped. Native reservation detail now shows a labeled `Edit` toolbar action when editing is allowed, and owner-access bookings that are no longer editable show an `Editing locked` notice instead of leaving a disappearing pencil unexplained.
- 2026-06-03: iOS reservation edit contract aligned with shared booking hardening. Native `BookingDetailView` now decodes the booking snapshot `updatedAt` defensively and sends it as `If-Unmodified-Since` on `/api/bookings/[id]` PATCH calls, so reservation edits use the same stale-write rejection path as web without breaking older payloads that do not include the timestamp.
- 2026-06-02: Manual multi-day all-day event linkage support shipped for reservation creation. Linked all-day events now keep their manual summary, derive the reservation window from the full event span without timed-game buffers, and show all-day range copy in the event picker and confirmation review while preserving existing `eventIds[]`, `Booking.eventId`, and `BookingEvent` semantics.
- 2026-06-02: Custody confidence slice 5. Shared reservation detail sheet history pagination now surfaces stale-cursor, access-change, server, network, and malformed-response failures inline, with retry or refresh recovery instead of silently hiding older audit entries.
- 2026-06-02: Custody confidence slice 4. Successful reservation cancellation from the `/bookings` active list now removes the row from the visible work queue and refreshes the list, preserving AC-12 list/detail consistency after cancel actions.
- 2026-06-02: Custody confidence slice 2. Reservation conversion docs and shared detail/sheet copy now match the shipped service behavior: `Start checkout` creates a pending pickup and closes the reservation, with gear custody beginning only at kiosk pickup.
- 2026-05-30: Booking create UX ownership pass. Reservation creation now shows event-linked versus ad hoc context before Step 1 completion, carries selected hard-conflict, next-use, and turnaround warning counts through Step 2 and confirmation, and improves success feedback before opening `/bookings` with the new reservation highlighted.
- 2026-05-30: Booking create hardening. Shared reservation creation now rejects empty payloads, duplicate `eventIds`, duplicate bulk lines, and invalid create windows before booking writes. Exclusion-constraint and serializable overlap races now return 409 conflict responses instead of leaking server errors.
- 2026-05-25: Web bug sweep Batch 28. Booking detail sheet deep links now preserve `sheetTab=equipment|history` through `/bookings` mounted-route handoff, clear the consumed URL parameter, and focus the requested detail section after the sheet data loads.
- 2026-05-25: Web bug sweep Batch 21. Shared reservation/booking lists now safe-parse list responses, context-menu mutations use a ref-backed duplicate-submit guard, and menu extend actions always release their busy state through `finally`. Full reservation detail actions now also clear action locks through `finally`, expired-session inline saves throw instead of locally patching false success, extend presets safe-parse their settings response, and shared edit/search/date controls expose stable form metadata.
- 2026-05-24: Web bug sweep Batch 18. Reservation creation, shared EquipmentPicker search/scan/hydration, event context loading, kit loading, draft resume/save, form-options, booking detail reads, and equipment conflict previews now use shared auth redirects and safe response parsing where applicable. Malformed JSON on reservation create, draft save, and availability check routes now returns 400 before booking, draft, or availability service work.
- 2026-05-24: Web bug sweep Batch 7. Shared reservation detail sheets now safe-parse detail, form-options, audit-log, edit, equipment-save, and checkout-conversion responses, and their mutation handlers use ref-backed guards so stale React state cannot double-submit save, extend, cancel, or start-checkout actions.
- 2026-05-21: Design language Area 6 shared-component consolidation. Reservation list filters now use `OperationalToolbar`, shared active-filter chips, and 40px shared filter controls instead of the previous route-local card-header filter row.
- 2026-05-21: Design language Area 5 state/copy audit. Shared booking detail copy now names reservation cancellation, checkout conversion, equipment-save, and extension consequences so operators know what record changed and what to retry.
- 2026-05-21: Shared reservation `EquipmentPicker` controls now follow the 40px operational target baseline for search clear, scanner close, select-visible, clear-section, bulk quantity, selected-shelf remove, and clear-all actions.
- 2026-05-20: Booking row overflow actions now use the shared `OperationalRowActions` trigger in reservation table rows, mobile rows, and booking cards while preserving right-click context menus and reservation action policy.
- 2026-03-01: Initial standalone area scope created.
- 2026-03-01: Rewritten into hardened V1 workflow, logic, and transition spec.
- 2026-03-01: Added reservation detail-page and actions-menu behavior from Cheqroom context.
- 2026-03-01: Added reservations list-page controls, columns, and role-based export behavior.
- 2026-03-02: Added explicit mobile row-interaction contract alignment.
- 2026-03-11: Docs hardening — synced action matrix to shipped `booking-rules.ts`. Removed Cheqroom action mapping. Replaced "Reserve again"/"Repeat reservation" with deferred duplicate action. Added DRAFT state. Marked V1 as shipped.
- 2026-03-14: Shipped duplicate/clone action — detail page button + list context menu entry. API endpoint at POST /api/reservations/[id]/duplicate.
- 2026-03-16: Booking reference numbers (D-024) — RV-XXXX format, global sequence, searchable, monospace badge in list/detail.
- 2026-03-22: **Unified detail page** — Reservation and checkout detail pages unified via shared `BookingDetailPage` component. Extracted `useBookingDetail` + `useBookingActions` hooks. Old `/api/reservations/[id]` GET/PATCH redirects to `/api/bookings/[id]`. PATCH returns enriched detail with before-snapshot audit. Shared `InlineTitle` component. Reservation-specific: "Start checkout" CTA, duplicate action, serial/location equipment columns.
- 2026-03-22: **Detail page UX polish (3 rounds)** — Same changes as AREA_CHECKOUTS.md. Status vocabulary: BOOKED→"Confirmed". Action buttons redesigned. Equipment row context menus. Avatar initials. shadcn component replacements (Breadcrumb, Collapsible, ToggleGroup, Alert). InlineTitle save feedback. Collapsible history with preview.
- 2026-03-25: **Booking page hardening (5-pass)** — Same shared hardening as AREA_CHECKOUTS. Error state → Alert. AbortController on all fetches. 401 redirect on all endpoints. Refresh-preserves-data. Context menu 401 handling + success toasts. Manual refresh button. Extend toast with date.
- 2026-03-25: **Kit-to-booking integration (GAP-18)** — `kitId` FK on Booking model. Kit selector in CreateBookingSheet (location-filtered). Kit badge on booking detail page.
- 2026-03-25: **Overdue priority sort** — Overdue reservations float to top of list page. Longest-overdue first.
- 2026-03-26: **BookingListPage hardened (5-pass)** — Extend toast, error differentiation (network vs server), all 8 resilience scenarios verified.
- 2026-03-30: **Photo requirement (D-028)** — Condition photos required on checkout/checkin completion. Camera-only capture. Scan-only checkin (manual checkbox return removed). Admin override available.
- 2026-03-31: **Booking sheet deep links** — Reservation redirect page forwards all URL search params. Dashboard buttons open CreateBookingSheet in-place with event auto-fill. Item detail "Reserve" deep-links with asset pre-selection.
- 2026-04-06: **Doc sync** — ACs converted to checkbox format. 11/12 checked (AC-8 conflict badges partial). Changelog backfilled for kit integration, overdue sort, list hardening, photo requirement.
- 2026-04-09: **Booking flow overhaul** — Creation flow moved from side-sheet to full-page 3-step wizard at `/reservations/new`. BookingDetailsSheet gains Equipment tab with full EquipmentPicker in edit mode. `CreateBookingSheet` deleted. Asset thumbnails on all equipment rows. Stress-tested with 8 fixes applied.
- 2026-04-09: **EquipmentPicker rebuild + hardening** — Same picker rebuild as AREA_CHECKOUTS. Full-row selection, conflict check on selection change, selected shelf, error state surfacing. Reservation wizard at `/reservations/new` shares same picker with proper browse-first UX (no scan gate).
- 2026-05-05: **Requester deep-link support** — Shared booking wizard now accepts `requesterUserId` as a creation deep-link parameter, preserving requester context from cross-page flows.
- 2026-05-06: **Bookings ownership pass** — `/bookings` tab changes now persist to URL state. The All tab is active-only by default (`DRAFT`, `BOOKED`, `PENDING_PICKUP`, `OPEN`) until a separate past toggle is shipped, and it evaluates row actions from each booking's actual kind so reservation actions remain available outside the Reservations-only tab. Desktop equipment counts now include bulk planned quantities, and page-level tabs/view controls now match peer shadcn patterns.
- 2026-05-07: **Avatar and shadcn cleanup** — Shared booking cards now use item thumbnail stacks for equipment and shadcn `Button` variants for filter clear actions, keeping reservation list chrome aligned with checkout list chrome.
- 2026-05-07: **Bookings past-scope toggle** — The unified `/bookings` page now separates Active and Past records with one URL-backed scope. Active keeps the All tab constrained to non-terminal booking statuses; Past sends `past=true` through combined, checkout, and reservation list APIs to show completed/cancelled records intentionally.
- 2026-05-07: **Booking creation ownership pass** — `/reservations/new` now uses the documented 30-day event picker window in the browser, and draft save/resume preserves multi-event links through `/api/drafts` so interrupted event-linked reservations reopen with their selected events intact.
- 2026-05-07: **Booking creation shadcn alignment** — Reservation creation now follows the Items list standard more closely: shared `PageHeader`, shadcn `Switch`/`Button`/`Badge` primitives, item-form section headings and rows, quiet bordered card surfaces, exact transitions, and browser-clean field labels.
- 2026-05-07: **Booking creation item picker flow** — Reservation creation shares the updated `EquipmentPicker`: selected asset hydration for deep links and drafts, shadcn `Tabs`/`Input`/`Checkbox`/`Button`/`Item`/`Empty` composition, in-step scan-to-add, select-visible and clear-section actions, and review-first Step 2 navigation once equipment is selected.
- 2026-05-07: **Booking creation item picker hardening** — Reservation creation shares the hardened picker availability preview: visible-section assets plus selected assets are checked, search text persists per section, conflict-warning rows remain selectable, and booking detail equipment edit passes `excludeBookingId` so a reservation does not conflict with itself.
- 2026-05-07: **Booking creation stale selection recovery** — Reservation creation now surfaces unresolved deep-linked or draft asset IDs as removable unavailable rows, and unresolved serialized assets no longer count toward review readiness, confirmation totals, draft saves, or create payloads.
- 2026-05-07: **Booking creation Step 2 UX polish** — Reservation creation Step 2 now shows a compact valid/warning/unavailable selection summary and uses state-aware footer copy such as "Review with warnings" or "Remove unavailable item" so requester recovery and staff review paths stay clear.
- 2026-05-07: **Booking creation final-screen polish** — Reservation confirmation now leads with confirmed-for-later language, location, start timing, and the staff handoff expectation that checkout begins from the reservation when gear changes custody.
- 2026-05-08: **API hardening Wave 11** — Reservation duplicate now re-checks that the loaded source is still BOOKED before creating a copy, while conversion was re-verified to validate `sourceReservationId` inside `createBooking`'s SERIALIZABLE transaction.
- 2026-05-08: **API hardening Wave 13** — Shared booking edit hardening added
  indexed search, required optimistic-lock headers, full before snapshots in
  edit audits, and read-triggered stale draft pruning. The pruning behavior was
  superseded on 2026-08-07: expired drafts remain hidden from reads, while
  physical deletion is deferred to an explicit audited maintenance path.
- 2026-05-08: **Busy-day availability stress** — Live API smoke created overlapping checkouts/reservations and confirmed serialized conflicts block against `PENDING_PICKUP` checkouts, non-overlapping same-asset reservations pass under the then-current half-open contract, and overlapping bulk reservations fail once existing `BOOKED` commitments consume available quantity. Superseded 2026-06-26 by the 60-minute serialized turnaround buffer.
- 2026-05-08: **Future booking context** — Availability checks now return the next future serialized commitment per item, and reservation creation/edit plus reservation equipment rows surface a blue "Back before" badge with the exact next needed time.
- 2026-05-08: **Turnaround risk guard** — Availability checks now return advisory serialized and bulk turnaround risks, and reservation creation/edit plus reservation equipment rows surface compact "Turnaround" warnings for short handoffs, next-use location transfers, recent damage/lost reports, and tight future bulk bookings.
- 2026-05-13: **Battery guidance polish** — Reservation creation/edit shares the updated EquipmentPicker battery guidance: compatible battery families are recommended from selected cameras, item-family quantities read as requested, and exact Units are still scanned only at kiosk pickup.
- 2026-05-10: **Bookings mounted-route polish** — `/bookings` now responds to tab, Active/Past, search, status, location, requester, special-filter, create, `highlight`, and legacy `id` URL changes after the page is already mounted. Reservation overdue and due-today links now map to real `BOOKED` reservation API filters instead of showing an unfiltered reservation list.
- 2026-05-10: **Bookings status ship fixes** — Past-due `BOOKED` reservations now surface separately on dashboard as Stale reservations, linking to `/bookings?tab=reservations&filter=overdue`, while checkout overdue counts remain custody-only.
- 2026-06-11: **Duplicate creation audit entry fix** — Reservation creation no longer writes a second route-level audit entry; `createBooking()`'s in-transaction `created` entry is the single source, so new reservations show one "created booking" history line instead of two.
- 2026-06-11: **Booking detail visual refresh** — Reservation detail page and quick-view sheet share the refreshed wizard-aligned styling (inline section headers + count badges, softer card borders with shadow-xs, stagger motion on equipment rows). See AREA_CHECKOUTS 2026-06-11 entry; components are shared across kinds.
- 2026-07-28: **iOS drafts reach parity with web** — native iOS now reads and writes the same `/api/drafts` rows the web wizard uses, so an interrupted reservation is a `DRAFT` booking rather than lost input. The iOS composer minimizes to a card instead of blocking the app, exit offers save-or-discard, and creating the reservation deletes its draft. No schema, route, or web changes; see `AREA_MOBILE.md` 2026-07-28 for the client detail.
- 2026-07-28: **Draft permission, audit, and completion hardening** — `/api/drafts` now applies the canonical booking or checkout permission before reads and writes, honors collaborator `MY_GEAR_VIEW` / `RESERVATION_CREATE` capabilities, and forces Student and Collaborator reservation drafts to the authenticated requester. Draft create, update, and discard writes carry useful transactional audit snapshots; ownership and `DRAFT` status are rechecked inside the serializable update/delete transaction. Reservation creation accepts an optional owned `sourceDraftId` and deletes that row with a `draft_consumed` audit entry inside the same serializable transaction as the new `BOOKED` reservation, so a successful response cannot leave a duplicate draft.
- 2026-07-28: **Lost-response draft recovery** — reservation creation uses the consumed draft audit as an actor-scoped response-recovery record. A retry with the same `sourceDraftId` returns the original committed reservation, notification ownership comes from that persisted row, and any later changed payload is ignored. This closes the response-loss window without duplicate bookings or cross-requester notification side effects.
- 2026-07-28: **Native submission ownership and durable notification follow-up:** the iOS composer now persists a server draft before every submit path, including a never-saved or bulk-only reservation, and only the exact session-owned composer may adopt, finish, or clear that draft after an await. Reservation create and cancel routes await durable lifecycle-notification creation before returning; only APNs transport remains deferred. This closes cross-account late-submit cleanup, source-draft omission, and serverless response-freeze notification loss without changing reservation permission or custody policy.
- 2026-07-28: **Indeterminate native submission replay** — the native composer binds one immutable reservation payload to its `sourceDraftId` across network, decoding, session-boundary, non-HTTP, and HTTP 5xx retries. HTTP 4xx rejection is definite and permits correction. If replay confirms that the original payload committed while the user made later edits, the app saves those edits as a fresh draft and keeps the composer available. Notes, requester, location, event links, title, schedule, and gear all participate in unsaved-work protection; a pristine Save Draft cannot report success without persistence.
