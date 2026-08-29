---
name: gt-api-hardening
description: Canonical Wisconsin Creative API hardening workflow. Use when the user runs /gt-api-hardening or asks to audit or improve route authentication, authorization, validation, transactions, concurrency, audit entries, query efficiency, public or kiosk boundaries, cron behavior, exports, bulk work, or Vercel runtime safety.
---

# GT API Hardening

Harden one route family from current contracts and source. Do not apply generic security prescriptions without proving they fit the route.

## Orient

1. Read `AGENTS.md`, the owning area and brief docs, decisions, gaps, active ledger, and relevant lessons.
2. Read target routes, wrappers, services, schema models, tests, callers, and client response handling completely.
3. Inspect `git status --short` and preserve unrelated work.
4. Record the route inventory, actor types, trust boundary, mutation effects, response envelopes, and runtime constraints.

## Check

- Authentication wrapper matches the actor: user, kiosk device, cron, or intentional public caller.
- Every protected mutation enforces server-side permission and writes a useful audit entry when product state changes.
- Params, query, body, and external data are normalized and validated at the correct boundary.
- Atomic multi-write work uses a transaction; logically concurrent invariants use the isolation or conflict strategy required by the contract.
- Database constraints own uniqueness and conflicts return actionable responses.
- Public, export, upload, and bulk routes have evidence-based abuse and resource bounds. Add rate limiting only where the threat and infrastructure support it.
- Query shape avoids proven N+1 or unbounded work. Use parallel or partial-result behavior only when the product contract allows partial success.
- Error handling preserves status, never assumes JSON, and does not leak sensitive internals.
- Client and native models match the actual response envelope and rollout order.

## Execute

Use `gt-plan` for a non-trivial route family. Implement P0/P1 fixes as independently testable service, route, client, test, and documentation slices. Stop on contract, schema, live-data, or permission mismatches instead of improvising.

## Verify

Select proof from the `AGENTS.md` verification matrix. Add focused route/service tests for authorization, validation, concurrency, audit behavior, and failure responses. Use deploy-shaped proof only when deployment behavior is in scope and safe.

Use `area-doc-sync` when behavior ships. Do not commit, push, or open a PR unless explicitly requested.
