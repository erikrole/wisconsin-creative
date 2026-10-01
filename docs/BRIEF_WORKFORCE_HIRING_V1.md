# Brief: Workforce Overview and Student Hiring Pipeline (V1)

## Document Control
- Owner: Erik Role
- Created: 2026-09-30
- Status: Slice 1 implemented on branch `worktree-workforce-hiring-pipeline` (uncommitted); source, unit and route tests pass. Not yet proven in an authenticated browser or against a migrated database (no hosted preview exists until a PR is opened).
- Priority: High. Fall 2026 posting is open now.
- Surface: Web only, admin only (3 users). No iOS or kiosk surface.
- Decision record: D-065 (`docs/DECISIONS.md`)

## 1. Problem
Two Google Sheets run workforce and hiring today ("Creative Staff", "Creative Student Interns"). They work, but:
- Staff, current interns, and applicants live in separate tabs with no link. The same person appears as an applicant, then an intern, then (rarely) full-time, and is retyped each time.
- Every hiring cycle has a different column shape (Google Form dump in Spring 2025/2026, an Application-ID portal export in Fall 2026). Nothing compares cycles.
- Year is typed and goes stale. Duplicate submissions and email changes (personal to wisc.edu) are resolved by eye.
- Resumes are filenames or links in cells. Interview videos are Hireflix URLs in cells. Reviewing 65 candidates means tab-hopping.
- There is no forward view: who graduates when, per area, versus who is in the pipeline.

## 2. Outcome
1. An admin opens one page and sees the whole workforce (staff and students) by area, year, graduation term, and sport assignments.
2. An admin runs a hiring cycle in the app: candidates, resumes, interview links, notes, stages, decisions. Review is fast, comparable, and keyboard-driven.
3. Marking a candidate **Hire** stages their account (invite prefilled from the candidate) and, once they claim it, links candidate to user permanently.
4. A planning view shows graduating-out headcount per area per term against hires and pipeline, so next year's gap is visible.

Success signal: Fall 2026 is fully run in the app, and the two sheets are no longer edited.

## 3. Principles for this feature
- **One person, many lifecycle stages.** Evidence from the sheets: someone applied (Spring 2025), interned, then became full-time (June 2026). Others applied with a personal email and later appear with a campus email. The model must be person-centered, not cycle-row-centered.
- **Existing `User` is the source of truth for the workforce.** The staff sheet is about 90% `User` fields already (title, athletics email, start date, direct report, sizes, grad year/term, areas, sports). The overview is a read model over `User`, not a new store.
- **Applicants are not users.** `User` requires a password hash and role and drives roster, kiosk, and schedule. Applicants live in their own table, linked on hire.
- **Staged, reviewable conversion.** Hire never silently creates an account. It opens a prefilled confirmation that writes an `AllowedEmail` invite.
- **Use their vocabulary.** Stages are Applied, Reviewed, Round 1, Hire, Passed. There is no Offer stage. Do not invent one.

## 4. Data model (proposed, names provisional)

### New
- `HiringCycle`: `label` ("Fall 2026"), `term`, `year`, `status` (PLANNING/OPEN/CLOSED/ARCHIVED), `opensOn`, `closesOn`, `intakeNote`.
- `HiringCycleSlot`: per cycle per area, `targetCount`. This is the "8-12 spots per area" scratch column from the Spring 2025 sheet, made real.
- `Applicant` (person): `name`, `emails[]` (primary plus aliases), `phone` (normalized), `gradTerm`, `gradYear`, `classStanding` (adds `INCOMING`; may extend `StudentYear` or be applicant-local, decide in slice 1), `location`, `portfolioUrl`, `socialHandles`, `hiredUserId?` (unique), `notes`.
- `Application`: `applicantId`, `cycleId`, `externalApplicationId?` (Fall 2026 portal ID), `stage` (APPLIED, REVIEWED, ROUND_1, HIRE, PASSED, WITHDRAWN), `reviewedAt`, `interviewedAt`, `interviewUrl?` (Hireflix), `summerAvailable?`, `softwareExperience[]`, `fieldsExperience[]`, `fieldsInterested[]`, `rawAreas[]`, `primaryArea?`, `decidedAt`, `decidedById`, `sourcePayload Json` (preserve original row, same rule as Cheqroom import).
- `ApplicantDocument`: `applicationId`, `kind` (RESUME, COVER_LETTER, PORTFOLIO_FILE, OTHER), private blob `pathname`, `contentType`, `sizeBytes`, `uploadedById`.
- `ApplicationNote`: `applicationId`, `authorId`, `body`, `rating?` (1-5), `createdAt`. Notes are append-only and audited.
- `ApplicantMergeCandidate` is not stored. Possible matches are computed on read.

### Extended on existing
- `User`: add `startTerm`/`startTermYear` (students start by term, "Fall 2025", not by date; `startDate` stays for staff). Backfill from the sheet.
- New `StudentTermPlacement` (decided): `userId`, `term`, `year`, `area`, `sportCodes[]`, `notes`. Replaces the Fall/Winter/Spring columns of the intern sheet. Existing `StudentSportAssignment` stays as the current-term default; the placement history is the record by term.
- `Applicant.purgedAt?` marks a retention tombstone (see section 8).

### Area mapping (decision needed)
Candidate areas are free-form (Marketing, Design, Journalism, Writing/Editing, Print Production, Visual Storytelling). `ShiftArea` has VIDEO, PHOTO, GRAPHICS, SOCIAL, COMMS, LIVE_PRODUCTION. Keep raw multi-value `rawAreas[]` plus a mapped `primaryArea` (`Design` maps to `GRAPHICS`). **Decided:** `Marketing` and other unmapped labels stay raw only (shown as chips, excluded from planning math) until a real area is warranted.

## 5. Hire conversion (staged)
1. Admin sets stage to HIRE on an application.
2. App shows "Create invite" prefilled from the applicant: name, preferred email, role STUDENT, `staffingType` ST, `preloadedPrimaryArea`/`preloadedAreas` from the mapped areas, start term from the cycle.
3. On confirm, write the `AllowedEmail` row (existing invite flow), set `Application.stage = HIRE`, audit the action.
4. When the student claims the invite, set `Applicant.hiredUserId` and surface them in the workforce overview. Matching on claim: email, then name, then manual confirm. Never auto-link on a fuzzy match; show "possible match".
5. Undo path: until claimed, the invite can be removed and the application returned to ROUND_1. After claim, undo is a normal user deactivation.

## 6. Front end

### Routes (web, admin-only)
Information architecture (user direction, 2026-09-30): **Workforce** is the staff overview for full-time staff and students; **Hiring** is a tab inside it and houses applicants and openings (cycles).
- `/workforce`: Overview tab. Full-time and students by area, graduating counts, sports, links to profiles.
- `/workforce/hiring`: Hiring tab. Cycle (opening) board; `/workforce/hiring/[cycleId]` and `/workforce/hiring/applicants/[id]` later.
- `/workforce/planning`: forward view (slice 5), likely a third tab.
One admin gate lives in `src/app/(app)/workforce/layout.tsx`; the sidebar has a single "Workforce" item (`requiredRole: "ADMIN"`).

### Overview
- Header stats: staff count, student count, by area, graduating this spring, graduating within 12 months.
- Area columns (Video, Graphic Design, Photography, Social, Comms, Live Production): people as compact cards with avatar, name, class standing derived from grad term, sport assignments as chips. A toggle switches to a dense table. Staff section above students, direct reports shown via the existing org-chart data.
- Click a person: side drawer with the profile summary and a link to `/users/[id]`. Edit stays in the existing profile page; the overview does not duplicate editing.
- Standing is derived from grad term (not typed), with `studentYearOverride` honored.

### Hiring board
- Kanban columns: Applied, Reviewed, Round 1, Hire, Passed. Drag to change stage, with a confirm for Hire and Passed.
- Cycle header with per-area slot meters (hired vs target) from `HiringCycleSlot`.
- Filters: area, class standing, grad year, summer availability, reviewed/not, search. Saved as URL state.
- Card: name, standing and grad term, area chips, portfolio icon, interview icon, reviewed dot, rating average.
- Bulk actions: mark reviewed, set stage, pass.

### Review mode (the "robust way to review candidates")
- Full-screen: left rail is the queue (filtered), center is the resume (inline PDF), right is facts, interview link, portfolio link, notes and rating.
- Keyboard: `J/K` next/previous, `R` reviewed, `1-5` rating, `H` hire, `P` pass, `N` note. Review state advances automatically.
- Side-by-side compare for two or three candidates.
- "Seen before" banner: prior applications, prior employment, and possible duplicate (same person, different email).

### Planning (slice 5)
- Matrix: rows are areas, columns are terms (Fall 2026 through Spring 2029). Cells show projected headcount = current workforce minus graduating, plus hired, with pipeline in a lighter tone, and a gap versus target.
- Click a cell: who graduates, who is in the pipeline for that area.

## 7. Resumes and files
- Reuse the private Vercel Blob pattern in `src/lib/resource-assets-storage.ts` (private access, server-mediated reads, upload verification). Add a dedicated store/token for applicant files; do not share the brand-asset or public-image token.
- Reads are admin-only, streamed through an authenticated route. No public or long-lived URLs.
- PDF and common image types only, size-capped, magic-byte validated.
- Hireflix and portfolio entries remain external URLs (validated, `https` only, opened with `noopener`).

## 8. Privacy and audit
- Admin-only for every route, API, and export; STAFF cannot see candidates.
- Every mutation (stage, decision, note, document view/upload, hire conversion, merge) writes an `AuditLog` row.
- Retention (decided): the **name stays forever** as an identity tombstone (name, cycles applied, final outcome) so returning applicants are recognized. Everything else personal (email, phone, resume and other files, social/portfolio links, notes, ratings, interview links, `sourcePayload`) is purged **36 months after the cycle closes** for applicants who were not hired. Files are deleted before rows. Hired applicants keep their application while the linked user is active; the same 36-month clock starts when that user is deactivated. Purge is a scheduled job with an audit row per applicant and a dry-run report, and the UI shows a "purges in N days" badge. No manual "forget" action in V1.
- No real names, emails, or phone numbers in docs, fixtures, tests, or seeds. Use fictional data only.

## 9. Import (slice 4, dry-run first)
Source tabs: Fall 2026 Prospects (portal export), Spring 2026 Prospects, Spring 2026 Form, Spring 2025 Prospects/Interviews/Form, 2025-26 and 2026-27 intern rosters, Creative Staff.
- Dry run produces a report: matched, new, duplicates, unparseable. Nothing writes until the admin applies the plan.
- Normalize: strip Unicode directional marks (U+202D, U+202C) from phone numbers; convert Excel serial dates (one staff start date arrives as `46202`); parse terms ("Spring 2027") into term and year; split multi-value areas on `,` and `;`.
- Identity resolution: exact email, then alias email, then normalized name plus grad term, then manual confirm queue. Duplicate submissions in one cycle collapse to one application, keeping both source rows in `sourcePayload`.
- Staff/student sizes: free text ("women's medium, men's small") imports into notes where it cannot be structured, never guessed.
- Resume files: resumes come from PageUp (no API assumed). Slice 1 includes a bulk drag-drop uploader that matches files to applicants by PageUp Application ID or filename/name, with a confirm list for unmatched files. PageUp's Application ID is the dedupe key for Fall 2026 forward; a PageUp CSV export import is part of slice 4.
- Old cycles are imported (decided), as archive: Spring 2025 and Spring 2026 land as closed cycles with whatever fields exist; missing fields stay empty.

## 10. Slices
1. **Hiring foundation (Fall 2026):** schema, D-065, `HiringCycle`, `Applicant`, `Application`, notes, admin API with audit, board and detail, manual add, resume upload and viewer. Migration follows `docs/PRISMA_NEON_RUNBOOK.md`.
2. **Review mode and filters:** keyboard review, compare, duplicate hints, slot meters.
3. **Workforce overview:** read model over `User`, area columns, drawer, `startTerm` backfill.
4. **Hire conversion and importer:** staged invite, claim linking, dry-run importer for the sheets.
5. **Planning view.**
Each slice is independently shippable with its own proof (web UI changes ship with a review page via `gt-ui-review`; authenticated browser proof via `dev:preview`).

## 11. Acceptance criteria (slice 1)
1. Non-admin roles receive 403 on every hiring route and API; the nav entry is absent for them.
2. An admin can create a cycle, add an applicant with email, grad term, areas, links, and a resume, and see it on the board in Applied.
3. Stage changes persist, write audit rows, and survive reload; Hire and Passed require confirmation.
4. Resume downloads only through the authenticated route; the stored pathname is never exposed publicly.
5. Adding an applicant whose email or name plus grad term matches an existing one shows a possible-match prompt instead of creating a silent duplicate.
6. Tests cover role gating, stage transitions, audit writes, upload validation, and the duplicate matcher with fictional fixtures.

## 12. Open questions
Resolved 2026-09-30: resumes come from PageUp (bulk upload); Marketing stays raw; term placement is first-class; old cycles import; retention is name forever plus 36 months for everything else.
- **Q1.** Does a `Passed` applicant stay visible in the cycle, or archive immediately? Default: stays, filtered out by default.
- **Q2.** Is "Reviewed" a flag or a stage? Default: flag plus the stage list.
- **Q7.** Is Hireflix API access available, or are interview links just pasted URLs? Default: pasted URLs.

## 13. Out of scope
Applicant-facing portal or public posting page; email or calendar automation; offer letters; interview scheduling; scoring formulas or auto-ranking; native iOS or kiosk surfaces; cross-department hiring.

## 14. Amendments from the plan review (binding; supersede earlier sections)
Source: Fable read-only review, 2026-09-30, verified against the repo.
1. **Naming:** use `applicant` in every identifier, route, and test name. "Candidate" already means shift-crew scoring (`src/lib/candidate-scoring-types.ts`). UI copy may say candidate.
2. **Emails:** no `String[]`. `ApplicantEmail` table with a unique normalized email and `isPrimary`; uniqueness is decided by the database and P2002 is caught.
3. **Enums:** reuse `GraduationTerm` for `HiringCycle.term`, `Applicant.gradTerm`, and later `StudentTermPlacement.term`/`User.startTerm`. No `INCOMING` on `StudentYear`; applicant standing is a separate applicant-local enum (`INCOMING, FRESHMAN, SOPHOMORE, JUNIOR, SENIOR, GRADUATE, OTHER`). The runbook's enum-split rule covers `ALTER TYPE ... ADD VALUE`; slice 1 only runs `CREATE TYPE`, so enums and their first use share migration `0156`. Any later value addition to these enums gets its own migration step.
4. **Constraints:** `Application @@unique([applicantId, cycleId])`, `@@unique([cycleId, externalApplicationId])`, `@@index([cycleId, stage])`, `@@index([decidedById])`; `HiringCycleSlot @@unique([cycleId, area])`; `Applicant.hiredUserId @unique`, `onDelete: SetNull`.
5. **Retention clock:** per applicant, defined as the latest `HiringCycle.closedAt` (actual, added) over their non-hired applications. Hired clock starts at user deactivation; `User` has no `deactivatedAt`, so slice 4 adds one or reads the lifecycle record. Tombstone keeps name, cycle labels, and final stage; purge nulls/deletes email, phone, files, links, notes, ratings, interview URL, `sourcePayload`. A durable non-PII `ApplicantRetentionEvent` ledger records purges, because audit rows are hard-deleted at 90 days (`src/lib/audit.ts`). Audit entries for hiring must not snapshot email, phone, or file paths. Purge job: batched, blob 404 counts as success, `withCron`, registered in `vercel.json`, `job_runs` row.
6. **Gating:** a `hiring` resource in `src/lib/permissions.ts` (ADMIN only, precedent `venue_mappings`). Sidebar item with `requiredRole: "ADMIN"` (the existing admin-nav helper also admits STAFF, so do not reuse it). Pages redirect, APIs return 403, and tests cover role preview (an admin previewing as Staff loses access).
7. **Files:** magic-byte (`%PDF`, image) check on the server at upload completion is new work, as is audit on document reads. Inline viewer sets `X-Frame-Options: SAMEORIGIN` and `Cache-Control: private, no-store` on its own route. A dedicated blob token is added to `src/lib/env.ts`; the branch provisioner and handoff must be budgeted for a fourth store (D-063).
8. **Hire invite:** `Application.allowedEmailId?` (`onDelete: SetNull`) so deleting an unclaimed invite from onboarding status cleanly reverts. Claim linking sets `Applicant.hiredUserId` inside the register transaction (`src/app/api/auth/register/route.ts`). Re-applicants who already have a `User` or an invite are caught and routed to link, not create.
9. **Preview data:** applicant tables are never part of the preview template; the sanitizer must truncate them if the template is ever refreshed from production.
10. **UX fixes:** Reviewed is a flag only; stages are APPLIED, ROUND_1, HIRE, PASSED, WITHDRAWN. Drag-to-Hire opens a confirm and the card stays until confirmed. Review hotkeys are inert while a text field has focus and stage hotkeys (`H`, `P`) open the same confirm.
11. **Slice 1 scope:** single-file resume upload only (no bulk matcher); staged hire invite moves to slice 2; bulk uploader moves to slice 4 with the importer; overview (slice 3) may run in parallel. `StudentTermPlacement` and `User.startTerm` move to slice 3.
12. **Retention window:** 36 months (user decision, replaces 12).

## 15. Slice 1 implementation notes (2026-09-30)
- Migration `0156_student_hiring_pipeline`: enums plus `hiring_cycles`, `hiring_cycle_slots`, `applicants`, `applicant_emails`, `applications`, `applicant_documents`, `application_notes`. Not yet applied anywhere.
- A basic read-only Workforce overview (`/workforce`) now exists ahead of schedule: active full-time and student users grouped by area, derived standing, graduation, sports, graduating-by-year counts. Term placements, drawer, and directory sorting remain slice 3.
- Gating: `hiring` resource (ADMIN only) in `src/lib/permissions.ts`; sidebar item `requiredRole: "ADMIN"`; page redirects non-admins; APIs return 403 (tested for STAFF, STUDENT, COLLABORATOR on every route).
- Routes: `/api/hiring/cycles`, `/api/hiring/cycles/[id]`, `/api/hiring/applications`, `/api/hiring/applications/[id]` (+ `/notes`, `/documents`), `/api/hiring/documents/[id]`. Page: `/workforce/hiring`.
- Files: single-file upload through the server (4 MB cap, PDF/PNG/JPEG, magic-byte check), private blob via `APPLICANT_BLOB_READ_WRITE_TOKEN` (new; must be provisioned, including in the branch provisioner per D-063), reads audited.
- Named TODO: add `APPLICANT_BLOB_READ_WRITE_TOKEN` to the branch provisioner and handoff (`scripts/lib/provision-preview-storage.mjs`, `scripts/lib/preview-environment.mjs`) and to production environment settings. Until then uploads return 503 "Applicant file storage is not configured."
- Not in slice 1: hire-to-invite conversion, review hotkeys and compare, bulk uploader, importer, retention purge job and `ApplicantRetentionEvent` ledger, `StudentTermPlacement`, workforce overview, planning matrix.

## 16. Slice 2 implementation notes (2026-09-30)
- Staged hire invite: `POST /api/hiring/applications/[id]/invite` (ADMIN only). Requires stage HIRE and an applicant email; creates a student `AllowedEmail` through `createAllowedEmailInvite` prefilled with name and mapped area, and stores `Application.allowedEmailId` (`onDelete: SetNull`, so deleting an unclaimed invite from onboarding status reverts cleanly). If an account already exists for the email the route returns `user_exists`; linking requires an explicit second confirmed call.
- Claim linking: the register transaction (`src/app/api/auth/register/route.ts`) sets `Applicant.hiredUserId` with `updateMany(... hiredUserId: null)`, so an existing link is never overwritten, and writes a `hire_linked` audit entry. Migration `0156` was regenerated to include the new column (still unapplied anywhere).
- Review mode in the applicant panel: J/K move through the current filtered queue, R marks reviewed and advances, H and P open the same Hire and Pass confirmations, N focuses the note box. Hotkeys are inert while typing, with modifiers held, or while a confirmation is open.
- Fixed in passing: the add-applicant dialog read `matches` from the wrong level of the error body, so the possible-match prompt would not have shown. The route test now asserts the payload shape.
- Still open from slice 2 scope: side-by-side compare, and the review-mode full-screen layout (current review runs in the side panel).

## 17. Slice 3 implementation notes (2026-09-30)
- Migration `0157_student_term_placements` (unapplied): `users.start_term`/`start_term_year` (students start by term; staff keep `startDate`) and `student_term_placements` (`@@unique([userId, term, year])`, area, sport codes, notes; cascades with the user).
- `workforce` permission resource (ADMIN only). Routes: `GET/PATCH /api/workforce/people/[id]` (placements plus start term), `POST/DELETE /api/workforce/people/[id]/placements` (upsert per person and term; sport codes validated against `SPORT_CODES`; deleting another person's placement returns 404).
- Overview cards now open a side panel: start term editor, placements by term in chronological order (Winter, Spring, Summer, Fall within a calendar year), and an add-or-update-term form. Full editing still lives on the existing profile page, linked from the panel.
- Not done: bulk backfill of start terms and placements from the sheets (importer, slice 4), per-term view across the whole workforce, and the planning matrix (slice 5). Existing `StudentSportAssignment` is unchanged and still drives the sport chips on cards.

## 18. Slice 4 implementation notes (2026-09-30)
- **Applicant importer:** `POST /api/hiring/import` (ADMIN). Body: `cycleId`, `csv`, `apply` (default false = dry run), `blankDecisionMeansPassed`. One header-alias parser (`src/lib/hiring/import.ts`) handles the PageUp export and the Google Form and prospect sheets. Limits: 1,000,000 characters and 500 rows.
- **Matching rules:** exact email attaches a new application to the known person; same normalized name and graduation with a different email is **needs review** and is skipped on apply (never auto-merged), including two such rows inside one file; a repeated email in one file keeps the first row; an application already in the cycle (by person or PageUp ID) is skipped. Existing accounts are reported, never linked.
- **Normalization:** emails lowercased, phones stripped of Unicode directional marks, terms parsed ("Spring 2027"), Design mapped to Graphics, unmapped labels such as Marketing kept raw with a warning, non-https links dropped with a warning. The whole source row is kept in `sourcePayload`. Imported notes are stored as notes by the importing admin.
- **Roster importer:** `POST /api/workforce/import` (ADMIN, `workforce.manage`). Matches users by campus or athletics email only (never by name). Sets a start term only where none exists and creates term placements only for terms that have none; the Fall, Winter, and Spring columns map into the chosen academic year. Unknown sport codes and non-term start dates are skipped with warnings.
- **UI:** "Import CSV" on the Hiring tab and "Import roster" on the Overview share one preview-then-apply dialog; nothing is written until the admin presses Apply after the report.
- **Known limits:** a CSV export loses spreadsheet hyperlinks, so PageUp "Resume" and "Portfolio" cells arrive as plain text. Resumes are still uploaded per applicant (the bulk uploader remains open). Audit rows for imports carry counts only.

## 19. Slice 5 implementation notes (2026-09-30)
- **Planning tab** (`/workforce/planning`, ADMIN via the Workforce layout and a page-level check): rows are areas, columns are the current and next two academic years (Fall start). Pure projection in `src/lib/workforce/planning.ts`.
- **Rules:** a student is counted for an academic year unless they graduate before that Fall (graduating that Fall still counts). No graduation date means assumed staying, and is flagged in the cell. Projected headcount = continuing students + hired applicants who have no account yet. Open-cycle applicants (Applied or Round 1) show as pipeline and are not counted in the projection. **Need** = this year's headcount for the area minus the projection, never negative, hires only. A "Who" disclosure in each cell lists who is leaving, hired, and in the pipeline.
- **Scope choices:** students only (`staffingType = ST`; full-time staff excluded); unassigned people land in a "No area set" row; hired applicants already linked to an account are not double-counted; purged applicants are ignored. Area comes from the user's primary area or primary area assignment, and from the application's mapped area (Marketing and other unmapped labels have no area, so those applicants appear under "No area set").
- **Not built:** per-area headcount targets (Need is relative to today's size, not a target), term-level columns, and CSV export.

## 20. Retention purge and bulk resumes (2026-09-30)
- **Retention purge (D-065, 36 months):** `runApplicantRetention` in `src/lib/hiring/retention.ts`, called from the existing weekly `audit-archive` cron so no cron slot is added (plan limit); its failure is isolated and reported as `applicantRetention` in that job's response; batches of 25; `job_runs` entry `applicant_retention` when anyone is processed. Eligible: not purged, not linked to an account, at least one application, and every application's cycle closed (with a recorded `closedAt`) more than 36 months ago. Any open, planned, or close-time-less cycle blocks the purge. Files are deleted first (a storage failure leaves the rows intact and retried next run), then one transaction deletes documents, notes, and emails, clears personal fields on the applicant and applications (PageUp ID, interview link, source row, areas, experience lists), sets `purgedAt`, and writes a non-PII `applicant_retention_events` row (migration `0158`, unapplied). Retained outcome: name, stage, reviewed state, decision time, cycle link, and mapped area.
- **Returning applicants:** a same-name match against a purged record is surfaced as "same name as a previous applicant" (hint only, never auto-linked). Attaching a new application to a purged record refills the profile and clears `purgedAt`, restarting the clock from the new cycle.
- **Visible in the UI:** the applicant panel shows the scheduled deletion date, or why none is scheduled.
- **Still open:** hired applicants linked to an account are never purged by this job; a post-deactivation clock needs a `User.deactivatedAt`, which does not exist yet. No "keep for next cycle" flag was added.
- **Bulk resume upload:** "Upload resumes" on the Hiring tab matches many files to applicants by PageUp ID or name in the filename (`src/lib/hiring/resume-match.ts`), lets you correct any row, skips applicants who already have a resume, and uploads one at a time through the existing validated endpoint. Ambiguous names are never guessed.

## 21. Review fixes (PR #414, 2026-09-30)
- **Undoing a Hire** revokes an unclaimed invite in the same transaction; an already-claimed invite blocks the undo (deactivate the account instead). Registration links an applicant only when the application is still at Hire, and sets the student's start term from the hiring cycle.
- **Files:** blob deletion throws on any failure except a confirmed missing blob, so a database row (the only record of a pathname) is never removed while its file survives. Document delete removes the blob first.
- **Retention:** the purge re-reads and rechecks the applicant inside a SERIALIZABLE transaction (concurrent hiring activity aborts it, retried next run) and also deletes an unclaimed hire invite, which still holds the applicant's email and name.
- **Cycles:** the Hiring tab has Close cycle and Reopen cycle, which set or clear `closedAt` (the retention clock).
- **Audit:** hire invites use a redacted onboarding audit; application, note, and cycle updates write their audit entry in the same transaction as the change.
- **Identity:** the invite checks campus and athletics email aliases and asks about same-name accounts under another email (link, or confirm a separate account). Duplicate lookup uses a stored normalized `nameKey` (migration `0159`), so accents and punctuation no longer hide a duplicate; a re-hydrated record gets a primary email again.
- **Imports:** applicant imports write with batched inserts (one per table); a changed import option (Fall year, blank-decision rule) clears the reviewed preview; roster import and the placement and start-term APIs accept student workers only.
- **Planning** counts each applicant once (strongest stage, then latest cycle).
- **Client races:** applicant list and detail responses from superseded requests are ignored; J/K and R use only stages visible on the board; R advances only after Reviewed saves.

## 22. Review fixes, round 2 (PR #414, 2026-09-30)
- **Invite creation is atomic with the Hire state:** the invite is attached to the application in a SERIALIZABLE transaction that re-reads the stage; if the decision was undone meanwhile the just-created invite is deleted and the request fails. Undoing a Hire re-reads the invite link inside its own serializable transaction. Together a race aborts one side instead of leaving a live invite on a passed applicant.
- **Invite address:** the newest known address is the default and the admin can pick any known address in the Account section.
- **Uploads:** rejected for purged applicants (a tombstone is only rehydrated through a new application), the purge state is re-checked inside the write transaction, and the document row and its audit entry commit together; the stored file is removed if either fails.
- **Planning honors start terms:** a student with a future `startTerm`, and a hired applicant by hiring-cycle term, is counted only from the academic year they start.
- **Importer:** non-empty decision text it does not recognize rejects the row (no silent fall back to Applied); slash-delimited lists split; applicant imports create UUID ids, so the attach contract accepts any persisted id (cuid or UUID).
- **Roster import:** a student repeated in one file is planned once (first start term wins, no duplicate placements).
- **Cycles:** archiving an Open or Planning cycle stamps `closedAt` like closing it; reopening clears it.
