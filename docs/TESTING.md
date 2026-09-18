# Testing Guide

Last refreshed: 2026-09-17

## Overview

The automated test suite uses Vitest in the Node.js environment. Tests live in `tests/` and follow `tests/<feature>.test.ts`.

Current static inventory:

- 391 test files under `tests/`
- 2,331 `it()` / `test()` declarations by static grep
- 55 iOS source-contract files named `ios-*.test.ts`
- 79 source or contract files with `source` or `contract` in the filename
- 66 route-focused files with `route` in the filename
- 35 current `BUG:` references across 11 files

Refresh the inventory with:

```bash
find tests -name '*.test.ts' -type f | wc -l
rg -n '\b(it|test)\s*\(' tests --glob '*.test.ts' | wc -l
find tests -name 'ios-*.test.ts' -type f | wc -l
find tests -name '*.test.ts' -type f | rg '/[^/]*(source|contract)[^/]*\.test\.ts$' | wc -l
find tests -name '*.test.ts' -type f | rg '/[^/]*route[^/]*\.test\.ts$' | wc -l
rg -n 'BUG:' tests --glob '*.test.ts'
```

These counts are orientation data, not a coverage guarantee. Use focused tests and the required gates for the code touched by a slice.

The 2026-07-17 adversarial baseline is 391 files and 2,464 passing runtime tests. The normal full suite, the instrumented coverage run, and shuffled full-suite runs with seeds `1701`, `1702`, and `20260717` all passed without skips. The measured critical-server scope is 70.80% statements/lines, 78.03% branches, and 77.35% functions across `src/lib/services/**`, `src/lib/api.ts`, `src/lib/rbac.ts`, and `src/lib/permissions.ts`. `npm run test:coverage` enforces non-regression floors of 70% statements/lines and 75% branches/functions. These percentages describe the configured critical-server scope, not the entire Next.js or Swift codebase.

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

Use this path for authenticated local Preview work on `http://127.0.0.1:3000`. Do not mint session rows by hand, and do not point Playwright at production.

```bash
npm run dev:preview
npm run auth:local
```

`npm run dev:preview` keeps Preview variables in memory, replaces a short provider `SESSION_SECRET` with the gitignored local development secret, retargets Preview's empty default `neondb` database to `gear-tracker`, refuses the production Neon endpoint, and overlays local Preview flags from `.env.development.local`. Unless that file explicitly sets `BADGES_ENABLED=false`, local Preview starts with badges on.

`npm run auth:local` then:

1. Refuses Vercel production env, production Neon, and non-loopback app URLs.
2. Uses the hidden `admin@creative.local` smoke identity only.
3. Signs in through `POST /api/auth/login` and writes Playwright storage to ignored `test-results/playwright/auth/user.json`.
4. Stores `PLAYWRIGHT_EMAIL`, `PLAYWRIGHT_PASSWORD`, `PLAYWRIGHT_ROLE`, `PLAYWRIGHT_BASE_URL`, and `PLAYWRIGHT_TARGET_ISOLATED=1` in gitignored `.env.development.local`.
5. Probes `GET /api/me` and prints identity fields without passwords, tokens, or secrets.

If the stored smoke password is missing or rejected, the script rotates that hidden `@creative.local` password on the isolated Preview or local database only. Playwright loads those gitignored values automatically for local runs and still ignores them in CI. Session cookies expire after 12 hours; rerun `npm run auth:local` or the Playwright auth setup to refresh them. Expired server sessions now clear the cookie instead of leaving a stale `gear-tracker-session` value in the browser.

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
