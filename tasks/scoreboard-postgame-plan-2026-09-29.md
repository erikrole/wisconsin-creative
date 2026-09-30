# Scoreboard postgame enrichment and season stories

Date: 2026-09-29
Status: Product direction accepted; source investigation and implementation plan prepared; not implemented
Owner: Scoreboard — Users, Events and Mobile

## Outcome and scope

The user endorsed richer Scoreboard game details and personal season stories, and explicitly excluded live scores. Keep the experience centered on completed games: final scores, personal records and a season recap. Both web and native iOS remain in scope.

- First: final scores on existing worked-game history, followed by grounded personal record cards.
- Next: Season Wrapped with the existing season record, work coverage and memorable completed games.
- Later, when data supports it: comebacks, close finishes, overtime appearances and ranked wins. Use sport-appropriate definitions and game-time ranking evidence.
- Excluded: live scoreboards, live game clocks, game-time polling, scoring alerts and score Live Activities.
- Crew combinations and luck-themed copy are recognition features, never measures of work quality or causal claims about game outcomes.

## Verified source facts

1. `CalendarEvent` already preserves `rawSummary`, `rawDescription`, the ICS `externalId`, canonical sport/site/opponent and the source-owned W/L/T result. There are no structured final-score fields today.
2. `src/lib/services/calendar-sync.ts` unescapes ICS descriptions and preserves them as `rawDescription`. `parseEventResult` in `src/lib/schedule-event-identity.ts` reads only a leading `[W]`, `[L]` or `[T]` marker from the source summary.
3. Read-only inspection on September 29 of the documented [UW home calendar feed](https://uwbadgers.com/api/v2/Calendar/subscribe?type=ics&locationIndicator=H) returned 135 events, including 13 with outcome markers. Examples of separate description lines were `W 5-1` (women's soccer), `W 3-1` (men's soccer), `W 3-2` and `W 3-0` (volleyball), and `T 1-1` (men's soccer). These are live observations of that feed, not a claim of complete sport, season or away-game coverage.
4. The descriptions also carry UW game URLs; the ICS UID supplies existing event identity. Basic final-score enrichment can therefore use already-stored UW source evidence without matching a second provider or changing the result authority.
5. Prior investigation in this chat found ESPN football/basketball scoring sequences, box scores and win-probability history, plus volleyball set scores. Coverage and identity require per-sport validation. Reachable endpoints are not proof of an approved production integration; the applicable access arrangement remains unresolved.
6. Current local Scoreboard hardening is complete and uncommitted; production acceptance remains GAP-71. This plan does not overwrite or reopen the completed September 28 pass.

## Contracts

- Preserve D-056/D-057: Schedule assignments and recorded workers own participation; deduplicate each person/event; existing official-record exclusions, ties, privacy and all-role shared access remain intact.
- Missing or ambiguous score evidence means unavailable, never zero. Do not infer final status merely because the planned event end time passed.
- Do not extract arbitrary number pairs from broadcast links, dates, ranking text or narrative. Match a dedicated result line, validate its relationship to the source outcome, and explicitly handle or decline overtime/shootout/forfeit exceptions.
- Preserve Wisconsin/opponent orientation. Keep points, goals and sets distinct; never compare a football point margin with a volleyball set margin as one universal record.
- Score parsing does not rewrite `CalendarEvent.result`. A disagreement remains visible for source investigation rather than silently changing W/L/T.
- Additive payloads must decode on both old and new clients. Missing score data must leave today's Scoreboard usable.
- A recap must use the complete eligible server-owned season, not a paginated list. Show coverage for score-dependent claims, for example “Among 12 games with recorded scores.”
- Preserve authenticated sharing. Public exports or publication of crew identities require a separate sharing contract; do not turn a recap into a public endpoint implicitly.

## Bounded implementation slices

### 1. UW final-score enrichment

- [x] Inspect the existing importer, schema, result authority and live public feed.
- [ ] Add a pure, conservative UW description parser with result-line, score-orientation and exceptional-format cases. Keep source evidence and parser output separate.
- [ ] Add an optional final-score object to `ScoreboardEvent` and select only the required raw fields in existing bounded reads. A read-derived field is the preferred first slice; no migration is required unless verified needs change that choice.
- [ ] Display final scores in existing web and native worked-game rows. Missing data keeps existing W/L/T treatment; source-owned official records and non-game history stay unchanged.
- [ ] Verify existing archive/current-season coverage and filtered/paged behavior with actual stored-data samples before claiming complete season support.

Expected paths: `src/lib/scoreboard-*.ts`, `src/lib/services/scoreboard.ts`, `src/app/(app)/users/[id]/UserScoreboardTab.tsx`, `ios/Wisconsin/Models/ScoreboardModels.swift`, `ios/Wisconsin/Views/ScoreboardView.swift`, and their focused tests. Avoid changing shared calendar ingestion when the preserved source is sufficient.

### 2. Personal records and Season Wrapped

- [ ] Derive per-sport biggest winning margin and closest completed finish from full-season eligible scored games, with deterministic ties and explicit data coverage.
- [ ] Combine these with existing events worked, W/L/T, sports, venues and streaks. Keep the first narrative set deterministic and inspectable.
- [ ] Add web and native recap presentation using the established Scoreboard components/design system. Start within authenticated Scoreboard.
- [ ] Verify archived participation remains available and correct before treating an end-of-year recap as durable history. The existing archival work in AREA_EVENTS remains relevant.

Expected owners: personal/team Scoreboard services, `src/lib/scoreboard-digest.ts`, existing Scoreboard presentation components and native views. Reuse existing server counting instead of duplicating it in a client.

### 3. Optional detailed postgame provider

- [ ] Establish an approved ESPN or UW-supplied detailed feed and verify coverage by sport.
- [ ] Match and persist provider event identities with sport/team/opponent/date evidence; ambiguous games and doubleheaders require resolution before attribution.
- [ ] Save completed-game facts with provider, fetched time and correction provenance. Bounded postgame rechecks may accept corrected finals; use cached data for app reads.
- [ ] Add comebacks, overtime/five-set appearances and ranked-win stories only where the relevant evidence exists. Never substitute tournament seed or today's rank for a game-time poll ranking.

No live features are included in any slice. No external feed provisioning, recurring job or production activation has been performed.

## Acceptance and verification

For the current planning deliverable: `git diff --check`, local link/reference sweep and `npm run verify:docs`.

For implementation:

- Meaningful parser/service/API tests must cover missing, malformed and conflicting evidence, ties, zero scores, duplicated work, unofficial exclusions, sport units, filters, and pagination-independent records.
- `npx vitest run tests/scoreboard*.test.ts tests/team-scoreboard*.test.ts tests/game-record.test.ts tests/ios-scoreboard-wiring.test.ts` plus new focused behavioral cases.
- `npx tsc --noEmit --pretty false`, lint on changed files, and `npm run build:app`. Do not run deploy-shaped migrations against an uncontrolled database.
- `xcodebuild test -project ios/Wisconsin.xcodeproj -scheme Wisconsin -destination 'platform=iOS Simulator,name=iPhone 18 Pro Max' -only-testing:WisconsinTests/ScoreboardModelsTests`, affected native UI workflows, and affected Swift source-contract tests.
- Authenticated local web proof, the required native simulator proof and a `gt-ui-review` page with matched captures or honest after-only states.
- Keep local/source/simulator proof separate from production Student/Collaborator and signed-in native/iPad release acceptance.

## Remaining decisions and status

- Product direction is settled: completed-game enrichment and stories; no live scores.
- The UW final-score source is verified for the sampled home feed. Parsing breadth, historical coverage and exceptional score formats still need implementation evidence.
- Detailed external-feed permission and coverage remain open for slice 3; they do not prevent work on already-preserved UW descriptions.
- This turn prepared the plan and changed no runtime code, schema, data, jobs or deployments.
