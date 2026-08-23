# Shift Trade Actions from iOS (Event Detail + Schedule)

Goal: post shifts to the Trade Board from where people actually see shifts
(event-detail crew rows, My Shifts), with staff able to post any student
shift, owner notifications, visible on-board indicators, and swipe/long-press
ergonomics.

## Decisions (2026-07-02, with Erik)

- Terminology is **Trade Board** everywhere in new UI ("Post to Trade Board",
  "Remove from Trade Board"). iOS Open Work sheet retitled to "Trade Board";
  web rename deferred (that surface also lists open shifts + pickups).
- Staff/admin may post any **student** assignment; never another staff
  member's. Server-enforced.
- Owner gets a notification when staff posts their shift (need, not polish).
- Trade-state indicator on crew rows = small orange `arrow.left.arrow.right`
  chip (icon, not a cell stroke).
- Premier events: effectively dead in live data (1/239 groups, 0 active
  approval trades). No premier copy in this feature; full concept removal is
  a separate queued cleanup.
- Swipe delete always confirms; no full-swipe destructive execution.

## Slices

- [x] 1 — Server: staff-posts-student-trade
  - `postTrade` accepts actor role; staff/admin may post student-class
    assignments they don't own; audit gains postedFor context
  - Owner notification ("Your Video shift for {event} was posted to the
    Trade Board") through existing notification policy plumbing
  - Vitest coverage (own-shift unchanged, staff-post-student allowed,
    staff-post-staff 403, student-post-others 403, owner notified)
- [x] 2 — Server: per-assignment trade state in the shift-group payload
  (`activeTrade { id, status }`), so clients can render indicators and
  offer Remove from Trade Board
- [x] 3 — iOS: crew row context menu gains Post to Trade Board / Remove from
  Trade Board (role-gated), preselected PostTradeSheet variant, trade chip
  indicator on rows, Open Work sheet retitled Trade Board (+ contract tests)
- [~] 4 — iOS: swipe-to-post shipped 2026-08-22 on the Schedule list, where a
  person actually sees their own shifts: a trailing swipe on a row whose event
  carries your own future active shift opens the preselected `PostTradeSheet`.
  Full swipe is disabled, matching the decision below.

  **Not done, and deliberately:** converting the event-detail crew section to a
  `List` for swipe actions. This slice was written 2026-07-02; the 2026-08-16
  Event detail rebuild then made that screen `ScrollView { LazyVStack }` to match
  `BookingDetailView`/`ItemDetailView`/`UserDetailView`, naming that house pattern
  as the reason successive local spacing fixes had never made the screen cohere.
  A `List` there would either nest a scroller inside the ScrollView or abandon the
  pattern, and the same rebuild already gathered post/remove/delete into grouped
  context-menu sections ordered by likelihood. Reopen only as a deliberate
  revisit of the 2026-08-16 layout decision, not as leftover plan work.
- [ ] Follow-up (queued separately): remove premier concept end-to-end

## Verification

- Slices 1-2: vitest + `npm run build` before commit
- Slices 3-4: xcodebuild simulator build + full vitest (source contracts)
- 12 known pre-existing test failures excluded (tracked separately)
