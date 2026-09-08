# Event Schedule — September 7, 2026

The proposed named-crew layout was rejected. The user wants the previous avatar groupings and compact event rows.

Restored the pre-pass web ListView, native ScheduleView and ScheduleModels. Removed the supporting crew API projection and fixture changes. Preserved unrelated existing work.

Any captures in tasks/archive/proofs/event-schedule-2026-09-07 showing the named-crew layout are rejected exploration, not accepted product evidence.

Future scheduling work must build on the avatar groupings. Scope remains web scheduling and native crew views.

No commit, push, deployment, assignment mutation, or notification was performed.

## Accepted follow-up: preserve avatar groups, harden event data

Actor boundary: internal authenticated Schedule reads; staff/admin manual event creation. Existing permission checks, audit entry, pagination envelope and native coverage decoding are retained. No schema or scheduling mutation-service changes.

- [x] Calendar coverage now counts only DIRECT_ASSIGNED and APPROVED assignments using a filtered database count. Multiple active assignments still fill one slot; pending/declined requests fill none. Empty groups and absent groups remain distinct.
- [x] Manual all-day creation validates the normalized persisted date boundaries, preventing a zero-length event after timestamps collapse to midnight.
- [x] 37 focused route tests pass; TypeScript and scoped lint pass.
- [x] Final diff check and docs verification pass (generated codemaps refreshed).
- [ ] Application build: compilation passed, but page-data collection failed with missing `.next/build-manifest.json`. A separate `next build` process was active after this build exited; avoid retrying into shared output. No authenticated runtime or deployment proof claimed.

Avatar groupings and native layout are unchanged. No new UI design is accepted by this pass. Runtime and production acceptance remain separate from mocked route tests.
