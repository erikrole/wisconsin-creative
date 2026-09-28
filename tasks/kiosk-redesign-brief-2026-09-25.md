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

## Decisions answered by Erik (2026-09-25)

1. **Kits start on the scan screen, for football crew only.**
2. **Peer transfers are immediate.** Any holder can transfer a checkout to anyone on the roster with no accept step. H3 (accept) is dropped, and H2's "The new holder taps their name to accept" copy goes with it. This loosens today's staff-only transfer rule, so it ships as its own server slice with tests and an AREA_KIOSK rule change.
3. **Anyone can nudge an overdue booking from home, once per booking per day.** This needs a kiosk nudge route with a per-booking, per-local-day dedupe.
4. **A missing item is accounted for, matching web's LOST report.** The report closes the item so the return can finish. G5's "stays on your record until it turns up" copy changes to match.

Defaults taken without asking (reversible):

- H5 keeps "Nothing changes until you save". The client stages changes and applies them in order on Save using the existing per-operation endpoint, and reports any change that fails.
- Canvas data with no source (class d): B1's "Where: Shelf B2" is dropped. The same-model suggestion lists in D6 and F3 are dropped until a same-product availability query exists. Kit role labels come from the kit's own name.

## Constraints

- Branch from `origin/claude/kiosk-multi-lens` (PR #403, stacked on #402). The custody, API, and native fixes this redesign depends on are there, not on `main`. Do not merge #402 or #403 without Erik.
- PR #403's Vercel preview fails because the preview database's migration history does not match the repo. That is an infrastructure change; ask before touching it.
- Follow `AGENTS.md`: `gt-ios-slice` workflow; new Swift files via `xcodegen generate` with the regenerated `project.pbxproj`; `WisconsinKiosk` build and tests on the iPad Air 11-inch (M4) iOS 26.5 simulator; affected source-contract tests; a `gt-ui-review` before/after for every visible slice using `scripts/kiosk-capture-scenarios.sh` and new `GT_KIOSK_SCENARIO` fixtures per frame.
- Physical proof happens in the managed-iPad session next week; simulator captures prove presentation only.

## Phase 0 frame map (2026-09-25)

Class: **a** = UI on existing endpoints · **b** = new server work that changes no rule · **c** = rule change, waits for Erik · **d** = the canvas shows data that exists nowhere today (drop, or back it with b).

Corrections to the "already backed" list: the **checkout limit** is only a plain 409 at `checkout/complete` (message text, no code; `checkout_policies.maxItemsPerUser`, default `null` = no limit) and `student/[userId]` exposes nothing, so C3 needs server work. **Extend** PATCH validates but never returns a latest allowed time. **Staged battery replace** is pickup-only; H4 swaps on an *active* checkout, which is two separate transactions today. **Reservation edits** save on every tap, while H5 says "Nothing changes until you save".

| Frame | Today | Endpoint(s) | Class | What changes / gap |
| --- | --- | --- | --- | --- |
| A1 nothing out | `KioskIdleView` | `dashboard`, `users` | a | Rebuild: SF Pro clock with seconds, "Everything is in" card, no stat tiles, no health dot when healthy. "Next up" needs the next event/pickup (b, small: dashboard `nextUp`). |
| A2 typical afternoon | `KioskIdleView` checkout list | `dashboard` | a+b | Sectioned cards (overdue / due today / ready for pickup / out, due later). Due-today is derivable client-side; **pickups ready is missing from the dashboard** (b). Today tiles: overdue + due-today derivable; pickup + shift-call-within-2h need server (b). Everyone grid 4 cols ≤24 else 5 cols no photos. |
| A3 game day | — | `dashboard.events` | b + d | Group by event, pickups first. Needs checkouts linked to events and pickups in payload (b). "Crew without gear" needs shift-assignment × booking join (b; `ShiftAssignment.bookings` exists). Kit role labels beyond Slow 1–2, Bench, Roam 1–4 (Sideline, High, Photo) do not exist (d). |
| A4 offline | idle `connectionTone` dot | client only | a | Band shows only real problems: "Offline for N min · Showing what was true at …". Sleeping scanner is not an error. |
| A5 nudge | — | web `bookings/[id]/nudge` (staff only, once per booking per UTC hour) | **c** | The frame puts Nudge on home with nobody identified, so "anyone" is baked in. Staff-only moves it into C5. Kiosk route + per-day limit after the decision. |
| A6 who's returning | `KioskIdentityView` (return-other) | `checkin/*` actor rule (anyone may return) | a | New sheet layout: booking card left, owner first then "Someone else" grid. |
| B1 free gear | idle scan → `pendingIntent` → identity | `resolve-scan` (`pending_identity/available`), `scan-lookup` | a + d | "Where: Shelf B2" has no field (Asset has only `locationId`, `notes`) (d). "Free until" (next reservation) and "Last back" are computable but not returned (b). |
| B2 reserved gear | identity (expected requester) | `resolve-scan` (`booked_reservation`) | a | Single "Continue as Erik" card; copy "Put it back on the shelf". |
| C1 hub, nothing out | `KioskOperatorHubView` | `student/[userId]`, `events?userId` | a | Header 56 pt name, green "Check out gear" hero, OUT WITH YOU / READY TO PICK UP / YOUR SHIFTS with "Check out for this". |
| C2 hub, gear + pickup | hub + `KioskCheckoutDetailSheet` | `student`, `checkout/[id]` | a | Inline Return / Extend / Add items / Transfer buttons per booking; Pick up / Change what's reserved. Transfer button for students depends on decision 2 (hide until then). |
| C3 at the limit | — | `checkout/complete` 409 | b | Add `openCheckoutCount` + `checkoutLimit` (or `canCheckout` + reason) to `student/[userId]`, and an error code on the 409. Same card covers the leftover-pickup block. |
| C4 unfinished checkout | pending handoff in `KioskAPIClient` (`hasPendingCheckout`) | receipts replay/reject | a | Card on the hub with Check it now / Discard; checkout hero disabled "Finish the one above first". |
| C5 staff on a booking | detail sheet (edit allowed for staff) | `checkout/[id]` PATCH, `checkout/[id]/transfer` (staff) | a + b | Change due back and Transfer whole checkout: a. "Mark returned without scanning": kiosk has nothing; web `checkouts/[id]/admin-override` needs `checkout.admin_override` (b if the same permission applies; ask). "Report lost or damaged": see G. |
| D1 tap your name | idle | — | a | Same as A2. |
| D2 details | `KioskCheckoutView` step 1 | `events?userId` | a | Shifts list with white-outline selection, "Something else" field, day chips + time chips + "90 min after" + Back by summary. **Reverses** the 2026-09 removal of time presets (brief wins; changelog must say so). Kit row removed from details. |
| D3 other date | native pickers | — | a | Month grid + time chips sheet. |
| D4–D5 scan, items | `KioskCheckoutView` step 2 | `checkout/scan`, `availability` | a | Task scaffold: context card + Edit, scan stage left, TAKING OUT list right, white primary pill. Undo = remove from local cart. |
| D6 blocked scan | `What now?` / rejection | `availability` | a + d | "NOT ADDED … Your list didn't change." "Available now, same model" suggestions don't exist (d, or b: same-product availability query). |
| D7–D8 receipt | `KioskSuccessView` | completion payloads | a | Receipt card with ref, items, due; badge card; "Home in 6s". "You'll get a reminder tomorrow evening" copy must match real reminder timing. |
| E1–E3 kits | checkout details kit menu | `kits`, `kits/[id]`, `checkout/complete kitId` | **c** (entry point) + a | Checklist behaviour exists (a). Entry point is decision 1. E3 "asks first" is a. Roles like Slow 3, Roam 5, Sideline 2 are not in `FootballGamedayKitRole` (d). |
| F1 pickup | `KioskPickupView` | `pickup/[id]/scan`, `confirm` | a | Task scaffold, blue section color, battery row "#12" filled/outlined, Undo. Undo for serialized staged scans: DELETE handles numbered units only (b for serialized unstage). |
| F2 off-plan | Add/Discard dialog | `pickup/[id]/scan intent:add` | a | Inline card "Put it back / Add MIC-12". |
| F3 substitute | swap dialog | `pickup/[id]/substitute` | a + d | Same-model suggestion list (d). |
| F4 shared case | pickup SHARED | same | a | Violet section; "Pick up for the team". |
| F5 receipt | success | confirm `remainingItemNames` | a | Leftover line. |
| G1–G2 return | `KioskReturnView` | `checkin/[id]/scan`, `quantity`, `complete` | a + b | Amber section, "Something damaged or missing?" link, "N back · M still out". **Undo of a return scan has no endpoint** (b: un-return a scan made in this session). |
| G3–G5 damaged / missing | — | web `checkouts/[id]/checkin-report` (user session; Blob photo) | b | Kiosk route wrapping the same `CheckinItemReport {DAMAGED, LOST}` service. Damaged: returned + asset to MAINTENANCE ("held for staff"). **Conflict:** web LOST counts the item as accounted for; G5 says it "stays on your record until it turns up". Needs Erik's confirmation of which. Camera capture on iPad is device-only proof. |
| G6 receipt | success | — | a | Returned + marked missing cards. |
| H1 extend | detail sheet date edit | `checkout/[id]` PATCH | a + b | "Can go until 10:00 PM" needs the latest allowed time (b: return the earliest conflicting start, or a `maxEndsAt` preview). |
| H2–H3 transfer + accept | — | `checkout/[id]/transfer` (staff, immediate) | **c** | No pending/accept model. Peer transfer is decision 2. |
| H4 swap a unit | — | `checkout/[id]` POST + DELETE (two transactions) | b | Atomic `POST checkout/[id]/swap`; "Something's wrong with it" routes through G4's report. |
| H5 change reservation | pickup remaining-item edits | `reservation/[id]/items` (immediate per op) | a or b | Either change the copy to "saved as you go" (a) or add a batch save (b). Ask. Swap = remove + add. |
| I1 discard scans | cancel confirm | client | a | Sheet with red Discard. |
| I2 return with gear out | — | client | a | Asks first. |
| I3 scanner asleep | scanner pill | client | a | Inline scan-stage copy; not an error. |
| I4 still here? | `InactivityWarningOverlay` | client | a | Countdown ring, "your 3 scans wait 20 minutes". |
| I5 not confirmed | pending handoff | receipts | a | Card in scan stage with auto-retry countdown. |
| I6 keyboard tip | `KioskKeyboardHint` (shell popup) | client | a | Inline under the focused field, never centered. |
| J1 setup | `KioskActivationView` | `activate` | a | White Go key, Paste code / Use keyboard. |
| J2 standby | `KioskSleepModeView` | `dashboard.standby` | a | 132 pt dim clock on black, "Tap or scan to wake · Next: …". |
| J3 phone messages | — | web notifications | c / b | Notification copy, not kiosk UI. Due/overdue copy is web work; nudge/transfer messages wait on decisions 2–3. |
| J4 sound + motion | `KioskFeedbackSound` + ad-hoc animation | client | a | Accept / reject / undo / done / badge / attention / warning sounds; 150 ms fades under Reduce Motion. |

Existing contracts the redesign changes on purpose (update tests and AREA_KIOSK in the same slice): AC-26 puts Back top-left, but the canvas puts time and Back top-right (`tests/ios-kiosk-back-button.test.ts`). `KioskStatus` uses blue for checked out and purple for reserved; the canvas uses green = taking out, amber = coming back, blue = picking up, violet = shared. `KioskButtonRole.primary` is brand-red glass; the canvas primary is a solid white pill (`tests/ios-kiosk-liquid-glass.test.ts`). Gotham appears in about 126 call sites across 10 files.

## Ledger

- [x] Phase 0: frame map above (2026-09-25).
- [x] Server slices S1–S9 (merged `7200a7d0`): allowance, dashboard home data, nudge, peer transfer, damaged/missing report, extend window, lookup extras, atomic swap, pickup/return undo. Swift clients for these are not wired yet.
- [x] 1a Tokens: SF Pro type scale with a 14 pt floor, section colors, white primary pill, applied through `KioskType` / `KioskStatus` / `kioskButtonRole` so every screen shifts at once (before/after review across all fixtures)
- [x] 1b Shared components (task scaffold, list rows, battery row, confirmation stage with Undo, sheets), added without rewiring screens yet
- [x] Home (A1, A2, A4), standby and setup (J1–J2). Pending: wiring the new dashboard data (pickups section, Today pickup and shift tiles, A3 game day, A5 Nudge) and A6.
- [~] Hubs: C1 and C2 are done. Pending: C3 limit card and C4 unfinished card (server `checkoutAllowance` has landed), and C5 staff actions.
- [~] New checkout: D2, D4–D8, I5 and I6 are done, and the kit entry is on the scan screen. Pending: D3 fidelity check, I1 as a card rather than a system dialog, and the kit checklist polish (E).
- [x] Pickup (F1–F5): task scaffold, blue/violet sections, battery chips, Undo via pickup scan DELETE, inline off-plan and swap cards (scan route now offers a like-for-like `substitution`), finish-with-leftovers check, receipt leftover line. Review: `tasks/kiosk-redesign-review-pickup-2026-09-28/`. Pending: live-server and hardware proof.
- [x] Return (G1–G6, I2): G1–G2 and I2 rebuilt in `1417e3c0` (task scaffold, amber section, Undo via checkin scan DELETE, still-out check). G3–G6: one "Something damaged or missing?" link opens its own page; damaged = describe + photo (multipart `checkin/[id]/report`, held for staff); missing = accounted for per decision 4 (a last missing item finishes the return server-side); receipt shows Returned / Held for staff / Marked missing cards. Only serialized items can be reported (the service keys on `bookingSerializedItem`), so batteries and counted stock are left out of the chooser. Review: `tasks/kiosk-redesign-review-return-reports-2026-09-28/`. Pending: live-server proof, and on-device camera and photo upload.
- [ ] Changes (H)
- [ ] Interruptions (I3, I4) and sound/motion (J4)
- [ ] Kits (E) once the entry point is decided
- [ ] Docs: `AREA_KIOSK.md`, gaps, codemaps
