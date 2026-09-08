---
name: gt-incident
description: "Investigate and resolve an actual Wisconsin Creative Schedule, reservation, checkout, battery, or kiosk incident using exact records and operator evidence. Use for incorrect state, blocked actions, lost edits, or uncertain saves."
---

# GT Incident

Start with the reported incident and actual read-only evidence. Prioritize trustworthy student/staff work and correct custody over exports or speculative features.

## Establish what happened

Identify the affected record/event, actor and role, surface, environment, expected outcome, observed failure, and time. Resolve IDs from authenticated data; never select a similarly named record by guess. Read current owner contracts and trace the route/service/native client that produced the observed result. Preserve unrelated dirty work.

Use existing authenticated connectors, application reads, or approved diagnostic scripts. Capture only necessary fields, versions, timestamps, allocation/scan/audit evidence, and deployment identity; omit credentials and private contact details from deliverables. When real records are unavailable, reproduce safely with isolated fixtures and label that evidence as isolated.

## Operational checks

- Schedule: compare staff working-copy version, published relational state, release result, conflicts, and worker-facing reads. A pending request is not active coverage. A timer expiring does not prove publication or notification delivery. Preserve the current contract's exact-version behavior; inspect it rather than hardcoding a release delay here.
- Stale/failed reads: keep known data and show stale/retry state; an unavailable read is not an empty crew or completed operation.
- Uncertain writes: preserve form values and reconcile an authoritative record/audit/version before retrying. A lost response does not prove failure.
- Gear: distinguish reservation intent, pickup, checkout custody, partial return, and completion. Trace exact serialized/numbered-unit allocations and scan evidence. Kiosk remains the physical custody boundary; do not create an app/web shortcut.
- Duplicates: inspect event, requester, state, allocations, and provenance. Require explicit staff/admin selection for consolidation; never silently deduplicate. Preserve event/requester links and a useful audit trail.

## Fix within scope

An audit-only request ends with findings. A request to resolve the incident includes supported source fixes and any exact-record repair it authorizes. Separate the repair from the prevention fix so each can be reviewed and verified.

Before a live repair, identify the exact target, current version/state, expected change, audit reason, and rollback/recovery path. Prefer the application's supported repair operation. If a maintenance script is necessary, make it bounded, dry-run capable, transactional where required, and guarded by expected IDs/versions/state. Do not use broad SQL or retry an uncertain mutation blindly. Stop the live action on conflicting ownership, changed state, missing authority, or inadequate recovery; continue independent preparation.

## Prove the outcome

Reread the repaired record and dependent read model. Verify the reported interaction and relevant role, including failure/retry behavior. Use focused regression tests for the root cause. UI changes use `gt-page`/`gt-ios-slice` and `gt-ui-review`; schema work uses `gt-migrate` only when needed.

Report: confirmed root cause or remaining hypothesis; exact repair result; prevention fix; source/test, authenticated UI, durable record, deployed, notification, and physical-device evidence separately. Do not declare a real incident resolved solely because fixtures or unit tests pass.
