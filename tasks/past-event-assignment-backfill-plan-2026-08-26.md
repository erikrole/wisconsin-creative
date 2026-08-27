# Past Event Schedule Backfill Plan - 2026-08-26

## Goal

- Make the existing Schedule crew editor automatically backfill an event once its live end time has passed.
- Publish that assignment synchronously, with no ten-minute cooldown and no schedule, follower, gear, badge, in-app, push, or email notification.
- Make the published assignment count immediately in team and per-person Scoreboard work totals, including result-less non-game events.
- Keep future-event edits on the existing private ten-minute release contract and do not add a second backfill control.

## Route

- Owner area: Schedule / Shift Calendar & Scheduling.
- Supporting areas: Events, badges, and per-person Scoreboard.
- Primary mutation: `PATCH /api/shift-groups/[id]/working-copy`.
- Existing contracts: D-046 for future working-copy release, D-056 for shared Scoreboard data, and D-057 for the separate EventWorker record.

## Source Checks

- The screenshot is the normal `WorkingCrewEditor`, not the separate EventWorker surface.
- The working-copy route currently queues every edit before saving, so a past event still follows the future release path.
- The editor fallback copy says assignees will be notified when a past event has a working copy with no timer.
- Team Scoreboard already counts published active assignments, but the per-person event list excludes result-less events even though its worked total counts them.

## Guardrails

- Use the live event end timestamp, not a stale draft payload, to choose the branch.
- Preserve optimistic version checks, authorization, validation, serializable mutation, audit records, and publication safety blockers.
- Do not call schedule worker, follower, gear, or badge notification fanout for a past-event backfill; badge recognition remains recorded but silent.
- Keep future events unchanged: enqueue the version-specific ten-minute release before saving and retain the existing future notification contract.
- Do not mutate production data or claim deployment from this local implementation slice.

## Slices

- [x] Slice 1: Route ended-event edits through synchronous publication and clear any stale pending release metadata.
- [x] Slice 2: Suppress notification fanout for ended-event workflow races and later badge sweeps; hide ended-event release copy on every editor surface.
- [x] Slice 3: Include result-less worked events in the per-person Scoreboard list with event identity, while keeping official W/L/T breakdowns resolved-only.
- [x] Slice 4: Add focused route, workflow, UI-source, badge, and Scoreboard regression coverage; sync area docs.
- [x] Slice 5: Run focused and repository verification; report local code proof separately from production deployment and authenticated UI proof.

## Verification

- Focused Schedule working-copy/publication/workflow, badge, and Scoreboard tests.
- `npx tsc --noEmit --pretty false`, focused ESLint, `git diff --check`, and affected docs verification.
- `npm run build:app` if the repository environment completes the gate.
- Matched native Scoreboard capture and focused model tests on the mandated iPhone 16 Pro iOS 26.5 simulator.
- Authenticated browser and production read-back remain separate gates; no live backfill is authorized by this plan.

## Remaining Proof Gates

- Authenticated web Schedule and per-person Scoreboard capture is unavailable in this environment.
- The mandated iPhone 16 Pro iOS 26.5 simulator capture and focused native model tests pass; no physical-device proof is claimed.
- No deployment or production data mutation was performed; the current Vercel project access returned 403.
