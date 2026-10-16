# iOS ↔ web parity

Last updated: 2026-10-16

This is the handoff for the next native slice. Compare the website's pages and staff actions with the iPhone app under `ios/`. Count a row as covered when it is on `main` or in an open pull request listed below. Do not edit files those pull requests already change unless the slice cannot exist without a shared file (`BrowseView.swift`, `APIClient.swift`, `project.pbxproj`, `src/lib/releases.json`, `docs/AREA_MOBILE.md`).

Open, and off limits for file overlap:

- #492 kits, kit detail, bulk inventory, and Battery Ops
- #493 reservation edit and checkout detail actions
- #494 admin budget linked to items (web only; do not start a phone version from those files)
- #491 web list performance and route loading states (not an iOS slice)
- #478 Photo Frame on `/apps` (draft static web tool; it also edits `src/lib/releases.json`)
- Erik's drafts, even where they are not parity work: #483 Fetch/Offload pages, #484 Users→Staff rename, #485 Workforce under Staff, #486 staff roster, #488 Photo Mechanic licenses redesign

#490 reports, #489 blasts, and #487 events are already on `main`.

## How to pick

Take the first item under **Missing** whose blocked note is clear. Keep one screen to one main action. Use the existing `/api/*` route and its validation. Leave control-room work in **Intentionally web-only**.

## Covered

- [x] Home action queue (personal overdue, due today, pending pickup, upcoming reservations, next shift)
- [x] Schedule: week list, event detail, claim, trade board, assign, add shift, availability, calendar feed
- [x] Bookings list and detail, including create reservation, extend, cancel, and re-reserve. Edit and the remaining checkout actions are #493.
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
- [x] Accountability: this year or all time, three sorts, name search, personal standing, open the checkout. Added in this slice. Location, incident state, active-user filters, the continuous on-time bar, CSV, and exclusion edits stay on the web.

## Missing

- [ ] **Brand assets.** `/resources?tab=brand-assets` is a file library (folders, preview, download, favorites). Guides on the phone are Markdown only. A read-only library is the next field slice: creative staff need a logo or PDF at a venue. Folder create, upload, and version restore stay on the web.
- [ ] **UA Gear Picks, for a participant.** `/gear` shops one fit against an allowance (`GET`/`PUT /api/gear-picks/me`). It is seasonal. Confirm the cycle is open before building it. Admin roster, deadline, and the equipment spreadsheet stay on the web.
- [ ] **Shared software logins.** `/licenses` has a vault beside Photo Mechanic. The phone only does Photo Mechanic. Blocked until #488 merges, because that pull request owns `LicensesView.swift`.
- [ ] **Native signature capture.** `docs/AREA_MOBILE.md` (2026-10-07) describes `Views/Signatures/` and an iPad Browse row. Those files are not on `main`. The live capture path is iPad Safari with Apple Pencil. Confirm the native screens were dropped before rebuilding them.
- [ ] **Guide authoring.** Create, edit, delete, and Mark verified stay off the phone today. Add them only if staff actually edit guides away from a desk.
- [ ] **Team badge shelf.** `/badges` is the staff catalog and award surface. A person's own badges already open from Profile. Bulk award is admin work and sits inside the Staff rename drafts; do not start it from those files.

## Intentionally web-only

- [x] **YouTube Studio Lite** (`/youtube`). Admin review queue, Google connection, and channel writes. Desktop work.
- [x] **Workforce and hiring.** Admin planning. Also in #485, under the Staff rename.
- [x] **UA Gear Picks admin** (`/gear/admin`). Roster, allowances, deadline, CSV, and the equipment workbook.
- [x] **Operations hub** (`/operations`). Fix Today (offline kiosks, calendar sync, license expirations) and inventory hygiene are cleanup. Battery totals move to Battery Ops in #492.
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
