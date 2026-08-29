# Bookings 1.0 — Gap Evaluation & Hardening Plan

**Status:** Evaluation phase  
**Goal:** Identify gaps between current implementation and Cheqroom parity; harden UX for 1.0 release  
**Scope:** Checkout/reservation core flows, check-in/return workflows, admin controls, kiosk implementation  
**Timeline:** 1.0 release target  

---

## 1. Core Flows — Create, Edit, Extend, Convert, Cancel

### Current State (V1 Shipped)
- ✅ Create checkout/reservation with event tie-in (30-day window)
- ✅ Equipment picker (sectioned, multi-select, availability preview)
- ✅ Edit inline fields (title, notes, dates)
- ✅ Extend with conflict checking
- ✅ Convert reservation to checkout
- ✅ Cancel with audit trail
- ✅ Unified BookingDetailPage for both kinds

### UX Gaps to Evaluate

**1.1 Create Flow Friction — Gaps Identified**

- [x] **Equipment picker mobile UX** — Needs overall polish. Action: Audit mobile responsive layout, touch targets, section navigation
- [x] **Guidance hints** — Replace suggestion ("don't forget batteries") with hard requirement. Action: If camera body selected, make batteries required; hide suggestion message entirely
- [x] **Bulk item quantity entry** — Dual approach needed:
  - Items WITH QR code (numbered Sony batteries): Students scan QR codes one by one
  - Items WITHOUT QR code (sand bags, light stands): Use quantity stepper
  - Action: Update equipment picker to distinguish and handle both paths
- [x] **Mobile date/time input** — Use native shadcn `select` component on mobile for familiar OS feel
  - Action: Replace datetime picker with dropdown selects (date + time) on mobile breakpoint
- [x] **Location selection** — REQUIRED field
  - Action: Remove optional state; always show location picker before equipment selection
- [x] **Save terminology** — Change from BOOKED vs. OPEN to clearer CTA:
  - "Pick Up Now" (OPEN) — handoff immediately
  - "Convert to Check Out" (BOOKED) — reserve for later handoff
  - Action: Rename buttons, update copy
- [x] **DRAFT recovery** — Surface on dashboard AND sticky card at bottom of screen
  - Action: Add recent drafts to sticky footer card with "Resume" quick action

**1.2 Edit Flow Friction — Gaps Identified**

- [x] **Inline edit feedback** — Spinner → checkmark → auto-clear working smoothly. ✅ No action needed
- [x] **Permission gates** — Fields that user can't edit should be grayed out/disabled
  - Action: Add visual disabled state to non-editable fields (e.g., student viewing staff-only location field)
- [x] **Date conflict re-validation** — Must check automatically when dates change
  - Action: On date input blur or change, trigger availability check; show conflict badge if conflict detected
- [x] **Bulk quantity edit** — Add "Edit Items" or "Add More" button to easily adjust quantities
  - Action: On equipment tab, add button to open picker modal and adjust bulk quantities or add new items without killing the flow
- [x] **Equipment removal** — Ensure confirmation modal before removing items

**1.3 Extend Flow Friction — Gaps Identified**

- [x] **Conflict messaging** — Must surface specific details:
  - Item name (e.g., "Canon C70")
  - Conflicting booking title (e.g., "UW vs Michigan")
  - Conflicting user (who has it)
  - Conflict date range
  - Action: Update error modal to include all 4 fields; make it scannable (not paragraph text)
- [x] **Retry UX after conflict resolves** — Staff should be able to easily re-trigger extend
  - Action: Add "Retry Extend" button to booking detail after initial extend failure; keep conflict details visible for context

**1.4 Convert (Reservation → Checkout) — Gaps Identified**

- [x] **"Convert to Check Out" CTA** — Primary action button (same size as others, but visually primary)
  - Action: Move to primary position in action bar; use primary button styling
- [x] **State transition feedback** — Show success toast after BOOKED → OPEN conversion
  - Action: Toast message: "✓ Reservation converted to active checkout"
  - Also update booking detail to show new state immediately

**1.5 Cancel Flow — Gaps Identified**

- [x] **Reversible cancel** — Staff can undo within 5-minute window
  - Action: Add undo button to cancel confirmation toast; after 5 min, make permanent
  - Update booking status to show "CANCELLED (undo available)" during grace period
- [x] **Cancel confirmation copy** — Message should explain consequence:
  - "This will return all equipment to available inventory and unblock other bookings."
  - Action: Update cancel modal confirmation message

---

## 2. Check-In / Return Workflows

### Current State
- ✅ Partial check-in (multi-item bookings)
- ✅ Scan QR to identify booking
- ✅ Manual item selection for return
- ✅ Auto-transition to COMPLETED when all items back
- ✅ Item-level audit trail

### Complexity vs. Cheqroom
Cheqroom is simpler: scan item → confirm → close. Wisconsin Creative requires:
- Bulk item quantity handling (how many of X are back?)
- Numbered item verification (scan Unit #5 specifically)
- Loss marking (item didn't come back)
- Partial returns (5 of 10 back, extend the rest)

### Return Workflow Gaps to Evaluate

**2.1 Untracked Bulk (Sand bags, light stands) — Gaps Identified**

- [x] **Quantity entry on return** — Use stepper (not text input), default to checkout quantity
  - Action: Show "Expected: 5 sand bags" with stepper defaulting to 5
- [x] **Loss auto-count** — Returning 4 of 5 auto-marks 1 as lost (no separate button)
  - Action: On submit, if returned < expected, auto-calculate loss and create AuditLog entry
- [x] **Audit trail** — Log format: "4 returned, 1 lost"
  - Action: AuditLog entry shows returned vs. lost breakdown

**2.2 Numbered Items (Sony batteries) — Gaps Identified**

- [x] **Checklist** — Show all units upfront (Unit #1, #3, #5) before scanning
  - Action: Pre-populate checklist on modal load; show [☐] Unit #1, [☐] Unit #3, [☐] Unit #5
- [x] **Unit not found** — If scan fails, immediately show "Mark as lost?" option (no skip)
  - Action: On failed scan, don't wait for timeout; offer modal: [Mark as Lost] [Try Again]
- [x] **Successful scans** — Check mark unit, no toast (scan page UI handles feedback)
  - Action: Silently check [✓] Unit #1; update UI state without toast

**2.3 Serialized Assets (Single cameras) — Gaps Identified**

- [x] **Scan required** — Not optional; must scan to return
  - Action: Disable submit button until scan detected
- [x] **Damaged QR fallback** — Mark as Damaged (staff can type reason or unreadable QR note)
  - Action: Add "Mark as Damaged" button; opens input field for notes
- [x] **Photo capture** — Not required; scan is the gate
  - Action: Remove photo requirement from return flow

**2.4 Return Modal/Sheet UX — Gaps Identified**

- [x] **Modal header** — Use "Check In" (consistent with operational language)
  - Action: Title: "Check In Equipment"
- [x] **Item visibility** — Show all expected items upfront
  - Checked items grayed out / checkmarked
  - Action: Pre-populate full checklist; gray out scanned items as they're marked

**2.5 Post-Return State — Gaps Identified**

- [x] **Summary page after check-in** — Show before closing modal
  - Action: After final item scanned, show summary: "4 returned, 1 lost, 0 damaged"
  - Include button to view updated booking status
- [x] **Final confirmation** — Require explicit confirmation to close
  - Action: Summary page has [Close] button to finalize return and close modal
  - Booking auto-updates to COMPLETED after confirmation

---

## 3. Admin / Staff Controls

### Current State
- ✅ Permission gating (RBAC)
- ✅ Override reason capture
- ✅ Audit logging

### Control Gaps to Evaluate

**3.1 Override Workflows — Gaps Identified**

- [x] **Admin force-complete** — Only ADMIN role can force-complete a checkout without all items
  - Action: Add "Force Complete" button (admin-only) on booking detail
- [x] **Override reason** — REQUIRED field when force-completing
  - Action: Modal with reason dropdown or text input (required)
- [x] **Hard override** — No soft/warn path; force-complete is a hard action
  - Action: Direct force-complete without warning/confirmation (reason capture is the gate)

**3.2 Bulk Item Management — Gaps Identified**

- [x] **Quantity adjustment** — Staff can change planned quantities after booking creation
  - Action: Add "Edit Items" button on equipment tab to re-open picker and adjust quantities
- [x] **Location reallocation** — Staff can move items between locations mid-booking
  - Action: On equipment tab or separate modal, allow location change per item
- [x] **Damage marking** — Staff can mark items as damaged during return
  - Action: In return/check-in flow, "Mark as Damaged" button (opens notes field)

**3.3 Booking Visibility — Gaps Identified**

- [x] **Visibility** — Staff see ALL bookings (current behavior)
  - Action: No change; maintain global visibility
- [x] **Search/filter** — Current implementation adequate
  - Action: No change; keep existing search/filter
- [x] **Overdue/due-soon** — Current surfacing adequate
  - Action: No change; keep current highlighting/dashboard prominence

**3.4 Cancellation & Archival — Gaps Identified**

- [x] **Cancellation permissions** — STAFF can cancel any booking; STUDENT can cancel only their own
  - Action: Add role-based gate on cancel button
- [x] **Auto-free items** — Cancellation automatically frees all items (no confirmation needed)
  - Action: Cancel immediately frees allocations; no extra confirmation step
- [x] **Visibility** — Canceled bookings hidden by default, visible via toggle/dropdown
  - Action: Add "Show archived/canceled" toggle to booking list; off by default

**3.5 Escalation & Notifications — Gaps Identified**

- [x] **Multi-tier escalation** — Overdue triggers escalation at 2h, 6h, 12h, 24h
  - Action: Update escalation rule scheduling; cron job checks at each interval
- [x] **Manual nudge** — Staff can manually trigger a nudge notification to student
  - Action: Add [Nudge] button on booking detail; sends immediate notification

---

## 4. Kiosk Implementation (Built Yesterday)

### Current State
- ✅ Device activation & heartbeat
- ✅ Student login/dashboard
- ✅ Equipment picker on kiosk
- ✅ Scan-based checkout
- ✅ Scan-based checkin

### Kiosk Gaps to Evaluate

**4.1 Device Management — Gaps Identified**

- [x] **Activation code** — 6-digit numeric code
  - Action: Generate 6-digit code on device creation; display once to staff
- [x] **Location assignment** — Manual (staff selects location during device setup)
  - Action: Required location field during device creation; no IP inference
- [x] **Device reset/deactivation** — Deactivate lost/stolen devices from admin panel
  - Action: Add [Deactivate] button on kiosk-devices list; prevents further use

**4.2 Student Flow on Kiosk — Gaps Identified**

- [x] **Student identification** — Avatar grid name selection (debating student ID card scan for V1)
  - Action: Primary: Scrollable avatar grid with names. Future: Student ID scan
- [x] **Guest checkout** — Not supported in V1
  - Action: No guest mode; student must select their name

**4.3 Checkout on Kiosk — Gaps Identified**

- [x] **Equipment sections** — Show sections on ad hoc booking (Cameras, Batteries, etc.)
  - Action: Equipment picker shows full sectioned UI on kiosk
- [x] **Numbered item scanning** — Scan Unit QRs BEFORE confirming checkout
  - Action: After selecting items, prompt for numbered item scans before submit

**4.4 Check-In on Kiosk — Gaps Identified**

- [x] **Booking lookup** — Two-step: Select student name, then select booking from their list
  - Action: Step 1: Avatar grid. Step 2: Booking list (title, date, equipment count). Click to open return flow
- [x] **Return flow** — Show checklist of expected items, scan each, then close (no "new checkout" option)
  - Action: After check-in summary, [Close] button only; return to login screen

**4.5 Kiosk Offline Mode — Deferred**

- [x] **Always online assumption** — Kiosks always connected to internet in V1
  - Action: Skip offline mode for V1; add to Phase 2 if needed later

**4.6 Multi-Location Kiosk — Gaps Identified**

- [x] **One kiosk per location** — Each physical kiosk locked to 1 location
  - Action: Kiosk location set at creation; can be updated by admin, but no location selector on student flow

---

## 5. Reporting & Visibility — Gaps Identified

✅ **Already solid for 1.0:**
- Dashboard with overdue + due-soon banners
- Utilization, checkout, and scan reports
- Audit trail with before/after diffs
- User activity timeline

- [x] **Overdue count real-time** — Dashboard count should update without refresh
  - Action: Verify cron job timing and client-side refresh logic
- [x] **CSV export** — Not needed for 1.0
  - Action: No change; defer to 2.0
- [x] **Mobile responsiveness** — Reports should work on mobile
  - Action: Verify layout on iPhone 12/13; adjust if needed

---

## 6. Bulk Items for 1.0 — Gaps Identified

**Scope for 1.0:** Untracked bulk only (sand bags, light stands, etc.). Numbered bulk deferred to V2.

- [x] **Items list display** — Show location breakdown on bulk items
  - Example: "Sand Bags: 10 @ Camp Randall / 3 @ Kohl Center"
  - Action: Update items list to show location breakdown for bulk SKUs
- [x] **Equipment picker integration** — Check out via same picker with quantity stepper
  - Action: Add bulk items to equipment picker; show stepper (not scanning) for quantity selection
- [x] **Checkout/return flow** — Untracked bulk should work smoothly
  - Checkout: Quantity stepper
  - Return: Stepper default to planned quantity, auto-loss if returning less
  - Action: Ensure checkout/return flows handle bulk items correctly
- [x] **Transfer function** — Deferred to V2
  - Action: No location reallocation in V1; defer to bulk-items-v2-plan.md

See `tasks/bulk-items-v2-plan.md` for full V2 roadmap (numbered items, transfers, matrix view).

---

## Acceptance Criteria for 1.0 Release

### Core Workflows
- [ ] **Create flow** — Equipment picker mobile-polished, batteries required (not suggested), pickup location required, "Pick Up" vs. "Convert to Check Out" CTAs
- [ ] **Edit flow** — Non-editable fields grayed out, date changes auto-check conflicts, "Edit Items" button allows quantity/equipment changes
- [ ] **Extend flow** — Conflict error shows Item + Blocking Booking Title + User + Date; "Retry Extend" button appears after conflict resolves
- [ ] **Convert** — "Convert to Check Out" is primary action; success toast on BOOKED → OPEN; state change visible
- [ ] **Cancel** — Reversible for 5 min (undo in toast); confirmation copy explains consequence; canceled bookings hidden by default

### Check-In / Return
- [ ] **Untracked bulk** — Stepper defaults to planned qty; returning less auto-counts as loss; audit logged
- [ ] **Numbered items** — Checklist pre-populated; successful scans auto-check; failed scans immediately offer "Mark as Lost"
- [ ] **Serialized assets** — Scan required; damaged QR fallback with notes; no photo requirement
- [ ] **Return modal** — Title "Check In Equipment"; all items shown upfront; scanned items grayed out
- [ ] **Summary page** — Shows returned/lost/damaged breakdown; final confirmation required before COMPLETED

### Admin & Staff Controls
- [ ] **Force-complete** — ADMIN-only button; requires reason (required field); hard action (no soft warn)
- [ ] **Quantity edit** — "Edit Items" button on equipment tab; can adjust planned quantities
- [ ] **Location reallocation** — Can move items between locations mid-booking
- [ ] **Damage marking** — Staff can mark items as damaged during return (notes)
- [ ] **Cancellation** — STAFF can cancel any booking; STUDENT only their own; auto-frees items
- [ ] **Escalation** — Multi-tier: 2h, 6h, 12h, 24h overdue alerts; manual nudge button available
- [ ] **Visibility** — Staff see all bookings; current filters/search adequate; overdue/due-soon highlighted

### Kiosk Implementation
- [ ] **Device setup** — 6-digit activation code; manual location assignment; admin can deactivate
- [ ] **Student flow** — Avatar grid name selection (future: student ID scan); no guest mode
- [ ] **Checkout** — Equipment picker with sections; numbered item scans BEFORE confirm
- [ ] **Check-in** — Two-step lookup (name → booking); checklist return; close button only
- [ ] **Offline** — Assume always online; defer offline mode to Phase 2
- [ ] **Location** — One kiosk per location (locked); no location selector on student flow

### Bulk Items (1.0: Untracked Only)
- [ ] **Items list** — Bulk SKUs show location breakdown (e.g., "10 @ Camp Randall / 3 @ Kohl Center")
- [ ] **Equipment picker** — Bulk items integrated; stepper for quantity selection
- [ ] **Checkout/return** — Untracked bulk flows work smoothly
- [ ] **Transfer function** — Deferred to V2

### Overall Polish
- [ ] **Mobile responsiveness** — All flows tested on iPhone 12/13
- [ ] **Error messaging** — Clear, actionable; helps users recover
- [ ] **Real-time dashboard** — Overdue count updates without refresh
- [ ] **Draft recovery** — Dashboard + sticky footer card showing recent drafts

---

## Implementation Roadmap (Concrete Tasks)

### Phase 1: Core Flow Hardening

**1.1 Create Flow**
- [ ] Equipment picker: Polish mobile UI (touch targets, scroll behavior)
- [ ] Batteries required: Implement hard requirement (checkbox disabled until batteries selected)
- [ ] Pickup location: Make required; show location picker before equipment selection
- [ ] Date input: Use native shadcn `Select` on mobile (not datetime picker)
- [ ] CTA terminology: "Pick Up Now" (OPEN) vs. "Convert to Check Out" (BOOKED)
- [ ] DRAFT recovery: Add sticky footer card showing recent drafts with "Resume" button

**1.2 Edit Flow**
- [ ] Permission gates: Add visual disabled state to non-editable fields
- [ ] Conflict re-validation: Auto-check availability when dates change (debounced)
- [ ] Edit Items button: Open equipment picker modal to adjust quantities/add items

**1.3 Extend Flow**
- [ ] Conflict error modal: Show Item + Blocking Booking + User + Date (structured, not paragraph)
- [ ] Retry Extend button: Add to booking detail after extend failure

**1.4 Convert & Cancel**
- [ ] Convert button: Primary styling; position first in action bar; show success toast
- [ ] Cancel: Reversible for 5 min (undo in toast); update message about consequence
- [ ] Cancel visibility: Add toggle to hide canceled bookings by default

---

### Phase 2: Check-In/Return Workflows

**2.1 Untracked Bulk Return**
- [ ] Stepper UI: Default to planned quantity; allow decrement
- [ ] Auto-loss: Calculate loss on submit (planned - returned)
- [ ] Audit entry: Log "X returned, Y lost"

**2.2 Numbered Items Return** (Basic support; full V2 deferred)
- [ ] Checklist: Pre-populate with all unit numbers
- [ ] Scan feedback: Auto-check unit on successful scan; gray out
- [ ] Failed scan: Immediate "Mark as Lost?" modal (no timeout)

**2.3 Serialized Assets Return**
- [ ] Scan required: Disable submit until scan detected
- [ ] Damaged QR: "Mark as Damaged" button → notes input
- [ ] Photo: Remove from required fields

**2.4 Return Modal UX**
- [ ] Title: Change to "Check In Equipment"
- [ ] Item visibility: All items shown upfront; grayed out as scanned
- [ ] Summary page: After last item, show breakdown (returned/lost/damaged)
- [ ] Final confirmation: Summary page with [Close] button to finalize

---

### Phase 3: Kiosk Implementation

**3.1 Device Management**
- [ ] 6-digit code: Generate on creation; display once
- [ ] Location assignment: Required dropdown during setup
- [ ] Deactivation: Admin [Deactivate] button on devices list

**3.2 Student Flow**
- [ ] Avatar grid: Scrollable list with names + initials
- [ ] No guest mode: Student must select themselves

**3.3 Checkout**
- [ ] Equipment picker: Show sections on kiosk UI
- [ ] Numbered item scans: After equipment selection, scan Unit QRs before submit
- [ ] Error handling: If unit unavailable, show clear message

**3.4 Check-In**
- [ ] Two-step lookup: Name → then booking list
- [ ] Return checklist: Show expected items; scan each; close button only
- [ ] No "new checkout": Return to login after completion

---

### Phase 4: Admin Controls

**4.1 Overrides & Adjustments**
- [ ] Force-complete: ADMIN-only button with required reason field
- [ ] Edit items: Allow quantity/location changes on equipment tab
- [ ] Mark as damaged: Staff can note damaged items during return

**4.2 Escalation & Notifications**
- [ ] Multi-tier escalation: 2h, 6h, 12h, 24h cron triggers
- [ ] Manual nudge: [Nudge] button on booking detail

---

### Phase 5: Bulk Items (1.0: Untracked Only)

**5.1 Items List Display**
- [ ] Location breakdown: "Sand Bags: 10 @ Camp Randall / 3 @ Kohl Center"

**5.2 Equipment Picker Integration**
- [ ] Bulk items in picker: Stepper for quantity (not scanning)
- [ ] Checkout/return: Flows handle bulk items with location awareness

---

### Phase 6: Testing & Polish

- [ ] Mobile testing: iPhone 12/13 all flows
- [ ] Error path testing: Network failures, permission denials, conflicts
- [ ] Accessibility: Keyboard navigation, screen reader
- [ ] Load testing: Concurrent kiosk checkouts
- [ ] Real-time dashboard: Verify overdue count updates

---

## Summary of Gaps (For Opus One-Shot Implementation)

**Total gaps identified: 40+**

### Critical Path (Must-Have for 1.0)
1. **Create flow polish** — Mobile UX, location required, batteries hard-required, CTA terminology
2. **Edit flow gates** — Non-editable fields grayed out, auto-conflict check, Edit Items button
3. **Return workflows** — Stepper for untracked bulk, checklist for numbered items, summary page
4. **Kiosk core** — Device setup, avatar grid login, equipment picker, return flow
5. **Admin controls** — Force-complete, escalation tiers, cancellation reversibility
6. **Bulk items (V1)** — Location breakdown display, picker integration with stepper

### Nice-to-Have for 1.0 (If time)
- Sticky draft recovery footer card
- Damaged QR fallback (can manual-mark in return)
- Multi-tier escalation (2h/6h/12h/24h) — current may only be 24h

### Deferred to V2+
- Numbered item transfers & matrix view (bulk-items-v2-plan.md)
- Student ID scan (avatar grid is primary)
- Kiosk offline mode
- CSV export

---

## Ready for Opus Implementation

This evaluation plan is ready to hand to Claude Opus for a comprehensive one-shot implementation. All gaps are concrete, all decisions are documented, and all acceptance criteria are clear.

**Next step:** Run with Opus to implement all 6 phases in a single coordinated effort.
