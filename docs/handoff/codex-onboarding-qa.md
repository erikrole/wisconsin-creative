# Codex handoff: QA PR #584 (student onboarding)

Repo: erikrole/wisconsin-creative. PR: #584 (draft), branch `claude/project-thread-kggsp1`. Six new students start next week, so this is the path from invite email to their first look at Home. Report findings; fix only small, clear bugs on this branch.

## What changed
Web (wc-fresh theme, Lato):
- `/welcome` setup redesigned: single column, segmented step bar, one question at a time, mobile footer stacks (src/app/(app)/welcome/page.tsx, src/components/profile-completion/ProfileCompletionWizard.tsx, page presentation only).
- New finish screen `WelcomeDone.tsx`: "You're all set" with Schedule, Gear (/bookings), Guides (/resources), iPhone app. Collaborators see only the app row. Stopping early (Remind me tomorrow, or skipping the photo) shows "Setup paused".
- Anticipated graduation is no longer required (completion math in src/lib/profile-completion.ts, PATCH /api/me/profile-completion accepts year alone). Label unchanged, not marked optional. Students now have 7 required details.
- Home "Getting started" card for 14 days (`GettingStartedCard.tsx`, `accountCreatedAt` added to GET /api/me). Students: profile, can't work, schedule, guides, app. Staff/admin: profile, build a crew, see who's set up, guides, app. Progress is shared with iOS through `GET/PATCH /api/me/getting-started` (users.getting_started, PATCH only adds); the old per-browser copy is uploaded once.
- Invite email lists what happens next; login invite notice reworded. Adding one student or staff member in the invite dialog now emails the invite right away ("Email the invite now", on by default; bulk and collaborator adds never send). `POST /api/allowed-emails` `sendInvite: true`, audit `invite_sent`.
- No welcome email after setup (Erik dropped it to avoid email fatigue). Students get one email: the invite. The finish screen and Home card cover next steps.
- Optional "When can't you work?" page, `/welcome/availability` (Erik: not just classes; other jobs and time out of town too). Two sections: "Every week" (classes, a job, practice: name, day circles, from/to, repeats until, defaulting to an end-of-term guess) and "Days away" (what for, from/through dates, All day switch on by default, times when off). Weekly items save one weekly CANNOT_WORK block per day; days away save one AD_HOC CANNOT_WORK block with `dateEndsOn`, all through the existing `/api/users/[id]/availability`, so scheduling, conflicts and the staff Availability tab read them unchanged. Never required; "Skip for now" marks the Home row handled. Helpers in src/lib/unavailable-times.ts.
- Getting started card has an "Add when you can't work" row, checked off once any CANNOT_WORK block exists (any device). The student finish screen lists it first.
- Everyday "can't work": student workers (staffingType ST) see a "Can't work" card on Home under Up next (upcoming days away, weekly names, "Add days you can't work", "All times" to /welcome/availability) and a "Can't work" button in the Schedule header. Both open `CantWorkDialog` (src/components/availability/), one AD_HOC CANNOT_WORK block. After saving, if the student is on a shift in that stretch (`/api/my-shifts` window, `shiftsDuring`), the dialog lists those shifts with "Post to Trade Board" each (student presses it; nothing automatic). Staff, admins, collaborators and read-only previews never see it.
- Onboarding Status (/staff/onboarding-status): invites unclaimed after 3 days (was 14) show "Not signed in"; signed-in accounts with setup unfinished after 3 days show "Stalled N days", sort first, get a rail item, filter and a "Nudge everyone stalled" button (staff press only, nothing automatic). Students with no CANNOT_WORK blocks show "Hasn't added when they can't work". API adds `createdAt` and `hasUnavailableTimes` (students only) per account. Actions column widened so Nudge/Open no longer overlap the Next text.
- Staff/admin finish screen: Schedule (crews), See who's set up (/staff/onboarding-status), Gear, Guides, app.
- Invite create-password page (and every `AuthScreen` page: login, forgot, reset, change password) restyled to match the native iPhone sign-in: flat ink background, dark field wells, 52px light pill button, no crimson card (src/components/auth/AuthScreen.tsx, `.login-*` in globals.css, LoginForm.tsx). Behavior unchanged.
- Release note added to src/lib/releases.json (pr 584).

iOS (SwiftUI):
- Student step Continue needs only the year; graduation sent only when a term is chosen (ProfileCompletionDraft.swift).
- New `WelcomeFinishView.swift` after the last step, after skipping the photo, and after Remind me tomorrow. Rows open Schedule, Gear, Guides. No iPhone-app row on iOS. Registered in scripts/ios-audit-inventory.sh.
- Home Getting started card (`GettingStartedCard.swift`), students only, first 14 days (`accountCreatedAt` decoded from /api/me): Finish your profile, Add when you can't work (opens the existing Availability screen in a sheet; done once any CANNOT_WORK block exists, same rule as web), Check the schedule, Read the guides, Turn on shift reminders (opens Profile > Notifications, never prompts). Progress per device in UserDefaults; X hides it. DEBUG scenario `GT_PERFORMANCE_SCENARIO=home-getting-started`.

## Migration
`0199_user_getting_started`: one nullable JSONB column `users.getting_started`. Additive; the production build applies it (`npm run build` runs migrate deploy). Recheck the prefix against main before merging (`npm run db:migrate:check`).

## How to run it
- No database needed: `npm run review 584` (worktree beside the checkout; DB-free because the branch has no preview database, and none will be created). DB-free pages:
  - `/dev-welcome?role=STUDENT|STAFF|COLLABORATOR&view=setup|done|later|availability&filled=0..3&theme=dark` (`view=availability` calls `/api/users/dev-welcome/availability`; mock it, as the screenshots did)
  - `/dev-home?role=STUDENT&firstrun=1` (also shows the Can't work card; its Add dialog posts to `/api/users/dev/availability`, mock it)
  - `/login`
- Real invite -> password -> Welcome -> Home flow needs a database. Local option only: Postgres 17 on loopback, apply migrations the way scripts/check-postgres-integrity.mjs does, add an unclaimed AllowedEmail (STUDENT), and run the app against it. The app uses the Neon websocket adapter (src/lib/db.ts), so a plain local Postgres also needs a Neon wsproxy plus a local-only loopback tweak to db.ts that must never be committed. Erik found this too heavy, so skip it unless you must. Otherwise rely on tests and the lab pages.
- Screenshots: the project files folder student-onboarding/ (web; not visible from the Mac, ask Erik if needed). iOS finish-screen shots are on Erik's Mac in /Users/role/Code/welcome-finish-shots/.

## QA checklist
- [ ] Invite email (Settings > Allowed Emails > resend): steps list, forgot-password line in the footer, button opens /login?email=... prefilled. Needs RESEND_API_KEY and EMAIL_REPLY_TO in Vercel (Erik has not confirmed).
- [ ] Add one student with "Email the invite now" ticked: one email arrives, toast says emailed, audit log has invite_sent; unticked sends nothing; bulk add sends nothing.
- [ ] Login with an invited email shows the invite notice, name + password + confirm, then /welcome.
- [ ] Student steps: Phone, Wiscard, Student, Apparel, Photo (no email step). Student step continues with year alone; graduation can stay blank. Back and the step bar navigate; Apparel and Photo can be skipped.
- [ ] Staff/admin also see the Email step. Collaborator: photo only.
- [ ] Finishing shows "You're all set" with working links; Go to Home goes to `/`.
- [ ] Remind me tomorrow or skipping the photo shows "Setup paused"; Home still shows the profile banner.
- [ ] Reload mid-setup resumes at the first incomplete step.
- [ ] Home, new account under 14 days: student and staff versions of Getting started; Finish profile opens the wizard; other rows check off after a click; X hides it; a row checked on the web shows checked on iPhone and back; never shown to collaborators, read-only previews or accounts older than 14 days.
- [ ] When can't you work (`/welcome/availability`, student): add a weekly item on several days, it shows as one row (e.g. "M W F · 9:30 AM – 10:45 AM"); remove deletes every day; To before From shows an inline error and disables Save; add days away (all day, then a part-day with times), it shows "Wed, Nov 25 – Sun, Nov 29"; Through before From is blocked; only one form open at a time; Skip for now and Done go Home; Home row checks off after any entry; the staff Availability tab on the student's profile shows the same blocks; a shift during a weekly item or days away shows the usual advisory conflict.
- [ ] Home "Can't work" card (student worker): lists upcoming days away soonest first (max 3 plus "+N more"), past entries drop off, weekly names line, Add opens the dialog and the new entry appears after save; Schedule header "Can't work" button opens the same dialog; neither shows for staff/admin or a non-ST student.
- [ ] Block a day you're scheduled: the "You're on the schedule then" step lists only clashing shifts (all-day events by date, part-day blocks by hours); Post to Trade Board creates an OPEN trade and shows Posted; an already-posted shift shows the API error inline; no clash closes the dialog.
- [ ] Onboarding Status: "Not signed in" after 3 days, "Stalled N days" for unfinished setup after 3 days, Stalled filter and rail item, Nudge everyone stalled sends one reminder each and reports the count, "Hasn't added when they can't work" only for students; Nudge/Open don't overlap text at desktop width.
- [ ] Staff/admin finish screen shows Schedule, See who's set up, Gear, Guides, app; links work.
- [ ] No email is sent when setup finishes.
- [ ] Auth pages (/login invite and password steps, /forgot-password, /reset-password, /change-password): labels, email row and placeholders readable on the dark surface; focus ring visible on fields and the pill button; Tab order works; passkey button and "Keep me signed in" checkbox look right; errors still show; 390px has no horizontal scroll.
- [ ] 390px width: no horizontal scroll, footer buttons full width. Dark mode readable. Keyboard focus on step bar and finish rows.
- [ ] iOS Getting started card: shows for a new student only; each row opens the right screen; the availability row checks off after adding a weekly item or days away; X hides it.
- [ ] iOS: year-only Continue; finish screen after last step, after skipping photo, after Remind me tomorrow; rows open Schedule, Gear, Guides; Continue enters the app; collaborator sees Continue only.

## Verified vs not
Verified: tsc, eslint on touched files, vitest (unavailable-times, invite email, profile-completion, route, Swift source contracts, ios-audit-inventory), db:migrate:check, Postgres integrity run, Xcode build, Playwright screenshots of the lab pages, iOS finish-screen screenshots.
Not verified: the real signup-to-Home flow in a browser, iOS card row taps in the simulator (iOS card wording was changed after its Xcode build; string and identifier renames only), the availability page against a real API, iOS row navigation and the Welcome route hold at runtime, the Home card against a real account's accountCreatedAt. `verify:docs` shows codemap drift that already exists on main.

## Constraints
- Never create a Neon branch or Vercel preview; never touch production data or credentials. Only main deploys (PR #556).
- Do not commit local-DB scaffolding (db.ts tweak, wsproxy, seed scripts).
- Stage explicit paths only; do not merge. Erik merges. Every PR keeps its release note.
- Web redesigns stay in wc-fresh (Lato); iOS keeps Gotham and system controls.
