# Student Field Readiness Plan

> **Closed 2026-10-06** in the open-task audit: remaining boxes are stale (work shipped in source or superseded). Evidence is in the audit report; nothing here is open.

Created: 2026-06-03

## Goal

Improve the student field workflow across iOS and mobile-adjacent web contracts so the next action stays obvious: overdue, due today, awaiting pickup, reservations, shifts, item lookup, and scan recovery.

## Source Audit

- `AGENTS.md`: plan first, thin slices, full-file reads before edits, verify before done, sync docs on shipped functionality.
- `docs/AREA_MOBILE.md`: native Home is an action queue; scan stays one tap away; student flows prioritize owned checkouts, reservations, due/overdue work, and lookup.
- `docs/AREA_CHECKOUTS.md`: checkout custody pickup/return remains kiosk-owned; `PENDING_PICKUP` is active daily work, not a reservation.
- `docs/AREA_KIOSK.md`: iOS kiosk is canonical; camera and typed fallback must keep using the same scan APIs.
- `docs/AREA_RESERVATIONS.md`: reservation conversion creates `PENDING_PICKUP`; custody begins only at kiosk pickup.
- `docs/AREA_SHIFTS.md`: iOS schedule should support student shift request/trade execution without cloning web power filters.
- `docs/AREA_ITEMS.md` and `docs/AREA_SCAN.md`: item lookup is tag-first, app scan is lookup-only, and booking custody scans stay in kiosk flows.
- `docs/IOS_PATTERNS.md`: status tokens, centralized haptics, no silent `try?`, button-based row actions, combined accessibility labels, and defensive API handling.
- `docs/IOS_DEVICE_WALKTHROUGH.md`: manual QA must cover Home action queue, Scan tab, kiosk pickup/return recovery, network instability, VoiceOver, Dynamic Type, and scanner hardware.
- `docs/DECISIONS.md`: mobile is student-first, status is derived, bookings are unified, and audit/custody boundaries are product constraints.
- `docs/GAPS_AND_RISKS.md`: remaining mobile gaps are expected power-user parity gaps, not blockers; do not revive desktop filters unless they improve field execution.
- `tasks/audit-*-ios.md`: current iOS surfaces are broadly ready; remaining value is row action clarity, scan recovery visibility, and keeping source-level verification current.
- Current source reviewed: `ios/Wisconsin/Views/HomeView.swift`, `ios/Wisconsin/Models/DashboardModels.swift`, `ios/Wisconsin/Core/APIClient.swift`, `ios/Wisconsin/Views/AppTabView.swift`, `ios/Wisconsin/Views/ScanView.swift`, `ios/Wisconsin/Kiosk/KioskBarcodeCameraView.swift`, `ios/Wisconsin/Kiosk/KioskModels.swift`, `src/app/api/dashboard/route.ts`, `prisma/schema.prisma`.

## Product Constraints

- Keep iOS action-first. Do not port desktop density controls, historical filters, sort controls, or reporting views unless they shorten a field task.
- Keep scan one tap away through the tab bar and make Home point to scan as the recovery path when the user is between tasks.
- Do not add phone checkout or return scanning. Kiosk pickup/return is the custody boundary.
- Any new native-decoded API field must be additive and optional or defaulted because production may lag local API changes.
- If API payloads change, keep reads bounded, batched, and Vercel-safe. No N+1.

## Slice Plan

### Slice 1: Home Queue Action Clarity

- [x] Replace generic queue row action labels with task-specific labels: `Review overdue`, `Return today`, `Pick up`, `Open reservation`, `Prep shift`, or equivalent concise iOS labels.
- [x] Stop repeating the signed-in student name as the default subtitle for personal Home rows. Use location, item count, or timing context when available.
- [x] Add a small persistent lookup/recovery affordance under the queue or all-clear state that switches to the Scan tab without duplicating a scan card on every row.
- [x] Preserve current priority order: overdue, due today, awaiting pickup, upcoming reservations, event-linked shift/gear.
- [x] Avoid API changes unless current fields cannot express the needed copy.

### Slice 1b: Active Checkouts Contract Alignment

- [x] Align iOS active checkouts with the documented checkout work queue by requesting both `OPEN` and `PENDING_PICKUP`.
- [x] Keep the change client-side because `/api/checkouts` already supports `status_in=OPEN,PENDING_PICKUP`.
- [x] Preserve kiosk pickup/return custody. This only changes list visibility.

### Slice 1c: Shift Gear Contract Alignment

- [x] Align `/api/my-shifts` gear context with dashboard event work by including `PENDING_PICKUP`, `BookingEvent`, and `shiftAssignmentId` links.
- [x] Return `pickup_ready` when the best linked gear booking is awaiting kiosk pickup.
- [x] Label `pickup_ready` as `Gear ready` in native Schedule.
- [x] Return the real dashboard event-work `allDay` value instead of hardcoding `false`.

### Slice 2: Defensive Dashboard Contract

- [x] Audit `DashboardData` required fields against `/api/dashboard` and make newly or historically additive fields decode with defaults where production skew is plausible.
- [ ] If Home needs row metadata such as item thumbnails or pickup location copy, add it additively to `/api/dashboard` and decode defensively.
- [x] Add focused TypeScript coverage only if the API payload changes.

### Slice 3: Scan Recovery Verification

- [x] Re-check Scan tab and kiosk camera/manual fallback source paths for state preservation after camera denied, unsupported camera, typed code, scan failure, duplicate scan, and retry.
- [x] Patch only source-verifiable gaps. Do not loosen custody validation or create manual override routes.
- [x] Keep typed fallback on the exact lookup or kiosk scan APIs already documented.

### Slice 4: Source-Level Surface Verification

- [x] Re-run iOS drift checks after Swift edits.
- [x] Use XcodeBuildMCP simulator build for the native app.
- [x] Perform source-level verification for touched iOS screens; simulator UI verification if the build tools expose a reliable screenshot path.
- [x] If API changes land, run focused web tests, `npx tsc --noEmit`, and `npx next build`.

### Slice 5: Doc Sync and Review

- [x] Update `docs/AREA_MOBILE.md` change log for any shipped iOS Home/Scan behavior.
- [x] Update relevant feature area docs if API or kiosk/checkout contracts change.
- [x] Update `docs/GAPS_AND_RISKS.md` only if this closes or opens a real gap.
- [x] Add a review section here with final files, verification commands, and residual hardware-only QA.

## Acceptance Criteria

- [x] A student can understand the next action from Home without reading desktop-style filters.
- [x] Overdue and due-today work remain visibly urgent and sorted before lower-priority work.
- [x] Awaiting pickup reads as kiosk pickup work, not completed/success work.
- [x] Event-linked shifts and gear remain composed as one field task when the payload supports it.
- [x] Scan lookup remains one tap away and the recovery path is visible when there is no immediate queue work.
- [x] Camera/scanner failure recovery does not lose workflow state.
- [x] New native-decoded fields tolerate missing production fields.

## Verification Plan

- [x] `npm run drift:ios`
- [x] XcodeBuildMCP simulator build for `ios/Wisconsin.xcodeproj`, scheme `Wisconsin`, iPhone 17 Pro simulator
- [x] Source-level verification for touched Swift screens
- [x] If API payload changes: focused web tests for changed route contracts
- [x] If API payload changes: `npx tsc --noEmit`
- [x] If API payload changes: `npx next build`
- [x] `git diff --check`

## Review

### Implemented

- `ios/Wisconsin/Views/HomeView.swift`: Next Up rows now show visible task labels, personal row subtitles use location/item count context, event rows say `Reserve gear` or `Prep shift`, and Home includes one lookup recovery affordance that switches to Scan without implying custody scanning.
- `ios/Wisconsin/Core/APIClient.swift`: active Checkouts now request `status_in=OPEN,PENDING_PICKUP`, matching the web/default checkout work queue.
- `src/app/api/my-shifts/route.ts`: My Shifts gear context now includes pending-pickup gear and the same event-link paths used by dashboard event work.
- `src/app/api/dashboard/route.ts`: event-work payloads now return actual `allDay`.
- `ios/Wisconsin/Models/ScheduleModels.swift`: `pickup_ready` renders as `Gear ready`.
- `tests/student-field-contracts.test.ts`: added source contract checks for the iOS checkout query, my-shifts gear linkage, and dashboard event-work `allDay`.
- `docs/AREA_MOBILE.md`: recorded the iOS student field readiness slice.
- `docs/AREA_CHECKOUTS.md`: recorded the native active-checkouts contract alignment.
- `docs/AREA_SHIFTS.md`: recorded the My Shifts and dashboard event-work contract alignment.

### Verification Results

- Passed `npm run test -- tests/student-field-contracts.test.ts tests/booking-list-status-query.test.ts` with 7 tests.
- Passed `npm run drift:ios`.
- Passed `npm run audit:ios:gaps`.
- Passed `npx tsc --noEmit`.
- Passed `npx next build`.
- Passed XcodeBuildMCP simulator build for `Wisconsin` Debug on iPhone 17 Pro, iOS 26.5.
- Passed `git diff --check`.

### Residual QA

- Real-device camera/DataScanner, haptics, APNs, VoiceOver, Dynamic Type, Bluetooth HID scanner, and unstable-network verification remain hardware-only per `docs/IOS_DEVICE_WALKTHROUGH.md`.
