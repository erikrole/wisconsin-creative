# Research: Scheduling + Gear Integration — One Stop Shop

**Date**: 2026-03-17
**Status**: Research complete — ready for planning
**Owner**: Wisconsin Athletics Creative
**Decisions**: Student-first, event pre-fill (no area-based auto-suggest in V1)

---

## Executive Summary

Wisconsin Athletics Creative has two fully-implemented systems in Wisconsin Creative:

1. **Shift Scheduling** — ICS event sync, auto-generated shifts per sport/area config, student assignments, trade board
2. **Gear Management** — equipment checkout/reservation with QR scanning, conflict detection, event-linked bookings

Both already pivot on `CalendarEvent` as a shared entity, but they operate as separate workflows. The goal: make them feel like **one seamless system** — a "one stop shop" that no competitor offers.

**Key finding**: No competitor does both equipment checkout AND student worker shift scheduling natively in one athletics-specific platform. This is our moat.

---

## Competitive Analysis

### Market Landscape

| Competitor | Equipment Mgmt | Staff Scheduling | Athletics-Specific | Integration Level |
|---|---|---|---|---|
| **WebCheckout** | Core product | Add-on module | No (generic higher-ed) | Shared messaging only |
| **Cheqroom** | Core product | None | No | N/A |
| **Teamworks** | None | Core product (comms) | Yes (D1 programs) | N/A |
| **EquipCheck** | Core (athletics) | None | Yes | N/A |
| **DSE Rec** | Partial (facilities) | Staff scheduling | No (campus rec) | Limited |
| **FMX** | Maintenance tracking | Team assignments | No (facilities) | Shared work orders |
| **Univerus Rec** | Space booking | Facility scheduling | No (campus rec) | Shared space model |
| **Wisconsin Creative (Us)** | Core product | Core product | **Yes** | **Shared CalendarEvent** |

### WebCheckout — Closest Competitor (200+ institutions, $400+/mo)
- Has both equipment and personnel scheduling modules
- Sets specializations/certifications per employee, uses as shift criteria
- Modules share a unified messaging system
- **Weakness**: Generic higher-ed platform, not athletics workflow-aware
  - No sport configurations, no event-centric checkout, no trade board
  - No ICS event sync, no home/away coverage differentiation
  - No mobile-first student design

### Market Insights from Industry Research

**Student worker scheduling challenges** (source: TCP Software, ScheduleSource):
- Class schedules change every semester → need date-based availability profiles
- Work-study / international students capped at 20h/week → hour tracking needed
- Midterms/finals require automatic schedule adjustments
- Shift swap capability is essential for student retention

**Equipment room best practices** (source: EquipCheck, Cheqroom):
- Workflow should mirror natural flow: issue → return → reconcile
- QR/barcode/NFC scanning for accountability
- Session-based scan workflows with audit trail
- Individual unit tracking prevents "count is wrong but who has what?"

**Integration best practices** (source: Athletic Administrator Software Guide 2025):
- Prioritize platforms with API integration capabilities
- Scheduling + equipment management is the #1 requested combo
- Mobile-first is non-negotiable for student workers

### Our Competitive Advantages

1. **Athletics-specific**: Sport configs, ICS event sync, home/away shift counts, sport-linked checkouts
2. **Unified data model**: Both shifts and gear pivot on CalendarEvent — no data silos or API glue
3. **Student-first mobile**: Role-adaptive UI designed for phone-first student workers (D-015)
4. **Event-centric flow**: D-003 links gear to events; shifts link to events — the connection is architecturally natural
5. **Cost**: Internal tool vs. $400+/mo for WebCheckout + separate scheduling tool

---

## Integration Opportunity Map

### Where Scheduling + Gear Already Touch (Existing)
1. `CalendarEvent` → `ShiftGroup` (1:1) AND `CalendarEvent` → `Booking[]` (1:many via eventId)
2. `ShiftDetailPanel` shows equipment checkouts for the same event
3. Event detail page shows both shift coverage and equipment checkouts
4. Booking creation has event picker that populates from the same ICS data
5. Both share `sportCode` for filtering

### Where They Should Touch (Gaps)

#### Student Workflow Gaps
| Gap | Current State | Target State |
|---|---|---|
| No "My Day" view | Shifts and checkouts are separate pages | One surface showing "shift at 2pm + pick up gear at 1:30pm" |
| No gear awareness on shifts | Assigned to VIDEO, no gear prompt | "You're assigned — reserve your gear?" notification |
| No shift context on checkout | Checkout creation is generic | "This checkout is for your VIDEO shift at Basketball vs. Iowa" |
| No pre-game checklist | Student assembles info from 3 pages | Unified "here's everything for your shift" card |

#### Staff Workflow Gaps
| Gap | Current State | Target State |
|---|---|---|
| No game-day prep board | Check shifts page, then checkouts page | "Basketball vs. Iowa: 8/10 shifts, 3/3 gear ready" in one view |
| No coverage + gear readiness | Coverage dots show shift fill only | Combined readiness indicator |
| No auto-suggestion flow | Staff manually creates checkouts after scheduling | "Shifts generated — create gear reservations?" prompt |
| No post-event reconciliation | Check two systems for completion | "All gear returned, all shifts logged" summary |

---

## Feature Ideas — Ranked by Impact

### Tier 1: High Impact, Low-Medium Effort (Build First)

#### 1. Unified "My Shifts" Dashboard Widget
**Impact**: Students see upcoming shifts with gear status in one card
- Show: shift time, area, event, gear checkout status (none / reserved / checked out)
- "Reserve Gear" link → checkout creation pre-filled with event/time
- Mobile-first card layout, fits existing dashboard grid
- **Effort**: ~1 slice. Reads from existing APIs. No schema changes.

#### 2. Shift Context on Checkout Creation
**Impact**: When creating a checkout linked to an event, show shift info
- Header: "Basketball vs. Iowa — Your shift: VIDEO 1:30–5:00 PM"
- Pre-fill: event, time window (with 30min buffer), location
- **Effort**: ~0.5 slice. Enrich existing checkout create form. No schema changes.

#### 3. "Gear Up" Notification on Shift Assignment
**Impact**: When student gets approved for a shift, receive notification to reserve gear
- In-app notification: "You've been assigned to VIDEO for Basketball vs. Iowa. Reserve your gear?"
- Link → checkout creation with event pre-filled
- Uses existing notification system (no new channels needed)
- **Effort**: ~0.5 slice. Add notification trigger to shift assignment approval flow.

#### 4. Event Command Center (Staff View)
**Impact**: Staff see full game-day readiness at a glance
- Unified view: shift coverage grid + gear checkout summary
- Status line: "Shifts: 8/10 filled | Gear: 3 checkouts (2 picked up, 1 pending)"
- Quick actions: assign shift, create checkout, view details
- Builds on existing event detail page
- **Effort**: ~1 slice. New component, reads from existing APIs.

### Tier 2: Medium Impact, Medium Effort

#### 5. Shift-Checkout Linking
**Impact**: Explicit link between a student's shift and their gear checkout
- Add optional `shiftAssignmentId` FK on Booking (nullable)
- ShiftDetailPanel: show per-assignment gear status icon
- Checkout detail: show "For: VIDEO shift, Basketball vs. Iowa"
- Enables reporting: "which shifts don't have gear reserved?"
- **Effort**: ~1 slice. Schema migration + service + UI changes.

#### 6. Game-Day Readiness Score
**Impact**: Dashboard card for staff showing upcoming events with combined readiness
- Formula: shift fill rate + gear readiness → combined score
- Color-coded: green (100%), orange (50–99%), red (<50%)
- Priority card on staff dashboard
- **Effort**: ~1 slice. New dashboard component, aggregation query.

#### 7. Post-Event Summary
**Impact**: After event ends, show combined completion status
- "Basketball vs. Iowa — Complete: 10/10 shifts logged, 3/3 gear returned"
- Or: "2 items overdue from Sarah's checkout" with direct link
- **Effort**: ~0.5 slice. New event status derivation.

### Tier 3: Higher Effort, Strategic (Future)

#### 8. Area-to-Equipment Defaults
**Impact**: Pre-populate equipment picker based on shift area
- Config: VIDEO → [Cameras, Lenses, Batteries, Tripods]
- When student hits "Gear Up", picker pre-selects area-appropriate categories
- Code-defined in V1 (per D-016 pattern), admin-configurable later
- **Decision**: Deferred for now. V1 uses event pre-fill only.
- **Effort**: ~1 slice when ready.

#### 9. Auto-Reserve on Shift Generation
**Impact**: When shifts auto-generate, optionally create draft reservations
- Requires area-to-equipment mapping (Feature 8)
- Creates DRAFT reservations staff can review/confirm
- Biggest time saver for recurring events
- **Effort**: ~2 slices. Complex, depends on Feature 8.

#### 10. Pre-Game Runbook / Checklist
**Impact**: Printable/mobile game-day sheet combining shifts + gear + notes
- Aligns with Phase C "Board / ops view for game-day coordinators"
- Auto-generated from assignments + checkouts
- **Effort**: ~2 slices. New page + PDF generation.

---

## Recommended Implementation Order

**Persona priority**: Student-first
**Gear suggestion model**: Event pre-fill (no area-based auto-suggest in V1)

### Phase 1: Student Integration (Slices 1–3)

| Slice | Feature | Schema Change? | Key Files |
|---|---|---|---|
| 1 | Shift context on checkout creation | No | Checkout create form, event-defaults.ts |
| 2 | "My Shifts" dashboard widget with gear status | No | Dashboard page, new MyShiftsWidget component |
| 3 | "Gear Up" notification on shift assignment | No | notifications.ts, shift-assignments.ts |

### Phase 2: Staff Integration (Slices 4–5)

| Slice | Feature | Schema Change? | Key Files |
|---|---|---|---|
| 4 | Event Command Center (combined view) | No | Event detail page, new EventCommandCenter component |
| 5 | Game-Day Readiness Score | No | Dashboard page, new ReadinessCard component |

### Phase 3: Deep Integration (Slices 6–7)

| Slice | Feature | Schema Change? | Key Files |
|---|---|---|---|
| 6 | Shift-Checkout linking (FK) | Yes (migration) | prisma/schema.prisma, bookings.ts, ShiftDetailPanel |
| 7 | Post-Event Summary | No | Event detail page |

### Phase 4: Automation (Future)

| Slice | Feature | Schema Change? | Key Files |
|---|---|---|---|
| 8 | Area-to-equipment defaults | No (code config) | New area-equipment-defaults.ts, EquipmentPicker |
| 9 | Auto-reserve on shift generation | No | shift-groups.ts, bookings.ts |
| 10 | Pre-game runbook | No | New page + component |

---

## Student Workflow Vision (Target State)

```
1. Student opens app → Dashboard "My Shifts" widget
2. Sees: "Tomorrow: VIDEO, Basketball vs. Iowa, 1:30–5:00 PM"
3. Gear badge: "⚪ No gear reserved"
4. Taps "Reserve Gear" → Checkout creation opens:
   - Event: Basketball vs. Iowa (pre-filled)
   - Time: 12:30–5:30 PM (30min buffer auto-applied)
   - Location: Kohl Center (from event)
   - Equipment: Full picker, student selects what they need
5. Confirms → Reservation created, badge updates to "🟡 Gear reserved"
6. Game day: Arrives at equipment room, scans QR → Checkout opens
7. Scans items → Badge: "🟢 Gear checked out"
8. Post-game: Returns gear, scans back → Badge: "✅ Complete"
9. All visible in one dashboard — no jumping between pages
```

## Staff Workflow Vision (Target State)

```
1. Staff opens Schedule → sees events with coverage dots + gear indicators
2. Clicks "Basketball vs. Iowa" → Event Command Center:
   - Left: Shift grid (8/10 filled, by area)
   - Right: Gear summary (3 checkouts: 2 picked up, 1 pending)
3. Assigns remaining shifts → Students auto-notified to "Gear Up"
4. Game day: Readiness card on dashboard: "🟢 Basketball: Ready"
5. Post-game: Summary card: "10/10 shifts, 3/3 gear returned"
6. Exception: "Camera #7 overdue — Sarah's checkout" → escalation per D-009
```

---

## Data Model Notes

### No Schema Changes Required for Phase 1–2
All student and staff integration features in Phases 1–2 use existing data relationships:
- `CalendarEvent.id` links `ShiftGroup` (via eventId) and `Booking` (via eventId)
- Existing APIs provide all needed data
- New components are read-only aggregations

### Phase 3 Schema Addition (When Ready)
```prisma
model Booking {
  // ...existing fields...
  shiftAssignmentId  String?          @unique
  shiftAssignment    ShiftAssignment? @relation(fields: [shiftAssignmentId], references: [id])
}

model ShiftAssignment {
  // ...existing fields...
  booking            Booking?  // reverse relation
}
```

This enables:
- Direct query: "which shifts have gear reserved?"
- Per-assignment gear status in ShiftDetailPanel
- Checkout detail showing shift context

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Feature creep into area-based auto-suggest | Medium | Scope bloat | Decision recorded: V1 = event pre-fill only |
| Dashboard widget adds mobile scroll | Low | UX regression | Review against AREA_MOBILE.md per D-015 |
| Notification fatigue from "Gear Up" | Medium | Annoyance | Make optional, respect notification preferences |
| Phase 3 FK migration breaks existing bookings | Low | Data integrity | Nullable FK, no existing data affected |
| Staff Command Center scope expands | Medium | Delayed ship | Thin slice: read-only aggregation first, actions later |

---

## Sources

### Competitive Research
- [Athletic Administrator Software Guide 2025](https://touchhalloffame.us/blog/software-products-athletic-administrators-top-30-must-haves/)
- [Teamworks — The Operating System for Sports](https://teamworks.com/)
- [DSE Rec — Campus Recreation Management](https://www.dserec.com/)
- [FMX — Higher Education Facilities Management](https://www.gofmx.com/higher-education-facilities-management-software/)
- [Cheqroom — University Equipment Management](https://www.cheqroom.com/blog/university-equipment-management-software/)
- [EquipCheck — Athletic Equipment Software](https://getequipcheck.com/)
- [Univerus Rec — Facility Management](https://www.univerussportandrecreation.com/facility-management-software)
- [G2 — Athlete Management Software Reviews](https://www.g2.com/categories/athlete-management)

### Scheduling Best Practices
- [TCP Software — Employee Scheduling in Higher Ed](https://tcpsoftware.com/articles/employee-scheduling-for-higher-ed/)
- [ScheduleSource — Student Worker Scheduling Pitfalls](https://schedulesource.com/articles/scheduling-student-workers)
- [Shiftboard — Staff Scheduling for Universities](https://www.shiftboard.com/employee-scheduling-software/scheduleflex/education/)
- [MyShyft — Student Worker Scheduling](https://www.myshyft.com/blog/student-worker-scheduling/)
- [Teamup — University Athletics Scheduling](https://blog.teamup.com/streamlined-scheduling-for-university-athletics/)

### Equipment Management Best Practices
- [Cheqroom — How to Create an Equipment Checkout System](https://www.cheqroom.com/blog/create-equipment-checkout-system-with-spreadsheets/)
- [Mindbody — Best Sports Facility Software](https://www.mindbodyonline.com/business/education/comparison/10-best-sports-facility-software-options)
- [Spacesaver — Athletic Equipment Storage](https://www.spacesaverva.com/blogs/top-8-athletic-equipment-storage-solutions)
