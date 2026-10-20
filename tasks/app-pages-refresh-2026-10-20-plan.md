# App pages refresh — October 20, 2026

Scope: refresh `/apps/fetch`, then include the other four listed apps before pushing. Use static, public-safe screenshots and source-backed features. Preserve unrelated work in the primary checkout.

## Plan and gates

- [x] Isolate website changes from unrelated work and record the live main baseline.
- [x] Audit public releases, development status and screenshot privacy independently.
- [x] Capture Fetch 1.5.4, public Offload 1.5.3 and a generated-data Radio Clip development view; reuse published Apple artwork and generated Media Lab test media.
- [x] Implement all five pages, directory links, feature/workflow sections and release-aware download behavior.
- [x] Review factual content and release guards independently; address the metadata and release-bound fallback findings.
- [x] Focused tests: 39 passing across app product, directory, live version and public-showroom tests.
- [x] TypeScript check; repository lint (0 errors, 43 pre-existing warnings).
- [x] Complete final desktop/mobile/light/dark/keyboard browser checks and the HTML comparison review.
- [x] Complete the production-shaped application build, sequential TypeScript and documentation checks.
- [ ] Ship only the scoped changes through PR checks, then verify the live pages and assets.

## Evidence boundaries

Paired-capture production baseline: `c71954b56c7ae767dd5f5bbcfdbed0274bc368c5`, Vercel deployment `dpl_42N3EDKqotgytTdVy3HDxAE7pisA`, confirmed ready and aliased to wisconsincreative.com. Native source screenshots prove presentation; this task does not claim new camera-card, authenticated-data, transcription-accuracy or archive-transfer verification. See screenshot provenance in `public/apps/shots/README.md`.

No authenticated product or production database is needed for these static public pages. Existing public release lookups remain read-only. The new product route returns 404 for unknown app slugs.

The primary checkout continued changing in parallel: 13 initially dirty paths had different hashes at final comparison. This task edited only its isolated worktree and did not restore or stage those changes. Initial and final hash manifests remain in private recovery evidence.

Rebased onto main c71954b before push. Its email changes do not change the app page sources. The original initial baseline d396910 is retained in private recovery evidence; final receipts identify the ready production revision actually present at capture time.

Shipping PR: https://github.com/erikrole/wisconsin-creative/pull/539. The `no-preview` label avoids provisioning a managed database preview for static public content; normal required validate/postgres checks still run. Final CI and live acceptance will be recorded in the PR handoff.
