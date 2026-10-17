# iOS ↔ web parity

Last updated: 2026-10-17

This is the handoff for the next native slice. Compare the website's pages and staff actions with the iPhone app under `ios/`. Count a row as covered when it is on `main` or in an open pull request listed below. Do not edit files those pull requests already change unless the slice cannot exist without a shared file (`BrowseView.swift`, `APIClient.swift`, `project.pbxproj`, `src/lib/releases.json`, `docs/AREA_MOBILE.md`).

Open, and off limits for file overlap:

- #502 shared software logins (`LicensesView.swift` and the software models)
- #503 Madison hours, charts, and exports (item insight charts, schedule export, profile hours)
- #504 iPhone browse hardening (also edits `src/lib/releases.json`, `docs/AREA_MOBILE.md`, and `docs/GAPS_AND_RISKS.md`)
- #497, #486, #485, and #484 Users to Staff renaming and role tabs
- #494 Budget
- #488 Photo Mechanic licenses redesign
- #478 Photo Frame on `/apps` (also edits `src/lib/releases.json`)

Reports, blasts, events, kits, accountability, brand assets, UA Gear, and the team badge shelf are already on `main`.

## How to pick

Take the first item under **Missing** whose blocked note is clear. Keep one screen to one main action. Use the existing `/api/*` route and its validation. Leave control-room work in **Intentionally web-only**.

## Covered

- [x] Home action queue (personal overdue, due today, pending pickup, upcoming reservations, next shift)
- [x] Schedule: week list, event detail, claim, trade board, assign, add shift, availability, calendar feed
- [x] Bookings list and detail, including create reservation, edit, extend, cancel, re-reserve, and the checkout actions that stay off the kiosk.
- [x] Search, including camera scan
- [x] Items list and item detail: reserve, needs maintenance, attachments, booking history
- [x] Scoreboard, including a person's record
- [x] Events directory: upcoming and past 30 days, linked bookings and gear, Open in Schedule (#487)
- [x] Guides reader
- [x] Blasts history after dismiss (#489)
- [x] Photo Mechanic licenses: claim, copy, return. The redesign is #488; do not edit those files.
- [x] Users directory and person screen, including that person's badges and availability. The Users→Staff rename is #484 and #486; do not edit those files.
- [x] Reports: overdue, plus utilization, checkouts, scans, missing units, badges, and owner usage (#490)
- [x] Notifications inbox, notification settings, account security, passkeys, theme, sign out
- [x] Welcome and profile completion
- [x] Widgets, Live Activity, and Home Screen quick actions
- [x] Kiosk custody (separate iPad app): checkout, pickup, return
- [x] Accountability: this year or all time, three sorts, name search, personal standing, open the checkout. Location, incident state, active-user filters, the continuous on-time bar, CSV, and exclusion edits stay on the web.
- [x] Brand assets: folders, search, and opening a logo or PDF. Favorites, folder create, upload, and version restore stay on the web.
- [x] UA Gear, for a participant. Admin roster, deadline, and the equipment spreadsheet stay on the web.
- [x] Team badge shelf. A person's own badges stay on Profile. Awarding a group stays on the web.
- [x] Item condition reports. Staff and admin see the five newest damage and missing-item reports on the item, with the photo and the checkout. Added in this slice. Students do not see them. Clearing maintenance stays in the item menu.

## Missing

- [ ] **Item activity.** The website History tab is `GET /api/assets/:id/activity` for staff and admin (all activity, item updates, or booking activity). The phone already lists previous bookings. The touch log is still web-only.
- [ ] **Shared software logins.** `/licenses` has a vault beside Photo Mechanic. The phone only does Photo Mechanic. Blocked by #502, which owns `LicensesView.swift`.
- [ ] **Native signature capture.** Waiting on Erik. The live capture path is iPad Safari with Apple Pencil. Do not rebuild `Views/Signatures/` until that decision is made.
- [ ] **Guide authoring.** Waiting on Erik. Create, edit, delete, and Mark verified stay off the phone until staff need to edit guides away from a desk.

## Intentionally web-only

- [x] **YouTube Studio Lite** (`/youtube`). Admin review queue, Google connection, and channel writes. Desktop work.
- [x] **Workforce and hiring.** Admin planning. Also in #485, under the Staff rename.
- [x] **UA Gear Picks admin** (`/gear/admin`). Roster, allowances, deadline, CSV, and the equipment workbook.
- [x] **Operations hub** (`/operations`). Fix Today (offline kiosks, calendar sync, license expirations) and inventory hygiene are cleanup. Battery totals are on the phone under Battery Ops.
- [x] **Import, labels, and item intake.** Add item, import, export, fill gaps, and the cleanup wizard are desk workflows.
- [x] **Item catalog actions.** Duplicate, retire, and delete stay web-only (GAP-36). Needs Maintenance is already on the phone.
- [x] **Event authoring.** Create, edit, hide, and remove stay on the web (GAP-81). Combine, week view, and auto-assign stay on the web.
- [x] **Checkout custody.** Opening, editing, and closing physical custody belongs to the kiosk. The phone reserves.
- [x] **Settings control room.** Categories, departments, locations, venues, sports, calendar sources, kiosk devices, reservation rules, checkout policies, escalation, collaborator access, allowed emails, audit log, data export, database diagnostics, and owner app activity. The phone keeps profile, security, notifications, and theme.
- [x] **Org chart and onboarding status.** Admin roster tools, and they live in the Staff rename drafts.
- [x] **Report CSV and the Audit report.** Spreadsheets and the full audit trail stay on the web.
- [x] **Accountability export and exclusions.** Admin data-quality tools. The phone reads the leaderboard only.
- [x] **Stale-reservation cleanup** on the team dashboard. Home on the phone stays a personal action queue.
- [x] **Budget** (`/budget`, #494). Admin-only planning linked to item purchases. Not a field screen.
- [x] **Public pages.** About, releases, privacy, support, and the Fetch/Offload product pages (#483).
- [x] **Photo Frame** (`/apps`, #478). A static web tool. Not a field screen.
