# Schedule Timeline Context Hardening Plan - 2026-08-30

## Goal
- Make Schedule browsing and crew management feel stable under real use: preserve the event/day being read across filters and genuine List/Week/Calendar round trips, keep standalone period-to-List navigation anchored to Today, make Week and Calendar complete readable responsive views, distinguish ordinary past events from older archived records, never show rows from the wrong query scope while a view or sport change loads, and give staff the same safe versioned crew workflow from every view.

## Route
- Owner area: Shift Calendar & Scheduling web surface (`/schedule`).
- Ledger: this bounded implementation plan.
- Existing references: `tasks/schedule-timeline-scroll-fix-plan-2026-08-24.md`, `tasks/list-state-preservation-plan-2026-08-26.md`, `docs/AREA_SHIFTS.md`, and `tests/schedule-timeline-source.test.ts`.

## Source Checks
- The List view is a continuous chronological timeline with an inserted Today group, past above, and future below.
- Fresh visits intentionally anchor on Today; reload and Event-detail Back intentionally restore the stored document offset.
- Live authenticated baseline reproduced two separate context failures on 2026-08-30:
  - reading Sep. 25, then List -> Week -> List, returned to Aug. 30;
  - reading Sep. 25, then applying Home, collapsed the list above the viewport and landed around Aug. 5.
- `keepPreviousData` currently crosses view and sport query scopes, so a changed control can temporarily render rows from the previous scope without a loading state.
- Shift groups archive when their event ends, while calendar events archive only after the older-record cutoff. The merged entry currently overwrites the event archive field with the crew-group archive field, so normal past events are repeatedly labeled `Archived` and the `Archived events` filter does not describe the field shown in each row.
- Items provides the accepted URL-authoritative filter pattern; Schedule already uses the same App Router `replace(..., { scroll: false })` contract and must keep it.
- Authenticated desktop and 390px inspection of the locally hardened route found three remaining cross-view gaps:
  - List preserves its return anchor, but List -> Week/Calendar still opens the stored/current period instead of the date being read;
  - the desktop Week grid compresses event identity, time, and staffing into tiny truncated cards without useful day-level orientation;
  - Calendar replaces the entire month on phone widths with a desktop recommendation, so the third view is not an end-to-end view on responsive web.
- The 2026-08-30 crew-management follow-up found one remaining parity break:
  - List expands the shared `WorkingCrewEditor`, including slot creation/removal, assignment, conversion, call-time editing, recovery, and timed release;
  - Week and Calendar instead open the legacy `ShiftDetailPanel` for configured crews and send unconfigured events directly to Event detail, so staff cannot begin or complete the same workflow in those views.

## Stop Conditions
- Stop if the live API no longer returns separate CalendarEvent and ShiftGroup archive state.
- Stop if preserving context would require a nested scroll surface or replacing the document-owned timeline.
- Stop if a filter/view transition cannot identify a surviving visible event or nearest day without inventing a date outside the filtered timeline.
- Stop before changing archive policy, event lifecycle, working-copy mutation semantics, notification behavior, or native Schedule behavior; this parity slice may expose the existing staff crew editor and setup command from more web views but must not create a second mutation path.
- Stop if Week or Calendar parity would require exposing private working-copy data or staff controls to Students or Collaborators.
- Stop if crew setup cannot hand off to the created shift group without guessing the response contract or weakening existing permission, transaction, audit, or release boundaries.

## Slices
- [x] Slice 1: capture a logical visible-event/day anchor before list filters or view changes and restore it after rows change or List remounts, falling back to the nearest surviving day.
- [x] Slice 2: scope query placeholders so only the archived-record prepend keeps prior rows; give Week/Calendar honest loading states for scope changes.
- [x] Slice 3: separate event archive truth from ended crew-group archive truth, remove misleading per-row archive noise from ordinary past events, and clarify the Past / Today / older-record vocabulary.
- [x] Slice 4: harden Jump to today and filtered-empty/refresh feedback, including dynamic sticky-boundary and viewport-direction handling.
- [x] Slice 5: add focused behavioral/source contracts, run the web verification matrix, exercise authenticated desktop and narrow interactions, and build the matched `gt-ui-review` page when capture tooling permits.
- [x] Slice 6: hand the active date between every view transition: List opens the matching week/month, Week and Calendar translate their visible period into each other, a genuine List-origin round trip restores its reading place, and a standalone period-to-List transition opens Today.
- [x] Slice 7: rebuild Week scanability around stronger day orientation, event counts, readable event cards, explicit staffing state, and useful mobile expansion without changing event-detail ownership.
- [x] Slice 8: make Calendar a complete responsive view with a phone month agenda, stronger desktop day cells, truthful counts, and the same event/coverage semantics as List and Week.
- [x] Slice 9: finish the shared List/Week/Calendar navigation, loading, empty, focus, filter, and narrow interaction matrix; add matched three-view before/after proof and sync area/conformance docs.
- [x] Slice 10: replace the staff-only Week/Calendar legacy detail handoff with one shared Schedule crew sheet backed by `WorkingCrewEditor`, while retaining Event detail as the deeper context and preserving worker navigation.
- [x] Slice 11: bring crew setup parity to unconfigured Week/Calendar events with Home, Away, and empty choices, then hand the successful server-returned group directly into the editor without waiting for a refetch.
- [x] Slice 12: improve the List handoff so its secondary crew action opens the same shared sheet while expanded rows remain the primary multi-event workstation; harden loading, duplicate-submit, close/reopen, narrow, and keyboard behavior.
- [ ] Slice 13: add focused source/behavior contracts, complete the authenticated three-view staff interaction matrix without publishing or inventing production data, refresh matched visual review evidence, and sync Schedule documentation.

## Verification
- [x] Focused Vitest for timeline anchor selection/restoration, three-view behavior, and Schedule browse source contracts: 60 tests pass.
- [x] `npx tsc --noEmit --pretty false` — final shared-tree rerun passes after the concurrent Bulk SKU experiment was removed.
- [x] focused ESLint for changed source and tests
- [x] `npm run build:app` — final shared-tree source compiles and an isolated copy completes all 251 pages after the shared `.next` trace directory raced once.
- [x] `npm run codemap` before docs verification when codemap-owned source changes require it
- [x] `npm run verify:docs`, or record shared dirty-tree drift without overwriting parallel changes
- [x] `git diff --check`
- [x] Authenticated desktop smoke: fresh Today anchor; scroll past/future; Home/Away/Neutral/Non-game; Sport; My Shifts; Coverage; clear filters; List/Week/Calendar and back; Jump to today; older-record load/unload; reload; Event-detail Back.
- [x] Authenticated narrow smoke for wrapped sticky controls, active chips, Jump to today, and List/Calendar recovery.
- [x] Matched before/after visual review page with only this Schedule slice changed, or an explicit capture/publishing blocker.
- [x] Cross-view period handoff matrix: List past/future day -> Week/Calendar, rapid Week <-> Calendar toggles, standalone period -> List, filters retained, and direct URL/reload authority.
- [x] Authenticated desktop and 390px proof for readable Week event cards and functional Calendar month agenda, including visible keyboard focus treatment and no horizontal overflow.
- [x] Updated matched List/Week/Calendar visual review page with the same role, data, periods, widths, and scroll positions in each pair.
- [x] Focused crew-parity contracts for configured and unconfigured staff events in List, Week, and Calendar; Students keep Event detail/claim ownership and never receive the staff sheet. Eighty-four focused Schedule tests pass with the final parity source.
- [ ] Authenticated desktop and 390px staff proof: open configured crews, add/remove an empty slot, assign/unassign, edit a Student call time, exercise Revert/refresh recovery without releasing changes, close/reopen, set up a safe disposable or already-authorized unconfigured event only when available, and confirm filters/period/view remain stable.
- [x] Matched Week/Calendar before/after review captures show the same authenticated Admin, source data, periods, viewports, and unconfigured crew context; the review page records the configured-editor runtime blocker without presenting it as accepted.
- [x] Fresh `npm run build:app` completes all 251 static pages after the authenticated matrix and final documentation changes.

## Review
- Shipped: browsing hardening and the shared List/Week/Calendar staff crew-management implementation are local. No commit, push, deployment, or production mutation was requested or performed.
- Verified: the original 60 browsing tests plus 84 final focused Schedule tests, focused and full ESLint, final shared-tree TypeScript, and a fresh 251-page production-shaped build. Authenticated Admin proof passes configured/unconfigured routing, identical Home/Away/empty setup in Week and Calendar, List focused-sheet plus inline handoffs, Home/All filtering, view round-trips, Escape close/reopen, period retention, and 390px sheets without mutation. Matched deployed/local Week and Calendar captures are in the review page.
- Deferred: deployment and production read-back.
- Blocked: no source or build blocker remains. Configured crew actions reach the new shared sheet, but Preview returns Prisma `P2022` from the pre-existing working-copy service because the generated client expects a column missing from the Preview database; add/remove/assign/call-time/recovery runtime proof therefore remains open under GAP-60. Deployment and production read-back are separate permissions.
- Proof artifacts: `tasks/schedule-timeline-context-review-2026-08-30/review.html` plus matched Today, past-timeline, Week, and Calendar captures in that folder.
- Next slice or stop: reconcile the Preview migration state, then finish the non-releasing configured-editor control matrix and close Slice 13. Existing working-copy semantics, permissions, archive policy, notifications, deployment, and production read-back remain unchanged unless separately authorized.
