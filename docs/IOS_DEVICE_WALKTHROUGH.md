# iOS Device Walkthrough — Manual QA Plan

A structured checklist for verifying the Wisconsin iOS app on real hardware. The simulator covers most logic + layout, but several paths are hardware-only — DataScannerViewController, real haptics, APNs push delivery, VoiceOver, Dynamic Type, Bluetooth HID scanners, real network instability.

Run this end-to-end before any TestFlight build. Skip surfaces that haven't shipped yet.

This plan maps directly to the 24+ focused audit docs at `tasks/audit-*-ios.md` and the patterns codified in `docs/IOS_PATTERNS.md`. Every checkbox below corresponds to a specific audit-pass behavior we explicitly tested in source. The goal here is to verify the behavior survives in the wild.

---

## Pre-flight

### Automated readiness proof (2026-05-11)

- [x] `npm run drift:ios` -> `0 violations` across 45 Swift files.
- [x] `npm run audit:ios:gaps` -> 34/34 audit-worthy surfaces covered, `✓ no audit gaps`.
- [x] XcodeBuildMCP simulator build -> `SUCCEEDED`, zero warnings/errors, target `Wisconsin` on iOS Simulator.
- [x] Exact shell build -> `xcodebuild -scheme Wisconsin -destination 'generic/platform=iOS Simulator' -configuration Debug build` -> `** BUILD SUCCEEDED **`.
- [x] Real-device build/install/signing verified 2026-08-20 on Erik's iPhone (iPhone 16 Pro, iPhone17,1, paired). Build 27 compiled for `platform=iOS` in both Debug and Release with `Apple Development: Erik Role`, and the Release `.app` installed via `xcrun devicectl device install app`. The Release binary contains none of `GT_PERFORMANCE_SCENARIO`, `GT_KIOSK_SCENARIO`, or `SearchFixtureAPI`, confirming the DEBUG capture harness compiles out of a shipping build rather than merely being inert.

### Build + install

- [ ] Pull latest `main`. `git status` clean.
- [ ] `npm run drift:ios` → `0 violations`.
- [ ] `npm run audit:ios:gaps` → `✓ no audit gaps`.
- [ ] `cd ios && xcodegen generate` (if any new files were added).
- [ ] Confirm `Wisconsin/Wisconsin.entitlements` contains production APNs and associated domains after XcodeGen. WeatherKit must remain absent from Build 26 and later candidates.
- [ ] Build for device target in Xcode. **BUILD SUCCEEDED** with zero warnings (other than "AppIntents.framework dependency" notice).
- [ ] Install to a real iPhone (16 series or later) and a real iPad (Pro / Air).

### Test accounts

- [ ] STUDENT: a fresh student account, no prior data.
- [ ] STUDENT (heavy): a student with active checkouts + upcoming reservations + an overdue item.
- [ ] STAFF: standard staff account.
- [ ] ADMIN: admin account.

### Sign in

- [ ] `LoginView` — type a partial email; trailing-whitespace bug from the audit (slice 144) is fixed (login succeeds with a typo'd trailing space). [audit-login-ios.md]
- [ ] Enter an administrator-approved but unregistered email and tap Continue. The shared discovery request opens the native Set up account form with that email locked; create a password and verify the account enters the normal Welcome flow without leaving the app.
- [ ] Enter an existing account email and tap Continue. The app advances to Password and does not open onboarding.
- [ ] Tap "Forgot password?" → the native Reset password form opens. Submit an email and verify the generic in-app response; if email delivery is configured, the emailed reset link opens the canonical web reset form.
- [ ] Sign in succeeds; `currentUser` persists across cold launch (kill app, reopen — still signed in).

---

## Hardware-only verification

These paths cannot be exercised in the simulator. **Test on a real device, on every release.**

### Camera + scanner

- [ ] **Scan tab cold permission.** Fresh install: open Scan → `ScanPrePromptView` shows BEFORE the OS alert. Tap "Turn on camera" → OS alert → Allow. Camera-feed view appears.
- [ ] **Camera scanning** — point the camera at a real gear sticker (or a printed QR code). Within ~1s the result sheet appears at `.medium` detent above the live camera view.
- [ ] **Torch toggle** — the bottom overlay's bolt icon turns the torch on; the bolt fills + tints yellow; the room lights up. Tap again — torch off. [audit-scan-ios.md]
- [ ] **Rapid-fire scans** — scan one item, glance at the result sheet, point the camera at a NEW different code. The new code triggers a fresh result sheet (proves `isScanning = true` re-arms after a result lands). [audit-scan-ios.md P1]
- [ ] **Same-code re-fire** — point the camera at the SAME code while the result sheet is still up. Nothing happens (lastScanned dedupe). Dismiss the sheet, point at the same code again — fires.
- [ ] **Type code instead** — bottom overlay's "Type code" button. Sheet at `.medium` detent. Type a known code, tap "Look up" → result sheet appears.
- [ ] **Empty result + recovery** — type a nonsense code. Result sheet shows "Nothing found" + a "Type code instead" button (audit fix). Tap it → manual-entry sheet re-opens.
- [ ] **Server-error recovery** — turn airplane mode on, type any code. Result sheet now shows "Couldn't look that up" (NOT "Nothing found") + the humanized network error message. [audit-scan-ios.md P1 hardening]
- [ ] **Camera-permission-denied path** — Settings → Wisconsin → toggle Camera off → return to app → Scan tab shows `ScanDeniedView` with "Open Settings" button. Tap → opens iOS Settings to Wisconsin. Toggle back on → return → camera view re-appears.

### Haptics

Run with the device taken off mute and held in hand. Every `Haptics.*` call shipped today should produce a felt response.

- [ ] **`Haptics.success()`** — favorites toggle ON, scan match, booking create succeeds, kiosk checkout/pickup/return completes. Single firm "tap-tap" (UINotificationFeedbackGenerator success).
- [ ] **`Haptics.warning()`** — favorites toggle fails, booking save fails (try with airplane mode), scan dedupe ("already scanned"). Triple medium tap.
- [ ] **`Haptics.error()`** — kiosk activation invalid code, scan API failure. Heavier triple tap.
- [ ] **`Haptics.selection()`** — overdue report row expand/collapse, asset toggle in CreateBookingSheet equipment picker, profile push toggle, notification swipe-mark-read.
- [ ] **`Haptics.tap()`** — kiosk numpad digit press, QR code copy on item detail, extend-booking preset chips.

### Push notifications

- [ ] **First launch shows `PushPrePromptView`** as a sheet at `.medium` detent. The OS alert does NOT fire automatically. Tap "Turn on notifications" → OS alert → Allow.
- [ ] **Send a test push** (server-side: trigger an overdue notification or use the admin web's "send test" if available). Expect a banner with badge + sound.
- [ ] **Foreground notification** — open the app, send another notification → in-app banner via `userNotificationCenter:willPresent:`.
- [ ] **Tap a notification** → if `bookingId` payload, opens `BookingDetailView`. If `eventId` payload, opens schedule context. If asset-related (damage/lost/low-stock), opens asset detail (today's notifications-sheet fix).
- [ ] **Push after Settings → Wisconsin → Notifications OFF** — push permission .denied. Open `ProfileView` → Notifications section shows "Push disabled in iOS Settings" with a tappable "Open Settings" link. [audit-profile-ios.md]
- [ ] **Quiet hours** — tap "Pause 1 hour" in Profile. Server-side trigger a notification — the in-app inbox sheet still gets it (always fires) but no banner / no badge / no sound delivers (the channel is paused). After 1 hour, channels resume.
- [ ] **Email channel toggle** — flip OFF, request a server-side notification email — should NOT arrive. Flip ON — should arrive.

### VoiceOver (Settings → Accessibility → VoiceOver ON)

Every audit included a VoiceOver pass. Sample the most-trafficked surfaces:

- [ ] **Home dashboard** — stat strip reads each metric (Overdue, Due Today, Checked Out, Reserved); the empty-state seal reads "All caught up."
- [ ] **Items list row** — each row reads as a SINGLE element: "Sony FE 100-400mm, E1-008, Lenses, Camp Randall, Available." Not piece-by-piece.
- [ ] **Item detail Reserve button** — reads "Reserve Equipment" without the calendar.badge.plus icon name.
- [ ] **Notifications sheet** — each row reads as one element with title + body + relative date + "Unread" trait when applicable. Swipe left → button reads "Mark as read" (NOT "checkmark, Mark Read"). [audit-notifications-sheet-ios.md]
- [ ] **Profile sheet** — Notifications section reads each row as a coherent unit; the push-permission state row reads "Push disabled in iOS Settings. Tap to open Settings." when applicable.
- [ ] **Kiosk activation** — numpad keys announce "Delete last digit" and "Submit code" instead of "delete left" and "checkmark." Digit display container reads "Activation code, N of 6 digits entered." On invalid code: VO speaks the error message immediately via `UIAccessibility.post`. [audit-kiosk-activation-ios.md]
- [ ] **Kiosk idle roster** — each tile reads the user's full disambiguated name (e.g. "Erik Mason, Tap to start checkout for Erik Mason") not just the initials. [audit-kiosk-idle-ios.md]
- [ ] **Event detail shift row** — reads "Your shift. Student shift. 9:00 to 17:00. Assigned: Erik Mason." [audit-event-detail-ios.md]
- [ ] **Trade board row** — reads "VIDEO shift. Football vs Western Illinois. Sep 11 9:00 to 13:00. Posted by Erik Mason. Status: Open." Claim button stays separately addressable. [audit-trade-board-ios.md]
- [ ] **Assign student row** — primary-area match announced: "Erik Mason, role@wisc.edu, Video specialist (matches this shift)." [audit-assign-student-ios.md]

### Dynamic Type (Settings → Accessibility → Display & Text Size → Larger Text)

Iterate the slider through every step from the smallest to "Larger Accessibility Sizes."

- [ ] **Home dashboard** — text scales without truncation issues. Stat strip rows wrap or stack.
- [ ] **Bookings list** — row content stays readable; status pills don't get clipped.
- [ ] **Profile sheet** — Notifications/Appearance sections scroll properly; toggles + pause chips stay tappable.
- [ ] **Kiosk surfaces** — kiosk is dark-locked but Dynamic Type still applies. Verify roster grid + checkout cart remain usable at large sizes (some clipping acceptable; nothing critical truncates).

### Reduce Motion (Settings → Accessibility → Motion → Reduce Motion ON)

- [ ] **Kiosk activation** — digit-display strokes don't animate; loading scrim still appears (snap, no transition).
- [ ] **Kiosk idle** — stat-tile numeric transitions don't animate (`contentTransition(.numericText())` snaps).
- [ ] **Kiosk pickup ring** — fills snap rather than spring-animating.
- [ ] **Kiosk checkout** — auto-scroll-to-latest-scan snaps instead of easing.
- [ ] **Schedule view** — calendar swipes don't animate.
- [ ] **Item detail** — favorite toggle haptic still fires but visuals snap.

### Dark mode

- [ ] **System default light** — most app surfaces respect light mode; kiosk stays dark-locked.
- [ ] **System default dark** — every non-kiosk surface renders correctly with dark backgrounds + light text + status tokens.
- [ ] **Profile → Appearance → Light** — overrides system dark; everywhere except kiosk goes light.
- [ ] **Profile → Appearance → Dark** — overrides system light; everywhere goes dark.
- [ ] **Profile → Appearance → System** — follows OS preference.
- [ ] After overriding, kill the app + relaunch — preference persists (`@AppStorage`).

### Bluetooth HID scanner (kiosk only)

- [ ] **Pair a Bluetooth barcode scanner** to the iPad in iOS Settings.
- [ ] Activate kiosk mode. Open kiosk checkout for a test student.
- [ ] **Checkout Details context** — before Start Scanning, `Link to event` is off by default. Type a booking name/details value in the Context text field; Start Scanning stays disabled until that field has text.
- [ ] **Checkout Details event selector** — turn `Link to event` on. Upcoming events replace the booking-name field in the Context window; tapping one selects it, and the All Events menu remains available for the rest of the 7-day event list. Row taps should register normally without long-pressing.
- [ ] **Checkout Details return time** — on the iPad Pro 10.5 kiosk in landscape, Checkout Details keeps the hero full width, then shows Context on the left and Return on the right in the same row, with Start Scanning pinned at the bottom. Return uses a UIKit calendar date grid plus a native wheel time picker. There is no checkout start-date field and no Custom preset; calendar day taps should change the return date immediately, not require a long-press.
- [ ] **Ad hoc scanner handoff** — after typing an ad hoc booking name, tap Start Scanning and immediately scan a physical barcode. The first scan should land in the cart without tapping the screen again.
- [ ] **HID scan inputs land in the cart** — pull the scanner trigger over a real sticker. The `HIDScannerField` is hidden but always-first-responder; the scan should add the item to the cart with success haptic.
- [ ] **Tap a UI element to "steal" focus** — the field's `textFieldDidEndEditing` re-acquires within 150ms. Pull the trigger again — still works.
- [ ] **HID dedupe** — pull the trigger twice quickly on the same code. Only one cart entry (server idempotent + iOS dedupe).
- [ ] **Native keyboard with scanner awake** — in checkout details or active-checkout edit details, double-press the scanner trigger to show the iPad software keyboard, tap into a text field, and type several letters. The keyboard stays open after each character and the typed text lands in the visible field, not the hidden scanner sink.
- [ ] **Camera fallback while HID is connected** — tap the Camera button. Camera fallback opens. HID scans should NOT register while the camera sheet is up (or at least not corrupt the cart). After dismissing the camera, HID resumes.

### Apple Pencil signature capture (iPad, STAFF/ADMIN)

- [ ] **Entry** — Browse shows Signatures on iPad for a staff account; it is absent on iPhone and for students.
- [ ] **Pencil only** — a finger or palm on the canvas leaves no ink; the Pencil draws immediately with no visible lag at the tip.
- [ ] **Resting palm** — sign a long name with the palm on the glass; no stray marks, no edge-swipe or Control Center interruption.
- [ ] **Landscape** — in portrait the capture screen asks to rotate; rotating mid-signature keeps the ink.
- [ ] **Undo / Redo / Clear / Replay** — the bar works; Undo after Clear brings the signature back; Replay redraws at the signer's pace. Pencil double-tap and (Pencil Pro) squeeze undo unless Settings → Apple Pencil is set to Ignore; Command-Z / Shift-Command-Z work with a keyboard.
- [ ] **Save** — Save shows "Signature saved" briefly and returns to the roster, which now marks the person Signed; the web roster shows the same PNG/SVG.
- [ ] **Offline save** — turn on Airplane Mode, tap Save (error shown, ink kept), turn it off, tap Save again — one revision is created, not two.
- [ ] **Second iPad** — save the same person on another device first; this iPad's Save reports the conflict, keeps the ink, and shows "Replaces saved signature".

### Network instability

- [ ] **Cellular → Wi-Fi swap mid-action** — start a slow API call (e.g., booking create), toggle airplane mode briefly, toggle off. Action either completes or surfaces a clear network error. App doesn't crash.
- [ ] **Offline banner** — turn airplane mode on. The global "No connection — some actions may fail" banner appears at the top of the AppTabView (audit slice 142).
- [ ] **Network reconnect** — turn airplane mode off. Banner dismisses with reduce-motion-aware fade.
- [ ] **Stale-write race** — global search: type "ab" fast then "abc" while on slow cellular. Final results match "abc," not "ab" (today's race-guard fix). [audit-global-search-ios.md]

### Background / resume

- [ ] **Suspend during checkout** — open kiosk checkout, scan items, swipe up to background. Bring back. Cart persists (per `KioskStore`).
- [ ] **Suspend during edit** — open EditBookingSheet, type a title change, background, return. Form state persists.
- [ ] **Push permission revalidation on `scenePhase == .active`** — swipe to background → toggle push OFF in iOS Settings → return to app → ProfileView's Notifications section reflects the change without a manual refresh.
- [ ] **Inactivity timer in kiosk** — pick a name, scan items, leave the iPad alone for 4:30 → "Still here?" overlay appears. Tap Stay → cart preserved. Or wait full 5:00 → resets to idle, cart preserved (per audit fix).

---

## Per-surface walkthroughs

Order matches floor frequency. Run as STAFF/ADMIN unless noted; switch to STUDENT for explicitly student-only flows.

### Home / Action Queue

- [ ] Compact triage strip shows live counts (Overdue, Due Today, Pickups, Shifts). Each cell opens the relevant Bookings or Schedule tab.
- [ ] "Updated Xs/Xm ago" subtitle visible.
- [ ] Pull-to-refresh updates stamps.
- [ ] When stats are 0 across the board, "You're all set" empty state with green checkmark seal.
- [ ] `Next Up` queue prioritizes only this user's overdue gear, due-today bookings, awaiting pickup, upcoming reservations, and upcoming shift.
- [ ] Queue rows use status rails, not leading calendar/gear icons.
- [ ] Queue booking and reservation rows open Booking Detail without exposing checkout or handoff Scan actions.
- [ ] Queue shift rows open Event Detail; their Schedule buttons switch to the Schedule tab.
- [ ] Passive Upcoming Events, My Checkouts, Team Checkouts, and Team Reservations cards do not appear on Home.
- [ ] Staff/admin follow-up appears below the queue only for exception work such as flagged items, lost bulk units, or drafts.
- [ ] Top-right avatar tap → Profile sheet at `.medium` detent.
- [ ] Top-trailing bell tap → Notifications sheet (with badge count when unread > 0).
- [ ] Bottom-right plus action opens CreateBookingSheet.
- [ ] No bottom-trailing search button appears on Home; scan lookup remains the dedicated tab-bar action.
- [ ] Student tab bar: Home (active red), My Gear, Items, Scan, Schedule. Staff/admin also see Users.

### Profile sheet (today's biggest pass)

- [ ] Avatar = real photo loaded via AsyncImage (not initials).
- [ ] Name + monospaced email shown in header.
- [ ] **Notifications section**:
  - [ ] Push permission state row visible if denied/notDetermined.
  - [ ] Pause alerts row shows Pause 1 hour / Pause 1 day / Pause 1 week. Tap "Pause 1 hour" → optimistic flip to "Paused until {time}" with Resume button. Server save succeeds (toast or no error). Resume now restores chips.
  - [ ] Email alerts + Push alerts toggles. Flip OFF → optimistic switch off → if server fails, toggle reverts (test by toggling airplane mode).
  - [ ] Channel toggles disable when paused (paused state wins).
- [ ] **Appearance section** — Theme menu shows System / Light / Dark. Each choice persists across cold launch.
- [ ] **Stats section** — Upcoming Shifts → tap navigates to Schedule. Overdue Bookings → tap (STAFF/ADMIN only) navigates to OverdueReportView.
- [ ] My Availability (STUDENT only) — opens My Availability; existing blocks show a visible Add availability block row and a labeled Add block toolbar action.
- [ ] Tools section (STAFF/ADMIN only) — "Link Sticker Codes" opens the wizard.
- [ ] App section — Version + Build, Open iOS Settings link.
- [ ] Sign Out → confirmation dialog → on confirm, tokens revoked + session cleared + LoginView returns.

### My Gear / Bookings list + Booking detail

- [ ] Reservations / Checkouts segmented control; the navigation title changes to match the selected segment.
- [ ] Mine / All toggle in toolbar. STUDENT defaults to Mine; staff/admin default to All. When Mine is ON, list shows only the current user's bookings.
- [ ] New reservation toolbar button has visible "New" copy, not only a plus icon.
- [ ] Schedule filter (status pills) when applicable.
- [ ] Pull-to-refresh.
- [ ] Tap a booking → Booking Detail.
  - [ ] Live countdown badge ticks every 30s for OPEN bookings ("Due back in N hours M minutes" / "Overdue by …").
  - [ ] Overdue red banner appears when applicable.
  - [ ] Equipment + bulk consumables sections render with thumbnails.
  - [ ] **Action panel** (today's ownership-gate fix): only renders if the user is STAFF/ADMIN OR the booking's requester. STUDENT viewing someone else's booking → no Extend / Cancel buttons. [audit-booking-detail-ios.md]
  - [ ] Tap Extend → ExtendBookingSheet at default detent.
    - [ ] +1 day / +3 days / +1 week chips offset from the picker's current value if nudged, otherwise from current end.
    - [ ] Picker bounded to `currentEndsAt...` — can't pick a date before current end.
    - [ ] Save with date unchanged → button disabled.
    - [ ] Save with change → button shows inline ProgressView; haptic.success on dismiss.
    - [ ] Cancel with unsaved change → discard confirm.
  - [ ] Tap Cancel Booking (when status is BOOKED) → confirmationDialog "Cancel Booking?" → confirm → API call, haptic, view reloads with COMPLETED/CANCELLED status.
  - [ ] Labeled `Edit` action (STAFF/ADMIN OR own draft/booked booking) → EditBookingSheet → save updates with inline spinner + haptic.
  - [ ] Own booking after edit locks (PENDING_PICKUP/OPEN for STUDENT) shows `Editing locked` with Extend/kiosk handoff copy.

### Items list + Item detail

- [ ] Search bar filters live (with stale-write race guard — verify by typing fast on cellular).
- [ ] Visible `Favorites` and `All statuses` controls sit above the list; status selections change the status control label to `{N} statuses`.
- [ ] Each row: thumbnail, mono asset tag, brand+model subtitle, location, status pill (Available green / Out blue / Maintenance orange / Retired gray).
- [ ] Swipe-leading: favorite toggle.
- [ ] Swipe-trailing: Reserve → opens CreateBookingSheet prefilled with this asset.
- [ ] Long-press / context menu: Favorite, Reserve, Copy Asset Tag.
- [ ] Tap a row → Item Detail.
  - [ ] Hero card: thumbnail, title, status, availability snapshot ("Available — next reserved Mar 10" / "Erik Mason · due back in 3 hours"), QR pill (tap → toast "Copied {QR}").
  - [ ] **"Reserve Equipment" CTA below hero** (today's item-detail fix) — purple `Color.statusText(.purple)` glass button with `calendar.badge.plus`. Tap → CreateBookingSheet prefilled. After save → push to BookingDetailView via parent's NavigationStack. [audit-item-detail-ios.md]
  - [ ] Details card: Location, Category, Department, Serial (mono), UW Asset Tag (mono if present). Procurement section (Purchased, Purchase Price, Link) gated to STAFF/ADMIN only — STUDENT does NOT see these rows.
  - [ ] Active booking card (if any) → tap navigates to that booking.
  - [ ] Upcoming Reservations card with "No upcoming reservations" empty state when blank.
  - [ ] Accessories card (slice 17) when this asset has children.
  - [ ] Parent-link card (slice 17) when this asset is itself an accessory.
  - [ ] Star toggle in toolbar — haptic only fires on user action, NOT on initial load (today's fix).
  - [ ] Pencil → EditAssetSheet (STAFF/ADMIN only). Save with inline spinner + haptic.

### CreateBookingSheet (multi-entry)

Reachable from: Bookings tab `+`, Items list swipe + context menu, Item Detail Reserve CTA.

- [ ] Step 1 (details): title, requester (STAFF picker / STUDENT locked to self), location, dates, notes.
- [ ] Tap Choose Equipment → Step 2 (equipment picker).
- [ ] Equipment search has a stale-write guard (test on slow network).
- [ ] Asset rows toggle on tap with `Haptics.selection()`. Selected rows show blue checkmark; conflicted rows show orange triangle + "Scheduling conflict."
- [ ] Selected Equipment section shows every picked item with a visible Remove action. Remove works even when the current search results do not show that item.
- [ ] Conflict pre-check fires after asset selection changes (debounced).
- [ ] Tap Create Reservation → inline spinner replaces the label; haptic on success; new booking pushed onto navigation path.
- [ ] On submit failure → confirmationDialog with "Try again" + "OK" (today's fix).
- [ ] hasUnsavedInput broadened — STAFF picks a requester + edits dates + leaves title blank → Cancel STILL fires discard confirm. [audit-create-booking-ios.md]

### Scan tab — see Hardware-only above for camera-specific.

- [ ] Empty state: "Scanner Not Available" when no camera (simulator / front-only iPad).
- [ ] Single-asset auto-jump: scan a sticker → if exactly one asset matches, navigates straight to ItemDetailView (no result sheet).
- [ ] Same sticker held in frame does not push a second ItemDetailView on top of the first.
- [ ] Multi-result sheet: scan a code that matches an asset + a booking title → result sheet shows both sections; tap navigates to the right detail.

### Notifications sheet

- [ ] Bell on home shows badge with unread count.
- [ ] Sheet opens with grouped sections: Today / Yesterday / This Week / Older.
- [ ] Each row has type-tinted icon (overdue orange, gear-up green, trade-claimed blue, trade-declined red, reservation purple).
- [ ] Unread rows have semibold title + accent dot; tap marks read; row updates immediately (optimistic).
- [ ] Swipe-left or swipe-right → "Mark as read" with selection haptic. [audit-notifications-sheet-ios.md]
- [ ] **Asset-targeted notifications** (damage / lost / low-stock) — tap navigates to asset detail (today's fix).
- [ ] **Infinite scroll** — load more pages by scrolling near bottom (today's fix replaces the dead "Load More" button).
- [ ] Mark All Read button only renders when unreadCount > 0; success haptic via `sensoryFeedback`.
- [ ] Pull-to-refresh re-syncs.

### Schedule + Event detail

- [ ] Schedule tab → list of events with date columns.
- [ ] Visible `View` segmented control switches between List and Calendar.
- [ ] `Past events` chip (STAFF/ADMIN only) appears in List mode only; STUDENT does not see it.
- [ ] `My shifts` chip filters the list and calendar without relying on an icon-only toolbar toggle.
- [ ] Toolbar actions read `Trades` and `Calendar`, with the open-trade count still shown on Trades.
- [ ] Tap an event → EventDetailSheet.
  - [ ] Header: sport pill, home/away (with mappin.and.ellipse), title, date, and location. No weather request or weather presentation appears.
  - [ ] **Crew section with CoveragePill** — "0/4 filled" or similar in red token (today's fix). [audit-event-detail-ios.md]
  - [ ] **Per-area shift blocks** — "Video" / "Photo" / "Graphics" / "Comms" headers in title-case (today's title-case sweep), NOT "VIDEO" uppercase.
  - [ ] Each shift row shows time column + worker pill ("Student" blue token / "Staff" muted) + assigned person OR "Assign person" affordance (STAFF) OR "Claim shift" affordance (STUDENT for ST slots).
  - [ ] STAFF actions via context menu: Assign someone, Replace…, Remove {name}, Approve {name}, Decline {name}, Duplicate shift, Change call time, Delete shift.
  - [ ] STUDENT actions: "Claim this shift" for student-typed open slots.
  - [ ] Pending requests show inline mini-buttons with visible names ("Approve Erik Mason" / "Decline Erik Mason").
  - [ ] EditShiftTimesSheet (today's hardening) — Save shows inline spinner; Cancel-with-changes fires discard confirm; date pickers disable while saving.

### Trade board flows (student trade post → claim)

- [ ] Trade Board reachable from notifications (`onSelectTrades`) or Schedule toolbar.
- [ ] Open Trades section + My Active Posts section.
- [ ] Each row: area in title case ("Video shift" not "VIDEO"), event summary, time range, "Posted by {name}", optional notes, status pill (Open green / Claimed orange / etc. via tokens).
- [ ] Tap an open trade → claim confirmation → API call → haptic; row updates to "Claimed."
- [ ] Swipe-left on My Active Post → cancel confirmation → API; row removed.
- [ ] Tap `Post trade` toolbar action → PostTradeSheet.
  - [ ] Eligible shifts (future + active) listed; rows are real Buttons (today's fix replaced onTapGesture).
  - [ ] Pick a shift → notes section appears.
  - [ ] Post Trade button shows inline spinner (today's fix); success haptic; sheet dismisses.
  - [ ] Discard confirm if you've selected a shift then tap Cancel.

### Users + User detail

- [ ] Users list (STAFF/ADMIN only — STUDENTs don't see this tab).
- [ ] Search bar; role filter menu (Admin / Staff / Student); Show inactive toggle.
- [ ] Each row reads as a single VO element (today's a11y fix).
- [ ] Avatar via AsyncImage with initials fallback.
- [ ] Tap a user → User Detail.
  - [ ] Profile header: avatar (real photo, not initials — today's fix), name, mono email, role pill, location.
  - [ ] **Phone Link** — tappable `tel:` link if `detail.phone` is set (today's fix). Tapping triggers system dialer.
  - [ ] Email is `.textSelection(.enabled)` — long-press to copy.
  - [ ] Active Checkouts + Recent Reservations cards if data present.
  - [ ] Pull-to-refresh.

### Overdue report (STAFF/ADMIN only)

- [ ] Reachable from Profile → Overdue Bookings stat link.
- [ ] Summary row at top: "{N} overdue checkouts across {M} people" with red status background (today's a11y combined element).
- [ ] Leaderboard sorted by total overdue time. Each row tappable; haptic.selection on toggle (today's fix).
- [ ] Expand a row → nested booking rows with title + duration + secondary line; tap navigates to BookingDetailView.
- [ ] Pull-to-refresh.
- [ ] Stale data after refresh failure — data stays visible.

### Search (global sheet)

- [ ] No floating search button appears on Home.
- [ ] Tap → GlobalSearchSheet auto-focuses field.
- [ ] Type to debounce-search; results in sections (Items / Reservations / Checkouts / People) with **count in section header** (today's fix).
- [ ] Stale-write race guard verifiable on cellular.
- [ ] Tap QR icon in search bar → QRScannerSheet (full-screen).
- [ ] On match → dismisses search sheet + pushes asset detail.
- [ ] **Server failure** → "Couldn't search" view with `wifi.exclamationmark` + Retry button (today's fix).
- [ ] **Recents persist** in UserDefaults; "Clear Recents" red-text button.
- [ ] `scrollDismissesKeyboard(.immediately)` — verify by scrolling results with keyboard up.

### Dev tools — Link Sticker Codes wizard (STAFF/ADMIN)

- [ ] Reachable from Profile → Tools → Link Sticker Codes.
- [ ] **Step 1 — Scan**: camera fires; scan or "Type code" + verify torch toggle works on real device.
- [ ] **Step 2 — Pick Item**: search for the asset by name/tag/serial. Search has error surfacing now (today's fix) — verify with airplane mode.
- [ ] **Step 3 — Confirm**: scanned code in green, asset detail. Tap "Save & Link" → ProgressView replaces text; haptic on save success.
- [ ] **Step 4 — Success**: bouncing checkmark, "{code} → {asset name}" message. Tap "Scan Next" cycles back to Step 1; "Done" dismisses.

---

## Kiosk surfaces (separate iPad)

Kiosk runs as the dedicated `WisconsinKiosk` app on a dedicated iPad in landscape mode with Guided Access locked. Launch the `WisconsinKiosk` target from Xcode or TestFlight and activate through its activation screen.

### Activation

- [ ] Cold install -> launch `WisconsinKiosk` -> blank activation screen.
- [ ] **Keyboard activation** — with a first-party iPad keyboard case attached, type the 6-digit code. Digits fill the boxes, delete removes digits, and Return submits when all 6 digits are present.
- [ ] **Paste activation code** — generate a code on web `/settings/kiosk-devices`, copy to clipboard, switch to iPad, tap "Paste Code" or press Command-V. A 6-digit code fills + auto-submits; short or invalid clipboard text surfaces a clear error.
- [ ] Numpad keys disable when not actionable (✓ at <6, ⌫ at empty).
- [ ] Wrong code → loading scrim with "Activating…" → error in red token + haptic + VO announcement.
- [ ] Right code → kiosk_session cookie + transition to idle.
- [ ] Cookie persists across cold launch (per `KioskStore`).
- [ ] Text sizing and contrast — on iPad, activation guidance, code boxes, idle clock/date, stats, event rows, active checkouts, and roster names remain readable at default and Larger Text settings without clipping critical text.

### Idle screen

- [ ] Clock typography — idle clock renders in a large monospaced SF face so seconds do not shift the layout.
- [ ] Live stats (Items Out / Checkouts / Overdue), animated counts.
- [ ] Stat cards are tappable: Items Out shows asset name/image rows, Checkouts shows active checkout rows, and Overdue shows overdue checkout rows.
- [ ] Upcoming events with shift-count badges; tomorrow events show the weekday instead of being grouped under today.
- [ ] Event rows are tappable and open a read-only detail sheet with event time and assigned workers.
- [ ] Assigned workers render as avatar groups on event rows when shift assignments exist.
- [ ] Active checkouts show the checkout title beside the avatar, overdue red ring, "+N more" cue on truncated item lists.
- [ ] Avatar grid for "Select your name" — **real photos** (today's biggest idle fix), disambiguated names ("Erik R." when collisions).
- [ ] Header: kiosk name plus location, date, and "Updated Xs ago" stamp (orange when >5 min stale).
- [ ] Roster density fits 30+ users better than the first large-card grid.
- [ ] 30-second polling refreshes data automatically.
- [ ] Sleep mode, idle window — with no active checkouts/items out, no current or near events, and no booked/pending-pickup checkout windows, the idle screen dims into a near-black moving-clock sleep overlay.
- [ ] Sleep mode, night hours — between 10 PM and 6 AM, the idle screen enters the same near-black moving-clock overlay even if the normal idle layout recently loaded.
- [ ] DEBUG night-mode toggle — tap the moon icon in the top-right corner of the idle screen to force the sleep overlay on; tap it again to return to the normal idle screen.
- [ ] Pixel shift — leave sleep mode visible for at least 90 seconds; the dim clock cluster changes position every 30 seconds.
- [ ] Tap to wake — tap the sleep overlay. Full kiosk idle UI returns and remains usable for roughly 10 minutes before sleep mode can resume.

### Student hub

- [ ] Top bar: back button (returns to roster), avatar (real photo today), name, role.
- [ ] Action panel (left): Checkout Gear (always), Pickup buttons (if pending pickups), Return buttons (if active checkouts), each with item summary "{N items: A, B} · +N more" (today's fix).
- [ ] Status panel (right): "Coming Up" section showing upcoming reservations only (today's dedupe fix). Empty state "Nothing reserved this week."
- [ ] Server error → wifi.exclamationmark + Retry recovery surface.

### Checkout flow

- [ ] HID scanner test (real Bluetooth scanner) — scan a sticker, item appears in cart with success haptic.
- [ ] **Remove from cart** — trailing X button on each row (today's fix). Haptic warning.
- [ ] Camera fallback button → KioskBarcodeCameraView. **In-camera feedback banner** appears for each scan (today's fix).
- [ ] **Scan-during-complete race guard** — scan an item, tap Complete, immediately scan another → "Hold on — finishing checkout" feedback (today's fix).
- [ ] **Auto-scroll to latest scan** in cart panel.
- [ ] Cart count animates (`contentTransition(.numericText())`).
- [ ] Discard cart confirmation when going back with non-empty cart.
- [ ] Server error surfaces with humanized message (today's fix replaces "Scan failed" / "Checkout failed").
- [ ] Complete → Success screen.

### Pickup flow

- [ ] Open pending pickup from operator hub.
- [ ] Scan each item; ring fills; checklist updates.
- [ ] **In-camera feedback** + auto-scroll to last confirmed.
- [ ] **Race guard** — scan during confirm → "Hold on — confirming pickup."
- [ ] **P0 — Confirm pickup error path** (today's fix): trigger a 409 (e.g., complete pickup on web first, then try to confirm on iOS). Error must surface with humanized message, NOT a phantom success. Booking still PENDING_PICKUP server-side.
- [ ] Complete → Success.

### Return flow

- [ ] Open active checkout for return.
- [ ] Scan items; ring fills; rows strikethrough.
- [ ] Already-returned items pre-populate (`item.returned` from server).
- [ ] **Server-authoritative success counts** (today's fix) — message reads "All N items returned" / "X of N items returned" using server values, not local optimistic.
- [ ] **P0 — Complete checkin error path** — trigger a 5xx or 409, verify error surfaces (NOT phantom success).

### Success screen

- [ ] Bouncing checkmark.
- [ ] Success message reflects the action ("Checkout complete!" / "Pickup confirmed!" / "All N items returned. Thanks!").
- [ ] Done button → immediate return to idle (today's fix).
- [ ] Tap-anywhere → also returns to idle.
- [ ] If left alone, 5-second countdown auto-routes to idle. monospacedDigit prevents jitter.
- [ ] Inactivity timer resets on transition.

### Inactivity warning

- [ ] Pick a name, scan items, leave for 4:30. "Still here?" overlay appears.
- [ ] Tap Stay → warning dismisses, cart preserved.
- [ ] Wait full 5:00 → routes to idle, cart preserved (per audit fix). Re-pick name → cart restores.

### Kiosk admin deactivation (today's drift-detector P0)

- [ ] Kiosk active + on idle screen.
- [ ] On web `/settings/kiosk-devices`, deactivate this kiosk device.
- [ ] Within 60 seconds (heartbeat interval), the iPad should detect the 401 and route back to activation screen with cleared session. **Pre-fix this didn't work** because `kioskHeartbeat()` swallowed 401 silently. [today's drift-detector P0]

---

## Regression check — today's specific fixes

Quick spot-checks of the highest-risk fixes from today's audit sprint:

| Fix                                        | Test                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Kiosk pickup confirm 401 propagation       | Trigger 409 on web → confirm on iOS → error surfaces, NOT success                     |
| Kiosk return complete 401 propagation      | Same shape as above                                                                   |
| Kiosk heartbeat 401 detection              | Admin-deactivate kiosk → within 60s, kiosk drops to activation                       |
| Profile push channels mute                 | Pause 1 hour → trigger server notification → no banner / inbox still gets it          |
| Profile theme override                     | Set Dark → all non-kiosk surfaces dark even when system is light                      |
| Item detail Reserve CTA                    | Tap from item → CreateBookingSheet prefilled → save → pushed onto nav stack          |
| Notifications asset-tap routing            | Asset-related notification → tap → asset detail opens                                 |
| Global search stale-write race             | Type fast on cellular → final results match final query, not earlier prefix          |
| Booking detail ownership gate              | STUDENT views someone else's booking → no Cancel/Extend buttons                       |
| Trade board status tokens                  | Open / Claimed / Cancelled chips render in dark mode using statusText/statusBackground |
| AssignStudentSheet primary-area badge      | Pick a video shift → assign sheet → student with primaryArea VIDEO shows tinted badge |
| Title-case shift areas                     | Schedule → event detail → "Video" / "Photo" headers, NOT "VIDEO"                      |

---

## What this plan does NOT cover

- Performance under load (large rosters, large item catalogs). Use the dashboard data fixtures in `prisma/seed.mjs` if you need to populate.
- Long-running background fetches.
- Specific iOS version compatibility below each app target's deployment target. Both the full `Wisconsin` app and the dedicated kiosk-only `WisconsinKiosk` iPad target are iOS 26.0+.
- iPad split-screen / Stage Manager and portrait rotation for the kiosk: wide scenes should keep scan/content rails; compact scenes should stack the rail beneath the primary workflow.
- App Store metadata / TestFlight invitation flow.

When any of these matter, layer in additional surface-specific testing.

---

## Sign-off

After running this plan end-to-end:

- [ ] All checkboxes ticked OR explicitly noted as "skip — feature not shipped on this branch."
- [ ] Open issues filed for any failed checkboxes with the surface + step + observed behavior.
- [ ] If running before a TestFlight build, confirm the build number was bumped.
- [ ] Tester name + date + device model recorded at the bottom of this section in the PR description.
