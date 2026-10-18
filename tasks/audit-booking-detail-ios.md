# Audit: booking detail (iOS) — 2026-05-08

**MVP verdict (pre-fix):** ships, but the action panel (Extend / Cancel) is visible to anyone viewing the booking — including students who aren't the requester — and tints drift from the `StatusTone` token system established across the rest of the app today.
**Ship bar:** student-friendly, fully functional for core flows, zero hiccups in front of a class.
**Audit type:** static source (no build/run/UI tests).

Scope: `BookingDetailView` + the `EditBookingSheet` declared in the same file at `ios/Wisconsin/Views/BookingDetailView.swift`. Excludes `ExtendBookingSheet` (separate file, covered by the prior bookings audit and by a recent quick-extend chips slice).

## 2026-07-17 Item Detail alignment

- [x] Follow-up polish uses comma-separated countdowns such as `Due in 2 days, 13 hours`.
- [x] Pickup and return use neutral horizontal arrows; urgency color remains owned by the status rail and live timing.
- [x] The persistent Extend action remains above the native tab bar but uses the quieter bordered system style on material chrome.

- [x] Booking identity appears once as status rail, holder photo, title, requester name, and live natural-language timing; the routine status badge and internal reference are removed.
- [x] Eligible Extend is persistent above the native tab bar; Cancel remains a secondary contextual action at the end of the scroll.
- [x] The toolbar is the only Edit entry point; the duplicated in-card Edit Details button is removed.
- [x] Schedule gives Pickup Time, Return Time, and Pickup Kiosk standard-sized rows. Dates prefer Today, Tomorrow, Yesterday, or a near-term weekday before abbreviated month/day, omit the redundant year, and do not repeat the header countdown. Pickup Location is removed, and requester photo/email are not repeated.
- [x] Gear is a clean read-only list without routine Out, Reserved, or Pending pills. Fully returned rows use a green tint, checkmark, dimmed identity, and explicit accessibility copy.
- [x] Serialized equipment reads asset tag first and product name second, with brand/model only as a rollout fallback.
- [x] Upcoming demand still explains why extension is unavailable; pre-pickup bookings use an honest kiosk fallback until the handoff is recorded.
- [x] Role gates, optimistic locking, conflict checks, pull-to-refresh, and kiosk-owned custody are unchanged.
- [x] The full native source-contract suite, TypeScript check, and generic iOS Simulator build pass.
- [x] Authenticated runtime proof passes on iPhone 17 Pro: the compact identity header, lighter three-row Schedule card, clean product-name gear list, and material-backed bottom Extend control render without tab-bar overlap.

## 2026-07-17 focused mobile editor

- [x] Edit Booking now changes only the booking name and return time; pickup remains visible as fixed context.
- [x] Return changes debounce a complete serialized-and-bulk availability preflight, surface success or conflict state inline, and keep the optimistic-locked update route as final authority.
- [x] Transfer Ownership is inline, uses the active form-options roster, preserves `If-Unmodified-Since`, and closes the stale editor after a successful transfer.
- [x] Gear, pickup location, notes, custody, and physical return controls are absent from the phone editor.
- [x] Authenticated iPhone 17 Pro runtime inspection confirms the compact identity, two editable controls, inline transfer row, and transfer sheet hierarchy.

**Surrounding context:** booking detail is the primary floor surface for "what is the current state of my reservation/checkout, and what can I do about it?" Multiple recent slices have shipped on this screen (live countdown TimelineView, monospaced ref/email, status pill alignment, overdue banner, requester display rule, accessory/parent-item linkage on detail). The 2026-04-24 broad bookings audit covered architectural gaps; this pass is a focused follow-up on the per-screen polish since.

## P0 — blocks MVP

_None._ Auth/role gating is enforced server-side. The Edit pencil is gated client-side. Pull-to-refresh works. Loading skeleton and error recovery remain. Header timing updates on a 30-second `TimelineView`; overdue state is communicated by the red rail and explicit overdue timing copy without a duplicate banner.

## P1 — polish before ship

- [x] [Hardening] **`ActionsSection` (Extend / Cancel) is visible to every viewer, regardless of ownership.** Today a STUDENT who isn't the requester can land on someone else's booking detail (deep nav from Items tab → "out to {Person}" → that booking) and see "Extend Return Date" + "Cancel Booking" buttons. The server rejects the request, but the UI advertises an action they can't actually take, and a "Cancel Booking" tap on someone else's gear feels alarming even when it 401s.
      `ios/Wisconsin/Views/BookingDetailView.swift:51-58, 450-501`.
      Why it matters: parity with the toolbar Edit pencil shipped in the prior audit (`canEditBooking` gates STAFF/ADMIN OR requester). Actions panel never got the same treatment.
      Suggested fix: introduce a `canActOnBooking` computed property — STAFF/ADMIN always, OR the booking's requester. Gate `ActionsSection` on it. Note: this is intentionally *more permissive* than `canEditBooking` because Extend is a legitimate self-help action even after the booking transitions to OPEN (a student wanting "I need it longer" mid-shoot).

- [x] [UI polish] **Action button tints use raw `.blue` and `.red` instead of `Color.statusText(_:)`.** Drifts from the cross-app `StatusTone` token system established across all kiosk surfaces and the scan/profile passes shipped today.
      `ios/Wisconsin/Views/BookingDetailView.swift:466, 496`.
      Suggested fix: `.tint(Color.statusText(.blue))` for Extend; `.tint(Color.statusText(.red))` for Cancel. Same physical color in most cases but a single source of truth.

- [x] [Flows] **Haptics gap on `EditBookingSheet` save.** `cancelBooking` haptics on success/failure (`.success/.warning`); `EditBookingSheet.save` is silent. A user who edits the date and taps Save sees the sheet dismiss but gets no tactile confirmation that the save landed (especially relevant on a network-slow round-trip).
      `ios/Wisconsin/Views/BookingDetailView.swift:226-242`.
      Suggested fix: `Haptics.success()` immediately before `dismiss()` on the success path; `Haptics.warning()` (or `.error()`) in the catch.

- [x] [A11y] **Action buttons announce icon names: "clock arrow circle path, Extend Return Date" and "x mark circle, Cancel Booking".** SwiftUI's `Label(text, systemImage:)` exposes both pieces by default; VoiceOver reads the icon name out loud, which is meaningless to a blind user.
      `ios/Wisconsin/Views/BookingDetailView.swift:461-462, 489`.
      Suggested fix: explicit `.accessibilityLabel("Extend Return Date")` / `"Cancel Booking"` on each button so VO reads only the action name.

- [x] [A11y] **Overdue banner exposes "exclamation triangle fill, Overdue — return gear at a kiosk."** Same `Label`-as-decorative-icon issue.
      `ios/Wisconsin/Views/BookingDetailView.swift:288-295`.
      Suggested fix: `.accessibilityLabel("Overdue. Return gear at a kiosk.")` so the icon name doesn't intrude.

- [x] [A11y] **Location and Date `Label`s read icon names too** (`mappin.circle, Location Name`; `calendar, From X to Y`).
      `ios/Wisconsin/Views/BookingDetailView.swift:301, 304-313`.
      Suggested fix: `.accessibilityLabel("Location: \(location.name)")` on the location; `.accessibilityLabel("From \(formatted)... to \(formatted)...")` on the date label, treating the icon as decorative.

- [x] [A11y] **Footer hints "Pick up gear at a kiosk" / "Return gear at a kiosk" expose `barcode.viewfinder` icon names.**
      `ios/Wisconsin/Views/BookingDetailView.swift:470-480`.
      Suggested fix: same explicit label treatment.

- [x] [UI polish] **`EditBookingSheet` Save button works but doesn't communicate "saving" state visually.** Today the button just disables; no spinner. Compare to the Cancel-Booking button below which renders a `ProgressView` while in flight.
      `ios/Wisconsin/Views/BookingDetailView.swift:206-210`.
      Suggested fix: render a small inline `ProgressView` next to "Save" when `isSaving`; same shape as the Cancel button's pattern at `:485-488`.

- [x] [UI polish] **`canEditBooking` excludes STUDENTs once status flips to PENDING_PICKUP or OPEN — but the toolbar pencil silently disappears with no "you can no longer edit" affordance.** The student tapping Edit, walking away, then coming back sees the pencil gone. They might not know why.
      `ios/Wisconsin/Views/BookingDetailView.swift:15-22, 73-82`.
      Why it matters: minor; the underlying behavior is correct, but a tooltip/explainer in the form of a Label helps.
      Decision: **Skip.** Adding a "Edit locked: pickup in progress" pill at the header would clutter the screen for the much-more-common already-staff path. Leave the silent-disappear behavior — the prior audit's `canEditBooking` matrix is documented in `AREA_BOOKINGS.md`.

## P2 — post-MVP

- [ ] [Polish] **Deferred.** Extend button visibility for `.booked` state — Extend conceptually overlaps with Edit's date adjustment. A student with a BOOKED reservation tapping "Extend Return Date" might be confused because the booking hasn't started yet. Not actually broken (Extend works fine for booked); UX could be cleaner if Extend were OPEN-only and BOOKED state directed users to Edit. Not blocking ship.
- [ ] [Polish] **Deferred.** Inline action-failure error placement — currently lands below `ActionsSection` (acceptable given the user just clicked an action button right above), but a transient toast next to the button might feel more responsive. Current pattern is consistent with the rest of the app.
- [ ] [Polish] **Deferred.** "View on web" link for a fuller history view (audit log, scan events). Web has a sidebar; iOS intentionally doesn't (project rule: power-user info stays on web). Logged for completeness, not action.
- [ ] [Hardening] **Deferred.** Optimistic cancel — today the cancel API call awaits before reloading. On a slow network the user sees a 1–2 s lag. Optimistic UI would feel faster but adds rollback complexity for a destructive action. Skip.

## 2026-10-16 reservation edit and checkout actions

- [x] Reservations open `ReservationEditFlow` from the detail pencil and the bookings list. Checkouts still open the narrow `EditBookingSheet` (name and due back only).
- [x] One Save commits changed plan fields, then linked events. Gear and events are navigation destinations, not extra save buttons. A failed availability check turns that button into Check availability and blocks the write.
- [x] Pickup choices stay on Camp Randall and Kohl Center. Picked-up serialized lines cannot be removed. Bulk quantity cannot drop below what is already out.
- [x] Checkout detail keeps Extend as the only bottom action and Cancel in the scroll. Extra server-allowed actions live in one toolbar menu: nudge, close without scan, force checkout, close remaining, transfer, shared or personal custody, linked events, and re-reserve.
- [x] Active checkout equipment is not editable on the phone.
- [ ] iPhone 18 Pro Max build, fixture capture, and authenticated device proof remain open. This pass is source and contract only.

## Acceptance criteria status

Per `AREA_BOOKINGS.md` (and the prior 2026-04-24 audit):

- [x] AC: detail surfaces title, live status timing, requester, gear, dates, location, kiosk, and notes; the internal reference is intentionally omitted.
- [x] AC: live natural-language timing for OPEN, BOOKED, and PENDING_PICKUP states.
- [x] AC: overdue state remains explicit through the status rail and overdue timing copy.
- [x] AC: Edit pencil gated by role + status.
- [x] AC: Cancel only for `.booked` (terminal-state immutability).
- [x] AC: Pull-to-refresh.
- [x] AC: Action buttons gated by ownership/role — **closed by P1 ownership fix.**
- [x] AC: Save reports tactile confirmation — **closed by P1 haptic fix.**
- [x] AC: VoiceOver users hear action names without icon noise — **closed by P1 a11y fixes.**

## Lenses checked
- [x] Gaps
- [x] Flows
- [x] UI polish
- [x] Hardening
- [x] Parity (web has more — audit log sidebar, recharts overdue chart, CSV — those stay on web by `feedback_ios_vs_web_role.md`)
- [x] Accessibility
