# Damaged item reporting and staff follow-up

Scope: shared web/kiosk damage report service, staff item-detail evidence, and safe maintenance release. Preserve current kiosk photo-or-description fallback, missing-item completion, native clients, and unrelated Radio Clip work. No live record changes or publishing.

- [x] Inspect service/routes, kiosk caller, item detail, schema and owner contracts.
- [x] Make report, maintenance hold, and audit atomic for web and kiosk; reject conflicting in-flight report edits.
- [x] Reject empty damage evidence while preserving description-only and photo-only kiosk use.
- [x] Show bounded staff report evidence on item detail and confirm inspected release with an explicit, version-checked maintenance request.
- [x] Focused behavioral tests, TypeScript, lint, application build, docs checks, local visual review.

Verification boundary: current branch owns a managed preview but `preview:status` reports unrelated pending migration `0156_radio_clip_sign_in`. Do not migrate another task's work. Authenticated runtime proof remains unavailable until that environment is ready. No schema change is needed here.

## Local verification

- 83 tests passed in 10 focused files. Eight new regressions failed for the intended behavior against isolated original source copies before passing against the implementation.
- TypeScript, edited-file ESLint, `npm run build:app`, `npm run verify:docs`, and `git diff --check` passed. Build has one existing Sidebar unused-variable warning.
- [Review](archive/proofs/damaged-item-2026-10-03/review.html): after-only static component fixtures at 1200px and 390px, including photo placeholder, description-only, maintenance, and historical reports after release. Images inspected. This does not prove the authenticated page or interaction.
- Codemap refresh preserved the existing unrelated changes; this slice adds test-count/report-owner references and the changed service line count.
- No schema changes, staging, commits, pushes, deployment, or live inventory mutation.

## Remaining acceptance

- [ ] Once the branch preview's unrelated Radio Clip migration is ready, verify authenticated item detail, evidence-photo opening, checkout link, inspection confirmation, stale-version conflict, and durable report/hold/audit writes.
- [ ] Device camera/upload and actual notification delivery remain external proof.
- Bodyless native/list maintenance callers retain their legacy toggle; the explicit version guard is wired to web item detail. No separate repair assignment/notes/resolution tracker was introduced.

## Scoped diff size

- Production: +207/-92 lines (includes new files).
- Tests: +190/-5 lines (includes new files).
