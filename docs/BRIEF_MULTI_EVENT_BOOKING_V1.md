# Brief: Multi-Event Booking V1

## Document Control
- Owner: Wisconsin Athletics Creative Product
- Date: 2026-04-23
- Status: Implemented — production server deployed; authenticated interaction proof pending
- Related Area: `AREA_CHECKOUTS.md`, `AREA_RESERVATIONS.md`, `AREA_EVENTS.md`

---

## Problem Statement

A single booking can currently be tied to **one** calendar event via `Booking.eventId`. Real shoot weekends span multiple contiguous events — e.g., volleyball Friday night + Saturday matinee, or a football game day that includes pregame practice, the game itself, and a postgame presser. Operators today either:

- Create a separate booking per event (duplicate equipment picking, duplicate conflicts to resolve)
- Create one booking tied to the earliest event with an end time manually extended to cover the last event (breaks "event tie-in" for reports/dashboards — the later events have no linked booking)

Neither works. We need one booking that holds gear for the entire window and is discoverable from every event in that window.

## Solution

Introduce a `BookingEvent` junction table. A booking keeps its existing primary `eventId` (chronologically first event, for read-path compatibility) and optionally links to additional events through the junction. The booking window auto-derives from `min(events.startsAt)` → `max(events.endsAt)` when events are provided.

Wizard Step 1 replaces single-event selection with multi-select. All current single-event read paths continue to work against `booking.eventId`; new read paths use the `booking.events` relation to show and link all events.

---

## Scope (V1)

### 1. Schema — `BookingEvent` junction (Critical)
- New table: `booking_events` with columns `booking_id` (fk), `event_id` (fk), `ordinal` (int — 0-indexed chronological position), timestamps
- Composite unique: `(booking_id, event_id)`
- Indexes: `(event_id)` for reverse lookup, `(booking_id, ordinal)` for ordered reads
- Cascade: `booking_id` → `onDelete: Cascade`; `event_id` → `onDelete: Cascade` (if event deleted, drop the link but keep booking)
- Keep `Booking.eventId` unchanged. Contract: it points to `ordinal = 0` (the primary/first event).

### 2. Service Layer (Critical)
- `createBooking(input)` in `src/lib/services/bookings-lifecycle.ts` accepts new optional `eventIds: string[]`
  - If `eventIds.length > 0`: sort by `startsAt` ascending, set `Booking.eventId = eventIds[0]`, compute `startsAt = events[0].startsAt`, `endsAt = events[last].endsAt` when caller did not supply explicit dates, and insert junction rows in same transaction
  - If `eventId` (legacy single) provided and `eventIds` absent: treat as `[eventId]` — one junction row with ordinal 0
  - If neither provided: no junction rows (ad hoc booking)
- All existing transactional guarantees (SERIALIZABLE, overlap prevention) preserved — junction inserts piggyback on the booking insert transaction

### 3. API (Critical)
- `POST /api/checkouts` — schema (`createCheckoutSchema` in `src/lib/validation.ts`) accepts optional `eventIds: string[]` (1–5 ids) alongside existing `eventId`. Validation: must reference existing events; 400 on duplicate ids; 400 on mixing `eventId` + `eventIds`
- `POST /api/reservations` — same treatment
- `GET /api/bookings/[id]` — response includes `events: [{ id, summary, sportCode, opponent, isHome, startsAt, endsAt }]` sorted by ordinal, in addition to the existing `event` (primary) shape
- `event-defaults.ts` unchanged (still resolves single event for `sportCode`-only requests)

### 4. Wizard Step 1 UI (Critical)
- `src/components/booking-wizard/WizardStep1.tsx`
  - Replace single-select button list with a multi-select list: each event row gets a left-side checkbox; clicking row or checkbox toggles selection
  - Selected events shown above list as small chips (summary + × to remove), ordered chronologically
  - Auto-fill: title from first selected event (user-editable), location from first event, sport from first event, `startsAt`/`endsAt` = min/max of selection
  - "Link to Event" toggle persists — off = ad hoc, no event list shown
  - Range helper: shift-click a second event selects the chronological range between them (nice-to-have; cut if slice runs long)

### 5. Booking Detail Display (Critical)
- `src/components/booking-details/BookingOverview.tsx`
  - When `booking.events.length > 1`: render a stacked list of events (same card pattern as single-event today), each a link to `/events/[id]`
  - When `length <= 1`: existing single-event rendering unchanged
- `src/components/booking-details/types.ts` — extend `Booking` type with `events?: Array<{ id; summary; sportCode; opponent; isHome; startsAt; endsAt }>`

### 6. Reverse Lookup (High)
- Event detail page (`/events/[id]`) — if it currently lists "bookings for this event", extend query to union `eventId = id` with `BookingEvent.eventId = id` so a secondary link is also visible from the event
- If event detail has no bookings section today: V1 out of scope; file a follow-up

### 7. Draft Persistence (High)
- `use-draft-management.ts` + `/api/drafts` — extend draft payload with `eventIds: string[]`. Legacy `eventId` kept for backwards-compat (old drafts keep working; saves as single-element `eventIds` on next edit)

---

## Out of Scope (V1)

- **Edit event list post-creation** — V1 locks event selection at create time. Editing means cancel + recreate.
- **Same-sport / same-location validation** — caller responsibility; no hard constraint in V1.
- **Multi-event conflict checks** — conflict check continues to use `booking.startsAt`/`endsAt` window; no per-event checks.
- **Multi-event report grouping** — dashboard `gearByEvent` + `my-shifts` `bookingsByEvent` still group by `booking.eventId` (primary only). V2: extend group-by using the junction.
- **UI for >10 events** — V1 caps at 5 selected events.
- **Gap detection** — if events have non-contiguous gaps (Fri evening + Sunday morning), we keep gear for the whole span — a feature, not a bug.
- **Cross-day timezone display** — use existing `formatDateRange` helper.

---

## Invariants Preserved

- Asset status derived from active allocations (no change).
- SERIALIZABLE booking mutation + overlap prevention unchanged — multi-event only affects associated metadata, not the single `(startsAt, endsAt)` availability window.
- Audit logging — `createAuditEntry` `after` payload gains `eventIds` list when multi-event; single-event creations unchanged.
- `Booking.eventId` (primary) contract preserved so all 36+ readers continue working unchanged.

---

## UX Flow

1. User opens `/checkouts/new`. Step 1 shows sport filter + event list.
2. User ticks Friday 7 PM VB vs Iowa and Saturday 2 PM VB vs Minnesota.
3. Chips appear above list: `Fri 7 PM · VB vs Iowa ×` · `Sat 2 PM · VB vs Minn ×`.
4. Form auto-fills: title = "VB vs Iowa", startsAt = Fri 7 PM, endsAt = Sat 5 PM (end of Saturday event), location = Field House.
5. User advances to Step 2 (equipment), Step 3 (summary — shows both events under "Events").
6. Submit → `POST /api/checkouts` with `eventIds: [id1, id2]`.
7. Booking created with `eventId = id1`, junction rows `(booking, id1, 0)` and `(booking, id2, 1)`.
8. Opening the booking from either event detail shows the same booking.

---

## Acceptance Criteria (Testable)

1. **Schema migration applied**: `booking_events` table exists with correct columns, uniques, indexes, cascades. `prisma migrate` runs cleanly on an existing DB with no orphan rows afterward.
2. **Create with multiple events**: `POST /api/checkouts` with `eventIds: [a, b]` (sorted non-chronologically) returns 201; resulting booking has `eventId = chronologically_first_id`, `startsAt` = first event's start, `endsAt` = last event's end, and two junction rows with correct `ordinal`.
3. **Create with one event (legacy)**: Sending only `eventId` (no `eventIds`) behaves exactly as before — one junction row with ordinal 0, no API shape change for existing clients.
4. **Detail response**: `GET /api/bookings/[id]` returns the existing `event` field (primary) AND a new `events` array sorted by ordinal, each entry with `{ id, summary, sportCode, opponent, isHome, startsAt, endsAt }`.
5. **Wizard multi-select**: User can tick 2+ events, remove any via chip ×, and submit. Title/location auto-fill from first-selected event.
6. **Detail sheet rendering**: Booking with 2 linked events shows both in the overview card; booking with 1 event renders unchanged from V0.
7. **Audit entry**: Multi-event creation logs `eventIds: [id1, id2]` in the `after` payload.
8. **Reverse lookup**: From the second event's detail page (if it has a bookings section), the booking appears — not just from the primary event's page.
9. **Draft round-trip**: Save draft with 2 event selections, reload via `?draftId=`, both events still selected.
10. **Legacy read paths unbroken**: Dashboard `gearByEvent`, my-shifts, reports, search — all continue working (they read `booking.eventId` which still points to the primary).

---

## Edge Cases

- **Same event picked twice**: rejected by composite unique + 400 from validation (dedupe client-side before submit).
- **Event deleted while booking exists**: junction row cascades away; if the deleted event was `ordinal = 0`, a backfill job or `onDelete` trigger rewrites `Booking.eventId` to the new minimum. V1: simpler — on cascade delete of the primary junction row, trigger a service-layer rebuild of `Booking.eventId` (background task or on next read).
- **Caller supplies both `eventId` and `eventIds`**: reject with 400 — pick one.
- **Caller supplies `eventIds` AND explicit `startsAt`/`endsAt`**: explicit dates win; derivation skipped.
- **Event from a different location than booking's `locationId`**: allowed (operator discretion). Auto-fill picks first event's location on initial selection; user can override.
- **>5 events selected**: schema-level validation rejects.
- **All events cancelled**: junction rows persist; booking stays unless explicitly cancelled. Dashboard queries already filter on `CalendarEventStatus.CONFIRMED`, so cancelled events just drop from views.

---

## Files to Modify (High-Level)

### Schema / Service
- `prisma/schema.prisma` — new `BookingEvent` model + `Booking.events BookingEvent[]` back-relation
- `prisma/migrations/<ts>_booking_events/migration.sql` — generated
- `src/lib/services/bookings-lifecycle.ts` — createBooking multi-event path
- `src/lib/services/event-defaults.ts` — unchanged
- `src/lib/validation.ts` — `createCheckoutSchema` + `createReservationSchema` add `eventIds`

### API
- `src/app/api/checkouts/route.ts` — wire `eventIds` through
- `src/app/api/reservations/route.ts` — same
- `src/app/api/bookings/[id]/route.ts` — include `events: { orderBy: { ordinal: "asc" }, include: { event: true } }` in response

### UI
- `src/components/booking-wizard/WizardStep1.tsx` — multi-select list + chips
- `src/components/booking-wizard/BookingWizard.tsx` — form state `selectedEvents: CalendarEvent[]`
- `src/components/booking-details/BookingOverview.tsx` — multi-event rendering
- `src/components/booking-details/types.ts` — extend types
- `src/components/create-booking/use-draft-management.ts` — draft payload

### Event Detail (optional — if it has a bookings section today)
- `src/app/(app)/events/[id]/...` — union query on reverse lookup

### Docs
- `docs/AREA_CHECKOUTS.md` — add "Multi-Event Booking" subsection
- `docs/AREA_EVENTS.md` — note reverse lookup behavior
- `docs/DECISIONS.md` — D-NEW: why junction table over FK array
- `tasks/archive/completed-2026-06/sprint-april-plan-2026-04-17.md` — mark Tier 4 Feature 1 as shipped

---

## Slice Plan (per Rule 10 Thin Slice Protocol)

1. **Slice 1 — Schema + service** (migration + `createBooking` multi-event path + unit test for ordinal assignment). Independently mergeable behind API no-op.
2. **Slice 2 — API** (`eventIds` validation in schemas, response includes `events` array). Independently testable via curl.
3. **Slice 3 — Wizard UI** (multi-select + chips + auto-fill). Independently testable against API from Slice 2.
4. **Slice 4 — Detail display** (BookingOverview multi-event + reverse lookup). Independently testable against data from Slices 1–3.
5. **Slice 5 — Hardening** (draft round-trip, audit payload, edge case fixes found in dogfooding).

Max one PR per slice.

---

## Risks and Mitigations

- **Risk**: Primary-event cascade leaves `Booking.eventId` pointing at a deleted event.
  - **Mitigation**: Service-layer rebuild on read (cheap; `ordinal = 0` lookup); or DB trigger; or `Booking.eventId` converted to computed read-through in V2.
- **Risk**: Existing clients sending `eventId` break.
  - **Mitigation**: Legacy `eventId` kept in schema + API; multi-event is additive. Regression test: V0 checkout flow still works.
- **Risk**: Wizard multi-select complicates the mobile form.
  - **Mitigation**: Chips above list collapse into a horizontal scroller on small widths; keep single-event UX visually identical until user ticks a second event.
- **Risk**: Date auto-derivation surprises users who want to override.
  - **Mitigation**: Start/end inputs remain user-editable; auto-fill only populates on event-selection change.
