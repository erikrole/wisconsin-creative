# iOS ↔ web parity

Last updated: 2026-10-18

This is the handoff for the next native slice. Compare the website's pages and staff actions with the iPhone app under `ios/`. Count a row as covered when it is on `main` or in an open pull request listed below. Do not edit files those pull requests already change unless the slice cannot exist without a shared file (`BrowseView.swift`, `APIClient.swift`, `project.pbxproj`, `src/lib/releases.json`, `docs/AREA_MOBILE.md`).

Open, and off limits for file overlap:

- #497, #486, #485, and #484 Users to Staff and role tabs
- #494 Budget
- #488 Photo Mechanic licenses
- #478 Photo Frame

Hours and exports (#503), condition reports (#505), and the away-game travel roster (#506) are already merged, along with shared logins (#502), the Fetch and Offload pages (#483), item activity (#508), my hours (#512), and booking activity (#513). Kit return times are covered in this branch. Native signatures and guide authoring wait on Erik's decision.

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
- [x] Item activity. Staff and admin read the website History tab: all activity, item updates, or bookings, with older pages. A booking row opens that booking. Students do not see it. Previous bookings stay on the item.
- [x] **Booking activity.** Students, staff, and admins open Activity on a reservation or checkout and read the same history the website shows (`auditLogs` on `GET /api/bookings/:id`): all activity, booking changes, or equipment changes. The newest 50 entries are on the phone. Older history stays on the website. Collaborators do not see Activity. Extend stays the booking's main action. Added in #513.

- [x] **Brand assets.** Read-only folders, search, and opening a logo or PDF. Folder create, upload, and version restore stay on the web.
- [x] **UA Gear Picks, for a participant.** One fit against an allowance. Admin roster, deadline, and the equipment spreadsheet stay on the web.
- [x] **Shared software logins.** Read and copy from Browse (#502). Creating, editing, and archiving stay on the web. Photo Mechanic redesign remains #488.
- [x] **Team badge shelf.** Read-only staff catalog. Awarding a group stays on the web.
- [x] **Away-game travel roster.** Event detail lists who is traveling and opens a profile. Adding and removing travelers stays on the website.
- [x] **Kit return time.** When a kit item has a return time and the holder name is hidden, the row says Back plus that time. Staff and admin still see With plus the name and the return time. A hold with neither stays blank. Added in #510.
- [x] **My hours.** Your profile shows this week and this month from `GET /api/shifts/my-hours`. Students, staff, and admins see it. Collaborators do not. A failed refresh keeps the totals already on screen. Added in this slice.
- [x] **Item activity.** Staff and admin read `GET /api/assets/:id/activity` (all activity, item updates, or bookings). A booking row opens that booking. Students do not see it.

## Missing

- [ ] **Native signature capture.** Waiting on Erik's decision. The live capture path is iPad Safari with Apple Pencil. Do not rebuild `Views/Signatures/` until that decision lands.
- [ ] **Guide authoring.** Waiting on Erik's decision. Create, edit, delete, and Mark verified stay off the phone until staff need to edit guides away from a desk.

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
