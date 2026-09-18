# Badges MVP polish — 2026-09-16

Status: Implemented locally; Preview migration `0147` applied; authenticated UI and production remain open
Owner: AREA_BADGES
Decision: D-034

## Outcome

Make badges feel fun and accountable on both clients without expanding into a new gamification system. Repair unreachable catalog rows, close two reservation-first coverage holes that already have evaluator counts, and make the web tab and iOS gallery tell the same story.

## Source facts

- Catalog is already 100 active definitions. New raw-total ladders are out of scope.
- `category_collector` is missing `ruleKey` in `prisma/seed.mjs`; awards and progress both require it.
- `result_site_sweep` seed threshold is `3` while the rule is binary `0|1` (migration `0127` already uses `1`).
- `event_hero` / `above_and_beyond` are hidden-until-earned, so `GET /api/badges` strips them from the admin award catalog.
- Web profile omits `streaks[]` that iOS already renders.
- iOS gallery still uses the pre-v8 `MILESTONE` catch-all, percentage-first summary, `25 required` tile copy, and no per-shelf collapse.
- Unused measured rules already counted: `checkout_from_reservation`, `checkout_for_shift`.

## Bounded steps

1. Repair seed + migration `0147` for `category_collector` and `result_site_sweep`.
2. Seed two automatic badges: Plan Ahead (5 reservation pickups) and Crew Checkout (5 shift-linked opens).
3. Keep hidden manuals awardable; gate the profile Award action to ADMIN; render on-time streaks and a shelf deep-link on the celebration.
4. Port web shelf routing, sort, collapse, description meta, count-first summary, and `rarityProvisional` to iOS.
5. Tests, docs, and visual evidence.

## Verification

Passed locally:

- Focused badge tests (72/72), `npx tsc --noEmit --pretty false`, lint on touched paths, `npm run db:migrate:check`, `npm run build:app`
- `xcodebuild` Wisconsin, iPhone 16 Pro, Debug: BUILD SUCCEEDED
- `xcodebuild` WisconsinKiosk, generic iOS Simulator, Debug: BUILD SUCCEEDED
- `npm run verify:docs` after regenerating codemaps

Still open:

- Authenticated browser proof of award catalog, streak row, and celebration deep-link. Local Preview app is on `http://127.0.0.1:3000` against `gear-tracker`. Saved Playwright session returned 401; no smoke identity is configured.
- Physical iPhone 16 Pro gallery / kiosk celebration
- Production application of `0147` (not done; Preview only)
- `gt-ui-review` captures (login blocked this slice)
- `tests/badge-evaluator.test.ts` currently fails expecting `booking.findMany` without `custodyScope: PERSON`; that is from parallel shared-custody work, not this slice

Preview deploy evidence (2026-09-16):

- Health after apply: 153/153 local migrations, newest `0147_badge_mvp_repair` applied, pending none
- Catalog: `category_collector.rule_key=category_collector`, `result_site_sweep.threshold=1`, `plan_ahead` and `crew_checkout` active
- Backfill awards: 3 `category_collector`, 2 `plan_ahead`, 0 `crew_checkout`
- Local `vercel env run` without retargeting hits empty `neondb` on the same compute; deploy used `gear-tracker` after identity match to `br-morning-surf-aiuyphxx` / `ep-winter-leaf-ai0eekhl`
