# Scoreboard end-to-end pass

Date: 2026-09-28
Status: Complete for local implementation and verification; release acceptance remains GAP-71
Owner: Current Codex chat, working sequentially without delegated implementation

## Scope and contracts

User requested a thorough pass, one area at a time, and confirmed both web and native iOS. Covers shared team Scoreboard, individual Scoreboards, their API/services, and direct presentation helpers. Preserve the existing dirty checkout. No staging, commits, deployment, schema migration, or production writes are part of this pass.

Authority: D-056/D-057, `docs/AREA_USERS.md`, `docs/AREA_EVENTS.md`, `docs/AREA_MOBILE.md`, `docs/DESIGN_LANGUAGE.md`. Scoreboard remains available to all authenticated roles through its minimal identity/metrics contract. Preserve server-owned season, W/L/T math, official-game exclusions, count-once participation, and privacy.

## Sequential plan

1. [x] UI: inspected matched desktop/tablet and native captures; separated adjacent cards, preserved tablet names, corrected header overflow and retry-banner layout, clarified official-game labels and native venue wrapping.
2. [x] UX: carried all four team dimensions into person reads; retained the last successful scope and requested controls on failure; added explicit refresh/retry, stable facets and native search; verified clearing and paging recovery.
3. [x] Logic: separated completed work from official games, fixed nullable raw-title exclusions, computed full-season form before pagination, preserved ties/count-once participation, and corrected native all-day labels.
4. [x] Backend: verified existing role/privacy gates, normalized and bounded inputs, used two season-bounded scalar personal reads, retained additive API compatibility, and proved actual PostgreSQL filtering and cross-surface agreement.
5. [x] Paper cuts and quality of life: added person names to native navigation, stopped invalid cursors, rejected obsolete pages, deduplicated page results, and made loaded versus requested context explicit.
6. [x] Verification and documentation: completed the focused tests, TypeScript, changed-file lint, app build, authenticated browser proof, native simulator builds/tests, and matched review. Repository-wide lint has one unrelated pre-existing error; release gates remain documented below.

## Owning files

- Web: `src/app/(app)/scoreboard/*`, `src/app/(app)/users/[id]/UserScoreboardTab.tsx`, `src/components/scoreboard/ScoreboardVisuals.tsx`.
- Shared/API: `src/lib/scoreboard-*.ts`, `src/lib/services/scoreboard.ts`, `src/lib/services/team-scoreboard.ts`, `src/app/api/scoreboard/route.ts`, `src/app/api/users/[id]/scoreboard/route.ts`; inspect game-record/event-worker dependencies before changing participation rules.
- Native: `ios/Wisconsin/Views/TeamScoreboardView.swift`, `ios/Wisconsin/Views/ScoreboardView.swift`, `ios/Wisconsin/Models/ScoreboardModels.swift`, existing Scoreboard model/UI fixture tests.
- Evidence: `tasks/archive/proofs/scoreboard-end-to-end-2026-09-28/`.

## Findings and proof

- Matched before/after review: [review.html](../proofs/scoreboard-end-to-end-2026-09-28/review.html). Captured baseline source manifests include the pre-existing dirty checkout; no active files were swapped to manufacture a baseline.
- Detailed commands, evidence and boundaries: [verification.md](../proofs/scoreboard-end-to-end-2026-09-28/verification.md).
- 123 focused web/API/source-contract tests; 3 Scoreboard tests against disposable PostgreSQL (plus 8 existing custody checks); 17 native model tests and 3 native UI workflows passed.
- TypeScript, changed-file lint, app-only production build, docs verification and diff checks passed. The full repository lint still reports the existing vendored `public/qrcode/vendor/jsQR.js` `no-assign-module-variable` error.
- Authenticated hidden Admin on the existing isolated Preview verified navigation, failure/retry, query validation and narrow layouts. Controlled HTTP fixtures verified paging without adding Preview records. Browser page errors: zero.
- Required native destination: iPhone 18 Pro Max, iOS 27.0, `7BD40061-5741-4B92-B19C-3950F3C99DC3`. Native fixture tests covered all four filters carrying into a named person and a failed Away read recovering through Retry.
- Reused the managed Preview. Its previous process ended during the pass; this chat then started the managed server on port 3490. No external provisioning, shared migrations or production writes were performed.
- ESPN answer: no ESPN API integration exists or was added. Wisconsin calendar markers remain the result source; Schedule assignments and recorded workers remain the participation source.

## Remaining boundaries

Production Student/Collaborator runtime proof, authenticated native totals, regular-width iPad acceptance, release/distribution, and any external rollout remain separate from local acceptance (GAP-71). Simulator fixtures prove presentation and request handling, not production totals or physical-device behavior. No commit, stage, push or deployment was requested or performed.
