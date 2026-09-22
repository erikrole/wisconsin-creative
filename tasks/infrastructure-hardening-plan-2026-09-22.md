# Wisconsin Creative infrastructure hardening

Owner: current Codex task. Approved by the user on 2026-09-22. Branch: `codex/infrastructure-hardening`; starting main `c6565a216a166b71b1c624c59aaeb88fcf983ce6`. Source remains uncommitted; preserve unrelated proof screenshots/directories.

## Accepted outcome

- Production deploys once after required PR checks; review stays online and refreshes manually.
- Local and hosted previews share one sanitized, isolated database and file stores per Git branch across Claude, Cursor and Codex.
- Existing plans, production/review data, active branches, unrelated artifacts and original migration receipts are preserved. Slice is excluded.
- Disposable previews retire seven days after confirmed Git branch deletion, only without active references, recent use or a pin.
- No staging, commit, push or merge without explicit user authorization. Prepare reviewable source first.

## Completed live foundations

- [x] Disconnected review Git trigger. Review deployment `dpl_G8BWBTBavTkzxjpQCEkwhjdxjCDd` remains Ready; `/login` returns 200. Production `dpl_Dzr1QrsVGTzRtojrDhRMuRqXPq2Q` remains Ready; `/login` returns 200.
- [x] Protected main: strict `validate` and `postgres-integrity`, PR required, zero mandatory reviewers, conversations resolved, admin enforcement, no forced pushes/deletion.
- [x] Protected GitHub environment `preview-infrastructure`, restricted to protected branches. Saved Neon project-only key, approved one-year Vercel team token (expires 2027-09-22), and signing key. Provider-created secret values were copied through UI without exposing them to the model or logs.
- [x] Protected review Neon branch and created quarantined synthetic template. Production recovery settings and plans unchanged.
- [x] Installed exact-target production/review/template catalog checkpoints. Applied `0153`/`0154` through strict wrappers; all 160 local migrations represented and health passes. Production/template have 164 receipts including frozen historical attempts; review has 160. Original receipts preserved byte-for-byte. Unknown historical provenance remains explicit, including review's 93 old bootstrap-stamped rows.
- [x] Created first signed preview child and three isolated Blob stores. Verified synthetic upload/readback/delete; private stores deny anonymous reads. Encrypted development-only handoff saved and retrieved with credentials compared internally; no values logged. User explicitly approved this destination.

## Source implemented

- [x] Node22/npm contract; separate `.next/dev` and `.next/build`; locks with live-child recovery; actual-port authentication, branch-specific cookies, branch-switch stop, deterministic free-port selection.
- [x] Strict preflight before every migration transport; v2 physical catalog, signed child provenance, duplicated receipt checks, immutable exceptions. Retired live Prisma-only bootstrap that fabricated execution history.
- [x] Trusted-main hosted preview orchestration: exact open PR head, no fork secrets, no PR code execution on privileged runner, sanitized upload, fail-closed inherited variables, Ready/authenticated API acceptance.
- [x] Shared serialized queue with `queue: max`; atomic cleanup claim coordinated with local startup, pin, migration, handoff and authenticated activity; separate cleanup activation switch.
- [x] Preview credential allowlist; isolated public/private storage; disabled production mail/push/cron/telemetry; branch cache prefixes and fail-closed Companion when Redis is absent.
- [x] Vercel Fluid lifecycle attachment for the real Prisma Neon pool, max5 connections, 5s idle/10s connect timeout, singleton in all environments. No unsupported query rewrite or claimed measured production speedup.
- [x] Manual review refresh command: exact main commit, fixed review project, disconnected Git policy; plan-only verified without deploying review.
- [x] Shared runbook, Claude/Cursor pointers, migration recovery docs, decisions, risks and task index.

## Verification evidence

Private operational evidence is under ignored `.tmp/infrastructure-2026-09-22/`; logs under `.tmp/infrastructure-*.log`. Do not publish connection files, signing material, environment state or raw provider configuration.

- Security-patched full suite: 4,773 passed across 684 files, one explicitly skipped isolated replay. Cleanup activity and bulk-delete race regressions included.
- TypeScript clean; lint zero errors and one pre-existing Sidebar warning. Deploy-shaped build and subsequent application build passed against the isolated child.
- Disposable PostgreSQL17: base-schema forward DDL, all-model reads, allocation overlap rejection, restored sequence with existing CO/RV references, no sequence rewind, NULL-targeting rejection. Two concurrent clients observed waiting on the runtime row lock; both cleanup/pin orderings pass.
- Patched local authenticated Playwright: all eight tests pass, including normal login and seven routes. Security-patched hosted `dpl_7ko9caRyigdVWWY1pZotZXQZd9st` Ready: login, database reads, seven real browser pages, zero runtime errors. URL: https://wisconsin-creative-kh354o0f7-erikrole.vercel.app.
- Three branch Blob stores: synthetic upload/readback/delete pass; both private stores deny anonymous access. Handoff encrypted save/retrieve and live signed identity pass. Branch is pinned.
- Migration prefix/schema guard, generated docs and whitespace checks pass. Independent schema/isolation review has no remaining blockers after race fixes.

## Security gate discovered during closeout

Fresh audit found existing critical Next/image and high-severity transitive advisories. Narrow compatible patches selected: Next15.5.25, sharp0.35.4, fast-uri3.1.8, js-yaml4.3.2, xmldom0.9.12, browserslist4.28.9; baseline-browser-mapping2.11.0/devalue5.9.1 also patched. Scoped `@prisma/config@6.19.3` override to deepmerge-ts8.0.2 was independently reviewed against its plain-object use; Prisma itself stays6.19.3. Seven-day package-age safeguard retained. High/critical audit gate passes; four moderate advisories remain (Vitest mocker chain and qs). Prisma generate/validate, patched deploy-shaped build, full suite and PostgreSQL fixtures pass. Local shell uses Node24; Vercel acceptance uses the required Node22. Do not claim these dependency fixes are production-live until the source is shipped.

## Remaining gates

- [x] Dependency-patched high/critical audit gate, Prisma config/client proof, full tests/deploy-shaped build and hosted browser acceptance pass. Patched local Playwright: all eight checks pass (real sign-in plus seven routes, 46.7 seconds).
- [ ] Obtain explicit source shipping authorization, commit/push coherent files, open PR and pass required CI. Do not include unrelated screenshots.
- [ ] Merge authorized PR, verify production Ready and runtime health; pooling/runtime isolation changes are not production-live until this point.
- [ ] Enable `MANAGED_PREVIEWS_ENABLED`, exercise a real successful same-repository PR through the hosted workflow, then disable redundant native Git preview builds while preserving main production builds.
- [ ] Run cleanup dry-run with protected operator credentials; only then enable separate `PREVIEW_CLEANUP_ENABLED`. No legacy branch deletion is authorized by attestation absence.
- [ ] Dedicated preview Redis remains absent: ordinary app rate limiting falls back locally; Companion remote-sync fails closed. Documented, not claimed verified.

## Resource identity

| Role | Vercel | Neon |
| --- | --- | --- |
| Production | `prj_cEFq9iZQ5KrMz20wOQMFnhFMEcZ9` | `flat-night-29913432` / `br-gentle-sky-aisuwcsf` / `gear-tracker` |
| Review | `prj_QrspKH6nzpq4qoXkAHfcZqHVaWxi` | `rough-truth-81998555` / `br-broad-mouse-aid7tu0s` / `neondb` |
| Resource holder (no deployments) | `prj_CZ5zAePf5kDttfhrxJs5J5SEzSzI` | — |
| Sanitized template | — | `floral-fog-52897668` / `br-late-feather-auptprel` / `gear-tracker` |
| Acceptance preview | Production project's Preview target | `floral-fog-52897668` / `br-muddy-feather-auo8gqne` / `ep-late-tree-auej54y2` |

Team `team_TZ21VO3n7kpESrZGYA2z4qNo`; branch key `827cf3c97bc7813dbc21`. Template default/protected; acceptance child pinned. Public store `store_bJt8WAgwq35YVqUx`, private Signature `store_p80rEZy57ADF4Iz2`, private Resource `store_eMyHjHsky7hkwqyX`.

Canonical operating contract: [PREVIEW_ENVIRONMENTS.md](../docs/PREVIEW_ENVIRONMENTS.md). Keep this ledger active until shipping and activation gates close. User explicitly approved commit, push, PR, merge after CI, and activation after acceptance on 2026-09-22. Shipping is in progress. The disposable PostgreSQL test server is stopped; the managed local preview remains at http://127.0.0.1:3490.
