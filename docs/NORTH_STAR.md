# Gear Tracker - North Star

## Document Control
- Owner: Erik Role (Wisconsin Athletics Creative)
- Product: Gear Tracker
- Created: 2026-03-09
- Last Updated: 2026-06-24
- Status: Authoritative - read this first in any Gear Tracker session
- Purpose: Define what Gear Tracker is, who it serves, what principles guide every decision, and what deserves focus next

---

## Executive Summary

Gear Tracker is the operational command system for Wisconsin Athletics Creative gear, scheduling, and game-day handoffs. It replaces Cheqroom as the inventory and custody source of truth, and it now also owns the surrounding workflow context that Cheqroom never handled well: event-linked reservations, native iOS field work, counter-based kiosk custody, shift scheduling, item-family battery operations, and accountable exceptions.

The product's primary value is **operational speed, clarity, and trust**. The core question is not "how many surfaces exist?" It is: can students and staff move gear through the right physical handoff, know who has what, know when it comes back, and recover from real-world exceptions without inventing side channels?

The current operating model is clear:

- App and web are **reservation-first** outside the gear counter.
- Native kiosk is the **custody boundary** for immediate checkout, reservation pickup, active checkout edits, and return.
- Native iOS is a first-class operational app, not a future maybe.
- Web remains the staff/admin control room for configuration, review, reporting, imports, cleanup, and power workflows.
- Schedule is a source-of-truth workflow tied to gear readiness, not a disconnected calendar.

---

## 1. What Gear Tracker Is Trying To Be

- **The operational gear layer** for Wisconsin Athletics Creative's daily and game-day workflows.
- **Event-driven by default**: athletics events, shifts, call times, and gear prep are first-class context for reservations and custody.
- **Reservation-first away from the counter**: app/web users reserve gear for future pickup; they do not create checkout custody directly.
- **Kiosk-owned for custody**: immediate checkout, reservation pickup, return, and active checkout item edits happen through authenticated native kiosk flows.
- **Native where the workflow demands it**: iOS owns student field work, scanning, Schedule access, reservation creation, Settings, and dedicated kiosk hardware.
- **Web-powerful where operators need breadth**: staff/admin use web for inventory, users, settings, imports, reports, Schedule review, and exception cleanup.
- **Tag-first and physically scannable**: physical labels, QR values, item-family unit numbers, and Wiscard identity matter more than database abstractions.
- **Accountability-native**: every mutation is auditable; custody is never ambiguous; status is derived from allocations and lifecycle state.
- **Athletics-specific**: the product should feel built around games, locations, call times, crews, batteries, camera bodies, hand scanners, and staffed counters.

---

## 2. What It Is Explicitly Not Trying To Be

- A generic inventory, ERP, procurement, or finance lifecycle platform.
- A chart-first analytics product.
- A web-only replacement for a native app.
- A native-only app that hides staff/admin control behind phone workflows.
- A campus-wide or multi-department asset management system. Scope is Wisconsin Athletics Creative.
- A Cheqroom clone. Borrow useful primitives, but do not recreate Cheqroom's generic model.
- An unattended self-service security system. Kiosk V1 assumes a physically trusted, staffed counter plus device authentication.
- A place for speculative "maybe later" surfaces that create product gravity without an operator habit.

---

## 3. Primary Operating Modes

### Mode 1: Students and Student Staff
- **Context:** Native iOS, usually on phones, often between venues or during event prep.
- **Primary jobs:** See personal gear work, create reservations, scan/look up items, work assigned shifts, request/open work, manage availability, and respond to due or overdue gear.
- **What they need:** Action-first views, one-tap scan lookup, role-adaptive actions, clear pickup/return guidance, and no admin clutter.
- **Success metric:** A student can find the next gear or shift action within two taps and never has to guess whether app/web or kiosk owns the next custody step.

### Mode 2: Gear Counter Kiosk
- **Context:** Native iPad kiosk at a staffed equipment counter or carried by staff on the floor.
- **Primary jobs:** Identify the student, create immediate checkout custody, fulfill due reservations, scan exact serialized assets and numbered battery units, return gear, and edit active checkout contents when the counter catches reality changing.
- **What it needs:** Fast HID scanner capture, camera and typed recovery, Wiscard selection, location-scoped device auth, tolerant API decoding, visible recovery states, and no reliance on individual student passwords.
- **Success metric:** The counter can complete checkout, pickup, return, or item correction without leaving kiosk mode and without breaking the custody audit trail.

### Mode 3: Staff Operators
- **Context:** Web control room plus native iOS when mobile.
- **Primary jobs:** Create and manage reservations, supervise active checkouts, schedule crews, link gear to events and assignments, manage item families, resolve exceptions, and keep operational queues clean.
- **What they need:** Global mutation access where policy allows, clear handoff ownership, reliable list/detail freshness, strong search, meaningful warnings, and routes from Schedule to gear prep.
- **Success metric:** Staff can diagnose the state of an event, crew, reservation, checkout, or item family from the appropriate surface without cross-checking side documents.

### Mode 4: Admins and System Owners
- **Context:** Desktop-first web, lower frequency, high impact.
- **Primary jobs:** Configure users, roles, kiosk devices, locations, calendar sources, venue mappings, notification policy, imports, reporting, audit review, and data-quality cleanup.
- **What they need:** Full access, clear system health, bounded operations, audit evidence, and safe controls for fixing bad data.
- **Success metric:** An admin can investigate and resolve an incident from Gear Tracker's own audit trail, route history, and source-of-truth docs.

---

## 4. Highest-Frequency Workflows

1. **Reserve gear for upcoming work** - App/web/iOS creation with event context, conflict checks, item-family quantity intent, and pickup guidance.
2. **Pick up or check out gear at kiosk** - Student identity, event or purpose context, scan evidence, availability preflight, transactional custody creation, and exact numbered-unit binding.
3. **Return gear at kiosk** - Serialized and numbered-unit scans, partial return support, location evidence, audit trail, and automatic completion when everything is back.
4. **Run the Schedule source of truth** - Staff review staffing, conflicts, open work, publication, time off, call times, gear readiness, and data-quality queues.
5. **View and recover due, overdue, or stale work** - Dashboard/list queues, stale reservations, pending pickups, active checkouts, notifications, and admin repair paths.
6. **Look up item status and history** - Scan or search by tag, QR, serial, item-family unit label, or product identity and see current custody context quickly.
7. **Operate item families and batteries** - Battery Ops, unit labels, missing-unit reporting, low-stock warnings, and checked-out unit context.
8. **Import, onboard, and clean data** - Cheqroom import, invite-first onboarding, category/department cleanup, venue mapping, and source payload preservation.

---

## 5. What "Great" Looks Like

### Reservation Creation
- Event context is easy to select and can link multiple related events.
- Users choose serialized gear and item-family quantities in one equipment flow.
- Conflict, needed-next, shortage, and turnaround warnings are visible before submit, while server checks remain authoritative.
- The end state says "reserved for pickup" instead of pretending custody already changed.

### Kiosk Checkout, Pickup, and Return
- The kiosk identifies the student by Wiscard or global active-visible roster selection.
- Checkout requires an event or clear purpose, then scans exact items before custody opens.
- Reservation pickup fulfills the source reservation into linked checkout custody through `sourceReservationId`.
- Numbered battery units are scanned as physical units, not abstract quantities.
- Recovery paths use the same scan APIs: HID scanner, camera, and typed code are inputs to one custody contract.

### Schedule and Gear Readiness
- Schedule rows and event detail separate event time, call time, pickup location, venue, crew class, and gear state.
- Staff can see open work, conflicts, candidate warnings, auto-fill previews, publish readiness, and gear gaps without silent automation changing worker commitments.
- Students can see their shifts, open Student slots, trade work, and relevant gear prep without staff-only clutter.

### Item and Battery Operations
- Items remain tag-first and derived-status driven.
- Item families appear in normal item discovery, while Battery Ops and stockroom detail own operational unit controls.
- Battery labels, checked-out context, missing-unit reports, and low-stock warnings reflect real allocations and known orphan data safely.

### Exception Recovery
- System failures degrade visibly and narrowly.
- Read-heavy dashboards and kiosk screens tolerate partial failures when possible.
- Active checkout edits, activation-code reset, stale pending-pickup cleanup, and category/venue/data-quality queues give staff practical recovery paths.
- Audit evidence exists for every mutation that changes accountability.

---

## 6. Product Principles

These govern every feature decision and tradeoff. A proposal that conflicts with principles 1, 2, 3, 7, or 8 requires an explicit decision record.

1. **Derived status is the law.** Asset availability is computed from allocations, booking lifecycle, unit status, and active custody context. No authoritative stored asset status shortcut.
2. **Custody has one normal boundary.** App/web reserve; kiosk opens, edits, and closes physical custody. Any exception needs a decision record and audit strategy.
3. **Integrity before velocity.** SERIALIZABLE transactions, overlap prevention, permission checks, and audit writes are non-negotiable on mutation paths.
4. **Event context is the default.** Athletics work is driven by events, crews, call times, venues, pickup locations, and gear prep. Ad hoc flows are fallbacks.
5. **Tag-first, scan-first identity.** Physical labels, item tags, QR values, numbered unit labels, and Wiscard identifiers must work in the hands of real operators.
6. **Native iOS is real product surface.** Do not treat iOS as a mirror of web or as optional polish when the workflow is mobile, scanner, kiosk, push, or field centered.
7. **Web is the control room.** Do not force admin, import, reporting, settings, or broad cleanup workflows into mobile just because iOS exists.
8. **Role-adaptive surfaces protect attention.** Students get their work and allowed actions. Staff/admin get global controls. Scheduling class and permission role are separate concepts when the workflow needs that distinction.
9. **Operational speed beats feature breadth.** A faster, safer handoff beats another dashboard widget.
10. **Fail gracefully and explain recovery.** Missing event data, source sync issues, scanner problems, partial API failures, and stale local state should produce bounded recovery paths.
11. **Docs are part of shipped reality.** Area docs, decisions, gaps, task ledgers, and verification notes must move with the code.

---

## 7. Decision Filters

Use these questions before adding or changing a feature:

| Question | If yes | If no |
|---|---|---|
| Does it preserve kiosk-only custody? | Proceed to workflow design | Stop and write a decision record |
| Does it make reservation, pickup, checkout, return, or Schedule work faster or safer? | Prioritize | Scrutinize |
| Does it risk derived status or allocation truth? | Architecture review required | Proceed normally |
| Is the workflow naturally native iOS, web control-room, or kiosk? | Build on that surface | Re-route before implementation |
| Does it work for the correct role without cluttering students? | Validate against `AREA_MOBILE.md` and `AREA_USERS.md` | Redesign |
| Does it add reporting before the operator habit is stable? | Defer or make it read-only | Proceed |
| Does it require a new role, worker class, lifecycle state, or custody path? | Add or update a Decision record first | Proceed |
| Is there a relevant area doc, brief, or plan? | Implement against it | Write or update it first |

---

## 8. Tradeoffs We Will Make

- **More explicit handoff steps for more trust.** Reservation, pickup, checkout, and return are distinct because custody matters.
- **Native iOS where hardware and field context require it.** Scanning, push, kiosk, and student field workflows justify native work.
- **Read-path complexity for correct derived truth.** Derived status and allocation-aware read models are worth the complexity.
- **Staff review over silent automation.** Schedule suggestions, auto-fill, and cleanup should route to review surfaces unless a decision explicitly allows mutation.
- **Focused recovery tools over generic admin powers.** Build the repair path operators actually need, then audit it.
- **Operational reporting over broad analytics.** Reports should explain current risk, missing units, utilization, and exceptions before trend exploration.

## Tradeoffs We Will Not Make

- Direct app/web custody shortcuts for convenience.
- Stored-status shortcuts that can drift from allocations.
- Mutation paths without audit evidence.
- Role or scheduling-class ambiguity for dense crew and permission workflows.
- Generic inventory features that ignore athletics events, crews, staffed counters, batteries, or physical labels.
- Browser-only proof for native/kiosk bugs, or build-only proof for user-facing web routes.

---

## 9. Current Roadmap

### Shipped Baseline
| Area | Current reality |
|---|---|
| Booking model | Unified Booking model for reservations and checkouts, with display labels and action policy separated from raw DB enums |
| Reservations | App/web/iOS are reservation-first; kiosk pickup fulfills reservations into linked checkout custody |
| Checkouts | Direct custody creation, pickup, return, and active checkout item edits are kiosk-owned |
| Kiosk | Native iOS kiosk is canonical; web kiosk was removed; `WisconsinKiosk` supports dedicated iPadOS 17 hardware |
| Mobile | Native iOS owns student action queues, camera and hand-scanner lookup, reservation creation, Schedule, Settings, and kiosk surfaces; web remains text-first for lookup |
| Schedule | Schedule is a source-of-truth area with worker class, call-time, publication, Open Work, time off, automation review, data quality, and gear readiness |
| Items | Tag-first item detail/list workflows, image support, favorites, maintenance, and derived status are established |
| Item families | BulkSku families are first-class item rows; Battery Ops owns numbered-unit operations, labels, warnings, and missing-unit reporting |
| Imports and cleanup | Cheqroom import preserves source payload; category, department, venue, and source-quality cleanup are explicit operator workflows |
| Notifications and reports | In-app/email notifications, morning refresh, bounded reports, and current operational reports are established |
| Security and reliability | CSRF, rate limits, role checks, audit logging, serializable mutations, source-contract tests, and docs/codemap verification are normal gates |

### Active / Near-Term Focus
1. **Freshness and sync for operational booking surfaces.** Dashboard, list, and detail views must not disagree after mutations or cached reloads.
2. **Kiosk consolidation after velocity.** Keep the `WisconsinKiosk` target split, but reduce oversized native/API files and move route-heavy mutation logic into focused services.
3. **Authenticated browser proof for web routes.** Builds and tests are necessary, but route-level UX work needs authenticated smoke proof when credentials are available.
4. **iOS verification discipline.** Native changes require drift checks, source-contract coverage, simulator or generic builds, and physical-device proof when the bug is hardware-specific.
5. **Data-quality and source-of-truth maintenance.** Venue mappings, category gaps, stale rows, orphaned unit flags, and schedule source issues should stay visible and repairable.
6. **Small, independently mergeable slices.** Continue schema/API/UI/test/docs/hardening slices instead of mixed mega-PRs.

### Intentionally Deferred
| Feature | Why deferred |
|---|---|
| Reservation and checkout templates | Useful only after repeated operator patterns are stable enough to encode |
| Advanced analytics | Current operational trust, freshness, and exception reporting matter more |
| Multi-source event ingestion beyond current UW sources | Add only when a concrete source and owner exist |
| Database-configurable equipment guidance rules | Current code-defined rules are sufficient until operators need frequent rule edits |
| Unattended kiosk security, PIN, or NFC | Staffed-counter trust model is accepted for V1 |
| Full staff-mobile parity for every destructive admin action | Web remains the safer control room for broad admin work |

---

## 10. Risks / Drift to Avoid

| Risk | Early signal | Defense |
|---|---|---|
| Custody boundary erosion | App/web grows "quick checkout", "return", or "scan session" actions | Enforce D-040, route users to reservation or kiosk |
| Native kiosk drift | Web logic changes but kiosk API/iOS models are not checked | Verify kiosk contracts, iOS decoding, and target builds |
| Status drift | Any feature treats stored item status as authoritative | Block on D-001 and derived read model review |
| Schedule overload | Automation or template features mutate assignments without review | Keep review-first automation unless a decision says otherwise |
| Mobile as a mirror | iOS copies desktop density or hides primary field actions | Validate against `AREA_MOBILE.md` and native interaction patterns |
| Web as an afterthought | Admin/control workflows move to iOS before web source-of-truth is strong | Keep web as control room |
| Analytics creep | Chart requests arrive before operational queues are trustworthy | Limit to operational reports or defer |
| Generic inventory thinking | Feature would fit any business but ignores events, crew, labels, or handoff | Reframe around Wisconsin Athletics Creative workflow |
| Recovery bypasses policy | Typed/manual repair skips the same API and audit path | Make recovery another input to the canonical route |
| Plan/doc drift | Code ships without area doc, gap, decision, or task ledger updates | Stop at verification until docs are synced |

---

## 11. Current Planning Gaps

Open or intentionally deferred items that should shape future planning:

1. **Booking freshness and cache invalidation** - active planning is underway for operational booking surfaces that can disagree after mutations or persisted cache reuse.
2. **Kiosk consolidation debt** - deferred until resumed, but the next kiosk work should shrink oversized native/API ownership files and pin service behavior.
3. **Templates** - still unplanned. Do not implement until real repeated booking patterns are confirmed.
4. **Advanced analytics** - still lower priority than trust, freshness, exception handling, and operational reporting.
5. **Guidance rule configurability** - code-defined rules remain acceptable; database-configurable guidance is deferred.
6. **Durable authenticated browser harness** - useful cross-cutting test infrastructure, especially for web route proof, but not a blocker for every source-contract slice.
7. **Staff-mobile parity** - expected gaps remain for some destructive or broad admin actions; keep those web-owned unless a mobile operator need is concrete.

---

## 12. Recommended Next Planning Docs

1. **Booking freshness and operational cache sync**
   - Define the minimal truth cursor, invalidation contract, and route proof for dashboard, bookings list, and booking detail.

2. **Kiosk consolidation plan**
   - Preserve the native iOS 17 `WisconsinKiosk` target while extracting oversized views and moving kiosk checkout mutation logic into focused services.

3. **Templates brief**
   - Only write this after reviewing actual repeated reservation/checkout patterns from operators. Scope should be narrow and reservation-first.

---

## Feature Improvement Suggestions

These are candidates for future planning cycles, not permission to start broad work:

1. **Booking freshness and route proof** - make operational booking state changes visible without manual refresh across dashboard, list, and detail surfaces.
2. **Kiosk service extraction** - move active checkout edit logic out of route handlers and add service-level tests for add/remove/update paths.
3. **Battery Ops data repair tools** - turn read-only orphan/stale unit warnings into narrow audited repair flows if operators need them.
4. **Booking templates** - save common event plus equipment patterns only after the repeated patterns are proven.
5. **Drone/support guidance** - add targeted equipment guidance rules only when they reflect real checkout mistakes.
6. **Operational reports before analytics** - improve reports that answer current risk, missing units, utilization, and follow-up before adding broad dashboards.

---
