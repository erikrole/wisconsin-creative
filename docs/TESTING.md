# Testing Guide

Last refreshed: 2026-09-27

## Overview

The automated test suite uses Vitest in the Node.js environment. Tests live in `tests/` and follow `tests/<feature>.test.ts`.

Latest executed evidence (2026-09-27): 703 Vitest files, 5,019 passing cases, and one existing gated skip on Node 22.23.3 and Vitest 4.1.11, including the full shuffled coverage run (seed `260927`, four workers). See the [test audit and follow-ups](../tasks/audit-tests-2026-09-27.md) for the inventory, prior failures, cleanup decisions, and measured performance. Source-contract tests inspect source text; they do not execute Swift or replace browser/device proof.

Refresh static orientation counts with:

```bash
rg --files tests | rg '\.test\.(ts|mjs)$' | wc -l
rg -n '\b(it|test)\s*\(' tests --glob '*.test.ts' | wc -l
rg --files tests | rg '/ios-.*\.test\.ts$' | wc -l
rg --files tests | rg '/[^/]*(source|contract)[^/]*\.test\.ts$' | wc -l
rg --files tests | rg '/[^/]*route[^/]*\.test\.ts$' | wc -l
rg -n 'BUG:' tests --glob '*.test.ts'
```

These counts are orientation data, not a coverage guarantee. Use focused tests and the required gates for the code touched by a slice.

For the eight real PostgreSQL custody transaction and route checks, use Node 22 and local PostgreSQL tools (`initdb`, `pg_ctl`, and `createdb`) on macOS or Linux:

```bash
npm run test:postgres:custody
```

The runner creates a disposable cluster under the canonical `/tmp` directory (`/private/tmp` on macOS), disables TCP, builds a fresh schema from `prisma/schema.prisma`, runs `tests/postgres/*.postgres.ts` through `vitest.postgres.config.ts`, and stops/removes that cluster on normal completion or a failed command. It overwrites database environment variables and accepts no external database URL. The tests also reject a URL outside the disposable socket path before connecting. They use Prisma's native PostgreSQL transport and real wrapper, route, service, receipt, and audit code; only device authentication and post-response notification delivery are mocked.

The cases protect complete rollback after a late database failure, receipt read-back, competing transfers forced to overlap at the database write, simultaneous HTTP retries with one committed result and one live-activity scheduling callback, definitive rejection replay, and clearable changed/expired/unreadable handoffs. Temporary mutation controls prove the race case fails under weaker isolation or missing serialization retry. The local command took 3.60s including setup/cleanup; the eight cases took 958ms. These checks remain separate from the default suite and its existing skip.

The same command is wired into the existing PostgreSQL CI job, using `pg_config --bindir` to locate the runner's PostgreSQL tools; a hosted run is pending. The [GitHub runner image inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md#postgresql) documents the available PostgreSQL installation. Local proof uses PostgreSQL 17.11. These checks do not prove Neon transport, migration-only constraints/triggers/sequences, real device authentication, external notification delivery, or deployed/device acceptance.

The measured critical-server scope is 73.18% statements, 63.28% branches, 75.74% functions, and 76.00% lines across `src/lib/services/**`, `src/lib/api.ts`, `src/lib/rbac.ts`, and `src/lib/permissions.ts`. These percentages describe the configured 98-file critical-server scope, not the entire Next.js or Swift codebase. Static declaration counts also differ from executed case counts because of parameterized tests.

On 2026-09-27 the user accepted the Vitest 4 AST-aware measurement baseline. The same tests and source files were measured; the old remapper had overstated branch/function coverage, including 100% on an unexecuted service. Subsequent custody-transfer and bulk-scheduling service tests raised the measured baseline. `npm run test:coverage` now enforces floors of **70% statements, 63.28% branches, 75.74% functions, and 70% lines**. Raise the floors as meaningful owner tests improve coverage; do not lower them to accommodate later regressions or narrow the included files to make the gate pass. Test isolation and the existing gated integration skip are unchanged.

## Verification Gates

Use [docs/RELEASE_VERIFICATION.md](RELEASE_VERIFICATION.md) as the canonical closeout matrix. This guide owns test layers, test patterns, and test inventory; the release guide owns final gate selection for web, API, schema, browser, deploy, and iOS work.

Use the smallest focused test that proves the touched behavior first, then run broader gates according to blast radius.

```bash
# Focused Vitest file
npx vitest run tests/<feature>.test.ts

# Full Vitest suite
npm test

# Full suite with enforced critical-server coverage floors
npm run test:coverage

# TypeScript
npx tsc --noEmit --pretty false

# Codemap/docs drift
npm run verify:docs

# Prisma migration prefix sanity
npm run db:migrate:check

# Production app build without live migration deploy
npm run build:app

# Full production build, including migration deploy wrapper
npm run build

# Authenticated business-data-safe browser smoke (isolated target only)
npx playwright install chromium
npx playwright test --list
npm run test:e2e:smoke
```

Default local closeout for web/API cleanup slices:

1. Focused Vitest files for the changed behavior.
2. `npx tsc --noEmit --pretty false`.
3. `npm run verify:docs` after code, docs, or codemap-owned files change.
4. `npm run db:migrate:check` for any repo-wide closeout, and always after migration/schema work.
5. `git diff --check`.
6. `npm run build:app` before declaring a shippable local slice.

Run `npm test` when shared behavior, auth, route wrappers, booking lifecycle, or broad service helpers change enough that focused files do not cover the risk. For iOS source slices, also run `npm run drift:ios` and `npm run audit:ios:gaps`; use `npm run ios:xcode:verify` for serialized Xcode compile proof. Use XcodeBuildMCP or Simulator screenshots when Swift runtime, navigation, visual layout, or UI proof is part of the slice. The full native workflow lives in `docs/IOS_XCODE_WORKFLOW.md`.

For operator-facing booking freshness work, add authenticated browser proof after the focused automated gates: create or mutate one visible booking from another authenticated client, confirm Dashboard counts/rows and `/bookings` list rows converge without using the manual refresh button, verify an already-open booking detail sheet updates for the changed booking id, then reload Dashboard to prove persisted cache does not resurrect stale rows. Store proof notes or screenshots under `tasks/archive/proofs/`.

## Local Performance Benchmarks

For local performance regression evidence without credentials or external data:

```bash
# Real provider, production React and SSR hydration: cold, warm, corrupt and denied storage.
node scripts/benchmark-query-provider.mjs --verify /tmp/query-provider-results.json

# Run after build:app; includes unique JS chunks from the route and parent layouts.
node scripts/benchmark-web-bundles.mjs /tmp/web-bundles.json

# Real profile form against synthetic identity/save responses.
node scripts/benchmark-profile-completion.mjs --output /tmp/profile-performance
```

The profile script accepts `--baseline /absolute/path/to/saved/ProfileCompletionWizard.tsx` for a saved pre-change implementation; it never rewrites the checkout. These component fixtures do not replace authenticated route/server proof. Build first, then run standalone TypeScript checks: Next regenerates the generated types during a build.

For real authenticated routes and APIs, attach the current branch's signed isolated preview using [the shared agent runbook](PREVIEW_ENVIRONMENTS.md#reusable-performance-preview--2026-09-28), bring its migrations current, then run on Node 22:

```sh
node scripts/benchmark-authenticated-preview.mjs --build --samples 5
```

This starts and stops a separate local production-mode server. It signs in through the real UI and records five cold/warm samples for Home, Items, Bookings, Schedule and Signatures, one 390px rendered check per route, and eight API timing/payload samples. Credentials remain in memory; a new ignored output directory preserves prior runs. Source/build fingerprints, metric definitions, raw samples, dataset counts and limitations accompany `results.json`. Fresh browser contexts do not simulate an asleep database or serverless cold start. The small-sample p95 is a nearest-rank estimate, not a production percentile. Repeated runs reuse the branch's existing resources; they never provision or deploy.

The read-settled metric waits for document load and 500ms without outstanding GET/HEAD requests. It includes that observation delay. Background POST response/completion state is retained separately: whole-network idle did not settle for acknowledged product-event/app-open requests in the first live probe. The harness never stubs those requests. Treat a visible heading, settled reads, and full interaction readiness as different measures.

Native `WisconsinPerformance` owns the existing five-iteration launch/scroll and three-iteration equipment scenarios. `APIResponseDecodingTests` records matched 30/300/3,000-row decoding samples and verifies off-main execution. `ThumbnailLoadingTests` measures concurrent cold-cache requests/allocations and tests retry, size/scale, cancellation and sign-out isolation. Use the mandated simulator destinations, retain raw samples, and distinguish Debug simulator regression checks from Release physical-device results. The [2026-09-27 performance ledger](../tasks/performance-web-ios-plan-2026-09-27.md) tracks current evidence.

## Authenticated Playwright Smoke

`tests/e2e/` is the durable launch smoke layer. It does not invoke business-data mutation actions. It covers the launch-critical web routes in desktop Chromium and a 390px narrow-mobile Chromium viewport. Each route verifies its accessible heading, a keyboard-reachable primary control, console/page error health, and horizontal overflow. Request interception exercises Search partial results, Items bootstrap degradation, and Dashboard count-truth recovery without corrupting business data.

Use a dedicated active test identity on an isolated local or review environment:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 \
PLAYWRIGHT_EMAIL=<dedicated-test-email> \
PLAYWRIGHT_PASSWORD=<dedicated-test-password> \
PLAYWRIGHT_ROLE=STUDENT \
PLAYWRIGHT_TARGET_ISOLATED=1 \
npm run test:e2e:smoke
```

`PLAYWRIGHT_ROLE` must be `STUDENT`, `STAFF`, or `ADMIN` and must match the account. A `STUDENT` or `STAFF` account is required for the direct role-restricted Settings proof. Authentication uses the real `/login` UI, which creates a session and audit entry. Authenticated requests can also refresh the test user's last-active timestamp. This session metadata is why every authenticated run requires the affirmative `PLAYWRIGHT_TARGET_ISOLATED=1` contract even though the suite avoids business-data mutations. Cookies are written only to ignored `test-results/playwright/auth/user.json`. Traces and screenshots are retained only for failures.

### Local Preview identity bootstrap

Follow [PREVIEW_ENVIRONMENTS.md](PREVIEW_ENVIRONMENTS.md). `preview:setup` verifies
and attaches the current branch's sanitized environment; `dev:preview` prints the
actual port; `auth:local` uses the recorded server and branch-specific cookie.
It signs in as hidden synthetic `admin@creative.local`, writes ignored Playwright
state and local test settings, then probes `/api/me`. A rejected managed-preview
password fails rather than rotating another agent's credentials. Sessions expire
after 12 hours; rerun `auth:local` to refresh. Never point the harness at production.

The harness rejects `wisconsincreative.com` and its known legacy production host even if the isolation flag is set. Set comma-separated `PLAYWRIGHT_PRODUCTION_HOSTS` when another hostname must be treated as production. Do not commit auth state, weaken normal auth, seed production, or use production credentials.

Without any credential variables, local tests skip explicitly so `npx playwright test --list` remains useful. Partial credentials fail instead of skipping. Whenever `CI` is set, missing credentials, missing isolation opt-in, or an admin-only identity fail before tests start. Release verification must also add `PLAYWRIGHT_RELEASE=1` to enforce the same strict contract outside CI.

## Test Layers

- **Service tests:** Pure or DB-mocked business logic, such as booking rules, availability, reports, badge evaluation, schedule health, and status derivation.
- **Route tests:** API route handlers with mocked auth, database, and request context. These protect permission gates, safe parsing, transaction behavior, and response contracts.
- **Source-contract tests:** Static tests that pin important architectural decisions, app/iOS contracts, route wrappers, and UI affordance ownership.
- **iOS contract tests:** Static checks over Swift files and API contracts used by the native app. These do not replace a simulator build.
- **Regression tests:** Tests that prevent a fixed bug from returning. They should name the bug in plain language and point at the behavior that must stay true.
- **Browser smoke tests:** Authenticated Playwright checks against an isolated target. They prove rendered route, responsive, keyboard, role, and recovery behavior that source contracts and builds cannot establish.

## Mock Pattern: `vi.mock("@/lib/db")` + `_mockTx`

Most service functions use `db.$transaction()`. The standard mock pattern intercepts transactions and provides a mock transaction client:

```ts
const transactionCalls: Array<{ options: unknown }> = [];

vi.mock("@/lib/db", () => {
  const mockTx = {
    booking: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  };

  return {
    db: {
      $transaction: vi.fn(async (fn, options?) => {
        transactionCalls.push({ options });
        return fn(mockTx);
      }),
      _mockTx: mockTx,
    },
  };
});

import { db } from "@/lib/db";
const mockTx = (db as any)._mockTx;
```

Key rules:

1. Keep `vi.mock` at module scope so it is hoisted above imports.
2. Track transaction options when isolation level is part of the contract.
3. Expose `_mockTx` for assertions instead of rebuilding a second mock.
4. Clear mocks and reset call-tracking state in `beforeEach`.

## Transaction Isolation Verification

Use helpers from `tests/_helpers/assert-transaction.ts`:

```ts
import { expectSerializableIsolation, expectNoIsolation } from "./_helpers/assert-transaction";

expectSerializableIsolation(transactionCalls, 0);
expectNoIsolation(transactionCalls, 0);
```

`expectNoIsolation` is useful only when proving legacy behavior or guarding an intentionally non-transactional path. Prefer `expectSerializableIsolation` for mutation paths where concurrent writes can corrupt state.

## Data Factories

`tests/_helpers/factories.ts` provides override-friendly factories:

```ts
import { makeBooking, makeUser, makeBulkItem } from "./_helpers/factories";

const booking = makeBooking({ status: "COMPLETED" });
const user = makeUser({ role: "ADMIN" });
const bulkItem = makeBulkItem({ plannedQuantity: 2 });
```

Available helpers include `makeUser`, `makeBooking`, `makeSerializedItem`, `makeBulkItem`, `makeAsset`, `makeShiftTrade`, `makeShiftAssignment`, `makeShift`, `makeBulkSku`, and `makeBulkStockBalance`.

## Testing Functions That Accept `tx`

Functions that accept a transaction client do not need to mock `@/lib/db`; pass a local mock transaction instead:

```ts
function createMockTx() {
  return {
    assetAllocation: { findMany: vi.fn() },
    asset: { findMany: vi.fn() },
  };
}

const tx = createMockTx();
const result = await checkSerializedConflicts(tx as any, { /* ... */ });
```

## `BUG:` Convention

Use `BUG:` sparingly for fixed, high-risk regressions. The live inventory spans multiple areas, so use the repository search below instead of maintaining a stale list here.

For new tests:

- Use `BUG:` only when the test name is intentionally tied to a known bug report or high-risk regression.
- If the bug is still open and the test proves current broken behavior, say that in a nearby comment and track the open gap in `docs/GAPS_AND_RISKS.md` or the relevant plan.
- If the bug is fixed, write the assertion against the desired behavior and treat `BUG:` as regression history, not as an expected failure marker.
- Do not keep stale "known bug" tables in this guide. Use live `rg -n 'BUG:' tests --glob '*.test.ts'` output instead.

## Adding a New Test File

1. Create `tests/<feature>.test.ts`.
2. Choose the layer: service, route, source-contract, iOS contract, or regression.
3. Add the minimal mocks needed for the behavior under test.
4. Import the subject after module-scope `vi.mock` calls.
5. Reset mocks and shared arrays in `beforeEach`.
6. Use factories for complex domain objects.
7. Run `npx vitest run tests/<feature>.test.ts`.
8. Add the relevant closeout gates for the slice.

## Current Helper Files

```text
tests/_setup.ts
tests/_helpers/assert-transaction.ts
tests/_helpers/factories.ts
tests/_helpers/mock-db.ts
```

## Notes

- `npm run build:app` is the safer local app-build gate when the slice should not deploy migrations.
- `npm run build` runs the migration deploy wrapper before `next build`; reserve it for ship paths where that side effect is intended.
- Browser smoke remains necessary when the request is visual or route-proof oriented. Tests and builds do not prove authenticated UI behavior by themselves.
