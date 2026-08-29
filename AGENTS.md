# Wisconsin Creative Agent Contract

This file is the operating contract for work in this repository. Keep it short, enforceable, and current. Put durable implementation lessons in `tasks/lessons.md`, accepted architecture in `docs/DECISIONS.md`, and area-specific truth in the relevant `docs/AREA_*.md` file.

## Instruction priority

When guidance conflicts, use this order:

1. The user's current request and explicit product direction.
2. Current accepted contracts in `docs/DECISIONS.md`, the relevant area brief, and the relevant area doc.
3. Current source, schema, tests, and runtime evidence as proof of what is actually shipped.
4. Durable lessons in `tasks/lessons.md`.
5. Historical plans and archived session notes.

If a conflict could change behavior, stop and reconcile the source of truth in the appropriate document before implementing.

## Working rules

- Inspect the real repository state before making claims or edits.
- For a non-trivial task, write a bounded plan, identify the files and contracts involved, and verify the plan against the current source before editing.
- Read each file in full before editing it. Plan all edits to a file first, then make one coherent edit.
- Preserve unrelated user and parallel-agent work. Never use broad staging such as `git add -A` when unrelated changes are present.
- Do not stage, commit, push, merge, or delete user work unless the user explicitly asks for that action.
- If the same approach fails twice, stop repeating it. Re-plan with a safer alternative or report the concrete blocker.
- Promote a new lesson only when it is reusable, non-obvious, and supported by a verified failure or accepted decision.

## Execution flow

1. Establish scope: inspect `git status`, read `docs/NORTH_STAR.md`, then inspect the relevant route/view/service, schema, and current docs.
2. Audit contracts: read the relevant `docs/BRIEF_*`, `docs/AREA_*`, `docs/DECISIONS.md`, and `docs/GAPS_AND_RISKS.md` material. For schema work, inspect `prisma/schema.prisma` and migration state.
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
- Protect every mutation with `requirePermission(role, resource, action)` and write an audit entry with useful before/after snapshots.
- Use `SERIALIZABLE` for logically concurrent mutations and transactions for logically atomic multi-write flows.
- Let database constraints decide uniqueness. Catch Prisma `P2002` and return a friendly conflict instead of pre-checking with a race-prone read.
- Normalize and validate input at the schema boundary. Handle `ZodError` centrally and never assume an error response is JSON.

### Native iOS

- Native iOS workflows stay native. Do not replace a requested native flow with a web or PWA fallback for convenience.
- Prefer SwiftUI and system controls before custom chrome. Use the existing design tokens and native interaction patterns.
- Treat API payloads as versioned contracts. Check the route's actual response against every Swift Codable model, including nullable fields, envelopes, and rollout tolerance.
- A Swift source refactor requires both an Xcode build and the web-side source-contract tests that inspect Swift files.
- For explicit Xcode projects, register new Swift files in the project file and verify the target membership.

### Simulator policy

- Use `platform=iOS Simulator,name=iPhone 16 Pro` as the default iOS build and UI-verification destination for both `Wisconsin` and `WisconsinKiosk`.
- Use the physical iPhone 16 Pro for device-only proof such as passkeys, camera, notifications, APNs, and other hardware or permission behavior. Simulator success does not replace that proof.
- Do not silently substitute iPhone 17 or maintain a broad simulator matrix. Add another simulator only when the task specifically requires a different form factor, OS version, iPad, or watch.
- If the iPhone 16 Pro destination is unavailable, report the missing runtime/device and stop at the source or generic-device gate rather than changing the default destination.

### UI and component standards

- Web UI uses existing shadcn/ui primitives from `src/components/ui/`. Add a primitive through the project convention before creating a custom equivalent.
- Keep user-facing copy in product language, not schema or enum language. Reuse existing status, color, avatar, thumbnail, and feedback primitives.
- Remove dead consumers only after grepping all references. Do not delete CSS, exports, or helpers before their consumers are migrated.

## Documentation and task lifecycle

- Keep `tasks/` root for active work and durable reference ledgers. Archive completed plans instead of deleting them.
- A shipped behavior change requires the relevant area doc changelog and acceptance state. Update `docs/GAPS_AND_RISKS.md` when a gap or pending decision closes.
- Keep `tasks/lessons.md` concise. Dated evidence belongs in `tasks/archive/lessons-history-2026.md`; promote only reusable rules.
- Keep codemaps and task indexes synchronized after shared helper, component, route, or document moves. Run `npm run codemap` before retrying docs verification when generated maps are stale.
- Use conventional commits when commits are requested: `feat:`, `fix:`, or `chore:`. Describe the user-facing outcome and do not create a standalone generated-artifact commit.

## Verification matrix

| Change | Minimum proof |
| --- | --- |
| Docs or task structure | `git diff --check`, link/reference sweep, and the repository docs verification command when affected |
| Web or TypeScript | focused tests, `npx tsc --noEmit --pretty false`, lint, and `npm run build:app` |
| API or schema | service/route tests, migration checks, `npm run build:app`, and full deploy-shaped build only in a controlled migration-safe environment |
| Native iOS | `xcodebuild` for the affected target, plus affected source-contract tests and any required generic-device build |
| Authenticated UI flow | local authenticated browser proof for the changed route or an explicit statement of why that proof is unavailable |
| User-facing UI change | a `gt-ui-review` review page: matched before/after captures where the two columns differ only by the change, the measured difference, and the verification above |

Use the full `npm run build` when shipping or validating deploy-shaped behavior, especially schema and migration work. It may run database deployment steps, so do not use it casually against an uncontrolled environment.

## Safety and quality bar

- Prefer the smallest change that closes the root cause.
- Do not turn a role-specific workflow into a staff-only workflow without evidence.
- Treat current product direction as stronger than stale historical recommendations.
- Before deleting a source file, inspect every type it defines, not only the file's primary type, and compile the affected target in the same turn.
- Before declaring done, inspect the final diff, run the relevant gates, and report any unverified external or visual proof honestly.
