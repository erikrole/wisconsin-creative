# Competitor Research & Feature Roadmap

> **Date:** 2026-03-16
> **Purpose:** Evaluate competitor features against Wisconsin Athletics Creative's operational needs and recommend a prioritized feature roadmap for Wisconsin Creative.

## Context

Wisconsin Creative replaces Cheqroom for a game-day media production team managing cameras, lenses, audio gear, and accessories across Camp Randall Stadium and Kohl Center (~15-30 users). Every feature below is filtered through the product's North Star principles: operational speed over feature breadth, mobile-first, event-driven, simplicity, and derived status integrity.

**Why they left Cheqroom:** (1) No athletics-specific event integration, (2) mobile UX not optimized for student operators, (3) too much generic enterprise clutter, (4) no control over platform direction. The goal is NOT to replicate Cheqroom — it's to build a sharper, faster tool for this exact workflow.

## Competitors Analyzed

| Competitor | Focus | Key Differentiator |
|---|---|---|
| Cheqroom | Equipment operations (media, broadcast, education) | RFID, maintenance/CMMS, predictive availability, digital signatures |
| EZOfficeInventory | Cloud asset tracking (education, enterprise) | Low stock alerts, compliance, custom reports, cart-based checkout |
| Asset Panda | Lifecycle asset management (enterprise) | Depreciation, warranty, AI autofill, multi-tenant |
| GoCodes | QR/GPS asset tracking (construction, trades) | GPS capture on scan, Bluetooth beacons, branded QR tags |
| Snipe-IT | Open-source IT asset management | EULA/signature acceptance, LDAP, license management |

---

## TIER 1: "Do Next" — High Impact, Reasonable Effort

### 1. Condition / Damage Reporting on Check-In

**What:** When scanning items back in, students can flag "damaged" with a short note and optional photo. Flagged items auto-queue for maintenance review. Staff see a "needs attention" list on the dashboard or item detail page.

**Why it matters:** A Canon R5 body costs $3,900; a 70-200mm f/2.8 lens costs $2,800. Students handling gear at Camp Randall in November need a fast way to report drops, scratches, or lens issues at the moment of return — not via email that gets forgotten. The current system has no mechanism to capture condition at the custody handoff boundary.

**Competitor inspiration:** Cheqroom (damage reporting, maintenance histories), industry standard (condition tracking with photo evidence).

**Effort:** S-M | **Impact:** 5/5

**Implementation notes:** Add "Flag Issue" button in scan confirmation UI. New `ConditionReport` model or `conditionNote` + `conditionPhotoUrl` fields on `BookingSerializedItem`. Photo upload via Vercel Blob. Dashboard badge for items needing attention.

---

### 2. Low Stock Alerts for Consumables

**What:** When a `BulkSku` balance drops below its `minThreshold`, generate an in-app notification to admins. Surface a "Low Stock" badge on the dashboard or items list.

**Why it matters:** Batteries, SD cards, and gaffer tape run out unpredictably. Discovering you're out of LP-E6NH batteries 30 minutes before a football game is a real operational failure. The `minThreshold` field already exists on `BulkSku` but nothing reads it.

**Competitor inspiration:** EZOfficeInventory (auto-alert when below threshold).

**Effort:** S | **Impact:** 4/5

**Implementation notes:** Service-layer check on `BulkStockMovement` creation that fires a notification when `onHandQuantity` drops below `minThreshold`. Dashboard badge is a simple query.

---

### 3. Warranty & Purchase Date Visibility

**What:** Expose the existing `purchasePrice`, `warrantyDate`, and `purchaseDate` fields in the item detail Settings tab for admin users. Add a report or dashboard filter for "warranty expiring within 30/60/90 days." Surface a badge on item detail when warranty is expired or expiring soon.

**Why it matters:** University procurement cycles are annual. Knowing which camera bodies are approaching end-of-warranty helps plan capital requests during budget season. This data already exists in the schema from the Cheqroom import — it's just invisible in the UI.

**Competitor inspiration:** Asset Panda (full lifecycle tracking, warranty/insurance), Snipe-IT (warranty tracking).

**Effort:** S | **Impact:** 3/5

**Implementation notes:** Fields exist in the Prisma schema (D-018 accepted for Phase B). UI is an admin-only tab on item detail plus a filtered report view.

---

### 4. Game-Day Ops Board (Coordinator View)

**What:** A single-screen view showing all active checkouts for a specific event or date, grouped by sport/location, with real-time status (checked out, partially returned, overdue). Built for a coordinator sitting in the equipment room or production office during game day, monitoring all student crews simultaneously.

**Why it matters:** On a football Saturday, the creative team may have 5-8 students shooting across Camp Randall with different gear packages. The coordinator needs at-a-glance visibility: who has what, what's still out, what's overdue. **This is the single most athletics-specific feature possible.** No generic inventory tool builds for "Saturday at Camp Randall."

**Competitor inspiration:** Cheqroom (custom dashboards with KPIs), general ops board patterns.

**Effort:** M | **Impact:** 5/5

**Implementation notes:** Read-only view built on existing booking/allocation queries, filtered by event or date range. Purpose-built layout (full-screen/kiosk-friendly) with auto-refresh. No new data models needed.

**Phase C alignment:** Direct match to planned "Board / ops view for game-day coordinators." Confirmed as highest-priority Phase C item.

---

## TIER 2: "Strong Candidates" — High Impact, More Effort

### 5. Digital Signature / Acknowledgment on Checkout

**What:** When a student checks out gear, they tap a confirmation that records their acknowledgment of custody responsibility. Timestamped record: "User X acknowledged custody of items Y, Z at time T." First checkout for new students could include terms-of-use acceptance.

**Why it matters:** If a $4,000 lens goes missing, the team needs a clear "I accept responsibility" record. The current system records custody via bookings but has no explicit acknowledgment moment. Important for university risk management.

**Competitor inspiration:** Cheqroom (digital signatures on checkout), Snipe-IT (EULA/digital signature acceptance).

**Effort:** M | **Impact:** 4/5

**Implementation notes:** `custodyAcknowledgedAt` timestamp on `BookingSerializedItem` or new `CustodyAcknowledgment` model. UI is a confirmation step in checkout scan flow. No third-party signature service needed — tap-to-confirm with timestamp is sufficient for internal university operations.

---

### 6. Maintenance Scheduling & Status Tracking

**What:** Items placed in a "Maintenance" state with reason, expected return date, and work notes. Staff see a maintenance queue. Items in maintenance excluded from availability. Optionally, recurring maintenance (e.g., "sensor cleaning every 6 months").

**Why it matters:** Camera sensors need cleaning, lens calibration drifts, gimbals need firmware updates. The `MAINTENANCE` status already exists in `AssetStatus` enum but has no workflow built around it. Pairs naturally with condition/damage reporting (#1).

**Competitor inspiration:** Cheqroom (work orders, repair scheduling, proactive maintenance alerts, CMMS).

**Effort:** M-L | **Impact:** 4/5

**Implementation notes:** New maintenance log model (reason, startDate, expectedEndDate, completedDate, notes). "Send to Maintenance" action on item detail. Queue view. Availability derivation already excludes `MAINTENANCE` status. Recurring scheduling can be deferred.

---

### 7. Checkout Templates (Sport-Specific Gear Loadouts)

**What:** Staff save named templates like "Football Sideline Kit" that pre-select standard equipment (2x FX3 bodies, 2x 70-200mm lenses, 4x batteries, 2x SD cards, 1x audio recorder). Selecting a template pre-populates the picker, substituting available units if needed.

**Why it matters:** Game-day gear packages are highly repetitive by sport. Manually selecting 8-12 items every game day is wasted time. A football Saturday with 5 checkouts could save 15+ minutes of picker time.

**Competitor inspiration:** Cheqroom (intelligent resource orchestration), EZOfficeInventory (cart-based checkout).

**Effort:** M | **Impact:** 4/5

**Phase C alignment:** Direct match to planned "Reservation and checkout templates."

---

### 8. GPS Location Capture on Scan

**What:** Capture GPS coordinates via browser Geolocation API during QR scan, store with scan event. Display "last scanned at [Camp Randall, Section B]" on item detail or ops board.

**Why it matters:** Helps locate missing equipment. If a lens hasn't been returned and last scan was at the LaBahn Arena loading dock, that narrows the search. Value increases for away games and multi-venue days.

**Competitor inspiration:** GoCodes (GPS location tracking via QR scan).

**Effort:** S-M | **Impact:** 3/5

**Implementation notes:** `ScanEvent.deviceContext` field already exists as String. Store GPS as JSON. No new models needed.

---

### 9. Kiosk Mode (Self-Serve Scan Station)

**What:** Full-screen mode on an iPad/tablet in the equipment room. Students walk up, identify via scan/code, scan gear out. No app navigation, no login — the kiosk is always authenticated as a station.

**Why it matters:** Pre-game checkout bottleneck — multiple students grab gear within a 30-minute window. A kiosk makes checkout as fast as library self-checkout.

**Competitor inspiration:** Cheqroom (kiosk capability).

**Effort:** L | **Impact:** 4/5

**Phase C alignment:** Direct match to planned "Kiosk mode." Confirmed high value but correctly deferred due to effort.

---

### 10. Photo Documentation on Items

**What:** Staff attach multiple photos to item records (condition, label placement, rig configuration). Combined with damage reporting (#1), creates visual history.

**Why it matters:** Camera rigs are often custom-configured (body + cage + handle + monitor mount). A photo of the "correct" configuration helps students assemble and return gear properly. Also useful for insurance/damage comparison.

**Competitor inspiration:** Asset Panda (visual documentation), industry trend.

**Effort:** M | **Impact:** 3/5

**Implementation notes:** Requires Vercel Blob storage, image upload component, photos relation on Asset. The `imageUrl` field exists on Asset but is singular and currently unused.

---

## TIER 3: "Watch List" — Lower Priority or Needs Validation

| # | Feature | Effort | Impact | Why Watch |
|---|---------|--------|--------|-----------|
| 11 | Slack/Teams Integration | S-M | 2/5 | Team may use iMessage/GroupMe, not Slack. Validate need first. |
| 12 | Depreciation Tracking | M | 2/5 | University finance handles centrally. Outside product scope per North Star. |
| 13 | RFID Bulk Scanning | L | 3/5 | Hardware dependency. QR workflow is functional. Revisit if volume grows. |
| 14 | Predictive Availability | L | 2→4/5 | Needs 1+ season of data. Compelling after full academic year of checkouts. |
| 15 | License/Firmware Mgmt | M | 2/5 | Different operational domain. Firmware version could just be a field on Asset. |
| 16 | Custom Branded QR Tags | S-M | 2/5 | Existing labels deployed. Nice-to-have for new gear only. |
| 17 | Multi-Source Events | M | 3/5 | Matches Phase C plan. Practice schedules generate gear needs not on game calendar. |

---

## What NOT to Build (and Why)

The following competitor features were evaluated and explicitly rejected:

- **RFID scanning** — Hardware dependency, existing QR workflow functional, team too small to justify
- **Depreciation tracking** — University finance handles centrally; violates "not a procurement/finance platform" principle
- **AI-powered config** (Asset Panda) — Team too small; configuration complexity exceeds value
- **ATA Carnet generation** (Cheqroom) — International gear travel is rare/nonexistent for this team
- **Spaces management** (Cheqroom) — Two locations already modeled; room-level tracking is overkill
- **Generic automation builder** (Asset Panda/Cheqroom) — Escalation rules handle the key need; workflow builder adds enterprise complexity without athletics-specific value
- **Multi-tenant/enterprise** (Asset Panda) — Single team, single department; explicitly outside scope per North Star

---

## Summary Matrix

| # | Feature | Tier | Effort | Impact | Phase C? |
|---|---------|------|--------|--------|----------|
| 1 | Condition/Damage Reporting | Do Next | S-M | 5/5 | No |
| 2 | Low Stock Alerts | Do Next | S | 4/5 | No |
| 3 | Warranty/Purchase Visibility | Do Next | S | 3/5 | Phase B (D-018) |
| 4 | Game-Day Ops Board | Do Next | M | 5/5 | Phase C (Board) |
| 5 | Digital Signature/Acknowledgment | Strong | M | 4/5 | No |
| 6 | Maintenance Scheduling | Strong | M-L | 4/5 | No |
| 7 | Checkout Templates | Strong | M | 4/5 | Phase C (Templates) |
| 8 | GPS Location on Scan | Strong | S-M | 3/5 | No |
| 9 | Kiosk Mode | Strong | L | 4/5 | Phase C (Kiosk) |
| 10 | Photo Documentation | Strong | M | 3/5 | No |
| 11 | Slack/Teams Integration | Watch | S-M | 2/5 | No |
| 12 | Depreciation Tracking | Watch | M | 2/5 | No (out of scope) |
| 13 | RFID Bulk Scanning | Watch | L | 3/5 | No (hardware) |
| 14 | Predictive Availability | Watch | L | 2→4/5 | Phase C (Analytics) |
| 15 | License/Firmware Mgmt | Watch | M | 2/5 | No (out of scope) |
| 16 | Custom Branded QR Tags | Watch | S-M | 2/5 | No |
| 17 | Multi-Source Events | Watch | M | 3/5 | Phase C (Events) |

---

## Recommended Build Sequence (Post Phase B)

1. **Condition/Damage Reporting (#1) + Low Stock Alerts (#2)** — Small, protect expensive gear, ship together
2. **Warranty/Purchase Visibility (#3)** — Already accepted as D-018, trivial to build
3. **Game-Day Ops Board (#4)** — Highest-impact athletics-specific feature; defines product differentiation
4. **Checkout Templates (#7)** — Highest-impact workflow accelerator for primary use case
5. **Digital Signature (#5) + Maintenance Scheduling (#6)** — Full "responsible gear lifecycle" story

**Features 1-4 collectively answer "why not just use Cheqroom?":** Because Wisconsin Creative knows what game day looks like, protects your gear at the physical handoff boundary, and gives coordinators a purpose-built command center that no generic tool provides.

---

## Key Schema Extension Points

For implementers, the following existing models/fields are the primary extension points:

- `BulkSku.minThreshold` — Already exists, unused. Low stock alerts read this.
- `AssetStatus.MAINTENANCE` — Already in enum, no workflow. Maintenance feature activates it.
- `Asset.purchasePrice`, `Asset.warrantyDate`, `Asset.purchaseDate` — Exist from Cheqroom import, not exposed in UI.
- `Asset.imageUrl` — Exists but singular. Photo documentation needs multi-photo model.
- `ScanEvent.deviceContext` — Exists as String. GPS data stores here as JSON.
- `BookingSerializedItem` — Custody record. Damage reporting and digital signatures extend this model.
