# Photo Mechanic Licenses Area (V2 — 2-Slot Model)

## Document Control
- Area: Photo Mechanic license pool
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-08-23
- Status: Active — 2-slot model, expiry tracking, unknown occupants, CSV export, and native iOS self-service shipped
- Version: V2

## Direction
Replace the Google Sheet at `licenses.xlsx` with an in-app pool that mirrors how Photo Mechanic licenses actually work in the field — each license code activates on **two** machines, occupants drift over time, and licenses renew **annually**. Students self-serve a slot; admins manage account email, expiry, and unknown occupants.

The `/licenses` route is presented as **Software** in the sidebar. Photo Mechanic is the default landing and the primary tab. Shared logins is the secondary tab at `?tab=shared-logins`. Existing `?tab=photo-mechanic` links still open Photo Mechanic. The two-slot pool keeps its existing claim, masking, expiry, and administration rules unchanged and never becomes a normal shared login. Collaborators never see Photo Mechanic and land on Shared logins.

## Core Rules
1. **Two slots per license code.** Activations fill naturally; positions are not meaningful (no "slot 1 vs slot 2" semantics).
2. **One slot per user across all codes.** A student cannot hold a slot on multiple licenses simultaneously.
3. **Active claims drive status.** Status is derived from count of active claims (`releasedAt IS NULL`):
   - `AVAILABLE` — 0 active claims
   - `PARTIAL` — 1 active claim (badge: `1/2`)
   - `CLAIMED` — 2 active claims (badge: `Full`)
   - `RETIRED` — admin-archived, hidden from students by default
4. **Unknown occupants** can be marked by an admin with a free-text label (`occupantLabel`). Used when a license is in use by someone without an account here.
5. **Expiry is informational.** Warnings appear in the UI and via push notification 14 days before expiry; active claims are NOT auto-released.
6. **License codes only revealed to admins or the holder.** Other students see masked codes (`••••-••••-••••-••••`); the API also strips the code string server-side.
7. **Audit log** captures every claim, release, occupy, retire, delete, update.
8. **Staff and admins hold licenses with indefinite custody.** Only students are subject to the 2-day rotation nag. The "one active claim per user" rule still applies to everyone.

## Data Model
- Migration: SQL run manually 2026-04-24 (no Prisma migration file).
- `LicenseCode`:
  - `code` (unique), `label`, `accountEmail`, `expiresAt`
  - `status` (`AVAILABLE | PARTIAL | CLAIMED | RETIRED`)
  - `claimedById` / `claimedAt` — cached pointer to the FIRST active claimer (kept for backward compat)
  - `nagSentAt` — legacy V1 field; nag dedupe now keys per claim via notification `dedupeKey`
  - `claims` — `LicenseCodeClaim[]` (history, includes active and released)
- `LicenseCodeClaim`:
  - `userId` (nullable — `NULL` = unknown occupant)
  - `occupantLabel` (free-text name when `userId` is null)
  - `claimedAt`, `releasedAt`, `releasedById`

## API Surface

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET | `/api/licenses` | `license:view` | List codes with active claims (admin sees retired too) |
| POST | `/api/licenses` | `license:manage` | Create one code (with optional accountEmail/expiresAt) |
| POST | `/api/licenses/bulk` | `license:manage` | Bulk-create from newline-separated codes |
| PATCH | `/api/licenses/bulk` | `license:manage` | Bulk-renew visible active codes with one shared expiry date |
| GET | `/api/licenses/export` | `license:manage` | Download CSV of all codes |
| GET | `/api/licenses/my` | `license:view` | Current user's active claim (if any) |
| GET | `/api/licenses/my/history` | `license:view` | Current user's recent claim/return history without revealing released codes |
| PATCH | `/api/licenses/[id]` | `license:manage` | Update label / accountEmail / expiresAt / retire |
| DELETE | `/api/licenses/[id]` | `license:manage` | Permanent delete (must have 0 active claims) |
| POST | `/api/licenses/[id]/claim` | `license:claim` | Student claims a slot |
| POST | `/api/licenses/[id]/release` | `license:release` | Release own claim (empty body), admin releases one (`{ claimId }`) or all (`{ all: true }`) |
| POST | `/api/licenses/[id]/occupy` | `license:manage` | Admin marks slot occupied by unknown user (`{ label }`) |
| GET | `/api/licenses/[id]/history` | `license:manage` | Full claim history for a code |

## UI

- Page: `src/app/(app)/licenses/page.tsx` — Software shell. Photo Mechanic is the default tab; Shared logins is `?tab=shared-logins`.
- Photo Mechanic section: `src/app/(app)/licenses/PhotoMechanicLicenses.tsx`
- Native iOS page: `ios/Wisconsin/Views/LicensesView.swift`
  - Every authenticated role can open Licenses from Browse or Settings > Directory, view the license pool, claim one open slot, copy their active code, and return their own slot.
  - Student pool rows hide code strings unless the row is their active claim; staff/admin rows can reveal pool codes.
  - Staff/admin users get a web-management link for create, bulk create, renew, retire, export, unknown occupants, and full history workflows.
- Components:
  - `PhotoMechanicLicenses.tsx` — default Software panel: holder/claim hero first, then capacity rail, pool toolbar (staff add/renew/export), and pool table
  - `MyLicensePanel.tsx` — student banner showing their active code with copy + return
  - `MyLicenseHistoryDialog.tsx` — user-visible recent claim/return history from the active-license banner
  - `LicenseTable.tsx` — main table with masked codes, explicit claim/inspect actions, neutral occupied identities for students, and expiry tooltips
  - `ConfirmClaimDialog.tsx` — student claim confirmation, copies code on success
  - `ReleaseDialog.tsx` — student return confirmation
  - `AdminClaimSheet.tsx` — admin detail sheet (slots, self-claim of an open slot, occupant, editable label/account/expiry, danger zone, history)
  - `AddLicenseDialog.tsx` — single-code add with accountEmail + expiry
  - `BulkAddSheet.tsx` — paste many codes at once
  - `BulkRenewDialog.tsx` — admin renewal dialog for expiring/expired visible codes or all visible active codes

The Photo Mechanic tab also renders a responsive mobile card/list view so capacity, holders, expiry, and Claim/Inspect actions remain visible without horizontal table scrolling.

### Visual states
- AVAILABLE row: tinted green, `cursor-pointer` if user has no claim
- PARTIAL row: tinted blue, `1/2` badge, claimable by anyone without a license
- CLAIMED row: tinted blue for active use, with an explicit staff inspection action
- RETIRED row: 50% opacity, hidden by default, shown from the admin toolbar and inspectable for history/details
- Expiry: ≤30 days = yellow `Xd left`, expired = red `Expired`, normal = grayed date string
- Holder cell: avatar + name for staff or the current holder; students see neutral `Occupied` identity for other claims; `unknown` badges remain staff-only

## Notifications

Cron route: `GET /api/cron/notifications` (daily, see `vercel.json`).

| Trigger | Recipients | Dedupe | Channel |
|---|---|---|---|
| Student has held a slot for >2 days | Each holder individually (STUDENT only — staff/admins exempt) | `license-nag-{codeId}-{claimedAtIso}` (per claim, so both slot holders get nagged) | in-app + push |
| License expires within 14 days OR is past expiry | All ADMIN/STAFF users | `license-expiry-{codeId}-{currentYYYY-MM}-{adminId}` (keyed on the current month, so warnings repeat monthly until renewal) | in-app + push |

Implementation: `processLicenseNags` and `processExpiryWarnings` in `src/lib/services/licenses.ts`.

## CSV Export
- Endpoint: `GET /api/licenses/export`
- Auth: ADMIN/STAFF only
- Filename: `licenses-YYYY-MM-DD.csv`
- Columns: `code, label, account_email, status, holder_1, holder_2, expires_at, created_at`
- Holder cells use `user.name` if linked, else `occupantLabel`, else "Unknown"

## Permissions (`src/lib/permissions.ts`)
- `license:view` — STUDENT, STAFF, ADMIN
- `license:claim` / `license:release` — STUDENT, STAFF, ADMIN
- `license:manage` — STAFF, ADMIN

## Acceptance Criteria (V2 — Met)
- [x] Each license code can be held by up to 2 users at once
- [x] Status badge shows `Open`, `1/2`, `Full`, or `Retired`
- [x] Admins can record an unknown occupant by name
- [x] Staff and admins can assign an open slot to an active internal user
- [x] Admins can set + edit `accountEmail` and `expiresAt`
- [x] Expiring licenses (≤30d) show yellow badge; expired show red
- [x] Admins receive in-app + push notification 14d before expiry, monthly thereafter
- [x] Admin sheet shows full claim history including releases and unknown occupants
- [x] Admins can bulk-renew expiring/expired visible codes or all visible active codes
- [x] Users can view their own recent claim/return history without exposing released codes
- [x] Students cannot hold more than one slot across all codes
- [x] Codes are masked to non-holders/non-admins
- [x] Destructive actions (delete, retire) require confirmation
- [x] CSV export available to admins
- [x] Native iOS self-service available for view, claim, copy, and return

## Known Gaps / Deferred
- No full history pagination UI yet; API history reads are bounded.
- No full admin per-user license usage report beyond the user's own recent history and per-code admin history

## Change Log
- 2026-08-23: Redesigned the Photo Mechanic landing so the holder's activation code (or the claim prompt) is the first thing on the page. Staff add actions moved into the pool toolbar and no longer sit above the hero. `/licenses` still opens Photo Mechanic by default; Shared logins is `?tab=shared-logins`. Claim, masking, two-slot, and expiry contracts are unchanged.
- 2026-08-19: Added the shared Software Vault above the Photo Mechanic pool. The sidebar and route copy now say Software, while the existing two-slot license workflow remains compatible at `/licenses`. See `docs/AREA_SOFTWARE.md` for the encrypted credential contract and rollout gates.
- 2026-08-18: Fixed native iOS license expiry rendering a day early. Expiry values are annual calendar dates encoded at UTC midnight (`src/lib/license-dates.ts`), but iOS formatted the encoded instant in the device timezone, so anywhere west of UTC a 31 Dec license read "Expires Dec 30", and both the "Expired" copy and the amber/red urgency tone flipped a full day before the license lapsed. `LicenseExpiry.calendarDay(from:)` / `.daysUntil(_:)` now read the UTC date parts and compare whole calendar days, mirroring `licenseExpiryAsLocalDate` and `licenseDaysUntilExpiry` on the web. Claim timestamps are real instants and still render in local time. Pinned by `ios/WisconsinTests/LicenseExpiryTests.swift`.
- 2026-08-18: **Local calendar dates for annual expiry.** Date-only renewal values such as `2027-08-18` now display as August 18 in Central/local browser time instead of shifting to August 17 through UTC-midnight conversion. Expired, expiring-soon, renewal-scope, admin-sheet, and CSV filename calculations use the same local calendar-day contract; storage encoding, claim eligibility, and notification policy are unchanged.
- 2026-07-29: **Staff assignment.** Staff and admins can assign an open Photo Mechanic slot to an active internal user from the license detail sheet. The audited management route rejects retired or full licenses and users who already hold an active slot. Unknown-occupant recording remains available as a separate fallback.
- 2026-07-15: **Native iOS Licenses hierarchy and capacity polish.** The self-service page now opens with a shared-capacity summary, gives the holder's code a clearer active-license card, presents open capacity directly on each pool row, hides other student identities behind neutral occupancy copy, and aligns partial/full use to the established blue operational state. Claim, copy, return, masking, expiry, two-slot capacity, and web-owned administration are unchanged.
- 2026-07-10: **License expiry warnings unified to orange (shadcn audit follow-up).** The admin claim sheet expiring badge and the personal panel expiring-soon text drop off-system yellow for the shared orange warning tokens, matching the license table. Expired remains destructive red.
- 2026-07-10: **License table color-system alignment (shadcn audit).** The expiring-soon badge moved from off-system yellow to the shared orange (warning) badge variant, and row status tints plus the own-claim ring now use `--green-bg`/`--blue-bg`/`--blue` tokens instead of raw palette + `dark:` pairs. Status semantics unchanged; contract test updated to assert the token form. Audit record: `tasks/shadcn-audit-2026-07-10.md`.
- 2026-07-10: **End-to-end Licenses UI ownership pass.** Simplified the page header, moved renewal/archive/export commands into a labeled operational toolbar, corrected active-use status semantics from red/green to blue, added explicit Claim and Inspect actions, and made retired records inspectable. The custody panel and all create, bulk-create, renew, claim, return, personal-history, and admin-detail overlays now use stable pending labels and recoverable inline failure states; personal history can retry, and staff can edit license labels. Student API responses now redact other holders' names, avatars, IDs, and occupant labels while preserving anonymous slot occupancy. Expiry remains informational, and two-slot, one-license-per-user, claim, renewal, and role contracts are unchanged.
- 2026-07-10: **License capacity operational status rail.** Open slot capacity now anchors the shared rail, expiring codes and exhausted capacity receive priority treatment, and the full code, utilization, capacity, expiry, and retired totals remain under Details. Claim, renewal, and role behavior are unchanged.
- **2026-07-09 (Logic + polish audit fixes)**: Full-page audit pass (`tasks/audit-licenses-web.md`). Admin "Release all slots" now always releases every holder via an explicit `{ all: true }` body (previously it silently released only the admin's own slot when they held one); staff/admins can claim an open slot from the admin sheet ("Claim open slot", disabled with a hint while they hold a license); claim success is never mis-reported when the clipboard write fails (Safari); bulk add dedupes repeated pasted codes and duplicate single adds return 409 instead of 500 (shared P2002 mapping in `fail()`); expiry warnings now repeat monthly (dedupe keyed on current month) and the 2-day nag is tracked per claim so both slot holders get nagged; retire/delete checks run in serializable transactions; input bounds added (code/label/occupant/bulk paste); CSV export fetches via blob so errors toast instead of navigating to raw JSON; expired-today shows "Today"/"expires today" instead of "0d left"; all-retired empty state copy fixed; admin sheet header stays fresh after saves without clobbering in-progress edits; banner copy button reports clipboard failures.
- **2026-06-30 (Native iOS Browse reachability)**: Licenses is now a first-class compact Browse destination in native iOS, with Settings > Directory kept as a fallback and regular-width iPad still exposing Licenses as a sidebar-only Resources destination. Self-service behavior and web-owned management workflows did not change.
- **2026-06-30 (Native iOS self-service)**: Added `LicensesView.swift` backed by the existing `/api/licenses`, `/api/licenses/my`, claim, and release routes. Compact iPhone reaches Licenses from Profile/Settings > Directory, regular-width iPad exposes Licenses as a sidebar-only native Resources destination, and the page supports loading/error/empty states, pull-to-refresh, claim confirmation, copy-to-clipboard, and return confirmation. Admin create/edit/renew/retire/export/history workflows remain on the web management page. Screenshot follow-up removed contradictory `Available` + `Already claimed` pool-row copy when the user already holds a license, made Copy Code neutral/blue, tints Claim as a positive action, and kept Return License as the only destructive action. Student code visibility is also masked client-side unless the row is the student's active claim, matching the API sanitizer. App Store-style follow-up uses native SwiftUI text-only capsule buttons: green bordered-prominent Claim, blue bordered Copy Code, and destructive bordered Return License, with no custom badge or action-icon styling.
- **2026-05-25 (Web bug sweep Batch 31)**: Admin table row clicks now prioritize inspection over self-claiming, so staff/admin users can manage open or partially used license codes from the table instead of being dropped into the student claim dialog.
- **2026-05-25 (Web bug sweep Batch 30)**: Admin license sheets now show a retryable error when claim history fails instead of looking empty, abort stale history loads when switching sheets, expose stable form metadata on occupant/account/expiry inputs, and guard retire/delete actions while the request is in flight.
- **2026-05-24 (Client reliability sweep)**: License dialogs and sheets now use the shared safe error helpers for add, bulk add, bulk renew, claim, return, user history, and admin claim-management actions. These flows now handle expired sessions through the shared login redirect and no longer assume failed API responses are JSON.
- **2026-05-21 (Design-language cleanup)**: License pool summary metrics now use the shared `OperationalMetricCard` primitive, and compact header/admin controls use the 40px operational target baseline while preserving the 2-slot claim, masking, and admin-sheet behavior.
- **2026-05-08 (API hardening Wave 13)**: Code and personal claim history endpoints now apply bounded pagination instead of returning unbounded claim sets.
- **2026-05-08 (API hardening Wave 8)**: CSV export now uses shared formula-safe escaping so holder names and unknown occupant labels that begin with spreadsheet formula characters are exported as inert text.
- **2026-05-07 (User history)**: Added `/api/licenses/my/history` and a user-facing License history dialog from the active-license banner. The dialog shows recent claim/return timing while keeping released license codes hidden.
- **2026-05-07 (Bulk renewal)**: Added admin bulk renewal for expiring/expired visible codes or all visible active codes via `PATCH /api/licenses/bulk`, with rate limiting and audit logging.
- **2026-05-07 (Ownership pass)**: Added a compact license health summary for active codes, slot usage, open slots, expiring codes, and retired codes; fixed student-owned table rows so they no longer expose a dead click/keyboard path; corrected partial-row action labels for assistive tech; added an explicit hidden-retired empty state when no active codes are visible.
- **2026-04-24 (MVP polish)** — Per-user rate limits on claim/release/bulk/occupy/export; serializable-isolation transactions on `claimCode`/`addUnknownOccupant` to close concurrent-claim race; `LicenseCodeClaim.user` FK now `SET NULL` (migration 0044) so deleting users with claim history is safe; admin per-claim and "release all" now confirm via AlertDialog; list-fetch error surfaces a Retry empty-state instead of looking like an empty pool; BulkAddSheet now accepts shared `accountEmail` + `expiresAt`; "Mark slot occupied" input has a proper Label; footer hint hidden when user already holds a slot.
- **2026-04-24 (V2)** — Two-slot model, expiry, unknown occupants, CSV export, expiry push notifications, full UI polish + danger-zone confirmations
- **2026-04-23 (V1)** — Original single-slot pool with claim/release, 2-day nag push, claim history
