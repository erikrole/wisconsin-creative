# Audit: item detail (iOS) — 2026-05-08

## 2026-10-17 — Condition reports

Staff and admin item detail now shows the website's five most recent condition reports (`checkinReports` on `GET /api/assets/:id`). Damage is orange, a missing item is red, a photo opens full screen, and the row opens the checkout. Reserve stays the primary action. Clearing maintenance stays in the toolbar menu. A malformed report row is skipped so the item still loads. Students and collaborators do not see the section. Source contract: `tests/ios-item-condition-reports.test.ts`. An Xcode build on a Mac and an authenticated iPhone walkthrough remain open.

**MVP verdict (pre-fix):** ships, but the floor-relevant CTA — "Reserve this gear" — is missing. The list has it (swipe action + context menu); detail doesn't. Plus a few polish gaps inherited from this morning's pattern (edit save haptic, QR copy feedback, favorite haptic on load).
**Ship bar:** student-friendly, fully functional for core flows, zero hiccups in front of a class.
**Audit type:** static source (no build/run/UI tests).

Scope: `ItemDetailView` + `EditAssetSheet` + the per-card sub-views (`ItemHeroCard`, `ItemDetailsCard`, `ActiveBookingCard`, `UpcomingReservationsCard`, `ParentLinkCard`, `AccessoriesCard`, `NotesCard`) in `ios/Wisconsin/Views/ItemDetailView.swift`. Multiple recent slices (#16-18: parent link, attachments, QR chip, procurement gate, info expansion) shipped on this surface; this is the focused follow-up audit.

**Surrounding context:** item detail is the floor's "is this available, who has it, can I reserve it?" lookup. Students scan a sticker → navigate to the detail; staff tap from the items list. The hero card answers the first two questions in one glance via the `availabilitySnapshot` helper. The gap is the third question — there's no inline path to start a reservation.

## P0 — blocks MVP

_None._ Auth/role gating is correct (`canEditAsset` is STAFF/ADMIN only; `canSeeProcurement` mirrors that gate per slice 18). Pull-to-refresh works. Toggle-favorite has correct optimistic update + revert with toast feedback. Edit sheet has discard confirm + interactiveDismissDisabled. The hero, details, active-booking, upcoming-reservations, attachments, parent-link, and notes cards all render correctly per recent slices.

## P1 — polish before ship

- [x] [Gaps] **No "Reserve" CTA on the detail page itself.** The items list has a swipe action AND a context menu Reserve button (per the prior bookings audit's P1 #2 fix); from the *detail* page the same intent requires backing out, returning to the list, swiping the row, and going through the prefill flow. Floor users who scan a sticker → land on detail → decide to reserve are stranded.
      `ios/Wisconsin/Views/ItemDetailView.swift:43-66` — no Reserve button, no `CreateBookingSheet` presenter.
      Why it matters: parity with web (the detail page has a Reserve button), parity with the items list (swipe action), and the canonical floor flow (scan → see → reserve). This is the single biggest "feels like a complete page" win on this surface.
      Suggested fix: full-width `Button` styled with `.glass` below the hero card, label "Reserve Equipment" / icon `calendar.badge.plus`, tinted with `Color.statusText(.purple)` to match the reservation-tone semantics shipped across the app today. Tap opens `CreateBookingSheet` with `prefillReservation(for:)` already wired (the items-list flow). On save, push the new booking onto the navigation path via `BookingRouteId`. New `AssetDetail.asAsset` helper bridges the type gap (the prefill API takes `Asset`, not `AssetDetail`).

- [x] [Flows] **Edit save success silently dismisses.** Same gap pattern as the booking-detail pass shipped earlier today: no haptic = "did the save land?" doubt on slow network. The save also doesn't show a "Saving…" spinner inline.
      `ios/Wisconsin/Views/ItemDetailView.swift:231-246` (`EditAssetSheet.save`) and `:211-215` (Save toolbar item).
      Suggested fix: `Haptics.success()` immediately before `dismiss()`; `Haptics.warning()` in the catch. Save toolbar item swaps to inline `ProgressView` while saving (matching the booking-detail edit fix shipped today).

- [x] [UI polish] **QR copy gives a haptic but no visible "copied" feedback.** Today the QR pill triggers `UIPasteboard.general.string = qr` + `Haptics.tap()` and that's it. A toast confirms the operation visually.
      `ios/Wisconsin/Views/ItemDetailView.swift:313-335`.
      Why it matters: floor user copying the QR for kiosk re-link or a Slack message wants confirmation that the clipboard actually has it. Current haptic happens before the system clipboard write commits visually; a toast closes the loop.
      Suggested fix: existing `toast` state is already wired; reuse: `toast = Toast(message: "Copied \(qr)", icon: "checkmark.circle.fill", role: .success)` (or whatever the existing Toast role enum supports). Keep the haptic.

- [x] [UI polish] **Favorite haptic fires on initial load.** `sensoryFeedback(.selection, trigger: isFavorited)` triggers whenever `isFavorited` changes — including the moment `loadAsset` flips it from `false` to the loaded value. A user opening a favorited item's detail hears/feels the selection haptic for no reason.
      `ios/Wisconsin/Views/ItemDetailView.swift:81`.
      Suggested fix: track a separate `favoriteToggleCount: Int` that only increments when the user taps. Trigger sensory feedback on that counter instead of `isFavorited` directly. Initial load doesn't tick the counter.

- [x] [A11y] **Active-booking, upcoming-reservation, attachments, and parent-link rows aren't combined accessibility elements.** VoiceOver walks each piece (title, requester name, due date, chevron) when a single combined "Active reservation: {title}, {requester}, due {date}" announcement is friendlier.
      `ios/Wisconsin/Views/ItemDetailView.swift:480-595, 600-704`.
      Suggested fix: `.accessibilityElement(children: .combine)` on each tappable row (the inner content of each `NavigationLink`); `.accessibilityHidden(true)` on decorative chevrons + status icons; explicit per-card label that puts the most important fact first ("Overdue: ..." / "Active reservation: ..." / "Attachment: tag {tag}, {name}").

- [x] [A11y] **Active-booking due-date label exposes the icon name** ("clock, Due ..." or "exclamation triangle fill, Due ...").
      `ios/Wisconsin/Views/ItemDetailView.swift:508-513`.
      Suggested fix: explicit `.accessibilityLabel(booking.isOverdue ? "Overdue. Due \(formatted)" : "Due \(formatted)")` on that Label.

## P2 — post-MVP

- [ ] [Polish] **Deferred.** "Mark damaged" / "Mark lost" affordances for STAFF on the detail page. Web has them. Per `feedback_ios_vs_web_role.md` the day-to-day floor case for these is real (staff seeing damage on a checkout return), but the canonical path on iOS is via the kiosk return flow which already covers the lost-unit case. Floor staff reporting damage outside the kiosk scope is rare; defer until requested.
- [ ] [Polish] **Deferred.** "Copy asset tag" affordance on the detail page (the items list has it via context menu). The hero already shows the tag prominently; long-press text actions cover most copy needs. Skip.
- [ ] [Polish] **Deferred.** "View all bookings for this item" history view. Power-user; stays on web by `feedback_ios_vs_web_role.md`.
- [ ] [Polish] **Deferred.** Sharing affordance ("share this item to Slack") — not a documented floor need.
- [ ] [Polish] **Deferred.** Reserve button hidden on `.retired` status. Conceptually you can't reserve retired gear, but the server enforces it and showing the button + letting the server return a clear error is acceptable. If user feedback flags confusion, gate visually.

## Acceptance criteria status

Per `AREA_ITEMS.md` and the prior items audit:

- [x] AC: hero shows asset tag, brand/model, status, QR.
- [x] AC: details card shows location, category, department, serial, UW asset tag, procurement (gated).
- [x] AC: active booking surface with one-tap into the booking detail.
- [x] AC: upcoming reservations visible.
- [x] AC: attachments + parent link (slice 17).
- [x] AC: notes card.
- [x] AC: edit gated by STAFF/ADMIN.
- [x] AC: favorite toggle with optimistic update + revert.
- [x] AC: pull-to-refresh.
- [x] AC: Reserve CTA inline on detail — **closed by P1 fix.**
- [x] AC: edit save reports tactile confirmation — **closed by P1 haptic fix.**
- [x] AC: QR copy reports visual confirmation — **closed by P1 toast fix.**
- [x] AC: VoiceOver users hear card rows as single elements — **closed by P1 a11y fixes.**

## 2026-07-03 Runtime Recheck

- [x] Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_4c06d113-c53c-4962-b37b-903a41398c84.jpg`
- [x] Standalone category values such as `Accessories` may still display in the details card because they are backend taxonomy. The parent-child bundle card and VoiceOver label use current product language: `Attachments`.

## Lenses checked
- [x] Gaps
- [x] Flows
- [x] UI polish
- [x] Hardening
- [x] Parity (web has the Reserve CTA — closed by P1; reports stay on web by project rule)
- [x] Accessibility
