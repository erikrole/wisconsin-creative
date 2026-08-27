# Settings Area Scope

## Document Control
- Area: Settings
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-08-26
- Status: Active
- Version: V1

## Direction
Single Settings surface for both **personal preferences** (visible to every authenticated user) and **system configuration** (admin/staff only, hidden by role-aware nav). Each sub-page is a focused domain. Keep pages self-contained with clear feedback loops (toasts, inline saves).

Design language reference: `docs/DESIGN_LANGUAGE.md`.

## Core Rules
1. The Settings surface is open to any authenticated user (STUDENT / STAFF / ADMIN). Each sub-page declares its own `requiredRole`; the layout filters tabs and gates direct-route rendering through the canonical `SETTINGS_SECTIONS` role matrix before child controls mount. STUDENTs only see the Personal group. Forbidden and unknown Settings routes show a recovery path instead of rendering child content.
2. Settings layout provides unified role-aware section navigation via the shared `SectionNav` treatment; sub-pages should not render their own page-level `<h1>`.
3. Each sub-page uses `SettingsPageShell`: compact intro rail (title + description) and main content for forms, tables, loading states, and errors.
4. Mutations should provide immediate feedback via toast notifications and visible form-level errors for create/add forms.
5. Personal-group preferences belong in **Personal** (top group). System configuration belongs in **People · Inventory · Scheduling · Devices · System**.
6. **App activity** is a separate owner-only support/adoption report. The Settings rail, command palette, breadcrumbs, direct route, and API all require the configured `USAGE_ANALYTICS_OWNER_EMAILS` identity; ADMIN role alone is not sufficient.

## Sub-Pages

### Security (`/settings/security`) -- Personal
- Change password: verify current password, set new one (min 8 chars), optional "sign out of all other devices" checkbox. Client-side confirm-password match before submit.
- Active sessions list: shows each non-expired session with creation date, expiry date, and "This device" badge for the current session. Per-session "Sign out" button (cannot revoke the current session). "Sign out all other devices" bulk action.
- Passkeys: active invite-granted users can add one or more discoverable passkeys after current-password reauthentication, name them, see last-used metadata, and revoke an individual credential. An unnamed passkey is named after the enrolling client (for example "Chrome on macOS" or "iPhone"), each row states whether the credential is synced or bound to one device, and removal takes its own confirmation dialog with its own current-password field. Password sign-in and recovery remain available during rollout.
- `POST /api/me/change-password` (5/min rate limit -- brute-force protection; verifies bcrypt, sets new hash, optionally deletes other sessions).
- `GET /api/me/sessions` (30/min; lists non-expired sessions with `isCurrent` flag -- tokenHash never exposed to client).
- `DELETE /api/me/sessions/:id` (10/min; rejects current session with 400, confirms ownership before delete).
- `DELETE /api/me/sessions` (10/min; revokes all sessions except current).
- `POST /api/auth/passkey/registration/options` and `POST /api/auth/passkey/registration/verify` (authenticated, current-password reauthentication, one-time server ceremonies).
- `POST /api/auth/passkey/login/options` and `POST /api/auth/passkey/login/verify` (public discoverable login, required user verification, existing cookie-backed session issuance).
- `GET /api/me/passkeys` and `DELETE /api/me/passkeys/:id` (credential metadata and current-password-protected per-credential revocation).
- `GET /.well-known/change-password` redirects (303) to this page against the requesting origin, so a password manager's "Change password" action lands on the form that changes it.
- Every password form on this page carries the signed-in address as a hidden `autocomplete="username"` field, so a manager files or updates the credential against the right account instead of saving it unattached.
- Available to every authenticated user (STUDENT included).

### Overview (`/settings`)
- Role-aware control map for every visible settings section.
- Groups settings into Personal, People, Inventory, Scheduling, Devices, and System with short descriptions.
- Preserves the previous last-tab behavior as a "Resume" action instead of immediately redirecting.

### Profile (`/settings/profile`) — Personal
- Self-service identity editing for every authenticated user.
- Editable: `name` (required), `phone`, `avatarUrl`, `primaryArea` (Video/Photo/Graphics/Comms), `title`, `athleticsEmail`, `slackHandle`. NOT `email` (login email stays admin-gated).
- Avatar managed via the existing `/api/users/[id]/avatar` endpoint (POST upload + DELETE remove) -- separately from the profile form save.
- `GET/PUT /api/me/profile` (rate-limited at `SETTINGS_MUTATION_LIMIT`). Validates + trims all fields; blocks duplicate `athleticsEmail` with 409. Changes audit-logged as `profile_updated`.

### Notifications (`/settings/notifications`) -- Personal (updated)
- "Quiet hours" pause (1 hour / 1 day / 1 week) — sets `pausedUntil` on the user's prefs row; while active, all email + push delivery skips. The in-app inbox always continues.
- Channel toggles: Email and Push (master switches per channel). Disabled while a pause is active.
- Notification type toggles (slice 7): Checkout due reminders, Checkout overdue alerts, Reservation updates, License expiry reminders. All on by default; null/missing prefs treated as all-on (no change for existing users). In-app notifications always fire regardless.
- Persisted server-side in `users.notification_prefs` JSONB (added in migration `0046_user_notification_prefs`). Null = receive everything (matches pre-feature behavior).
- Enforced in `sendPushToUser` / `sendEmailToUser` wrappers in `src/lib/services/notifications.ts` and `src/lib/services/licenses.ts` via `category` param. Other dispatch sites (shift trades, password reset, low-stock, item reports, system mails) intentionally bypass -- system / operational mails always send.
- Category assignment: `checkout_due_*` escalation rules use `checkoutDue`; `checkout_overdue_*` rules use `checkoutOverdue`; reservation lifecycle uses `reservation`; license nag uses `licenseExpiry`.
- API: `GET/PUT /api/me/notification-preferences` (rate-limited at the standard settings budget). `categories` field added to PUT schema; missing keys default to true.

### Appearance (`/settings/appearance`) — Personal
- Theme picker: Light / Dark / System (follows OS preference).
- Theme switching is shared with the Sidebar footer control through `src/lib/theme.ts`; choosing Light/Dark writes `localStorage.theme`, choosing System removes the override and follows OS changes.
- User-initiated theme switches use a short root-level animation via the View Transitions API when available, with a CSS fallback and reduced-motion opt-out.
- Text size picker: Small / Default / Large / Extra large (0.9 → 1.3 multiplier on the `--text-scale` CSS variable; all `--text-*` tokens scale proportionally).
- Saved per-device in `localStorage` (`theme`, `text-scale`); the cold-load script in `src/app/layout.tsx` applies both on first paint to avoid FOUC.
- Available to every authenticated user (STUDENT included).

### Checkout Policies (`/settings/checkout-policies`) -- Inventory, ADMIN
- **Default loan duration** (`defaultLoanDays`, default 3): used as the fallback `endsAt` when a checkout POST omits the end date. The creation form can use this to prefill the due-date picker.
- **Overdue grace period** (`gracePeriodHours`, default 0): items become overdue and the first overdue notification becomes eligible at `endsAt + gracePeriodHours`. Due-time, +4h, and +24h notification offsets remain exact relative to `endsAt`; manual nudges use the same grace boundary.
- **Max active checkouts per user** (`maxItemsPerUser`, default null = no limit): enforced at checkout POST time; counts OPEN + PENDING_PICKUP bookings for the requester. Rejects with 409 when at/over cap.
- `GET/PUT /api/settings/checkout-policies` (ADMIN, rate-limited at `SETTINGS_MUTATION_LIMIT`). Stored in `SystemConfig.checkout_policies`. Missing/null key falls back to defaults -- no behavior change for existing data.

### Reservation Rules (`/settings/reservation-rules`) -- Scheduling, ADMIN
- **Advance booking window** (`advanceWindowDays`, default null = no limit): reservations whose `startsAt` is further out than the window are rejected with 409.
- **No-show expiry** (`noShowExpiryHours`, default 48): starts when a booked
  reservation reaches `startsAt`. Loaded at cron run time in
  `expirePickupNoShows`, so admin changes take effect without a redeploy. The
  daily run cancels and releases eligible reservations and also drains legacy
  staged `PENDING_PICKUP` checkout rows.
- **Max concurrent reservations** (`maxConcurrentReservations`, default null = no limit): enforced at reservation POST time; counts BOOKED reservations for the requester. Rejects with 409 when at/over cap.
- `GET/PUT /api/settings/reservation-rules` (ADMIN, rate-limited). Stored in `SystemConfig.reservation_rules`. Missing key falls back to defaults.

### Categories (`/settings/categories`)
- Hierarchical tree of equipment categories with inline rename, subcategory creation, move (reparent), and delete.
- Search filters the tree (preserves parent nodes for structure).
- Sort toggles A→Z / Z→A.
- Move opens a parent picker that excludes the category and its own descendants (server still enforces cycle/depth limits).
- Item-count badge reflects items linked **directly** to that category, matching the `/items?category=` filter it links to (descendants are not rolled up).
- Items filters and item create/edit pickers show every category as a full hierarchy path, so parent categories with direct items and deeply nested subcategories remain selectable.
- Delete is guarded: blocked if category has items or children, and STAFF cannot delete (ADMIN-only). The kebab item is disabled with an inline reason in those cases.
- Duplicate names are blocked within the same tree level, and rows show last audit actor/time when audit history exists.

### Departments (`/settings/departments`)
- Staff/admin catalog of inventory ownership groups used by item forms, filters, bulk SKUs, and utilization reports.
- Add a department, inline rename by clicking the name, and deactivate/reactivate without breaking existing item or bulk references.
- Active departments appear in new item and bulk SKU pickers; inactive departments are hidden from pickers but remain on existing records.
- Usage counts show how many serialized items and bulk SKUs still reference each department.
- Rows show the last audit actor/time when audit history exists.

### Sports (`/settings/sports`)
- Configure one Non-game template with per-area Staff and Student counts for events without an opponent.
- Toggle sports active/inactive for shift generation.
- Configure separate Staff and Student home/away shift counts per area (Video, Photo, Graphics, Comms).
- Configure sport-level and Non-game Student call-time windows. Staff and collaborators have no displayed call time or event-time substitute.
- Saving Non-game defaults backfills missing upcoming Non-game schedules. Sport saves continue synchronizing safe upcoming Student fallback windows and active pending copies; explicit Student overrides remain unchanged and all-day events retain date-only boundaries.
- Expandable roster panel per sport — add/remove users.
- Mobile: card layout replaces dense table for shift configs.

### Escalation (`/settings/escalation`)
- Configure the -2h, due-time, grace-expiry, +4h, and +24h checkout notification rules.
- Assign up to ten active visible STAFF/ADMIN overdue responders per active checkout location. Empty assignments fall back to the active staff/admin booking creator, then active admins.
- Fatigue controls split requester stages from responder/admin rows per due-date version, so staff fanout cannot silence borrower reminders or exceed its own cap.
- The +4h and +24h stages reach location responders; +24h also reaches all admins by in-app + email while push remains responder-only.
- Migration `0111_checkout_overdue_notification_policy` and authenticated production rollout proof remain pending.

### Audit Log (`/settings/audit`) — System, ADMIN
- Admin-only live feed of every create, update, and delete action across the system.
- First page loads on mount; "Load older entries" button fetches the next keyset-paginated page via `?cursor=<nextCursor>`.
- Older-page failures preserve the loaded entries and show persistent inline recovery copy plus a retry-labeled pagination action so partial history is not mistaken for complete history.
- **Auto-refresh** toggle: when on, polls `GET /api/audit?after=<newestCursor>` every 30 seconds while the browser is visible, online, and recently active, then prepends new rows with a dismissible new-count banner. Polling pauses after two minutes without activity and checks immediately when the user returns.
- Auto-refresh failures preserve the loaded entries, show an inline stale-data warning, and expose `Retry now` so admins do not mistake a failed live-tail check for a current audit feed.
- Filters: entity type (exact), action (substring), from date, to date. The filter row uses the shared operational toolbar and removable active-filter chips. Apply validates invalid or inverted dates inline before a fresh first-page load; "Clear filters" resets to unfiltered.
- Retention banner shows the configured retention window (90 days) from the API response.
- Each row: timestamp, entity type + entity ID (8-char prefix), action badge, actor name (or "System" for server-generated events).
- `GET /api/audit` (ADMIN, 60/min): keyset pagination on `(createdAt DESC, id DESC)`; supports `?cursor`, `?after`, `?entityType`, `?actor`, `?action`, `?from`, `?to`, `?limit` (default 50, max 100). Returns `{ data, nextCursor, hasMore, retentionDays }`.

### Data Export (`/settings/data-export`) — System, ADMIN
- Admin-only hub for exporting data as CSV.
- Five exports: Items (assets), Users, Licenses, Bookings (checkouts + reservations), Audit Log.
- Bookings and Audit Log are new -- the other three surface existing endpoints in one place.
- All exports capped at 5,000 rows; `X-Truncated` + `X-Total-Count` response headers surface truncation; the UI shows a warning toast when capped.
- `GET /api/bookings/export` (ADMIN, 5/min, optional `?from=&to=&kind=`).
- `GET /api/audit/export` (ADMIN, 5/min, optional `?from=&to=&entity_type=`).

### Database (`/settings/database`)
- On-demand schema health diagnostics.
- Checks: migration table, tables, enums, extensions, column drift.
- Shows remediation steps when issues detected.

### App activity (`/settings/app-activity`) — System, configured product owner only
- Read-only dashboard of every active or inactive user that is visible in the roster, with whether the app has reported an app-open event and the last launch time.
- Each user lists the pseudonymous client installations that have reported: coarse device model, iOS version, marketing version, build number, best-effort `TestFlight` / `App Store` channel, first/last seen, and last launch.
- The report table keeps iOS hardware, iOS software/build, latest browser, and last-seen context in dedicated columns. Multiple web installations are summarized as the latest browser client plus an installation count; browser engine identity is not inferred from the available telemetry.
- iOS clients are marked `Latest`, `Stale`, `Newer`, or `Compare unavailable` against `IOS_LATEST_APP_VERSION` and `IOS_LATEST_APP_BUILD` when those server settings are configured. The report never presents an unconfigured comparison as current.
- `GET /api/settings/app-activity` is owner-allowlisted and returns no hidden-roster users. The durable installation key is server-HMACed; the app does not store or send a UDID, serial number, IDFA, raw receipt, or raw installation key in the database.
- Loading, refresh, error, and no-client states preserve the existing roster/report context. This page does not expose mutation controls.

### Locations (`/settings/locations`)
- Admin-only catalog of physical locations referenced by items, kiosks, calendar events, and venue mappings.
- Add a location with optional address; toggle isHomeVenue inline; rename inline by clicking the name.
- Deactivate (soft-delete) hides a location from new pickers but keeps existing references intact. Deactivated locations show in their own card with the count of references that still point at them, and can be reactivated.
- Hard delete is intentionally not exposed — locations are referenced by many models (FK constraints would block it anyway).
- This tab also owns Home Venue toggling, which previously lived under Venue Mappings.

### Calendar Sources (`/settings/calendar-sources`)
- Enable/disable ICS calendar sources for event sync.
- Sync status badges use the shared shadcn-backed status indicator: green for active, orange for stale/needs attention, red for errors, and gray for disabled or never synced.
- Manual "Sync Now" button. Add/delete sources.
- Manual sync reports returned feed errors, event add/refresh/cancel/skip counts, and shift-generation outcome instead of treating every 200 response as success.
- Manual sync, test, add, enable/disable, and delete actions use immediate duplicate-action guards before React disabled state renders.
- Per D-026 and D-035: daily calendar sync runs through `/api/cron/morning-refresh` at 08:00 UTC, with manual refresh for changes that cannot wait for the next run.
- Morning refresh records per-source consecutive hard sync failures in `SystemConfig`, resets the count after a hard-error-free cron sync, creates in-app notifications for active admins starting at 3 consecutive hard failures, and Admin Fix Today shows the repeated-failure count next to the latest source error.

### Venue Mappings (`/settings/venue-mappings`)
- Admin-only regex-to-location mapping table.
- Pattern validation on create/update (rejects invalid regex).
- Priority + longest-match tie-breaking.
- Per D-027: ADMIN-only, STAFF cannot access.
- Home venue toggling moved to the Locations tab as of 2026-04-25.
- Read-only Mapping Audit surfaces home venues without mappings, mappings to inactive or missing locations, and home-looking mappings pointed at non-home locations. Missing-home-venue rows can prefill Add mapping with the location name and ID.

### Bookings (`/settings/bookings`)
- Configure the extend-due-date presets shown when extending a booking.
- Up to 10 presets, each with a free-text label and a duration picked from a fixed list (15m → 1 month).
- Save button is always rendered (disabled when clean → "Saved", enabled when dirty → "Save changes").
- Browser `beforeunload` guard warns before navigating away with unsaved presets.
- Persisted to `system_config.extend_presets` (ADMIN-only PUT).

### Kiosk Devices (`/settings/kiosk-devices`)
- Manage iPad kiosk stations for self-serve checkout (admin-only).
- Create device → server returns a one-shot 6-digit activation code; admin enters it on the iPad at `/kiosk` to bind the device.
- Pending-activation devices have a "Regenerate code" affordance — invalidates the prior hash and surfaces a fresh code in the same dialog.
- Activated kiosks can't regenerate (must deactivate first; server returns 409).
- Kiosk sessions are **always-on**: a bound device has no server-side session expiry and stays active until an admin deactivates it. The HTTP-only cookie is rolled forward on every authenticated kiosk request (~395-day window) to stay under browser cookie-lifetime caps without ever forcing a re-activation on a live device.
- Toggle active/inactive (deactivating clears the session token, which ends the session immediately), delete, and inspect last-seen timestamp.
- Device rows use the shared shadcn-backed status indicator for `Online`, `Heartbeat stale`, `Offline`, `Pending activation`, and `Deactivated` health.

### Allowed Emails (`/settings/allowed-emails`)
- Admin-managed email allowlist for registration gating (D-029).
- Add invitations through the shared onboarding dialog with bulk paste, local CSV upload using the existing `email, role` intake, or one-email intake. STAFF can invite STUDENT only; ADMIN can invite STAFF, STUDENT, or COLLABORATOR.
- Bulk invite preview groups ready, duplicate, invalid, role-blocked, existing-user, pending-invite, and claimed-invite rows before write. Existing registered or already-invited addresses are visible only to authenticated operators through the preview endpoint; final write responses keep generic skip behavior.
- When a batch write is not confirmed, the completion panel keeps the attempted rows visible with a retry action. This is transient client recovery; it does not create a persisted failed-invitation status.
- First-time temporary-password account creation is retired. Operators add allowlist invitations, and users set their own password during email-first app sign-in.
- Onboarding Status links to `/users/onboarding-status`, where staff/admin can review pending, stale pending, and claimed onboarding access across the allowlist, copy the generic app login link, and remove unclaimed invites before reissuing access.
- Delete unclaimed entries. Claimed entries preserved (audit trail).
- Filter by status (all/unclaimed/claimed).

## Acceptance Criteria
- [x] AC-1: Role-aware grouped navigation across all settings pages
- [x] AC-2: Categories: tree CRUD with search and sort
- [x] AC-3: Sports: shift config table + roster management
- [x] AC-4: Escalation: toggle-based rule management + fatigue cap
- [x] AC-5: Database: on-demand diagnostics with status badges
- [x] AC-6: Mobile-responsive layouts for all sub-pages
- [x] AC-7: Component extraction for maintainability (Sports, Categories)
- [x] AC-8: Calendar sources: enable/disable, sync status, health badges, add/delete
- [x] AC-9: Venue mappings: admin-only CRUD with regex validation
- [x] AC-10: Allowed emails: add/delete with role pre-assignment, registration gating enforced
- [x] AC-11: Departments: staff/admin CRUD surface for inventory ownership groups
- [x] AC-12: Sports: separate Staff and Student staffing counts plus default call-time copy
- [x] AC-13: Audit auto-refresh stops requests for hidden, offline, or two-minute-idle sessions and checks immediately when activity resumes.
- [ ] AC-14: App activity passes migrated, configured, authenticated owner/non-owner acceptance, including a signed TestFlight/App Store client and stale/latest build comparison.

## Breadcrumb Roadmap

Navigation breadcrumb versioned roadmap: `tasks/breadcrumbs-roadmap.md`

All versions shipped. Duplicate breadcrumb removed; parent-level sibling quick-jump dropdown on "Settings" crumb navigates between sub-pages. Role-gated Settings sibling menus now wait for the current role before becoming dropdowns, so the loading frame does not expose an empty menu. The global breadcrumb UI now uses a lighter trail treatment with the current Settings sub-page marked by a subtle underline instead of a filled chip.

## Change Log

- 2026-08-26: **Kiosk activation-code copy feedback now reflects browser reality.** The activation dialog only reports success after the clipboard write resolves and gives manual-copy guidance when access is unavailable. Activation-code lifecycle, device permissions, and kiosk behavior are unchanged. Focused source/behavior tests, TypeScript, and lint pass locally; the full build remains blocked by unrelated dirty Trade Board work.

- 2026-08-24: **Password managers can find, fill, and update the right
  credential.** Every screen that shows a password box on its own — the second
  step of sign-in, account creation, a forced change, Settings change-password,
  and passkey reauthentication — now carries the account address as a hidden
  username field, so a manager stops saving passwords against no account.
  `/.well-known/change-password` sends "Change password" straight to Settings
  Security, and new-password fields declare the server's 8-character rule so a
  generated password is accepted the first time. No authorization, validation,
  or session behaviour changed.

- 2026-08-23: **Passkeys are easier to use and safer to manage.** Sign-in
  arms browser AutoFill so a saved passkey is offered from the email field
  itself, and "Remember me" now applies to a passkey sign-in instead of only a
  password one. An unnamed credential is named after the enrolling client rather
  than "This device", the list says whether a passkey is synced or device-bound,
  and removal moved out of a browser `confirm()` into a dialog with its own
  reauthentication field — the delete button previously did nothing unless the
  enrollment form's password box happened to be filled. Ceremony failures now
  read as product language per spec error, and a dismissed sheet is silent.
  Authorization, one-time ceremonies, required user verification, and
  current-password reauthentication are unchanged.

- 2026-08-21: Added the owner-only **App activity** Settings page. It joins visible users to HMAC-keyed current client installations and shows app-open adoption, last launch/seen, device model, iOS version, build, release channel, and configurable stale/latest build state. Local schema, route, source-contract, and TypeScript gates pass; migration application, owner configuration, authenticated browser proof, and signed-client channel acceptance remain open.
- 2026-08-24: **App activity columns are now support-readable.** The owner report separates iOS hardware, iOS software/build/channel, latest browser activity, and last-seen context; repeated web installation rows collapse into one latest-browser summary with a count, while the route, owner gate, and telemetry contract remain unchanged. The web slice is deployed in `dpl_9cFHwpSQA9QjsQTV3GF3uKf65QtE`; owner-authenticated production proof remains open.

- 2026-08-18: **Allowed Emails gained safer batch recovery.** Operators can upload the existing `email, role` CSV shape, and an unconfirmed response now stays visible as a retryable failed-row result instead of collapsing into generic form error copy. Existing persistence, duplicate-skip, and role-boundary contracts are unchanged; broader roster-field CSV support and durable failed status remain open.

- 2026-08-17: **Allowed Emails now hands people to the app login.** Pending invitations are discovered after email entry and route unregistered users into self-chosen password setup on web or native iOS. Status actions copy `/login` instead of row-specific registration links, and the old `/register` route remains only as a compatibility redirect. The allowlist and registration transaction remain authoritative.

- 2026-08-10: Escalation settings now expose the durable five-stage checkout policy, separate requester and operational caps, and audited location-scoped overdue responder assignment with active visible STAFF/ADMIN validation and creator/admin fallback. Migration and production proof remain rollout gates.

- 2026-08-07: **Non-game staffing and Student call time are Settings-owned.** Admins can configure per-area Staff and Student counts plus Student offsets for events without an opponent. Saving backfills missing eligible future schedules; manual event creation and calendar sync use the same defaults. Staff and collaborators have no displayed call time.

- 2026-08-05: **The authorized one-time call-time override is complete.** Settings offsets were applied to the active visible future schedule as a bounded repair: 145 events and 118 groups inspected, 2 groups and 2 fallback shifts updated, 2 explicit shift call windows and 6 personal assignment call windows cleared, 1 private working copy rebased, and 1 already-published group refreshed. The 83 all-day events remained date-only, and 5 events without sport configuration were skipped. Ordinary settings synchronization continues to preserve explicit slot and personal overrides. Audit records were written for both changed groups.
- 2026-08-05: **Sport call-time defaults now reach new working-copy slots.** The schedule editor and native Add Shift flow consume the same settings-owned default window as direct shift creation, while existing peer, slot, personal, and all-day boundaries remain unchanged.

- 2026-08-04: **Sport settings now own current timed call-time synchronization.** The shared default-window helper is consumed by generation, manual slot creation, template review, and the grouped/direct Sport settings mutations. Saving call-time offsets updates future timed shift fallbacks, keeps active working-copy payloads publishable with the same defaults, refreshes published snapshots, and preserves explicit slot or personal overrides. All-day events remain date-only. A shared dry-run/apply path was used to repair live drift: 35 fallback shift windows across 9 groups, 3 private working copies, and 1 published snapshot were corrected; the post-apply audit found zero remaining drift.
- 2026-07-31: **Passkey self-service hardening.** Enrollment and revocation now
  enforce the explicit all-role `user.edit_self` permission in addition to the
  authenticated session and current-password checks. Duplicate credential
  races return a specific conflict and retire the completed ceremony. Native
  Account & Security keeps passkey success feedback in the passkey section,
  clears reauthentication secrets after successful mutations, bounds optional
  names to the server contract, and distinguishes successful enrollment from a
  failed follow-up list refresh.

- 2026-07-31: **Native passkey enrollment confirmation is rollout-safe.**
  Account & Security now decodes the registration endpoint's compact created
  credential response separately from the full passkey metadata list, so a
  passkey created in an external provider can finish enrollment without a
  false server-response error.

- 2026-07-31: **Passkey Security slice.** Security now supports web and native iOS passkey enrollment, discoverable passkey login, credential metadata, and current-password-protected revocation. Passkeys issue the existing cookie-backed user session, require user verification, persist one-time ceremonies, and leave password recovery plus kiosk device auth unchanged. The production AASA and API route contract is live; browser and real-device proof remain open.
- 2026-07-23: Reservation Rules now explains that Pending Pickup begins at the
  scheduled reservation start and that the configured no-show window cancels
  and releases an uncollected reservation.
- 2026-07-17: **Category graph mutations are atomic.** Category create, move, and delete perform graph, duplicate, dependency, write, and audit work in one `SERIALIZABLE` transaction with a bounded retry. Reciprocal moves and concurrent root duplicates fail safely, and a resulting subtree is capped at 25 parent-child edges. Name-only edits on a legacy overdeep tree remain available because unchanged placement is not revalidated; explicitly supplying a parent still enforces the cap.
- 2026-07-16: **Settings directory interaction-detail conformance.** The overview intro and role-aware group cards now enter as separate semantic chunks with a short stagger, destination rows use the shared exact 0.96 press response, the search trigger stays a compact 40px control on small screens, command results provide 44px touch targets, and blocked-route recovery provides an explicit 40px action. Section visibility, direct-route access gating, last-tab resume behavior, route URLs, and all sub-page data behavior are unchanged.
- 2026-07-16: Added admin-only Collaborator Access settings for affiliation creation, identity, validated capability replacement, suspension/reactivation, affected-count previews, history restoration, and constrained archival.
- 2026-07-16: **Activity-aware audit live feed.** Audit auto-refresh keeps its opt-in 30-second cadence while an admin is active, pauses requests for hidden, offline, or two-minute-idle sessions, and checks immediately on return. Existing rows, stale-feed recovery, filters, and pagination behavior are unchanged.
- 2026-07-11: **App Review legal and deletion controls.** Native Settings now provides first-level Privacy Policy and Contact Support links. Account & Security includes a password-reauthenticated, double-confirmed Delete Account flow backed by the existing user-deactivation service. Open custody blocks deletion; successful deletion cancels future work, revokes all sessions, removes access, and preserves required historical custody/audit records.
- 2026-07-11: **Manually finalized native icons resynced.** The app target now uses exact full-directory copies of the five latest Icon Composer documents, and the App Icon picker previews were regenerated from the artwork each document currently references. This supersedes earlier programmatic icon-package adjustments while preserving the same Motion W, Heritage, Bucky, Helmet, and Metallic selection names.
- 2026-07-11: **Native icon appearance correction.** The primary Motion W now has separate light and dark artwork/background annotations inside one Icon Composer document, the Heritage safe area is corrected, and primary/Heritage group shadows are strengthened for internal material depth. The App Icon picker names and switching contract are unchanged.
- 2026-07-11: **Native app-icon picker preview cleanup.** The iOS App Icon page now renders previews from the finalized Wisconsin artwork rather than generic symbols, and each option is a compact single-line name without explanatory subcopy. Selection, error, and UIKit switching behavior are unchanged.
- 2026-07-11: **Native iOS app-icon personalization.** Wisconsin Settings now includes an App Icon page with the primary Motion W plus Heritage, Bucky, Helmet, and Metallic W alternates. The picker reads `UIApplication.alternateIconName` as system truth, uses the four generated alternate names from Xcode's asset compiler setting, passes `nil` to restore the primary icon, disables duplicate requests during the UIKit handoff, and reports unsupported-device or system failures. This is an on-device native preference; it does not alter web Appearance settings or the dedicated kiosk icon.
- 2026-07-10: **Sweeping Settings shell and trust pass.** Removed the nested per-page intro rail so every form, table, and diagnostic surface gets the full content column beside the shared desktop navigation. Replaced the 19-destination mobile scroller with a grouped page picker, simplified the overview by removing redundant role/count badges, and renamed implementation-shaped destinations to intent-first labels while preserving every URL and role gate. Booking extensions now distinguishes load failure from an intentionally empty preset list and removes the false drag affordance; notification pause/resume success waits for persistence; Appearance copy reflects immediate local application; and Database diagnostics is labeled as a bounded baseline rather than complete schema-health proof.
- 2026-07-10: **Allowed Emails operational status rail.** Pending registration access now leads through the shared compact rail, while total, pending, and claimed allowlist counts remain pressed-state-aware filters under Details.
- 2026-07-10: **Settings direct-route role gating.** The shared Settings layout now checks the canonical `SETTINGS_SECTIONS` role matrix before mounting child controls, keeps Personal settings available to every authenticated role, and gives forbidden or unknown routes a clear recovery path.
- 2026-06-30: **iOS Browse directory reachability.** Native iOS now exposes Items, Guides, Licenses, and Users from the compact Browse tab. Profile/Settings > Directory remains a fallback path for Guides, Users, and Licenses, with Users visible to every authenticated role as a directory.
- 2026-06-30: **iOS Settings Directory Licenses.** Native Profile/Settings > Directory now opens `LicensesView.swift` for every authenticated role instead of a staff/admin-only web fallback. The child page handles Photo Mechanic license view, claim, copy, and return self-service; staff/admin management actions remain linked to the web Licenses page from inside the native screen.
- 2026-06-28: **Web sidebar Settings reachability.** The global web sidebar now keeps a single top-level Settings link visible to every authenticated role, matching the Personal settings contract while leaving individual Settings sections role-filtered by the existing Settings layout rail and command palette.
- 2026-06-27: **Audit command surface cleanup.** Settings > Audit now uses the shared `OperationalToolbar`, `OperationalActiveFilterChips`, shadcn `Table`, and shared `EmptyState` composition for filters, audit rows, empty results, and retryable load failures while preserving the existing keyset pagination and auto-refresh behavior.
- 2026-06-26: **Kiosk Devices health indicator cleanup.** Settings > Kiosk Devices now uses the shared shadcn-backed status indicator for device health instead of a route-local dot plus separate status badges. Online remains green, stale heartbeat is orange, offline is red, and pending/deactivated devices are gray.
- 2026-06-26: **shadcn status indicator cleanup.** The shared Calendar Sources health indicator now composes shadcn `Badge` variants instead of route-local/raw color spans. Active feeds stay green, stale feeds use the Gear Tracker orange warning tone, errors stay red, and disabled or never-synced feeds use gray.
- 2026-06-24: **Hidden smoke onboarding cleanup.** Allowed Emails and Onboarding Status now hide rows claimed by `hiddenFromRoster` users by default, keeping smoke/test invite history out of daily onboarding review while preserving the audit row.
- 2026-06-24: **Hidden smoke user visibility.** Added `User.hiddenFromRoster` so smoke/test identities can remain active for verification while staying out of default roster, export, form-option picker, kiosk user-selection, non-internal profile reads, Schedule candidate/conflict reads, org chart rows, and admin/supervisor notification fan-out. Internal operator opt-in is controlled by `INTERNAL_OPERATOR_EMAILS`; `/api/me` exposes that current-user capability, `/users` shows an owner-only "Show hidden test users" filter that also carries into roster CSV export, and `POST /api/users/hidden-cleanup` lets internal operators dry-run or apply age-based hidden-user deactivation. Normal staff/admin access still excludes hidden users by default.
- 2026-06-22: **Venue mapping contract cleanup.** `GET /api/location-mappings` now enforces ADMIN-only access, create rejects invalid regex patterns before storage, and list ordering follows priority plus longest-pattern tie-breaking to match D-027.
- 2026-06-20: **Settings section-nav refinement.** Settings now uses the shared `SectionNav` treatment for both the mobile horizontal strip and desktop side rail: lighter translucent chrome, 40px+ targets, active underline/accent states, and the existing role-aware grouping preserved.
- 2026-06-20: **Breadcrumb UI refinement.** Settings breadcrumb trails now inherit the lighter global breadcrumb treatment: quieter parent-link hover states, softer separators, and a current-page underline that keeps the Settings header from competing with another framed control strip.
- 2026-06-19: **Category cleanup wizard and picker visibility.** Items filters and shared category comboboxes now show every category as a full path, including parent categories with direct items and deeply nested subcategories. The Fill gaps wizard now gets server-side missing-category suggestions from already-categorized inventory and falls back to gear-term matching for common categories such as cameras, lenses, batteries, media, audio, cables, lighting, monitors, and support gear.
- 2026-06-19: **Breadcrumb role-load polish.** The global breadcrumb keeps Settings sibling jumps role-aware and now withholds the dropdown state while the current role is unresolved, avoiding an empty Settings menu during the `/api/me` loading frame.
- 2026-06-19: **Venue mapping audit surface.** Settings > Venue Mappings now renders the read-only audit helper as an admin diagnostics card, with recovery actions for missing home-venue mappings and links back to Locations for inactive or non-home venue fixes.
- 2026-06-19: **Venue mapping audit helper.** A read-only helper now classifies home venues without active mappings and mappings that point to missing or inactive locations, giving Settings-owned venue data a regression target before future diagnostics UI.
- 2026-06-19: **Sport settings code hardening.** Settings > Sports and related roster/config routes now normalize lowercase sport-code input to canonical UW codes and reject unknown codes before reads or writes. Locations' Home Venue flag is also consumed by calendar sync when mapped venues determine whether a `vs` event stays home or becomes neutral.
- 2026-06-10: **iOS Settings detail menus.** Native Settings now has dedicated Notifications and Account & Security drill-downs. Notifications keeps the existing server-backed pause, email/push, category, and iOS permission controls; Account & Security changes passwords through the existing personal Security endpoint and keeps profile editing plus active-session review linked to web.
- 2026-06-10: **iOS Settings first-class hub.** Native Profile now presents as Settings with grouped account, schedule, notification, appearance, tools, and app sections. The iOS surface keeps the web-owned backend settings model, existing notification preference API, student Availability entry, staff/admin sticker-code tool, and stable tab shell unchanged.
- 2026-06-08: **No-temp-password onboarding pivot.** Settings > Allowed Emails now keeps the shared onboarding dialog invite-first only. First-time direct-create and bulk-create password handoffs are retired; operators add allowlist invitations so users register with their own password.
- 2026-06-08: **Bulk onboarding launch hardening.** Settings > Allowed Emails bulk temporary-password account creation now hits a rate-limited route that rejects Admin rows before password generation, preserving the onboarding contract that roster operations create only Staff and Student accounts.
- 2026-06-05: **Allowed Emails toolbar cleanup.** Settings > Allowed Emails now gives the status filter a stable browser/accessibility identity and groups `Status` with `Onboard users` as workflow actions, while preserving allowlist filtering, onboarding dialog behavior, and delete semantics.
- 2026-06-05: **Shared onboarding dialog completion banner cleanup.** The Settings > Allowed Emails onboarding result banner now uses the shadcn alert primitive with semantic success tokens instead of hardcoded green utility classes, while preserving temporary-password handoff copy and result actions.
- 2026-06-05: **Shared onboarding dialog direct-create guidance tone cleanup.** The Settings > Allowed Emails onboarding dialog now presents the pre-submit direct-create handoff note as neutral guidance instead of green success styling, while preserving temporary-password behavior and profile handoff.
- 2026-06-05: **Shared onboarding dialog bulk-create limit feedback.** The Settings > Allowed Emails onboarding dialog now shows an inline error when bulk direct-create has more than 50 ready accounts, so the disabled create action has visible recovery copy while preserving the existing row limit.
- 2026-06-05: **Shared onboarding dialog form metadata cleanup.** The Settings > Allowed Emails onboarding dialog now exposes stable browser form names across bulk invite, single invite, and bulk direct-create controls, with email autocomplete on the single invite field, while preserving existing onboarding API payloads.
- 2026-06-05: **Shared onboarding dialog role-label cleanup.** The Settings > Allowed Emails onboarding dialog now shows and exports Admin, Staff, and Student labels in direct-create handoffs instead of raw role enum values, preserving stored API role values while making operator handoff output readable.
- 2026-06-05: **Allowed Emails claimed-state color cleanup.** Settings > Allowed Emails now renders claimed allowlist rows with terminal gray status badges instead of availability green, matching the onboarding status page and the shared color rule that green means available/free.
- 2026-06-04: **Bulk temporary-password onboarding.** The shared onboarding dialog now supports bulk direct account creation with role/location defaults and a one-time temporary-password CSV, giving operators an immediate-access path for cohorts that should not wait on invite registration.
- 2026-06-04: **Onboarding status handoff controls.** Settings > Allowed Emails now points operators to a status page that can copy mobile-friendly prefilled registration links and safely remove unclaimed pending/stale invites before reissue, while keeping claimed entries immutable for audit.
- 2026-06-03: **Onboarding status link.** Settings > Allowed Emails now links to `/users/onboarding-status`, giving operators a People-owned status page for pending, stale pending, and claimed onboarding access while keeping allowlist mutation controls in Settings.
- 2026-06-03: **Shared onboarding surface.** Settings > Allowed Emails now launches the same `Onboard users` dialog as `/users`, replacing the page-local add form with bulk invite paste, CSV-like `email, role` intake, local preview grouping for ready/duplicate/invalid/role-blocked rows, authenticated server preview for existing-user/pending-invite/claimed-invite rows, single invite, role-safe invite options, direct temporary-password account creation, and shared duplicate/registered skip copy.
- 2026-06-03: **Allowed Emails onboarding lifecycle service.** Settings > Allowed Emails now routes single and bulk invite creation through the shared onboarding lifecycle service, preserving STAFF/ADMIN role boundaries, claimed registered-user backfill, generic duplicate skip responses, batched bulk audit writes, and the current 50-row bulk limit.
- 2026-06-03: **Calendar Sources freshness consistency.** Settings > Calendar Sources and `/schedule` now share the same calendar-source freshness classifier and 30-hour stale threshold, so source health labels cannot drift between the configuration page and the operator Schedule signal.
- 2026-06-02: **Calendar sync health escalation.** Morning refresh now records consecutive hard Calendar Source failures, surfaces returned sync errors in the cron response, notifies active admins in-app after 3+ consecutive daily hard failures, and shows repeated-failure severity in Admin Fix Today.
- 2026-06-02: **Calendar Sources sync trust cleanup.** Settings > Calendar Sources now makes daily morning-refresh sync visible, guards rapid Test/Add/Sync/Toggle actions immediately, and reports manual sync results from returned event/shift data so external feed failures no longer look like successful syncs.
- 2026-06-02: **Audit Log auto-refresh stale-data warning.** Settings > Audit Log now surfaces failed background live-tail checks inline, keeps the loaded audit rows visible, and offers `Retry now` so admins do not mistake stale audit evidence for a current feed.
- 2026-06-02: **Audit Log filter validation.** Settings > Audit Log now trims filter drafts and blocks invalid or inverted date ranges inline before fetching, preserving the current audit table instead of turning bad operator input into a confusing server error or false empty result.
- 2026-06-02: **Audit Log pagination recovery.** Settings > Audit Log now keeps loaded audit rows visible when an older-page fetch fails, shows persistent inline recovery copy beside the pagination action, and changes the control to `Retry older entries` so admins do not mistake partial history for the end of the audit trail.
- 2026-06-02: **Data Export download trust cleanup.** Settings > Data Export now uses a ref-backed in-flight guard so admins cannot start duplicate CSV downloads before the disabled state renders, and export failure/success copy is normalized per dataset for JSON, text, capped, and normal responses.
- 2026-06-02: **Escalation save trust cleanup.** Settings > Escalation now serializes trigger and notification-cap saves in the UI, disables all related controls during an in-flight write, confirms the exact trigger or cap changed, and accepts the stable seeded escalation rule IDs used by the page so admins can persist overdue-notification policy updates.
- 2026-05-25: **Web bug sweep Kiosk Devices location-state cleanup.** Settings > Kiosk Devices now surfaces a retryable locations-load failure for kiosk assignment instead of leaving the required New Kiosk location picker empty; the create fields also expose stable form metadata.
- 2026-05-25: **Web bug sweep Calendar Sources load-state cleanup.** Settings > Calendar Sources now shows a retryable load failure when `/api/calendar-sources` cannot be read instead of falsely reporting that no feeds are configured; the Add source fields also have explicit label and form metadata.
- 2026-05-25: **Web bug sweep Venue Mappings location-state cleanup.** Settings > Venue Mappings now surfaces a retryable inline error when the required locations list fails to load and disables Add mapping until location options are available, avoiding a false empty required picker.
- 2026-05-25: **Web bug sweep Allowed Emails role-label cleanup.** Settings > Allowed Emails now renders allowlist role badges as `Admin`, `Staff`, and `Student` with the same role colors used elsewhere instead of leaking raw stored enum values such as `STAFF` or treating admin rows as student-gray.
- 2026-05-25: **Web bug sweep Locations accessibility cleanup.** Settings > Locations now gives each Home Venue switch a location-specific accessible name such as `Toggle Camp Randall home venue`, and inline rename inputs expose stable id/name metadata while editing.
- 2026-05-25: **Web bug sweep audit hint response hardening**. Shared last-edited audit hints now safe-parse `/api/audit/last` success bodies and validate the returned map before updating Settings catalog rows, so malformed 200 responses leave the decorative hint empty instead of throwing or trusting partial data.
- 2026-05-25: **Web bug sweep audit hint CSRF hardening**. Settings last-edited hints now survive local/proxied same-origin POSTs where Next's internal request URL scheme disagrees with the browser `Origin`; the shared API wrapper recognizes forwarded host/proto origins and loopback-only dev scheme mismatches while still blocking true cross-origin mutating requests.
- 2026-05-25: **Web bug sweep data export action clarity**. Data Export CSV actions now render dataset-specific labels such as `Download Items CSV` and `Download Audit Log CSV` instead of five repeated `Download CSV` buttons, keeping the admin export hub distinguishable for keyboard, screen-reader, and visual scanning.
- 2026-05-25: **Web bug sweep settings cache and role-gate hardening**. Profile saves now sync the shared `/api/me/profile` query cache from the successful mutation response instead of waiting on a follow-up refetch, so saved fields clear the dirty state immediately and avoid duplicate-save/stale-form loops. Profile avatar upload/remove also updates the same cached profile. The Settings shell now withholds role-gated section links and command-palette entries until the current user role is known, preventing a loading-frame flash of admin-only destinations. Security's sign-out-other-devices checkbox now has an explicit accessible name.
- 2026-05-25: **Web bug sweep settings response hardening**. Calendar Sources, Categories, Security, Allowed Emails, Kiosk Devices, Sports, Audit, Profile, and Database settings paths now safe-parse success responses or use shared error parsing instead of assuming JSON. Malformed success bodies now surface explicit recovery copy for calendar source tests, kiosk activation codes, sports group saves, avatar uploads, audit pagination, and database diagnostics. The same pass cleared browser-reported missing form identity metadata on Audit filters, Sports coverage counts, and the Categories search/add fields.
- 2026-05-24: **Web bug sweep settings mutation and state guards**. Security, Profile, Notifications, Extend Presets, Checkout Policies, and Reservation Rules now use ref-backed duplicate-submit guards on save/revoke/upload paths, disable related controls while writes are in flight, and keep expired sessions on shared auth-redirect paths. Browser smoke also fixed the Profile primary-area Select empty-value crash, cleared Profile autocomplete warnings, gave touched controls stable form metadata, moved the remaining text-only Settings load failures to shared retryable empty states, and corrected Checkout Policies / Reservation Rules client data unwrapping so successful 200 responses render the saved forms.
- 2026-05-21: Sports shift counts are now framed as Minimum crew, with Staff slots and Student slots labels plus helper copy that generation creates both slot types from those counts.
- 2026-05-21: Sports settings now treats Staff and Student as separate planned staffing requirements for every area and home/away row. The table labels are spelled out, legacy total counts stay derived for compatibility, and shift offset copy now reads as default call time.
- 2026-05-21: Categories hardening pass. (1) Item-count badge now shows direct items only. It previously summed the node plus its direct children but dropped grandchildren, and the number never matched the exact-category `/items` view it links to. (2) Delete is role-gated in the UI: STAFF (who can see the Categories tab and rename/add) no longer get a silent 403 on Delete; the kebab item is disabled with an inline reason ("admin only" / "has items" / "has subcategories"). (3) New Move action reparents a category via a combobox of valid targets (self + descendants excluded; server enforces cycle/depth). (4) Empty root "Add" input now cancels silently on blur/Enter instead of throwing "Category name is required", matching subcategory add. (5) `GET /api/categories` switched from `cachedOk` to `ok`, since the 60s browser cache could serve a stale list after a rename or delete reload. Settings overview also dropped a duplicate `/api/me` fetch (now shares `useCurrentUser`) and removed the vanity "N sections / N groups" stat chips.
- 2026-05-21: Audit Log viewer (roadmap slice 9). New `/settings/audit` (System, ADMIN) -- admin live-tail feed of all system actions. Keyset-paginated `GET /api/audit` (60/min) with `cursor`/`after`/`entityType`/`action`/`from`/`to`/`limit` params. UI has filter bar, "Load older entries" pagination, 30-second auto-refresh polling via `?after=<newestCursor>`, new-row count banner, and retention notice. Cursor is a client-built base64url encoding of `{createdAt, id}` matching the server format.
- 2026-05-21: Notification granularity (roadmap slice 7). Added per-category toggles to Settings > Notifications: Checkout due reminders, Checkout overdue alerts, Reservation updates, License expiry reminders. Stored in `notification_prefs.categories`; missing/null keys default to true (no change for existing users). Category gating threaded through `sendPushToUser`/`sendEmailToUser` in `notifications.ts` and `licenses.ts`. In-app notifications bypass category gating and always fire.
- 2026-05-21: Checkout Policies + Reservation Rules (roadmap slices 5 + 6). New `/settings/checkout-policies` (Inventory, ADMIN) and `/settings/reservation-rules` (Scheduling, ADMIN). Default loan duration and overdue grace period stored in `SystemConfig.checkout_policies`; advance booking window, no-show expiry (previously hardcoded 48h), and max concurrent reservations stored in `SystemConfig.reservation_rules`. Grace period now applied in both the Overdue list filter and the escalation cron. No-show expiry loaded at cron run time (no redeploy needed after a config change). New `GET/PUT /api/settings/checkout-policies` and `GET/PUT /api/settings/reservation-rules` (ADMIN, rate-limited, audit-logged).
- 2026-05-21: Security settings (roadmap slice 4). New `/settings/security` (Personal, all roles) adds change-password form (current password verify, new password min-8, confirm, optional sign-out-others checkbox) and active sessions list (per-session sign-out, bulk sign-out-all-others). New `POST /api/me/change-password` (5/min), `GET/DELETE /api/me/sessions` (30/10 per min), `DELETE /api/me/sessions/:id` (10/min). Current session identified server-side by hashing the cookie token -- tokenHash never exposed to client.
- 2026-05-21: Profile settings (roadmap slice 3). New `/settings/profile` (Personal, all roles) lets every authenticated user edit their name, phone, primary area, title, athletics email, and Slack handle. Avatar managed via the existing user avatar endpoint. New `GET/PUT /api/me/profile` -- rate-limited, audit-logged, 409 on duplicate athleticsEmail.
- 2026-05-21: Data Export settings (roadmap slice 2). New `/settings/data-export` (System, ADMIN) surfaces all five CSV exports in one place. Items, Users, and Licenses reuse existing endpoints; new `GET /api/bookings/export` and `GET /api/audit/export` added. All capped at 5,000 rows with truncation headers + toast warning.
- 2026-05-20: Kiosk always-on sessions (Settings roadmap slice 1). Removed the 7-day kiosk session expiry — `createKioskSession` no longer stamps `sessionExpiresAt` and `requireKiosk` no longer rejects on elapsed time, so a bound iPad stays active until an admin deactivates it. The kiosk cookie is now rolled forward on every authenticated kiosk request (~395-day expiry) to survive browser cookie-lifetime caps. Deactivation still clears `sessionToken`, ending the session at once. Removed the now-dead "Session expiring" badge, "Session expires" footer, and `sessionExpiresAt` exposure from the kiosk-devices list. The `session_expires_at` column is retained (unused, nullable) — a pure-hygiene drop can follow later.
- 2026-05-21: Design language Area 4 Settings follow-through shipped. Settings sub-pages were inventoried for `SettingsPageShell`, shared inline empty states, shared row actions, destructive confirmation copy, and sub-40px controls. Extend Presets remove controls, Kiosk pending-pickup/copy/cancel controls, Allowed Emails add-mode controls, and Database initial empty state were aligned with the shared operational baseline.
- 2026-05-20: Settings actions, empty states, and warning copy cleanup shipped. Calendar Sources, Venue Mappings, Locations, Departments, Allowed Emails, and Kiosk Devices now use the shared row-action trigger where rows have destructive or multi-step actions; remaining text-only empty states moved to shared inline empty states; destructive confirmations now name the target and operational consequence.
- 2026-05-20: Settings shell cleanup shipped. Settings sub-pages now share one `SettingsPageShell` for the intro column and main content, reducing repeated split-grid markup and keeping loading, error, and normal states aligned under the new grouped rail.
- 2026-05-20: Settings navigation rail shipped. Large desktop Settings now uses a grouped left rail for Overview, Personal, People, Inventory, Scheduling, Devices, and System while preserving the horizontal section scroller on smaller screens, role-gated visibility, search palette, and last-tab resume behavior.
- 2026-05-20: Design language slice 7. Settings Categories and Departments now use shared inline empty states instead of local text-only placeholders, keeping first-run and filtered-empty recovery copy aligned with the rest of the app.
- 2026-05-20: Design language slice 6. Settings Categories row actions now use the shared `OperationalRowActions` trigger, replacing the page-local kebab button while preserving rename, add subcategory, and delete behavior.
- 2026-05-20: Design language slice 4. Settings now links to the shared design-language reference while preserving the Settings-specific layout rule that the layout owns the page header and tab navigation.
- 2026-05-13: Appearance polish. Light/Dark/System switching now runs through a shared theme controller used by both Appearance and the Sidebar, keeps System as a no-override localStorage state, and adds a short reduced-motion-safe theme transition without animating first paint.
- 2026-05-12: Creation flow standardization. Categories, Departments, Locations, and Allowed Emails add forms now show visible form-level validation/API/network errors and keep submit/cancel controls in a clear disabled state during slow saves.
- 2026-05-12: Security audit patch. Kiosk device deactivation now clears both the stored session token and `sessionExpiresAt`, matching the server-side kiosk expiry model documented in `AREA_KIOSK.md`.
- 2026-05-10: Schedule ownership pass. Sports shift-generation activation now uses the shared Switch control with an explicit Active/Off badge, keeping the schedule-feeding settings page aligned with the rest of the app's control system.
- 2026-05-10: Component audit closeout. Database diagnostics now keeps result-list React keys stable even when duplicate migration/table labels are returned, clearing the console warning found during authenticated Settings smoke.
- 2026-05-10: Breadcrumb first-class UX pass. The Settings/Reports parent crumb dropdowns now inherit the stronger global breadcrumb shell treatment, keep role filtering intact, and show clearer menu framing with current-page indicators plus Settings section descriptions from `nav-sections.ts`.
- 2026-05-09: Settings control-map UI polish. `/settings` is now represented as an active Overview tab in the shared settings nav, and the role-aware control map now surfaces current role, visible section/group counts, destination role badges, tighter group cards, and stronger focus/hover row treatment without changing section permissions or subpage behavior.
- 2026-05-08: API hardening Wave 9. Allowed Emails add/bulk-add no longer reveals registered or already-allowlisted addresses via 409s or skipped-address lists; duplicate inputs return generic skipped success/counts.
- 2026-03-17: Initial area doc created. Settings layout upgraded to tab navigation pattern. Sports page extracted into ShiftConfigTable + RosterPanel + types. Categories page extracted into CategoryRow + KebabMenu + types + tree utils. Mobile card layouts added for sports and roster. Role badges standardized (ADMIN=purple, STAFF=blue, STUDENT=gray). Escalation and Database pages polished with data-table-wrap for mobile scroll. Sidebar titles normalized to h2 (layout provides h1).
- 2026-03-19: Calendar source health UI shipped (`/settings/calendar-sources`) — enable/disable toggle, sync status badges, error display, add/delete sources.
- 2026-03-24: Venue mappings shipped (`/settings/venue-mappings`) — admin-only regex-to-location mapping, pattern validation, priority tie-breaking (D-027).
- 2026-03-25: Breadcrumb V1–V3 + polish shipped. Duplicate removed, entity names on detail pages, sibling quick-jump on Settings/Reports parent crumbs, loading skeleton, recently visited entities.
- 2026-04-03: Allowed emails shipped (`/settings/allowed-emails`) — registration gating (D-029). Add/delete email allowlist entries with role pre-assignment. STAFF adds STUDENT only; ADMIN adds both. Claimed entries preserved.
- 2026-04-06: Doc sync — added 3 missing sub-page sections (Calendar Sources, Venue Mappings, Allowed Emails). ACs expanded from 7 to 10. Changelog backfilled.
- 2026-04-07: Hardening pass — all 7 settings pages migrated from raw fetch() to useFetch hook (AbortController, 401→login redirect, visibility refresh). All mutations hardened with handleAuthRedirect(returnTo) + classifyError + isAbortError. CategoryRow component also hardened. Database page uses on-demand fetch with classifyError. Hardening score 2/5 → 4/5.
- 2026-04-25: MVP audit (slice 1) — settings tabs are now role-aware. `SETTINGS_SECTIONS` carries a `requiredRole` and the layout filters tabs the current user can't use (Bookings / Escalation / Kiosk / Database hidden for STAFF). Layout shell (header + tab nav) renders immediately while `/api/me` resolves, replacing the blank-page flicker on every settings nav with a content-shaped skeleton. Tab nav scrolls horizontally on narrow viewports.
- 2026-04-25: MVP audit (slice 2) — UI hardening pack. Categories Add input now guards against the onBlur+Enter double-submit race (no more duplicate categories on slow networks). Database page no longer surfaces raw server error strings (replaced with intent-based messages). Escalation timing column rendered as muted read-only text with a header hint that timings are fixed (D-009). Allowed Emails claimed-row trash icon is now a disabled icon with a tooltip explaining the user must be deactivated instead of removed.
- 2026-04-25: MVP audit (slice 3+4) — Bookings save button is now always rendered (disabled when clean → "Saved", enabled when dirty → "Save changes"), and a beforeunload guard warns before navigating away with unsaved presets. Sports group cards now show "applies to MXC + WXC" when a group writes to multiple sport codes, replacing the bare code-list that masked the silent cross-write. Kiosk Devices: pending-activation devices now have a "Regenerate code" button (POST /api/kiosk-devices/[id]/regenerate-code) so an accidentally-closed activation dialog no longer forces a delete-and-recreate. Activated kiosks reject regenerate with 409 (must deactivate first).
- 2026-04-25: MVP audit (slice 5) — per-user rate limits applied to every settings mutation endpoint (categories, calendar-sources, location-mappings, sport-configs, allowed-emails, kiosk-devices, locations, escalation, extend-presets, kiosk regenerate). Default budget is 60 writes/min/user via the new `SETTINGS_MUTATION_LIMIT` preset; calendar sync is tighter at 10/min/user since it hits an external ICS URL. Adds `enforceRateLimit` helper that throws HttpError(429) with a Retry-After hint.
- 2026-04-25: MVP audit (slice 6) — doc backfill. Sub-page sections added for Bookings (extend presets) and Kiosk Devices, both shipped previously without an AREA narrative entry.
- 2026-04-25: MVP audit (slice 7, final P1) — Sports group updates are now atomic. New `POST /api/sport-configs/group` accepts a list of codes and a single patch, applying all upserts inside one Prisma transaction (Serializable isolation) — replaces the prior client-side loop of N sequential PATCHes that could half-apply on partial failure. Shift-count edits, call-time edits, and the active toggle on grouped sports (Cross Country, Golf, Rowing, Soccer, Swimming, Tennis, Track) all flow through it. Settings audit P1 list now fully closed.
- 2026-04-25: P2 polish pack — feedback toasts on Categories rename / add / Sports group save / Escalation toggles; Categories search keeps the full ancestor chain visible; Categories sort indicator switched to Lucide ArrowDownAZ/ArrowUpAZ; Calendar Sources stale threshold bumped 24h → 30h; Kiosk Devices show an "Offline" badge after 24h without a check-in; Allowed Emails gains a bulk-paste mode (up to 50 per batch) and live counts on the All / Pending / Claimed filter; Kiosk Devices page brought up to par with the 2026-04-07 hardening pattern (returnTo on useFetch, classifyError + isAbortError on every catch). D-027 reconciliation: location and location_mapping permissions tightened to ADMIN-only to match the spec (was STAFF+ in code), and the Venue Mappings settings tab now requires ADMIN.
- 2026-05-01: Breadcrumb sibling-jump dropdown is now role-aware. STUDENT users no longer see ADMIN-only entries (Locations, Venue Mappings, Database, Escalation, Kiosk, Bookings) when opening the Settings parent crumb on a page they can access (Notifications / Appearance) — clicking a hidden entry would have landed them on a blocked route. Filtering reuses the new `meetsRoleRequirement(required, role)` helper in `nav-sections.ts`. Same audit dropped 19 redundant `LABEL_MAP` entries, lifted the per-render `localStorage` read in `PageBreadcrumb` into a `useMemo`, and aligned the recents-cap constants (`MAX_RECENT_PER_SECTION` / `MAX_RECENT_TOTAL`).
- 2026-04-25: P2 — `/settings` index now resumes the user's last-visited tab from localStorage (`settings:last-tab`), validated against `SETTINGS_SECTIONS`. Layout writes the key on every navigation. Falls back to Categories on first visit or when storage is unavailable.
- 2026-04-25: P2 — new `/settings/locations` tab (ADMIN-only). Full CRUD for the locations catalog: add with optional address, inline rename, inline isHomeVenue toggle, soft-delete (deactivate) that preserves FK references and surfaces a deactivated section with reference counts. New endpoints: `GET /api/locations?includeInactive=1` (admin gets inactive too, plus `_count` of users/assets/bookings/kiosks/mappings) and `POST /api/locations` (rate-limited; rejects duplicate names with 409). Home Venue toggling removed from `/settings/venue-mappings` and folded into Locations; that page is now venue-pattern-only.
- 2026-04-25: P2 — inline "last edited by/when" context. New `POST /api/audit/last` accepts `{ entityType, entityIds[] }` and returns the most-recent audit entry per id (action, createdAt, actor) in one round trip — backed by the existing `(entityType, entityId, createdAt)` index on AuditLog. Wired via `useLastAudit` hook + tiny `LastEditedHint` component into the Locations and Allowed Emails surfaces (highest-leverage admin tables). Renders nothing when no audit entry exists, so untouched rows aren't visually disrupted.
- 2026-04-25: Personal — Notifications + text-size picker. New `/settings/notifications` (everyone-visible) ships pause-everything (1h / 1d / 1w) plus Email and Push channel master switches. Backed by a new nullable `users.notification_prefs` JSONB column (migration `0046_user_notification_prefs`); null = receive-everything so existing users have zero behavior change. Enforcement wired through the existing `sendPushToUser` wrappers in `notifications.ts` + `licenses.ts` and a new `sendEmailToUser` wrapper for the four email dispatch sites in the booking/escalation/shift-gear-up paths. New `GET/PUT /api/me/notification-preferences` is the admin/staff/student API. Appearance also gains a Text size picker (Small / Default / Large / Extra large = 0.9 → 1.3 multiplier on a new `--text-scale` CSS var); cold-load script applies both choices on first paint.
- 2026-04-25: IA — Settings is no longer admin-only. New top-of-nav **Personal** group hosts user-preference tabs that every authenticated user sees, including STUDENTs. First entry is **Appearance** (Light / Dark / System theme picker, saved to `localStorage:theme`, mirrors the cold-load script in `src/app/layout.tsx`). Layout auth gate relaxed from "ADMIN | STAFF" to "any authenticated role"; non-auth users still bounce to `/login`. The `/settings` index now picks the user's last-visited tab if their role still has access, otherwise falls back to the first section their role can see (so a STUDENT lands on Appearance, not Categories). `SettingsRole` is now a tri-state with rank ordering (STUDENT < STAFF < ADMIN); `isSectionVisible` uses the rank instead of two ad-hoc cases. Notifications preferences are the next planned Personal tab — needs schema work and is tracked separately.
- 2026-04-25: P2 — Test-before-save affordances. Calendar Sources Add form has a "Test" button next to the URL input that probes the feed via new `POST /api/calendar-sources/test` (8s timeout, 5 MB cap, 10 probes/min/user). Result panel reports reachability, content type, byte size, parsed event count, and the first three event summaries — admins see whether they pasted a valid feed before committing. Venue Mappings Add form pairs the pattern input with a live regex tester: a sample-text box + immediate "✓ Matches X" / "✗ Does not match" / "✗ Invalid regex: Y" feedback, all client-side.
- 2026-04-25: P2 — settings IA + density pass. `SETTINGS_SECTIONS` now carries `group` (People · Inventory · Scheduling · Devices · System) and `description` + `keywords` for each section. The tab nav is reordered into those groups with thin dividers between them. The `/settings/bookings` tab is relabeled to **Extend Presets** (route unchanged for compatibility). New ⌘K / `/` search palette (`SettingsCommand`) opens a CommandDialog over the visible-to-this-role sections; matches by label, description, and keyword aliases (so admins can find pages by intent — e.g. "allowlist", "cron", "home venue"). Sidebar density: every settings sub-page bumped from `max-md:` to `max-lg:` — the 260px decorative sidebar collapses to a one-line subhead at <1024px, giving 13" laptops more horizontal room for the actual table without rewriting any layout.
- 2026-05-06: Ownership pass - added `/settings/departments` under Inventory so staff/admins can manage department names and active state from Settings instead of relying on import side effects or item forms. Department APIs now support include-inactive reads with serialized/bulk usage counts plus PATCH rename/deactivate/reactivate with audit logging and settings rate limits. Extend Presets now accepts an empty saved list, matching the UI's "custom option only" empty state.
- 2026-05-06: Ownership pass slice 2 - `/settings` now renders a role-aware control map instead of immediately redirecting to the last visited tab. The previous last-tab behavior is preserved as a Resume action so direct Settings navigation is useful while still supporting fast return workflows.
- 2026-05-06: Ownership pass slice 3 - Departments now show last-edited audit context, matching the higher-signal admin catalog pattern from Locations and Allowed Emails. Department create now writes first and handles Prisma unique conflicts, preserving inactive reactivation behavior without a find-then-create race.
- 2026-05-06: Ownership pass slice 4 - Categories adopted the useful catalog hardening without adding a new active-state model. Category create/rename now trims names, blocks same-level duplicates with clear 409s, prevents moving a category under its own descendant, and surfaces last-edited audit context in the tree.
- 2026-05-08: API hardening Wave 13 - Category parent checks now have a bounded depth cap, system-config audit rows include an explicit first-create `before` state, and audit last-lookups are rate-limited by actor.
