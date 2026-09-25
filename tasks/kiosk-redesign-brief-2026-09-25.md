# Kiosk redesign brief

Owner: next implementation session. Status: approved design, ready to build. Created 2026-09-25 with Erik.

## Source of truth

The design canvas **Kiosk Redesign**: https://claude.ai/artifact/85Mem1ezt3oxdw5zmumibx

- Read it with the Artifact tool: `action: "read"`, `url` above, `path: "project/canvas.json"` for the layout and titles, then each `project/<Frame>.dc.html` for a frame's full markup.
- The frame IDs in the board titles (A1–J4) are the spec. Row notes on the canvas carry the rules for each journey.
- Frames are 1180×820 pt, landscape, matching the managed iPad Air 11-inch (M2) kiosks on iPadOS 26.5.

## Journeys (canvas rows)

| Row | Journey | Frames |
| --- | --- | --- |
| A | Home | nothing out, typical afternoon, game day, offline, nudge, returning someone's gear |
| B | Starting from a scan | free gear (who's taking it), reserved gear (holder's pickup) |
| C | Hubs | nothing out, gear out + pickup, can't check out (limit), unfinished checkout, staff actions |
| D | New checkout | tap name → hub → details → other date → scan → items → blocked scan → receipt → receipt with badge |
| E | Kits | choose a kit, scan against a kit, check out with kit items missing (asks first) |
| F | Pickup | pickup, item not on reservation, reserved item taken (substitute), shared travel case, receipt |
| G | Return | returning, returning someone else's gear, damaged or missing chooser, damaged, missing, receipt |
| H | Changes | extend, transfer, transfer accept, swap a unit, change a reservation |
| I | Confirmations and interruptions | discard scans, finish return with gear out, scanner asleep, still here, checkout not confirmed (offline), keyboard tip |
| J | This iPad | setup, standby, phone messages, sound and motion |

## Settled decisions

- **Flow:** home → hub → task screen → receipt. New checkout is hub → details (what it's for, when it's back) → scan → receipt. Details come first so every scan is checked against the right return time.
- **Task screen layout:** header (task name, then person and context; time and Back on the right); context card on top with Edit where it applies; scan area on the left; list on the right; one white primary button ("Check out · 3 items", "Pick up · 3 of 5", "Finish return", "Save changes").
- **Type:** SF Pro only. Nothing below 14 pt. Home clock is large with seconds, a white colon, and lighter seconds.
- **Color:** green = taking out, amber = coming back, blue = picking up, violet = shared custody, red = real problems only (blocked, overdue, missing). Selected choices are always a white outline; green never means "selected".
- **Home:** status is hidden while healthy; only real problems (offline) show in the clock band. A sleeping scanner is normal, not an error. Home list is sectioned cards (overdue, due today, pickups, out later); game day groups by event with pickups first and a "Crew without gear" line. Today tiles show people with a pickup, a return due, or a shift whose call is within 2 hours and who has no gear yet. Everyone grid: 4 columns up to 24 people, then 5 columns without photos.
- **Copy:** never "counter", "gear room", "GearOps", "Wiscard", or "Call staff". Due times read "Due today at 6:00 PM"; "Back by" only while choosing.
- **Football:** kits and football events are suggested only to football crew.
- **Kits:** not on the details screen. A kit turns the "Taking out" list into its checklist; only what's scanned goes out.
- **Finishing with planned items unscanned** (kit items, pickup leftovers, return items still out) asks first.
- **Damaged and missing:** one quiet link on the return screen opens its own page; damaged = describe + take a photo; missing = mark it and notify staff. Damaged items still count as returned but are held for staff.
- **Swap:** plain swap is the default; "Something's wrong with it" is the other choice.
- **Batteries:** reservations ask for a count ("2 × Sony battery", "numbers are assigned when you scan them at pickup"); once out, each unit shows its number, filled when scanned and outlined while still to scan.
- **Undo** on every scan confirmation.
- **Keyboard tip:** inline under the focused field when a scanner is paired; never a centered popup.
- **Sound and motion:** as in frame J4. The fleet has no haptics; every sound has a visible twin; Reduce Motion becomes 150 ms fades.
- **Standby:** dim grey clock on black, drifts a few px every 30 s, dims the screen overnight.
- **Staff:** no separate mode; staff actions appear inline on bookings when a staff member identifies.

## Open decisions (build around them; ask Erik, do not invent the rule)

1. Where kits start: scan screen for football crew only (recommended), the hub, or web only.
2. Direct peer transfers with the new holder accepting (H3–H4). Today only staff can move gear between people.
3. Who can nudge an overdue booking: anyone once per booking per day (drawn), or staff only.

## Constraints

- Branch from `origin/claude/kiosk-multi-lens` (PR #403, stacked on #402). The custody, API, and native fixes this redesign depends on are there, not on `main`. Do not merge #402 or #403 without Erik.
- PR #403's Vercel preview fails because the preview database's migration history does not match the repo. That is an infrastructure change; ask before touching it.
- Follow `AGENTS.md`: `gt-ios-slice` workflow; new Swift files via `xcodegen generate` with the regenerated `project.pbxproj`; `WisconsinKiosk` build and tests on the iPad Air 11-inch (M4) iOS 26.5 simulator; affected source-contract tests; a `gt-ui-review` before/after for every visible slice using `scripts/kiosk-capture-scenarios.sh` and new `GT_KIOSK_SCENARIO` fixtures per frame.
- Physical proof happens in the managed-iPad session next week; simulator captures prove presentation only.

## Ledger

- [ ] Phase 0: map every frame to its current view and `/api/kiosk/*` endpoint; list gaps. Already backed: counted-stock return, pickup off-plan add and substitute, pending handoff, checkout limit, extend (PATCH), staged battery replace. Likely new server work: nudge, peer transfer with accept, damaged/missing reports with photo, possibly plain swap. Rule-changing server work waits for the open decisions.
- [ ] Tokens and shared components (type scale, colors, task-screen scaffold, list rows, battery row, confirmation stage with Undo, sheets)
- [ ] Home (A) and standby/setup (J1–J2)
- [ ] Hubs (C)
- [ ] New checkout (D, I1, I5, I6)
- [ ] Pickup (F)
- [ ] Return (G, I2)
- [ ] Changes (H)
- [ ] Interruptions (I3, I4) and sound/motion (J4)
- [ ] Kits (E) once the entry point is decided
- [ ] Docs: `AREA_KIOSK.md`, gaps, codemaps
