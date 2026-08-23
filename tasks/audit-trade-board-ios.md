# Audit: trade board (iOS) — 2026-05-08

**MVP verdict (pre-fix):** ships, but `TradeStatusChip` uses raw `.green/.orange/.secondary/.gray` instead of the cross-app `StatusTone` system, the claim haptic bypasses the centralized `Haptics` enum, the action-error alert is OK-only with no Retry, and `TradeRow` isn't a combined VoiceOver element.
**Ship bar:** student-friendly, fully functional for core flows, zero hiccups in front of a class.
**Audit type:** static source (no build/run/UI tests).

Scope: `TradeBoardSheet` + `TradeBoardViewModel` + `TradeRow` + `TradeStatusChip` in `ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift`. Reachable from `HomeView` (notifications-tap → trades) and from `ScheduleView` toolbar.

**Surrounding context:** STUDENT shift-trading surface — students browse open trades posted by other students + claim them. Two sections: "Open Trades" (others' posts) and "My Active Posts" (own posts, swipe-to-cancel). STAFF trade-approve surfaces are different (live in `EventDetailSheet`'s assignment row mini-buttons, audited today).

## P0 — blocks MVP

_None._ Pull-to-refresh works. Auth handled. Claim + Cancel both have confirmation dialogs. Local list mutates correctly post-API-call. Error state has Retry on initial load failure. The trade post sheet is correctly presented and the `onTradePosted` / `onTradeClaimed` callbacks bubble through to the host (HomeView posts a toast).

## P1 — polish before ship

- [x] [Hardening] **Native cancel now uses the real server contract and returned state.** `APIClient.cancelShiftTrade` had drifted to `POST` plus unchecked raw `session.data`, while the shipped route is `PATCH /api/shift-trades/[id]/cancel` and returns `{ data: trade }`. That could make the native board remove a post locally even when the server rejected the mutation. The client now calls `PATCH`, decodes `DataWrapper<ShiftTrade>` through `perform`, and `TradeBoardViewModel.cancel` updates the row from the returned `CANCELLED` status.
      `ios/Wisconsin/Core/APIClient.swift`; `ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift`; `src/app/api/shift-trades/[id]/cancel/route.ts`

- [x] [Hardening] **Direct `UINotificationFeedbackGenerator()` call bypasses the centralized `Haptics` enum.** Same drift fixed on the link sticker wizard earlier today. The claim-success path fires a raw success haptic; cancel + post don't fire any.
      `ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift:111`.
      Suggested fix: replace the raw `UINotificationFeedbackGenerator()` call with `Haptics.success()`. Also fire `Haptics.success()` on cancel-success and `Haptics.warning()` in the error catches so the trade-management flow has a complete haptic chain.

- [x] [UI polish] **`TradeStatusChip.statusColor` returns raw `.green/.orange/.secondary/.gray`.** Drifts from the `StatusTone` token system established across all kiosk + booking-detail surfaces today.
      `ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift:283-291`.
      Suggested fix: route through `Color.statusText(_:)` and `Color.statusBackground(_:)` for the foreground + background pair. `.open` → `.green`, `.claimed` → `.orange`, `.completed` → `.gray`, `.cancelled / .expired / .unknown` → `.gray`. Mirror the kiosk + booking pass.

- [x] [Flows] **Action-error alert is OK-only.** Failed claim or cancel surfaced in an alert with just OK; user had to dismiss + re-tap. Same shape of fix shipped on create-booking today.
      `ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift:143-147`.
      Fixed 2026-06-05: Trade Board now shows an in-sheet error banner with Refresh and Dismiss instead of a generic alert. This preserves the list context and avoids ambiguous auto-retry state for claim versus cancel.

- [x] [A11y] **`TradeRow` not combined.** VoiceOver walks each piece (area, event summary, status pill, time row with clock icon, person row with person icon, notes, claim button) — seven announcements per row. Combined into a single "Trade: VIDEO at Football vs Western Illinois, Friday Sep 11, 9:00–13:00, posted by Erik Mason, status Open" announcement matches today's row patterns.
      `ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift:205-269`.
      Suggested fix: `.accessibilityElement(children: .combine)` on the outer VStack + an explicit row label that surfaces the most important fact first; decorative `clock` and `person` icons get `.accessibilityHidden(true)`; the Claim button stays as a separate accessibility element so VO can act on it (`.accessibilityElement(children: .contain)` would consume the button — `.combine` keeps interactive children separately addressable).

- [x] [A11y] **Swipe-action `Label("Cancel Trade", systemImage: "xmark")` exposes the icon name** ("x mark, Cancel Trade"). Same family of fix shipped today.
      `ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift:189-193`.
      Suggested fix: `.accessibilityLabel("Cancel trade")` on the swipe button.

- [x] [Flows] **No haptic on cancel-trade success.** Claim has one (post-fix); cancel doesn't.
      `ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift:131-138`.
      Suggested fix: `Haptics.success()` after the cancel awaits — symmetrical with claim.

## P2 — post-MVP

- [x] [Polish] **Shipped 2026-08-22.** Pagination — a Load more control pages past the 30-row cap using the `offset` the route already accepted, de-duplicating by id so a row resolved between pages cannot appear twice. Taken off deferral because the staff review queue added a second class of row competing for the same 30.
- [x] [Polish] **Shipped 2026-08-22.** Filter by area — a toolbar area menu matching the web board's six areas, applied to both the trade list and Open Work so the two halves of the board never disagree about scope.
- [ ] [Polish] **Deferred.** Time-to-claim countdown for expiring trades — web doesn't have it either. Not blocking ship.
- [ ] [Polish] **Deferred.** Per-trade share affordance (post to Slack / messages). Off-platform path; not a documented floor need.

## Acceptance criteria status

Per `AREA_SHIFTS.md`:

- [x] AC: students can browse open trades posted by others.
- [x] AC: students can claim a trade with confirmation.
- [x] AC: students can cancel their own posts via swipe.
- [x] AC: status chip distinguishes open / claimed / completed / cancelled / expired.
- [x] AC: pull-to-refresh.
- [x] AC: trade post sheet from `+` toolbar.
- [x] AC: status chip uses cross-app token discipline — **closed by P1 fix.**
- [x] AC: claim haptic via centralized `Haptics` enum — **closed by P1 fix.**
- [x] AC: VoiceOver users hear each row as a combined element — **closed by P1 a11y fixes.**
- [x] AC: cancel mutation uses the current server route and only updates local state after a decoded server response — **closed by HIG/iOS 27 readiness slice 8.**
- [x] AC: claim/cancel failures stay recoverable in context instead of using a generic OK-only alert — **closed by HIG/iOS 27 readiness slice 9.**

## Lenses checked
- [x] Gaps
- [x] Flows
- [x] UI polish
- [x] Hardening
- [x] Parity (web trade board exists; iOS aligned)
- [x] Accessibility
