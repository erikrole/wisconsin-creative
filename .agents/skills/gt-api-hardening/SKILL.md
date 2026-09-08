---
name: gt-api-hardening
description: "Audit or fix a Wisconsin Creative API route family for authorization, validation, concurrency, auditability, bounded work, and client recovery. Audit-only requests stay read-only."
---

# GT API Hardening

Work on the requested route family and actual actor boundary. `AGENTS.md` owns shared rules. Inspect route wrappers, services, schema, callers, and focused tests; read only relevant owner decisions and risks.

Record actor (user, kiosk device, cron, intentional public), permissions, input/response envelopes, mutation effects, concurrent invariants, and runtime constraints.

Check applicable contracts:
- Correct authentication wrapper and server-side permission for each protected action.
- Schema-boundary normalization/validation and safe non-JSON error handling.
- Atomic writes, required transaction isolation, uniqueness constraints, friendly conflicts, and useful before/after audit evidence.
- Stale/versioned writes and idempotency where retries are possible; callers retain input and reconcile uncertain outcomes.
- Resource bounds for public, bulk, upload, export, and external calls. Rate limits need a demonstrated threat and supported infrastructure.
- Query count/payload size and bounded pagination. Parallelize only independent reads; preserve ordering, atomicity, rate limits, and partial-result contracts.
- Actual native/web decoding and backward-compatible rollout.

Audit-only: return evidenced findings, paths/lines, severity, confidence, and a bounded fix order. Audit-and-fix: implement the authorized fixes without another approval gate; do not restrict work to P0/P1 if the user selected other findings.

Use focused negative authorization, concurrency, validation, audit, and failure-response tests where the changed contract warrants them. Apply the repository proof matrix; full deploy-shaped builds only in a controlled migration-safe environment. Report local versus runtime/deployed evidence accurately.
