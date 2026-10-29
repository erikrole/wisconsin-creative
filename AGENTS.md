# Wisconsin Creative Agent Contract

This file is the operating contract for work in this repository. Keep it short, enforceable, and current. Put durable implementation lessons in `tasks/lessons.md`, accepted architecture in `docs/DECISIONS.md`, and area-specific truth in the relevant `docs/AREA_*.md` file.

## Instruction priority

When guidance conflicts, use this order:

1. The user's current request and explicit product direction.
2. Current accepted contracts in `docs/DECISIONS.md`, the relevant area brief, and the relevant area doc.
3. Current source, schema, tests, and runtime evidence as proof of what is actually shipped.
4. Durable lessons in `tasks/lessons.md`.
5. Historical plans and archived session notes.

If a conflict could change behavior, reconcile it using the current request and evidence before the dependent edit. Ask only when a material product decision remains unresolved; continue independent work.

## Working rules

- Inspect the real repository state before making claims or edits.
- For a non-trivial task, write a bounded plan, identify the files and contracts involved, and verify it against current source before editing. An inline plan is sufficient for a bounded task; use an owner ledger for durable multi-step work.
- Inspect the relevant file context and consumers before editing; read the whole file when ownership or cross-file behavior requires it. Make coherent edits and review the resulting diff.
- Preserve unrelated user and parallel-agent work. Never use broad staging such as `git add -A` when unrelated changes are present.
- Do not stage, commit, push, merge, or delete user work unless the user explicitly asks for that action.
- If the same approach fails twice, stop repeating it. Re-plan with a safer alternative or report the concrete blocker.
- Promote a new lesson only when it is reusable, non-obvious, and supported by a verified failure or accepted decision.

## Coding rules

Erik's standing rules for every change, by any agent:

1. Ask before adding code for unlikely edge cases: say what it fixes, how likely it is, and how many lines it costs.
2. Validate outside data once at the entry point, then trust the types everywhere else.
3. Inline one-time logic and skip try/catch unless the failure is real and you can handle it.
4. Keep functions whole unless splitting makes them reused or easier to read.
5. Cut any label or explainer text the UI doesn't need, and if it breaks without them, fix the layout.
6. Ship a change only if it's better for users, developers and agents and breaks nothing.

## Execution flow

1. Establish scope: inspect `git status` and the relevant route/view/service, schema when needed, and current owner contracts. Consult `docs/NORTH_STAR.md` when product direction affects the decision. Choose one primary workflow from `.agents/skills/README.md`; add another only for a distinct dependency.
2. Audit contracts: read the relevant `docs/BRIEF_*`, `docs/AREA_*`, `docs/DECISIONS.md`, and `docs/GAPS_AND_RISKS.md` material. Search for the owning sections rather than rereading every document. Audit-only requests stay diagnostic; a request to audit and fix already authorizes in-scope implementation. For schema work, inspect `prisma/schema.prisma` and migration state.
3. Implement the smallest independently verifiable slice. Keep schema/migration, service/API, UI wiring, tests, and hardening separable when the change is substantial.
4. Verify behavior at the layer that can fail. Tests and builds do not replace authenticated browser proof for web runtime work, and TypeScript checks do not replace an Xcode build for Swift changes.
5. Sync shipped reality: update the relevant area docs, risks, task ledger, and plan lifecycle when the change changes product behavior.
6. Close with evidence, remaining risks, and either the next bounded slice or a clear stop recommendation.

## Repository contracts

### Web and API

- Deploys use standard Node.js serverless functions on Vercel. Do not add an Edge runtime without an explicit decision.
- Database access uses Neon PostgreSQL through the Prisma adapter. Batch database work where possible and avoid N+1 queries.
- Keep API routes within the platform timeout budget. Scheduled work belongs in Vercel Cron configuration.
- Use `withAuth` for authenticated routes and `withHandler` for public routes.
- Protect every mutation with `requirePermission(role, resource, action)` and write an audit entry with useful before/after snapshots. Use a snake_case action and give it a plain sentence in `src/lib/audit-actions.ts` (or a case in `describeAction`); `tests/audit-actions-contract.test.ts` fails otherwise.
- Use `SERIALIZABLE` for logically concurrent mutations and transactions for logically atomic multi-write flows.
- Let database constraints decide uniqueness. Catch Prisma `P2002` and return a friendly conflict instead of pre-checking with a race-prone read.
- Normalize and validate input at the schema boundary. Handle `ZodError` centrally and never assume an error response is JSON.

### Native iOS

- Native iOS workflows stay native. Do not replace a requested native flow with a web or PWA fallback for convenience.
- Prefer SwiftUI and system controls before custom chrome. Use the existing design tokens and native interaction patterns.
- Treat API payloads as versioned contracts. Check the route's actual response against every Swift Codable model, including nullable fields, envelopes, and rollout tolerance.
- A Swift source refactor requires both an Xcode build and the web-side source-contract tests that inspect Swift files.
- For explicit Xcode projects, register new Swift files in the project file and verify the target membership.

### macOS menu bar app

- The GearOps menu bar app (`macos/`) is a first-class client, not a side project. Fixes and polish to it carry the same bar as web and iOS work: root-cause fixes, tests, and verification — not best-effort follow-ups.
- When a change touches a contract the menu bar app consumes (companion projection, companion auth, APNs invalidation, shared assets), check and fix the macOS client in the same slice.
- Respect D-047 guardrails: no timers or database-backed fallback reads in the macOS client.

### Simulator policy

- Use `platform=iOS Simulator,name=iPhone 18 Pro Max` as the default iOS build and UI-verification destination for `Wisconsin`.
- `WisconsinKiosk` is iPad-only and runs on the two managed kiosk iPads (iPad Air 11-inch (M2), iPad14,8, iPadOS 26.5). Use `iPad Air 11-inch (M4)` on the iOS 26.5 runtime as its simulator stand-in (same 1180×820pt landscape canvas), and those managed iPads for physical proof. `scripts/kiosk-capture-scenarios.sh` captures the DEBUG fixture scenarios for review.
- Use the physical iPhone 16 Pro for device-only proof such as passkeys, camera, notifications, APNs, and other hardware or permission behavior. Simulator success does not replace that proof.
- Do not silently substitute iPhone 17 or maintain a broad simulator matrix. Add another simulator only when the task specifically requires a different form factor, OS version, iPad, or watch.
- If the required destination is unavailable, report the missing runtime/device and stop at the source or generic-device gate rather than changing the default destination.

### UI and component standards

- Web UI uses existing shadcn/ui primitives from `src/components/ui/`. Add a primitive through the project convention before creating a custom equivalent.
- Keep user-facing copy in product language, not schema or enum language. Reuse existing status, color, avatar, thumbnail, and feedback primitives.
- Remove dead consumers only after grepping all references. Do not delete CSS, exports, or helpers before their consumers are migrated.

## Documentation and task lifecycle

- Keep `tasks/` root for active work and durable reference ledgers. Archive completed plans instead of deleting them.
- A shipped behavior change requires the relevant area doc changelog and acceptance state. Update `docs/GAPS_AND_RISKS.md` when a gap or pending decision closes.
- Keep `tasks/lessons.md` concise. Dated evidence belongs in `tasks/archive/lessons-history-2026.md`; promote only reusable rules.
- Keep codemaps and task indexes synchronized after shared helper, component, route, or document moves. Run `npm run codemap` before retrying docs verification when generated maps are stale.
- Every pull request to `main` adds or updates an entry in `src/lib/releases.json`, the public release notes at `/releases`. Write it in product language for staff and students: a 2–7 word title, a 1–2 sentence summary, and 2–6 `details` bullets with the specifics that matter (not a vague "added Schedule functionality", not minute fixes). Set `date` to the expected merge date in Madison time (Central), not UTC; late evening in Madison is already tomorrow in UTC (the check allows 14 days either side of the run), `type` to `feature`, `improvement`, or `fixes`, and `pr` to the PR number (open the PR, then push the entry with its number; the check fails without it). Keep it public-safe: no names, emails, dollar amounts, or security specifics. Only PRs with nothing user-visible (dependencies, CI, docs, internal refactors) skip it, and they carry the `no-release-note` label. The CI `validate` job enforces this; after adding the label, re-run CI.
- Use conventional commits when commits are requested: `feat:`, `fix:`, or `chore:`. Describe the user-facing outcome and do not create a standalone generated-artifact commit.

## Verification matrix

| Change | Minimum proof |
| --- | --- |
| Docs or task structure | `git diff --check`, link/reference sweep, and the repository docs verification command when affected |
| Web or TypeScript | focused tests, `npx tsc --noEmit --pretty false`, lint, and `npm run build:app` |
| Browser cache/provider or polling lifecycle | `npm run test:performance:web` (local Chromium fixtures); authenticated route proof remains separate |
| API or schema | service/route tests, migration checks, `npm run build:app`, and full deploy-shaped build only in a controlled migration-safe environment |
| Native iOS | `xcodebuild` for the affected target, plus affected source-contract tests and any required generic-device build |
| macOS menu bar app | `xcodebuild -project macos/GearOps.xcodeproj -scheme GearOps build` (and `test` when behavior changes), plus `tests/macos-gearops-*.test.ts` and affected `tests/companion-*.test.ts` |
| Authenticated UI flow | local authenticated browser proof for the changed route or an explicit statement of why that proof is unavailable |
| User-facing UI change | a `gt-ui-review` review page: matched before/after captures where the two columns differ only by the change, measured differences when claimed, and the verification above. Local HTML is sufficient; external publishing requires existing authorization. If a trustworthy baseline is unavailable, label after-only evidence and the missing comparison rather than inventing a before |

Once the applicable gates pass, rerun them only after a relevant change, failure, or unresolved concern; avoid repeated passing checks.

Use the full `npm run build` when shipping or validating deploy-shaped behavior, especially schema and migration work. It may run database deployment steps, so do not use it casually against an uncontrolled environment.

## Preview environments and infrastructure hardening

The accepted plan is [D-063](docs/DECISIONS.md#d-063-branch-owned-previews-and-one-automatic-production-build); the runbook is [docs/PREVIEW_ENVIRONMENTS.md](docs/PREVIEW_ENVIRONMENTS.md). Rules for every agent (Claude, Cursor, Codex):

- One named Git feature branch owns one preview environment (its own sanitized Neon child, file stores, session secret, and encrypted handoff). Never share, borrow, reset, or recreate another branch's environment, and never use production credentials or pull production variables for a preview.
- New branches get an environment only from the hosted `Managed previews` workflow, which runs after `CI` passes on a same-repository PR targeting `main`. To get one: push the branch, open the PR, let CI and Managed previews pass, then run `npm run preview:setup`, `npm run dev:preview`, and `npm run auth:local` (the first `auth:local` can 404 on a cold route compile; run it again). Use the printed URL; do not bypass the wrappers with raw `next` commands.
- For a human's local review of a PR, `npm run review <PR#>` creates a worktree beside the main checkout, installs, reuses the PR's existing preview (or serves DB-free when there is none), signs in, and opens the browser. It never provisions a database.
- If `preview:setup` reports no environment, its message names the likely cause (workflow disabled, no open PR to `main`, or a Dependabot / non-app pull request that is skipped on purpose). It does not read check results, so when a PR is open inspect its checks and the `Managed previews` run for a failure before waiting. Do not provision manually; `PREVIEW_SIGNING_KEY` and operator tokens belong only to trusted CI. Dependabot pull requests and pull requests that do not change `prisma/`, `src/`, or `scripts/` do not get a Neon preview branch.
- Required checks on docs-only pull requests still have to report. Do not add `paths` or `paths-ignore` to `.github/workflows/ci.yml`. Docs-only diffs skip install, tests, the app build, and the database integrity script inside `validate` and `postgres-integrity`.
- Main is the only automatic production line. Native Vercel Git preview builds are skipped by the project's Ignored Build Step, so a failing `Vercel` check on a PR is a regression to report, not noise. Do not disconnect Git or change that step without checking the runbook.
- Vercel's free plan caps deployments per day, and a cancelled Git deployment still counts. `vercel.json` sets `git.deploymentEnabled` so branches with a slash (`claude/*`, `dependabot/*`) create no Git deployment at all. Batch work into fewer pushes per PR and merge related PRs together; every merge to `main` is one production deploy.
- Required checks on `main` are `validate` and `postgres-integrity`, with strict up-to-date, resolved conversations, and no admin bypass. Docs-only pull requests still report both. `validate` runs `scripts/audit-gate.mjs`, which fails on any high or critical `npm audit` advisory. Fix new advisories with targeted `package.json` overrides, not `npm audit fix` (it rewrites the lockfile and can make results worse). Only when no installable fix exists (no patched release, or the patch is still inside the `.npmrc` `min-release-age` cooldown) add a dated exception with a reason in that script; an expired exception fails CI.
- Agents must not merge to `main`, change repository variables, Vercel project settings, or branch protection, or enable cleanup without explicit user authorization. `PREVIEW_CLEANUP_ENABLED` stays off until a `preview:cleanup` dry run is reviewed.

## Safety and quality bar

- Prefer the smallest change that closes the root cause.
- Do not turn a role-specific workflow into a staff-only workflow without evidence.
- Treat current product direction as stronger than stale historical recommendations.
- Before deleting a source file, inspect every type it defines, not only the file's primary type, and compile the affected target in the same turn.
- Before declaring done, inspect the final diff, run the relevant gates, and report any unverified external or visual proof honestly.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
