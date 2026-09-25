# iOS Schedule redesign — September 23, 2026

Scope: the internal iOS Schedule tab (not the collaborator Published Schedule). The user found the cards dated and asked for a blank-slate rethink with the same view for every role. After comparing three mockups (sport-forward, minimal native, timeline), the user picked **minimal native**. The user also required **one master scroll list, as today**, with the week strip acting only as a jump bar.

Contracts to preserve: API payloads, venue classification through `ScheduleEvent.venue`, date and all-day boundaries, role gates for Past events and staff actions, detail push, deep links, Post trade swipe, and tap-tab reset.

- [x] Inspect the Schedule source, fixtures, tests, and docs; capture a HEAD baseline from an isolated worktree.
- [x] Replace the List/Calendar segmented control with a week jump bar (`Views/Schedule/ScheduleWeekStrip.swift`). It expands into a month grid, follows the scroll, and has a Today button.
- [x] Replace the filter sheet:
  - My Shifts and Sport are toolbar toggles, and Trade Board shows a native `.badge` count.
  - The staff-only Past toggle is in the overflow menu.
  - Event type chips and removable filter chips are in `ScheduleQuickFilterBar.swift`.
- [x] Restyle rows to minimal native (`ScheduleEventRow.swift`):
  - A venue dot, a one-line meta, and the time on the right.
  - A rounded day group under pinned headers.
  - A blue band plus a "You" line for your own work.
  - Coverage shows for every role.
- [x] Jump lands on each day's first row with its header pinned above. `List` honours only top, center, and bottom anchors, so the list stays plain with pinned headers rather than inset grouped.
- [x] Update source-contract tests, the UI screenshot test (month-grid, Today jump, and day-jump captures, plus a dark capture), and the audit inventory.
- [x] Changelog entries in `docs/AREA_MOBILE.md` and `docs/AREA_SHIFTS.md`.
- [x] Feedback pass:
  - Plain venue dots replace the calendar glyphs.
  - The personal "You · area · gear" line, the combined-crew line, and the edge band are removed in favour of a blue-tinted row, with the call time in the time column.
  - Start times are bolder.
  - The month grid has a muted neighbouring-month bleed.
  - The strip advances at the end of the list, which closes with a footer.
- [x] Windowed scrolling:
  - Week-window loads with future prefetch and empty-week placeholders.
  - The past sits behind a held pull with a haptic threshold and folds away at rest.
  - All roles can reach the past.
  - `/api/my-shifts` takes an optional date window.
  - The fixture harness filters by window.
- [x] Follow-ups:
  - Deep links outside the window, via the `eventId` read.
  - Empty-week runs merged into one row.
  - A fixed sport list.
  - Strip edge loading.
  - A per-user disk cache.
  - `VenueDot` across Schedule surfaces.
  - The Published Schedule restyled and extracted.
  - A shared `myShiftSurface`.
- [ ] Authenticated device acceptance and TestFlight are not claimed.

Evidence: `tasks/archive/proofs/ios-schedule-redesign-2026-09-23/review.html`.
