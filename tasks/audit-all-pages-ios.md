# Audit: all pages and sheets (iOS) - 2026-07-03

**Status:** ACTIVE
**Scope correction:** all native Wisconsin iOS pages, pushed detail screens, sheets, confirmation flows, scanner/search covers, profile/settings drill-downs, dev tools, and kiosk-only screens.
**Ship bar:** student-friendly, fully functional for core flows, zero hiccups in front of a class.

## Current Verification Baseline

- [x] `npm run drift:ios` passed after the first screenshot batch.
- [x] `npm run audit:ios:gaps` passed with 44/44 audit-worthy surfaces covered and 0 missing audits. It still reports 7 pre-existing unregistered extracted kiosk/create-booking files.
- [x] `npm run verify:docs` passed after Home and Schedule changes.
- [x] XcodeBuildMCP `build_run_sim` passed for the main `Wisconsin` app after Home and Schedule changes, with no warnings.

## Inventory Method

- Source inventory: `rg --files ios/Wisconsin | rg '\.swift$'`
- Surface inventory: `rg -n "struct .*: View|sheet\(|fullScreenCover\(|popover\(|confirmationDialog\(|NavigationLink|navigationDestination|Tab\(" ios/Wisconsin`
- Audit history: `find tasks -maxdepth 1 -name 'audit-*-ios*.md' -print | sort`
- Runtime proof: XcodeBuildMCP screenshot and runtime UI snapshot per reachable surface.

## Main App Tabs And Primary Screens

- [x] Home / Dashboard
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_cec62d2f-c50e-49c6-bbc3-2d6ca6cce6c7.jpg`
  - Fix shipped: Home hero now exposes one date plus greeting accessibility label instead of duplicate child text nodes.
  - Files: `ios/Wisconsin/Views/HomeView.swift`, `tasks/audit-home-ios.md`
- [x] Schedule list
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_20905039-75d4-492c-a1fb-754a7049d965.jpg`
  - Fix shipped: all-day my-shift rows now announce `All day` and visible multi-day segment instead of midnight event times.
  - Files: `ios/Wisconsin/Views/ScheduleView.swift`, `tasks/audit-schedule-list-ios.md`
- [x] Schedule calendar mode
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_0004286d-baa6-48bb-9a4c-3af60a3d53a2.jpg`
  - Result: clean. Native month grid exposes event-count labels, today state, month navigation, and legend without overlapping the tab bar.
  - Files: `ios/Wisconsin/Views/ScheduleView.swift`, `tasks/audit-schedule-ios.md`
- [x] Schedule filters sheet
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_5e124013-7008-4cf0-b6da-26a0cd549f78.jpg`
  - Result: clean. Medium sheet uses native Done, toggles, segmented venue filter, and sport menu.
  - Files: `ios/Wisconsin/Views/ScheduleView.swift`, `tasks/audit-schedule-ios.md`
- [x] Trade Board sheet
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_aedc740d-fd56-467a-83f6-4bc8c7b7edbd.jpg`
  - Result: clean in current empty state. Post Trade remains visible, open work copy is clear, and no stale approval-review sections appear.
  - Files: `ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift`, `tasks/audit-schedule-ios.md`
- [x] Post Trade sheet
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_363751c2-141e-4620-a986-d59d9d8d86ac.jpg`
  - Result: clean for current no-eligible-shifts state. The sheet shows recovery copy and Cancel without exposing a false submit action.
  - Files: `ios/Wisconsin/Views/Schedule/PostTradeSheet.swift`, `tasks/audit-schedule-ios.md`
- [x] Event Detail sheet
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_2bab9796-7560-4f7e-95de-4525d8c1a4e6.jpg`
  - Result: clean. All-day range is date-only, event context leads, reserve action is inline, and crew rows remain readable at iPhone width.
  - Files: `ios/Wisconsin/Views/EventDetailSheet.swift`, `tasks/audit-schedule-ios.md`
- [ ] Assign Student sheet
- [x] Add Shift sheet
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_f9a640f7-1f43-4d45-88c7-286040ad11b4.jpg`
  - Fix shipped: all-day event defaults now render as one date-only all-day window instead of midnight call/end rows unless staff enables custom timing.
  - Files: `ios/Wisconsin/Views/Schedule/AddShiftSheet.swift`, `tasks/audit-schedule-ios.md`
- [ ] Edit Shift Times sheet
- [x] Bookings / My Gear list
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_e45515c8-a2b3-47a9-a4d5-314427e60f6c.jpg`
  - Fix shipped: default empty All scope now shows a single centered `New Reservation` action instead of duplicating it in the toolbar.
  - Files: `ios/Wisconsin/Views/BookingsView.swift`, `tasks/audit-bookings-list-ios.md`
- [x] Booking Detail
  - Captured 2026-08-20 on iPhone 16 Pro, iOS 26.5, via `GT_PERFORMANCE_SCENARIO=booking-detail`. Served one canned open checkout with serialized gear, bulk gear, a linked event, and notes.
- [x] Edit Booking sheet
  - Captured 2026-08-20 on iPhone 16 Pro, iOS 26.5, via `GT_PERFORMANCE_SCENARIO=booking-edit`.
- [x] Extend Booking sheet
  - Captured 2026-08-20 on iPhone 16 Pro, iOS 26.5, via `GT_PERFORMANCE_SCENARIO=booking-extend`.
- [x] Cancel Booking confirmation
  - Captured 2026-08-20 on iPhone 16 Pro, iOS 26.5, via `GT_PERFORMANCE_SCENARIO=booking-cancel`. Seeded after load, because a confirmation dialog needs a state transition rather than a true initial value.
- [x] Create Booking sheet, Details step
  - Screenshots: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_be781ccb-539a-46a8-9157-454cc6a581be.jpg`, `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_42458b1d-e7e6-4b76-ae41-ff4f3c8faf55.jpg`, `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_727630f0-9885-4808-841f-db79be8dd194.jpg`
  - Fix shipped: shared picker rows no longer force short labels into a 40-point column, linked all-day events now show date-only `All day` header copy instead of midnight times across selected and prefilled event paths, and picker rows expose full-width hit targets.
  - Files: `ios/Wisconsin/Views/CreateBookingSheet.swift`, `ios/Wisconsin/Views/CreateBooking/CreateBookingFormRows.swift`, `ios/Wisconsin/Views/CreateBooking/CreateBookingPickers.swift`, `ios/Wisconsin/Views/CreateBooking/CreateBookingViewModel.swift`, `tasks/audit-create-booking-ios.md`
- [x] Create Booking event picker
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_3153084f-d085-4c84-a56f-92b445250d55.jpg`
  - Result: clean. Native searchable pushed list has clear title/back behavior, readable event rows, and explicit selected-state affordance.
  - Files: `ios/Wisconsin/Views/CreateBooking/CreateBookingEventViews.swift`, `tasks/audit-create-booking-ios.md`
- [x] Create Booking pickup picker
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_c13fbb3e-3c0f-4a0d-ae44-8980e95fa9c7.jpg`
  - Result: clean. Native pushed picker uses clear title/back behavior, simple 44-point rows, and a system search field.
  - Files: `ios/Wisconsin/Views/CreateBooking/CreateBookingPickers.swift`, `tasks/audit-create-booking-ios.md`
- [x] Create Booking sheet, Equipment step
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_1832e80e-a63e-4352-b3ec-2e2582af6855.jpg`
  - Fix shipped: attachment categories are hidden from reservation equipment browsing, even when stored category names still contain `Accessories`.
  - Files: `ios/Wisconsin/Views/CreateBooking/CreateBookingViewModel.swift`, `ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentPicker.swift`, `tasks/audit-create-booking-ios.md`
- [x] Create Booking cart sheet
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_c8210064-1527-4329-8815-eb2938572791.jpg`
  - Result: clean. Medium-detent drawer has a native title/done rhythm, selected item thumbnail/title/subtitle, and a visible remove action.
  - Files: `ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentPicker.swift`, `ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentRows.swift`, `tasks/audit-create-booking-ios.md`
- [x] Create Booking QR scanner cover
  - Captured 2026-08-20 via `GT_PERFORMANCE_SCENARIO=create-booking-scanner`. A simulator has no camera, so this is the permission-priming state a first-time user meets, not a live viewfinder. The viewfinder itself still needs a device.
- [x] Create Booking Confirm step
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_93ea3475-ab44-4f38-8d60-0d3b3a4cbdba.jpg`
  - Fix shipped: linked all-day reservations show date-only pickup window and `Return after event` instead of midnight pickup/return timestamps.
  - Files: `ios/Wisconsin/Views/CreateBookingSheet.swift`, `tasks/audit-create-booking-ios.md`
- [x] Create Booking discard confirmation
  - Runtime snapshot: `Discard reservation?`, message `Your changes will be lost.`, destructive `Discard`.
  - Result: clean. Confirmation appears only after unsaved input and keeps the destructive action explicit.
  - Files: `ios/Wisconsin/Views/CreateBookingSheet.swift`, `tasks/audit-create-booking-ios.md`
- [x] More directory
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_0e88725a-cad3-4cbc-8f15-5942231d3cd3.jpg`
  - Result: clean. Single `More` title, four native destination rows, no duplicate Browse header.
  - Files: `ios/Wisconsin/Views/BrowseView.swift`, `tasks/audit-browse-ios.md`
- [x] Items list
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_d244984a-8902-4b02-a90b-07897b055e03.jpg`
  - Result: clean. Native toolbar filters/sort are visible, rows expose tag/model/location/status, and regular browsing keeps attachments hidden.
  - Files: `ios/Wisconsin/Views/ItemsView.swift`, `tasks/audit-items-list-ios.md`
- [x] Item Detail
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_4c06d113-c53c-4962-b37b-903a41398c84.jpg`
  - Fix shipped: bundled child rows use current `Attachments` UI and VoiceOver language. Raw detail category values still reflect backend taxonomy, so standalone items like a teleconverter may still show `Category: Accessories`.
  - Files: `ios/Wisconsin/Views/ItemDetailView.swift`, `tasks/audit-item-detail-ios.md`
- [x] Edit Asset sheet
  - Captured 2026-08-20 via `GT_PERFORMANCE_SCENARIO=item-edit`, served one canned camera body at `/api/assets/{id}`.
- [x] Item image zoom cover
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_6045a110-481b-485e-8c1e-09fa727cf417.jpg`
  - Result: clean. Full-screen viewer uses a black backdrop, keeps the catalog image uncropped, and exposes an explicit `Close photo` button.
  - Files: `ios/Wisconsin/Views/ItemDetailView.swift`, `ios/Wisconsin/Core/Brand.swift` (`ZoomableImageViewer` lives here, not its own file — corrected 2026-07-08)
- [x] Guides list
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_205d7226-3cbb-4cab-8c6b-1cfb971cd593.jpg`
  - Fix shipped: Guide rows expose compact VoiceOver labels instead of full Markdown-derived summaries.
  - Files: `ios/Wisconsin/Views/GuidesView.swift`, `tasks/audit-guides-ios.md`
- [x] Guide reader
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_637461c1-bdd6-42be-b625-bf7ba23d9139.jpg`
  - Fix shipped: ordered Markdown runs render continuous numbers and the pushed article hides the tab bar so bottom chrome does not cover reader text.
  - Files: `ios/Wisconsin/Views/GuidesView.swift`, `tasks/audit-guides-ios.md`
- [x] Licenses list
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_c342b030-681b-4dd5-8f55-1279740f7c21.jpg`
  - Result: clean. Active claim, copy/return actions, pool rows, slot counts, and staff/admin code visibility match the documented self-service scope.
  - Files: `ios/Wisconsin/Views/LicensesView.swift`, `tasks/audit-licenses-ios.md`
- [x] Claim/return license confirmations
  - Runtime snapshot: `Return Photo Mechanic license?` with explanatory copy and destructive `Return License`; mutation was not confirmed. Claim confirmation was not reachable because the live user already has an active claim, and claim buttons are correctly hidden in that state.
  - Result: clean. Destructive return is confirmed; claim remains single-license guarded.
  - Files: `ios/Wisconsin/Views/LicensesView.swift`, `tasks/audit-licenses-ios.md`
- [x] Users list
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_1ee16b49-ecb3-478c-bb62-edcd18ef54c3.jpg`
  - Fix shipped: list rows no longer repeat routine location copy such as `Camp Randall`; they keep role, title/year, and primary area.
  - Files: `ios/Wisconsin/Views/UsersView.swift`, `tasks/audit-users-ios.md`
- [x] User Detail
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_32f3681c-88ff-4fdb-b6b6-3450f2f370af.jpg`
  - Result: clean. Profile header omits location, preserves avatar/email/role/joined metadata, and keeps badges plus booking cards readable.
  - Files: `ios/Wisconsin/Views/UserDetailView.swift`, `tasks/audit-users-ios.md`
- [x] Badge Gallery sheet
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_fc880878-f579-477b-a470-c18bfa10e682.jpg`
  - Result: clean. Large sheet uses native Done action, summary counts, horizontal filter chips, and readable badge tiles.
  - Files: `ios/Wisconsin/Views/UserDetailView.swift`, `tasks/audit-users-ios.md`
- [x] Badge Detail sheet
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_e2be5e5c-b60d-498b-9429-acd77a0fbb87.jpg`
  - Result: clean. Nested sheet keeps artifact/title/description first, has an explicit Done action, and scrolls the metric grid.
  - Files: `ios/Wisconsin/Views/UserDetailView.swift`, `tasks/audit-users-ios.md`
- [x] Search tab
  - Screenshots: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_bd11aa33-51b7-4291-8bea-64728d1d0b44.jpg`, `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_c23366e4-8b5c-4ec1-96df-48ae068250ee.jpg`
  - Fix shipped: typed item/family results filter attachment/accessory categories while QR/direct scan lookup stays able to resolve child attachments.
  - Files: `ios/Wisconsin/Views/Search/GlobalSearchSheet.swift`, `ios/Wisconsin/Core/SearchService.swift`, `tasks/audit-search-ios.md`
- [x] Search scanner cover
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_a057ded1-fb07-4631-9e5d-c3ca8a2b5cf1.jpg`
  - Result: clean for Simulator/unsupported-camera path. Scanner cover shows close affordance plus typed-code recovery; camera-authorized hardware path remains covered by existing source audit.
  - Files: `ios/Wisconsin/Views/Search/QRScannerSheet.swift`, `tasks/audit-scan-ios.md`
- [x] Search result destinations
  - Captured 2026-08-20 via `GT_PERFORMANCE_SCENARIO=search`. All four fan-out endpoints are served, so the capture shows items, a reservation, a checkout, and people ranked into one list rather than a single result type.
- [x] QR scanner manual-entry sheet
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_95a10250-6bd7-4d5a-bfb5-cc8e52715702.jpg`
  - Fix shipped: unavailable scanner controls hide behind the typed-code sheet so the form no longer sits over a glowing fallback button.
  - Files: `ios/Wisconsin/Views/Search/QRScannerSheet.swift`, `ios/Wisconsin/Views/ScanView.swift`, `tasks/audit-scan-ios.md`
- [x] Notifications sheet
  - Covered by Notification Settings runtime surface and source ownership. The toolbar bell entry opens the same notification inbox/settings ownership path; no unread state mutation performed.
- [x] Profile / Settings hub
  - Screenshots: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_2fac7dd5-bb21-4dbb-9626-08d6aa891d3e.jpg`, `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_93a11174-5b9c-4a11-9f5c-fe419e930726.jpg`
  - Result: clean. Grouped native Settings hub shows account, schedule, directory, notifications, appearance, tools, app, and isolated sign-out sections.
  - Files: `ios/Wisconsin/Views/ProfileView.swift`, `tasks/audit-profile-ios.md`
- [x] Account Security settings
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_bbb035a9-10bd-4188-878a-d4a3de253645.jpg`
  - Result: clean. Native secure fields, show-password control, sign-out-other-devices switch, validation, and disabled submit state are present.
  - Files: `ios/Wisconsin/Views/AccountSecuritySettingsView.swift`, `tasks/audit-profile-ios.md`
- [x] Notification Settings
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_b381f487-b037-4fa6-9d08-7abc9f60c143.jpg`
  - Result: clean. Delivery status, pause chips, channel switches, and category toggles are native and readable; live preferences were not changed.
  - Files: `ios/Wisconsin/Views/NotificationSettingsView.swift`, `tasks/audit-profile-ios.md`
- [x] Push pre-prompt
  - Source-audited. Current Simulator/account has push already allowed, so the not-determined pre-prompt path is not runtime-reachable without resetting OS permission state.
  - Files: `ios/Wisconsin/Views/PushPrePromptView.swift`, `tasks/audit-profile-ios.md`
- [x] Availability list
  - Source-audited; current logged-in admin profile does not expose the student-scheduling-class entry.
  - Fix shipped: destructive availability swipe delete now requires confirmation.
  - Files: `ios/Wisconsin/Views/AvailabilityView.swift`, `tasks/audit-availability-ios.md`
- [x] Add Availability sheet
  - Source-audited; current logged-in admin profile does not expose the student-scheduling-class entry.
  - Result: clean source pass. Native Form uses pickers, date/time controls, optional label, validation, and disabled saving state.
  - Files: `ios/Wisconsin/Views/AvailabilityView.swift`, `tasks/audit-availability-ios.md`
- [x] Link Sticker Wizard
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_1be9e327-22f7-471b-864e-057bc1e08007.jpg`
  - Result: clean. Three-step staff/admin sheet opens with scanner unavailable fallback and manual entry; no link mutation performed.
  - Files: `ios/Wisconsin/Views/DevTools/LinkStickerWizard.swift`, `tasks/audit-link-sticker-wizard-ios.md`
- [x] Scanner Debugger
  - Screenshot: `/var/folders/_x/t6hvydvd77167wrmgclk3nc1bq8t3g/T/screenshot_optimized_e024c134-8832-47a4-a78e-d5f7e6a77569.jpg`
  - Result: clean. Large sheet shows HID readiness, raw/trimmed/lookup status rows, and typed fallback.
  - Files: `ios/Wisconsin/Views/DevTools/ScannerDebuggerView.swift`, `tasks/audit-scanner-debugger-ios.md`
- [x] Overdue Report
  - Source-audited. Current account has zero overdue bookings; Profile row is present and routes to `OverdueReportView`, though the runtime tap target did not push reliably from the current sheet scroll position.
  - Files: `ios/Wisconsin/Views/OverdueReportView.swift`, `tasks/audit-overdue-report-ios.md`
- [x] Login
  - Captured 2026-08-20 on iPhone 16 Pro, iOS 26.5, via `GT_PERFORMANCE_SCENARIO=login`. Signed-out screen, so it needs no session and no fixture payload.
- [x] Password Setup
  - Captured 2026-08-20 on iPhone 16 Pro, iOS 26.5, via `GT_PERFORMANCE_SCENARIO=password-setup`. Rendered with a fixture email; no credential is entered.
- [x] Scan legacy lookup screen, if still reachable
  - Resolved 2026-07-08 during Snow Leopard Slice 5/6: confirmed `ScanView.swift` (the old dedicated Scan tab this item was asking about) was fully unreachable — nothing instantiated it after the 2026-06-30 Search-tab migration. Deleted it; the live scanner is `Search/QRScannerSheet.swift` behind the Search tab. See `tasks/ios-snow-leopard-release-plan.md` and `tasks/audit-scan-ios.md`'s superseded note.

## Kiosk-Only Screens

- [x] Kiosk activation
  - Captured 2026-08-20 on iPad Pro 13-inch (M5), iOS 26.5, via `GT_KIOSK_SCENARIO=activation`.
- [x] Kiosk idle dashboard
  - Captured 2026-08-20 on iPad Pro 13-inch (M5), iOS 26.5, via `GT_KIOSK_SCENARIO=idle`.
- [x] Kiosk event detail sheet
  - Captured 2026-08-20 via `GT_KIOSK_SCENARIO=event-detail`, added the same day. That scenario is the only one whose dashboard fixture carries an event, so the idle capture is unchanged.
- [x] Kiosk active checkout detail sheet
  - Captured 2026-08-20 on iPad Pro 13-inch (M5), iOS 26.5, via `GT_KIOSK_SCENARIO=checkout-sheet`.
- [x] Kiosk student hub
  - Captured 2026-08-20 on iPad Pro 13-inch (M5), iOS 26.5, via `GT_KIOSK_SCENARIO=operator-hub`.
- [x] Kiosk checkout setup
  - Captured 2026-08-20 on iPad Pro 13-inch (M5), iOS 26.5, via `GT_KIOSK_SCENARIO=checkout-details, checkout-details-linked, keyboard-tip`.
- [x] Kiosk checkout scan mode
  - Captured 2026-08-20 on iPad Pro 13-inch (M5), iOS 26.5, via `GT_KIOSK_SCENARIO=scanning, scan-accepted`.
- [x] Kiosk checkout scanner help sheet
  - Captured 2026-08-20 via `GT_KIOSK_SCENARIO=scanner-help`, added the same day. The sheet is seeded open because it is reached only by tapping a control; it renders over the checkout details step rather than the scan step.
- [ ] Kiosk checkout camera sheet — needs a real camera; no simulator path.
- [x] Kiosk pickup
  - Captured 2026-08-20 on iPad Pro 13-inch (M5), iOS 26.5, via `GT_KIOSK_SCENARIO=pickup`.
- [ ] Kiosk pickup camera sheet — needs a real camera; no simulator path.
- [x] Kiosk return
  - Captured 2026-08-20 on iPad Pro 13-inch (M5), iOS 26.5, via `GT_KIOSK_SCENARIO=return, return-accepted`.
- [ ] Kiosk return camera sheet — needs a real camera; no simulator path.
- [x] Kiosk success
  - Captured 2026-08-20 on iPad Pro 13-inch (M5), iOS 26.5, via `GT_KIOSK_SCENARIO=badge`.
- [x] Kiosk sleep mode
  - Captured 2026-08-20 on iPad Pro 13-inch (M5), iOS 26.5, via `GT_KIOSK_SCENARIO=sleep`.
- [x] Kiosk inactivity warning overlay
  - Captured 2026-08-20 on iPad Pro 13-inch (M5), iOS 26.5, via `GT_KIOSK_SCENARIO=inactivity`.
- [x] Kiosk resume splash
  - Captured 2026-08-20 via `GT_KIOSK_SCENARIO=resume`, added the same day. Drives `KioskStore.isResuming` rather than a screen case.

## Active Findings And Fixes

### Fixed in this pass

- [x] Home hero accessibility duplication. Runtime snapshot previously exposed both a combined greeting and separate child text. `DashboardHero` now ignores children for accessibility and exposes one label with the visible date and greeting.
- [x] Schedule all-day my-shift row label. Runtime snapshot previously announced `Event 12:00 AM to 12:00 AM`; the row now announces `All day, Day n of m`.
- [x] Create Reservation details picker label wrap. Simulator screenshot showed `Pickup` splitting across two lines; shared form picker rows now keep labels to intrinsic one-line width and let values truncate.
- [x] Create Reservation all-day linked-event header. Selecting Football Media Day no longer renders `12:00 AM` times in the Details header; it uses date-only `All day` copy unless the user manually edits the window.
- [x] Create Reservation picker hit areas. Requester and pickup rows now make the full visible row tappable, matching native list-row expectations and the simulator runtime target.
- [x] Create Reservation attachment filtering. The Equipment step no longer shows attachment categories in browsing chips or result groups, even when the stored category label is `Accessories`.
- [x] Create Reservation review all-day copy. Confirm no longer renders `12:00 AM` pickup/return times for all-day event-linked reservations.
- [x] Item Detail attachment wording. The child bundle card now says `Attachments` and VoiceOver announces `Attachment`, while standalone backend category names remain unchanged.
- [x] Users list location cleanup. Native profile rows no longer repeat routine `Camp Randall` location context.
- [x] Guides reader polish. Ordered guide steps now render continuous numbers, guide rows use compact VoiceOver labels, and pushed article screens hide the tab bar.
- [x] Licenses runtime pass. Active-code self-service and return confirmation were verified without mutating the live license pool.
- [x] Search attachment filtering. The `fx3` typed query now returns camera bodies only and hides handle/attachment rows from normal Search.
- [x] Search scanner manual-entry polish. The unsupported-camera fallback no longer bleeds through the typed-code sheet.

### Next batch

1. Bookings list, Booking Detail, Edit Booking, Extend Booking, Create Booking. Closed 2026-10-16. Those screens were already captured. This pass adds the reservation edit flow and the checkout detail actions the web booking page offers: nudge, close without scan, force checkout, close remaining, transfer, shared or personal custody, and linked events. Extend stays the only bottom action. Checkout gear edits stay at the kiosk. Source contracts only; iPhone 18 Pro Max and authenticated device proof remain open.
2. More directory, Items, Item Detail, Guides, Licenses, Users, badges.
3. Search, scanner, notifications, profile/settings, availability, dev tools.
4. Kiosk-only screens under the `WisconsinKiosk` target.

## Sources Read For This Active Pass

- `docs/AREA_MOBILE.md`
- `docs/AREA_DASHBOARD.md`
- `docs/AREA_EVENTS.md`
- `docs/AREA_SHIFTS.md`
- `docs/DESIGN_LANGUAGE.md`
- `docs/DECISIONS.md`
- `docs/GAPS_AND_RISKS.md`
- `ios/Wisconsin/App/WisconsinApp.swift`
- `ios/Wisconsin/App/AppDelegate.swift`
- `ios/Wisconsin/Views/AppTabView.swift`
- `ios/Wisconsin/Views/HomeView.swift`
- `ios/Wisconsin/Views/ScheduleView.swift`
- `ios/Wisconsin/Views/ItemDetailView.swift`
- `ios/Wisconsin/Views/UsersView.swift`
- `ios/Wisconsin/Views/UserDetailView.swift`
- `ios/Wisconsin/Core/Brand.swift`
- `ios/Wisconsin/Views/GuidesView.swift`
- `ios/Wisconsin/Views/LicensesView.swift`
- `ios/Wisconsin/Views/Search/GlobalSearchSheet.swift`
- `ios/Wisconsin/Views/Search/QRScannerSheet.swift`
- `ios/Wisconsin/Views/ScanView.swift`
- `ios/Wisconsin/Core/SearchService.swift`
- `ios/Wisconsin/Models/DashboardModels.swift`
- `ios/Wisconsin/Models/ScheduleModels.swift`
- `ios/Wisconsin/Core/APIClient.swift`
- `ios/Wisconsin/Core/AppState.swift`
- `tasks/audit-home-ios.md`
- `tasks/audit-schedule-list-ios.md`
- `tasks/audit-schedule-ios.md`
- `tasks/audit-item-detail-ios.md`
- `tasks/audit-users-ios.md`
- `tasks/audit-guides-ios.md`
- `tasks/audit-licenses-ios.md`
- `tasks/audit-search-ios.md`
- `tasks/audit-scan-ios.md`

## 2026-08-20 Fixture Harness Extension

Six more main-app screens were captured without an account existing anywhere. The blocker recorded against these rows was "needs a signed-in session"; the answer was to extend `PerformanceTestHarness` rather than to provision credentials, which keeps captures repeatable, offline, and free of any real identity.

- `login` and `password-setup` render the signed-out screens directly. Neither needs a session or a fixture payload, so they were only ever blocked by nobody trying.
- `booking-detail` serves one canned open checkout through `BookingFixtureAPI` at `/api/bookings/{id}`, sized to fill every block the screen renders: requester, location, serialized and bulk gear, a linked event, notes, and `allowedActions`.
- `booking-extend`, `booking-edit`, and `booking-cancel` reuse that same fixture and differ only in which sheet is seeded open, via `AppRuntimeMode.CaptureSeed`. That enum is `false` outside DEBUG, so release builds carry none of it.

Two things worth carrying forward:

- A `confirmationDialog` will not present from a `true` initial value; it needs a state transition. The cancel capture flips its flag after `loadBooking()` finishes instead. `.sheet` has no such problem, which is why Extend and Edit work as plain initial state.
- No account was created and no password was entered to produce any of these. That is the point of the harness, not a limitation of it.

Remaining main-app rows are Assign Student, Edit Shift Times, Create Booking QR scanner cover, Edit Asset, and Search result destinations. The first two need Schedule event context, the last three need composer or search state; all are the same shape of work as the booking slice above.

### Follow-on 2026-08-20

Two more rows closed the same way. `item-edit` serves a canned asset and seeds `ItemDetailView.showEdit`; `create-booking-scanner` seeds the composer's QR cover.

The scanner seed had to move from an initial value to an `onAppear` transition, because `tests/ios-create-booking-picker-parity.test.ts` asserts the literal `@State private var showScanner = false` to guard that the cover starts closed. The contract is right and was left alone. That is now twice this pattern has come up -- the kiosk idle load and this -- so prefer a transition over a seeded initial value whenever the surface has a source contract.

Three main-app rows remain, each needing more fixture surface than a single payload:

- **Assign Student sheet** -- four endpoints: `workingScheduleCandidateScores`, `shiftCandidateScores`, `shiftConflicts`, and `users`. The sheet also takes eleven constructor values, all plain, so the harness wrapper is trivial once the endpoints exist.
- **Edit Shift Times sheet** -- lives inside `EventDetailSheet` and needs a working-copy event context rather than a standalone payload.
- **Search result destinations** -- `SearchService` fans out to `/api/assets`, `/api/reservations`, `/api/checkouts`, and `/api/users`. The last is already served and the middle two can reuse the `BookingFixtureAPI` shape, so this is the cheapest of the three.

### Search capture note 2026-08-20

`SearchFixtureAPI` answers `/api/assets`, `/api/reservations`, and `/api/checkouts`; `/api/users` was already served and is reused. All four match the same query on purpose, because a search returning one kind of result does not exercise the ranking this screen exists to show.

Two capture-only details worth knowing before reusing this scenario:

- The query is typed into `query` on appear rather than seeded as an initial value, so the debounce and the real result path run exactly as they do for a person typing.
- Focus is dropped 2.5 seconds later, because the software keyboard otherwise covers the Checkouts and People sections, which are the point of this row. The trade is that the committed query text is no longer visible in the collapsed search field. The destinations were judged the subject; if a future capture needs the query text on screen, keep focus and accept a shorter list.

The simulator's continuous-path keyboard tutorial also covered the results on first run. `xcrun simctl spawn <udid> defaults write com.apple.Preferences DidShowContinuousPathIntroduction -bool true` clears it, and is worth running on any fresh simulator before a capture pass.
