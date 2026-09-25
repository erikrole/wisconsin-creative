---
name: gt-test-audit
description: "Gate new or changed Wisconsin Creative tests and audit existing tests for low-value, implementation-coupled, or duplicative coverage and the test-only seams they keep alive."
---

# GT Test Audit

One value bar, two modes. **Authoring** gates every new or changed test at write time. **Audit** sweeps existing tests for the [junk patterns](#junk-patterns). Optimize for confidence, not deletion count. An audit is findings-only unless the same request authorizes fixes (see `README.md`).

## Authoring gate

Before adding a test, answer all four; a missing answer means do not add it yet:

1. What observable behavior, invariant, or independent contract does it protect?
2. What credible regression makes it fail?
3. Why does existing coverage not already catch it? Each contract has one primary owner test at the strongest boundary (service test for domain rules, route test for auth/validation/status, source-contract test for Swift/macOS invariants the web suite cannot execute). Prefer extending a table-driven case over a near-duplicate test.
4. Does it need a production seam (export, flag, wrapper, injection hook) that no production caller uses? If yes, test at the real boundary instead.

Then check every [junk pattern](#junk-patterns); a match fails the gate unless the [retention bar](#retention-bar) names the contract it independently guards. A test that breaks under behavior-preserving refactoring asserts implementation; rewrite it at the owning boundary.

Bug regression tests must fail on the pre-fix code for the intended reason. One regression at the owner boundary covers the bug; do not replay it at every layer.

## Junk patterns

- assertion-free coverage probes, or `expect(x).toBeDefined()` as the only claim;
- self-comparisons and identity copies (expected value built by the helper under test);
- copied fixtures, inventories, or export lists that restate source;
- source greps that pin identifiers, formatting, or call shape rather than a user-facing contract;
- the same contract asserted by several files (for example a `*-source.test.ts` and a behavioral service test of the same rule);
- mocks that implement the asserted behavior (a mocked Prisma call returning exactly what the assertion checks);
- tests whose only purpose is keeping a test-only export alive, or production code whose only callers are tests;
- negative controls that pass for an unrelated reason (a 401 from auth when the test claims to prove a 409 conflict guard);
- names that promise more than the input exercises.

## Retention bar

Keep a test when it independently enforces an API, auth/permission, schema or migration, custody/allocation, audit-log, notification, timezone, platform, or cross-client contract. Also keep:

- **Swift and macOS source-contract tests** (`tests/ios-*`, `tests/macos-gearops-*`, `tests/companion-*`, anything using `scheduleSurfaceSource()`). `AGENTS.md` requires them for Swift changes because vitest cannot execute Swift. Judge them on whether they pin a user-facing contract (route, key, copy, venue resolution, API field) versus an incidental identifier; prune only the latter.
- call ordering when order is observable behavior;
- regressions with a credible failure mode;
- web source inspection when it is the cheapest independent guard: it fails when the contract changes and survives an identifier-only rename.
- a retained test failing on the baseline: treat it as a possible product bug and repair the owner, never delete it.

Static or slow is not a deletion reason.

## Discovery

Read-only; report evidence before editing. Read the complete test, its production owner, callers, and overlapping tests before judging. For a broad sweep, split lanes: services/lib, API routes, web UI source tests, native (iOS/macOS/companion) source contracts, and a cross-cutting pattern sweep. Prefer a few high-confidence candidates over a speculative inventory.

## Candidate evidence

Record every field before editing; a missing field means the candidate is not ready:

- test name and `file:line`;
- what failure it can actually detect;
- non-test callers of the covered seam (`rg` proof);
- stronger remaining owner proof, or why none is needed;
- why the test or seam exists (`git log -L` / blame when unclear);
- deletion it unlocks (test, helper, export, production path);
- risk and the focused validation command.

## Edit shape

One coherent owner-boundary batch per change. Delete obsolete test-only exports and dead paths rather than preserving aliases. Move retained regressions to their canonical owner; consolidate duplicates into one table-driven case. Do not add replacement tests that restate the same implementation, and do not delete uncertain candidates to raise the count.

## Validation

Never edit tests while a vitest watcher is running in the checkout.

1. `npx vitest run <paths>` for the owner and sibling tests (see the threads-pool note in project memory; do not set `isolate: false`).
2. For a removed Swift source-contract test, confirm a retained test or the Xcode build still guards the contract.
3. `npx tsc --noEmit --pretty false`, lint on touched files, and `git diff --check`.
4. Report `git diff --numstat`, separating production from test LOC.

## Handoff

Report removed categories, production simplifications, retained false positives and why, proof actually run, production vs test LOC, and named follow-ups. Do not stage, commit, push, or open a PR unless requested; use `gt-ship` when it is.
