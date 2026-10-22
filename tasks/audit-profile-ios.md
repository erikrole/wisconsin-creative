# Audit: profile / preferences (iOS) — 2026-05-08

**MVP verdict (pre-fix):** ships, but the highest-traffic preference (mute push) is web-only.
**Ship bar:** student-friendly, fully functional for core flows, zero hiccups in front of a class.
**Audit type:** static source (no build/run/UI tests).

Scope: `ProfileView` in `ios/Wisconsin/Views/AppTabView.swift` (presented as a sheet from `HomeView`'s top-leading avatar), plus the push-permission lifecycle in `WisconsinApp` / `AppDelegate` / `PushPrePromptView`. Excludes admin/config sub-pages (`/settings/categories`, `/settings/locations`, etc.) — those are web-only by [iOS = day-to-day ops](feedback memory).

## Web parity baseline

- `/profile` — redirects to `/users/{me}` (the standard user detail page).
- `/settings/notifications` — quiet-hours pause (1 h / 1 d / 1 w + Resume), email + push channel toggles, in-app inbox always-on caveat. Backed by `GET/PUT /api/me/notification-preferences`.
- `/settings/appearance` — theme (light / dark / system), text size (4 levels). Per-device, localStorage only.
- `/settings/*` (sub-pages: categories, locations, allowed-emails, kiosk-devices, escalation, departments, sports, venue-mappings, calendar-sources, database) — power-user authoring, **stays web**.

## P0 — blocks MVP

- [x] [Gaps] **No way to mute push from inside the iOS app.** `ProfileView` exposes nothing for notification preferences. A student in class who wants to silence overdue/shift pings has to open Safari, sign in to the web, and use `/settings/notifications`. The endpoint already exists (`/api/me/notification-preferences`) and ships on web; iOS has zero UI surface, zero APIClient methods, zero models.
      `ios/Wisconsin/Views/AppTabView.swift:88-127` (sections present today: Account, Stats, optional Dev Tools, App, Sign Out — no Notifications).
      Why it matters: this is the canonical "I'm on my phone, mid-shift, please stop pinging me" use case. iOS = day-to-day ops; web ≠ where students go to silence push. The `PushPrePromptView` flow asks for permission once and then offers no in-app dial — the only escape is muting at the OS level, which kills *all* notifications including in-app inbox pings the user wants.
      Suggested fix: add a "Notifications" section to `ProfileView` that mirrors web: pause 1 h / 1 d / 1 w, Resume Now if paused, email + push channel toggles, in-app inbox caveat footer. Wire `APIClient.notificationPreferences()` (GET) + `updateNotificationPreferences(_:)` (PUT) against `/api/me/notification-preferences`. Add `NotificationPreferences` Codable to `Models.swift`.

## P1 — polish before ship

- [x] [Flows] **No visibility into the OS push permission state.** If the user denied at the system prompt (or the kid handed to a sibling who tapped Don't Allow), `ProfileView` and `PushPrePromptView` both stay silent — the user thinks notifications are on, but APNs never registers. Web's "Push" toggle has the same problem (it can't see iOS system state), but on iOS we can.
      `ios/Wisconsin/App/AppDelegate.swift:25-27` — failure prints to console only.
      Why it matters: silently broken push is the #1 reason students miss "due back" reminders and overdue escalations. Floor staff has no way to triage.
      Suggested fix: in the new Notifications section, read `UNUserNotificationCenter.current().notificationSettings()` on appear; if `authorizationStatus == .denied`, show an inline row "Push disabled in iOS Settings" with a tappable "Open Settings" button (`UIApplication.openSettingsURLString`). If `.notDetermined`, show "Turn on notifications" that re-presents `PushPrePromptView` (or directly requests). If `.authorized` but the network channel toggle is off, show channel state as the truth.

- [x] [UI polish] **`ProfileView` first appears as a `.large` sheet, but the content list is short (six rows + one section per role).** Using a single fixed `.large` detent forces a floor user to dismiss before doing anything else; web's `/users/{me}` has the same density but lives at a real route so it doesn't feel cramped at full screen.
      `ios/Wisconsin/Views/HomeView.swift:269-272` (`.presentationDetents([.large])`).
      Why it matters: minor, but the sheet eats the whole screen for what's a short list. Adding `.medium` lets the user peek + dismiss faster.
      Suggested fix: use `.presentationDetents([.medium, .large])` with `.presentationDragIndicator(.visible)`. Keeps the same `.large` first impression once the new Notifications section adds rows.

- [x] [Hardening] **`isDevRole` says STAFF + ADMIN but the only entry inside is "Link Sticker Codes" — a real production tool, not a dev tool.** Heading is misleading. STAFF will skip the section thinking it's debug-only.
      `ios/Wisconsin/Views/AppTabView.swift:65-68, 115-123`.
      Suggested fix: rename `Section("Dev Tools")` → `Section("Tools")`. (The boolean is fine — it gates STAFF + ADMIN as intended.)

- [x] [Flows] **No path to deep-link to iOS Settings → Wisconsin from inside the app.** Even outside the push case, students sometimes need to tweak the OS-level Wisconsin entry (Cellular data permissions, etc.). One-line affordance on the App section.
      `ios/Wisconsin/Views/AppTabView.swift:125-127`.
      Suggested fix: add a "Open iOS Settings" `Link(destination: URL(string: UIApplication.openSettingsURLString)!)` row under the Notifications block (when push is denied) or under "App". Keep it ultra-cheap.

- [x] [Hardening] **No optimistic-update revert if PUT to `/api/me/notification-preferences` fails.** This is fresh code on iOS so applies to the new section: web shows a toast and reloads on error; we should match (and add a `Haptics.warning()`).
      Suggested fix: in the new view-model, store `prevState` before mutating; on error, revert UI + `Haptics.error()` + show inline alert ("Couldn't save — try again"). Match the web's `reload()` fallback.

## P2 — post-MVP

- [x] [Parity] Theme override (light / dark / system) — web has it at `/settings/appearance`. iOS already follows the system theme automatically; manual override is a power-user nicety. Implemented as a 3-button row in a new "Appearance" section, persisted via `@AppStorage("WisconsinThemeChoice")` and applied via `.preferredColorScheme(_:)` at `RootView`. No server round-trip — same per-device contract as web.
- [ ] [Parity] **Deferred.** Avatar upload from iOS — web's user detail page lets you change your avatar via `/api/profile/avatar` (PUT image). iOS reads `currentUser.avatarUrl` but offers no upload affordance. Floor users rarely change their avatar; defer until iOS users page (the "view yourself" surface) lands.
- [ ] [Parity] **Deferred.** Text size override — iOS has Dynamic Type at the OS level (which the app already inherits). A per-app text size dial would duplicate Settings → Display & Brightness → Text Size; not worth the surface. Web has it because the browser has no Dynamic Type equivalent.
- [ ] [Hardening] **Deferred.** "Sign out from all devices" as a separate destructive action. Today, Sign Out already calls `revokeAllDeviceTokens()` then `logout()` — same effect. A dedicated row adds confusion without adding power.
- [ ] [Hardening] **Deferred.** Biometric (Face ID) re-auth on Sign Out / sensitive surfaces. Same disposition as the login audit — wait until session model needs it.
- [ ] [Polish] **Deferred.** "About" / acknowledgements / open-source licenses screen. Wisconsin is a closed app; no MIT-licensed dep currently mandates attribution.

## Acceptance criteria status

There is no `AREA_PROFILE.md`. AC inferred from `AREA_MOBILE.md` + `AREA_NOTIFICATIONS.md` + `AREA_USERS.md`:

- [x] AC: user can see their identity (name, email, role) without leaving the app — `ProfileView` header + Account section.
- [x] AC: user can sign out with confirmation — `confirmationDialog`, destructive Sign Out button.
- [x] AC: STAFF + ADMIN can reach the overdue report from Profile — `ProfileDestination.overdueBookings` → `OverdueReportView`.
- [x] AC: app version is visible — App section.
- [x] AC: user can manage their account on web — `Link` now resolves through AppEnvironment to `wisconsincreative.com`.
- [x] AC: user can pause notifications from iOS — **closed by P0 fix.**
- [x] AC: user can toggle email + push channels from iOS — **closed by P0 fix.**
- [x] AC: user is informed when iOS push permission is denied — **closed by P1 fix.**

## 2026-08-20 Real-Device Pass

Account & Security was opened on a physical iPhone 16 Pro running build 27, signed in as an ADMIN account.

- [x] The passkey section renders on device: explanatory copy, current-password field, optional name field, a correctly disabled **Add Passkey** button while the password field is empty, and the enrolled list with per-row delete.
- [x] Three enrolled passkeys decode and display with added/last-used dates. One shows a same-day `Used Aug 20, 2026`, so passkey sign-in is exercising on real hardware, not only in source.

- [ ] [UX] **An unnamed passkey is stored as the literal string "This device", which stops being true immediately.** `src/lib/passkey.ts:47` falls back to `"This device"` when no name is supplied. The name is captured at enrollment and never revisited, so it describes wherever the user happened to be at the time. On the device pass this was visibly wrong: the entry called *This device* was last used Jul 31 while the entry called *iOS* was used the same day, so the one word claiming to be the current device was the one that was not.
      Suggested fix: default to something that stays true without being deictic -- the platform plus enrollment date, e.g. `iPhone · Jul 31` -- and leave "This device" to the web badge, which computes it live against the current credential rather than storing it. Names for existing rows should not be rewritten; only the default for new ones.

## Lenses checked
- [x] Gaps
- [x] Flows
- [x] UI polish
- [x] Hardening
- [x] Parity (web ↔ iOS)
- [x] Accessibility (existing `accessibilityLabel`s preserved; new Notifications section adds labels for paused state)


## Avatar follow-up — 2026-10-22 (local)

`Views/Components/ProfileAvatarEditor.swift` is owned by the current `Views/ProfileView.swift` header. PhotosPicker, concurrent ImageIO downsampling, the crop sheet, explicit removal confirmation, account-bound requests, stale-photo checks, exact-upload reconciliation and immediate account-avatar refresh now cover add/change/remove outside Welcome. The crop sheet uses a system UIScrollView for pan/pinch with a circular guide, dimmed context and VoiceOver actions; no sliders. Gestures pause during a save; failed saves retain the crop and display the actual recovery message. Profile read-only previews cannot mutate photos. The shared store avoids accepting pre-mutation reads after a save and rejects old-session responses.

Evidence: native target build, model/image tests, web-side Swift contracts and iPhone 18 Pro Max crop-retry UI test. Review: `tasks/archive/proofs/onboarding-continuity-2026-10-22/review.html`. Actual photo-library selection, camera/device permission behavior, an authenticated shared-backend avatar upload and distribution remain pending in the continuity ledger. This supplements the historical audit above; it is not a new whole-Profile runtime audit.
