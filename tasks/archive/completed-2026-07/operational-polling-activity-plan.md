# Operational Polling Activity Plan

Status: Complete

Date: 2026-07-16

## Outcome

Reduce Neon compute wake time caused by unattended browser tabs without weakening freshness while someone is using Wisconsin Creative.

## Shipped Scope

- Added one shared two-minute browser-activity governor for operational polling.
- Kept booking freshness at 30 seconds and item freshness at 60 seconds during active use.
- Applied the same governor to the opt-in 30-second Settings Audit live feed.
- Stopped recurring requests while hidden, offline, or idle.
- Triggered an immediate check when focus, visibility, connectivity, or user activity returns.
- Preserved cursor state and existing cache invalidation behavior across pauses.

## Verification

- Focused polling, booking, item, and audit tests: 24 passed.
- Focused and repository-wide ESLint: passed.
- Full TypeScript check: passed.
- `npm run build:app`: passed.
- Migration prefix check, codemap generation, documentation verification, and final diff checks: passed.
- Authenticated browser proof was not available before deployment because the current production Neon project had already exhausted its monthly free compute allowance.

## Remaining Operational Proof

- Confirm the production Neon compute graph develops overnight inactive periods after deployment.
- Revisit server-pushed invalidation only if active-session polling remains a meaningful cost after this change.
