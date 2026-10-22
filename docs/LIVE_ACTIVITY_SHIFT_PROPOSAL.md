# Proposal: game-day shift Live Activity

Status: proposal only. Nothing here is built; it needs server work noted below.

## What it shows
A second activity, `ShiftActivityAttributes`, for the person's own shift on the day of the event.

- Lock screen: event title, venue, and one large figure that changes with the phase: "Call in 42 min", then "On shift", then "Wrap in 1h 10m".
- Dynamic Island: compact trailing shows the same figure; expanded adds area, venue, and the gear line ("Gear ready" / "Gear not picked up").
- Ends itself after the shift, or when the shift is removed.

## Contract
`ContentState`: `phase` (`upcoming`, `onShift`, `wrapping`, `ended`), `callAt`, `startsAt`, `endsAt`, `gearLabel?`. Attributes: `eventId`, `title`, `area`, `locationName?`. Every field new to ContentState decodes with a default, like the checkout-return activity, so an older build never drops an update.

## What the server needs (not built here)
1. A token table row per activity, the same shape as `LiveActivityToken` with `activity = "shift"` and `shiftAssignmentId`. No new migration if `bookingId` can be made generic; otherwise one small migration.
2. A cron that starts the activity with a push-to-start token about 2 hours before the call time, and sends `update`/`end` pushes at the phase boundaries. This mirrors the checkout-return sweep in `src/lib/live-activity-workflow.ts`.
3. A registration route next to `/api/live-activities/checkout-return`, checking the shift belongs to the caller.

## Client work once the server exists
`ShiftLiveActivityManager` beside the checkout-return manager, reusing `GearWidgetPublisher`'s shift list as the local fallback for starting while the app is open. Widget views reuse `CountdownFigure` and `ReturnTrack`.

## Risks
Push-to-start needs the user to have opened the app once on iOS 17.2+. Shifts that move after the start push rely on a follow-up update push.
