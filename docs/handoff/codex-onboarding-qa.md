# Codex handoff: QA PR #584 (student onboarding)

Repo: erikrole/wisconsin-creative. PR: #584 (draft), branch `claude/project-thread-kggsp1`. Six new students start next week, so this is the path from invite email to their first look at Home. Report findings; fix only small, clear bugs on this branch.

## What changed
Web (wc-fresh theme, Lato):
- `/welcome` setup redesigned: single column, segmented step bar, one question at a time, mobile footer stacks (src/app/(app)/welcome/page.tsx, src/components/profile-completion/ProfileCompletionWizard.tsx, page presentation only).
- New finish screen `WelcomeDone.tsx`: "You're all set" with Schedule, Gear (/bookings), Guides (/resources), iPhone app. Collaborators see only the app row. Stopping early (Remind me tomorrow, or skipping the photo) shows "Setup paused".
- Anticipated graduation is no longer required (completion math in src/lib/profile-completion.ts, PATCH /api/me/profile-completion accepts year alone). Label unchanged, not marked optional. Students now have 7 required details.
- Home "Getting started" card for STUDENT accounts for 14 days (`GettingStartedCard.tsx`, `accountCreatedAt` added to GET /api/me; checklist state is per browser in localStorage).
- Invite email lists what happens next; login invite notice reworded.
- One-time welcome email when a student/staff finishes setup (src/lib/services/welcome-email.ts). Sent from the PATCH route and the self avatar upload. Not for collaborators or hidden users. Claim is atomic on `users.welcome_email_sent_at`; a failed send releases it.
- Release note added to src/lib/releases.json (pr 584).

iOS (SwiftUI):
- Student step Continue needs only the year; graduation sent only when a term is chosen (ProfileCompletionDraft.swift).
- New `WelcomeFinishView.swift` after the last step, after skipping the photo, and after Remind me tomorrow. Rows open Schedule, Gear, Guides. No iPhone-app row on iOS. Registered in scripts/ios-audit-inventory.sh.

## Migration
`0199_user_welcome_email`: adds `users.welcome_email_sent_at` and backfills every existing user to NOW() so nobody is emailed at rollout. Main ended at 0191 earlier; 0192-0198 are reserved by open PRs. Recheck for a collision before merging. Apply 0199 before deploy. `npm run db:migrate:check` passes; the migrations applied cleanly on a local Postgres 16 through scripts/check-postgres-integrity.mjs.

## How to run it
- No database needed: `npm run review 584` (worktree beside the checkout; DB-free because the branch has no preview database, and none will be created). DB-free pages:
  - `/dev-welcome?role=STUDENT|STAFF|COLLABORATOR&view=setup|done|later&filled=0..3&theme=dark`
  - `/dev-home?role=STUDENT&firstrun=1`
  - `/login`
- Real invite -> password -> Welcome -> Home flow needs a database. Local option only: Postgres 17 on loopback, apply migrations the way scripts/check-postgres-integrity.mjs does, add an unclaimed AllowedEmail (STUDENT), and run the app against it. The app uses the Neon websocket adapter (src/lib/db.ts), so a plain local Postgres also needs a Neon wsproxy plus a local-only loopback tweak to db.ts that must never be committed. Erik found this too heavy, so skip it unless you must. Otherwise rely on tests and the lab pages.
- Screenshots: the project files folder student-onboarding/ (web; not visible from the Mac, ask Erik if needed). iOS finish-screen shots are on Erik's Mac in /Users/role/Code/welcome-finish-shots/.

## QA checklist
- [ ] Invite email (Settings > Allowed Emails > resend): steps list, button opens /login?email=... prefilled. Needs RESEND_API_KEY and EMAIL_REPLY_TO in Vercel (Erik has not confirmed).
- [ ] Login with an invited email shows the invite notice, name + password + confirm, then /welcome.
- [ ] Student steps: Phone, Wiscard, Student, Apparel, Photo (no email step). Student step continues with year alone; graduation can stay blank. Back and the step bar navigate; Apparel and Photo can be skipped.
- [ ] Staff/admin also see the Email step. Collaborator: photo only.
- [ ] Finishing shows "You're all set" with working links; Go to Home goes to `/`.
- [ ] Remind me tomorrow or skipping the photo shows "Setup paused"; Home still shows the profile banner.
- [ ] Reload mid-setup resumes at the first incomplete step.
- [ ] Home, new student under 14 days: Getting started card; Finish profile opens the wizard; other rows check off after a click; X hides it; never shown to staff or accounts older than 14 days.
- [ ] Welcome email: arrives once after finishing (last step or photo upload), not for collaborators, not on later edits, not for pre-0199 accounts.
- [ ] 390px width: no horizontal scroll, footer buttons full width. Dark mode readable. Keyboard focus on step bar and finish rows.
- [ ] iOS: year-only Continue; finish screen after last step, after skipping photo, after Remind me tomorrow; rows open Schedule, Gear, Guides; Continue enters the app; collaborator sees Continue only.

## Verified vs not
Verified: tsc, eslint on touched files, vitest (welcome-email incl. send/skip/retry paths, profile-completion, route, Swift source contracts, ios-audit-inventory), db:migrate:check, Postgres integrity run, Xcode build, Playwright screenshots of the lab pages, iOS finish-screen screenshots.
Not verified: the real signup-to-Home flow in a browser, the welcome email actually sending, iOS row navigation and the Welcome route hold at runtime, the Home card against a real account's accountCreatedAt. `verify:docs` shows codemap drift that already exists on main.

## Constraints
- Never create a Neon branch or Vercel preview; never touch production data or credentials. Only main deploys (PR #556).
- Do not commit local-DB scaffolding (db.ts tweak, wsproxy, seed scripts).
- Stage explicit paths only; do not merge. Erik merges. Every PR keeps its release note.
- Web redesigns stay in wc-fresh (Lato); iOS keeps Gotham and system controls.
