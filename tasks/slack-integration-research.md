# Slack Integration Research

**Date**: 2026-03-30
**Branch**: `claude/slack-integration-research-z4HrL`
**Status**: Research complete — ready for planning

---

## Summary

Integrating Slack notifications into Wisconsin Creative is straightforward. The right approach is **Incoming Webhooks** for V1 — no OAuth, no Slack app distribution, just a webhook URL that posts messages to a channel. The three requested events all have clear, single hook points in the API. Config lives in the existing `SystemConfig` table (no migration needed). A new `/settings/slack` sub-page fits the existing settings layout pattern exactly.

---

## Approach: Incoming Webhooks

### What it is
A webhook is a unique HTTPS URL (`https://hooks.slack.com/services/T.../B.../xxx`) that accepts a JSON POST and drops the message into a fixed Slack channel. The URL itself is the secret — no auth token in the request body.

### Setup (one-time, done by an admin at the org level)
1. Go to `api.slack.com/apps` → create app → **Incoming Webhooks** → toggle on
2. Click **Add New Webhook** → pick channel → copy URL
3. Paste URL into `/settings/slack` in Wisconsin Creative

### Why webhooks (not a full Slack app)
| Need | Webhooks | Full App |
|---|---|---|
| Post notifications to a channel | ✅ | ✅ |
| One-way fire-and-forget | ✅ | ✅ |
| Dynamic channel selection | ❌ (locked at creation) | ✅ |
| Update/delete posted messages | ❌ | ✅ |
| In-Slack action buttons (e.g. "Approve shift" button) | ❌ | ✅ |
| Multi-workspace install | ❌ | ✅ |

Webhooks cover everything needed for V1. A full Slack app is only worthwhile if you later want **interactive buttons** inside messages (e.g. one-click shift approval from Slack) or need to target multiple channels dynamically.

### Key limitations to design around
- **One channel per webhook** — locked at creation. To send to different channels (e.g. #gear-ops vs #scheduling), create separate webhooks and store multiple URLs.
- **Rate limit** — ~1 msg/sec per channel. Not a concern at this scale.
- **No retries built in** — if Slack returns 429 or 5xx, you handle it. Use fire-and-forget with logging; don't block the user response.
- **URL is the secret** — store in `SystemConfig` (DB), not in env vars, so admins can update it without a redeploy.

---

## The Three Events — Hook Points in the Codebase

All three events have clean, single locations to add a Slack call:

### 1. Gear Check-In
**File**: `src/app/api/checkouts/[id]/complete-checkin/route.ts`
**When**: After `completeCheckinScan()` succeeds — booking transitions to COMPLETED
**Data available**: booking ID, actor user, booking ref number (CO-XXXX), items, location

```ts
// After completeCheckinScan(id, user.id, user.role):
void sendSlackNotification("gear_checkin", { bookingId: id, actorUser: user, result });
```

### 2. Gear Reservation Created
**File**: `src/app/api/reservations/route.ts`
**When**: After `createBooking()` returns — reservation created with ref number
**Data available**: reservation ID, title, requester, location, startsAt, endsAt, ref number (RV-XXXX), item count

```ts
// After createBooking():
void sendSlackNotification("gear_reservation", { booking: reservation, createdBy: user });
```

### 3. Shift Request
**File**: `src/app/api/shift-assignments/request/route.ts`
**When**: After `requestShift()` returns — assignment status = REQUESTED
**Data available**: assignment ID, shift (area, dates), requesting user

```ts
// After requestShift():
void sendSlackNotification("shift_request", { assignment, requestedBy: user });
```

> **Note**: The `void` prefix is intentional — fire Slack async without blocking the API response. Errors should be caught and logged internally (Sentry), never bubble to the user.

---

## Message Format: Block Kit

Use Slack Block Kit for rich, structured messages. Each message needs a top-level `text` field (shown in mobile push/desktop preview) and a `blocks` array for the channel body.

### Gear Check-In
```json
{
  "text": "Gear returned: CO-0042 — Alex Johnson",
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "✅ Gear Checked In" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Booking Ref*\nCO-0042" },
        { "type": "mrkdwn", "text": "*Returned By*\nAlex Johnson" },
        { "type": "mrkdwn", "text": "*Location*\nMain Studio" },
        { "type": "mrkdwn", "text": "*Items*\n3 serialized items" }
      ]
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "Returned at 2:34 PM · <https://yourapp.com/bookings/CO-0042|View Checkout>" }
      ]
    }
  ]
}
```

### Reservation Created
```json
{
  "text": "New reservation: RV-0017 — Jordan Lee",
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "📅 New Reservation" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Ref*\nRV-0017" },
        { "type": "mrkdwn", "text": "*Reserved By*\nJordan Lee" },
        { "type": "mrkdwn", "text": "*Dates*\nApr 2 – Apr 4, 2026" },
        { "type": "mrkdwn", "text": "*Items*\n2 items" }
      ]
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "<https://yourapp.com/bookings/RV-0017|View Reservation>" }
      ]
    }
  ]
}
```

### Shift Request
```json
{
  "text": "Shift requested: Taylor Kim — Video, Apr 5 2026",
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "🙋 Shift Request" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Requested By*\nTaylor Kim" },
        { "type": "mrkdwn", "text": "*Area*\nVideo" },
        { "type": "mrkdwn", "text": "*Shift Date*\nApr 5, 2026" },
        { "type": "mrkdwn", "text": "*Sport*\nWomen's Basketball" }
      ]
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "<https://yourapp.com/schedule|Review in Schedule>" }
      ]
    }
  ]
}
```

Use the [Block Kit Builder](https://app.slack.com/block-kit-builder) to prototype visually.

---

## Config Storage — No Migration Needed

The `SystemConfig` model (`key: String @id, value: Json`) is already used for the escalation fatigue cap. Slack config fits perfectly as a new key:

```json
{
  "key": "slack",
  "value": {
    "webhookUrl": "https://hooks.slack.com/services/T.../B.../xxx",
    "enabled": true,
    "notifications": {
      "gear_checkin": true,
      "gear_reservation": true,
      "shift_request": true
    }
  }
}
```

Read with:
```ts
const config = await prisma.systemConfig.findUnique({ where: { key: "slack" } });
const slack = config?.value as SlackConfig | null;
if (!slack?.enabled) return;
```

**No Prisma migration required.** This is the same pattern used in `src/lib/services/notifications.ts` for the fatigue cap.

---

## New Files Required

| File | Purpose |
|---|---|
| `src/lib/services/slack.ts` | Core service: load config from DB, build Block Kit payload, POST to webhook, handle errors |
| `src/app/api/settings/slack/route.ts` | GET + PATCH — read and update Slack config in `SystemConfig` |
| `src/app/(app)/settings/slack/page.tsx` | Settings UI: webhook URL input, master toggle, per-event toggles, test button |

**Modified files:**
| File | Change |
|---|---|
| `src/app/api/checkouts/[id]/complete-checkin/route.ts` | Add `void sendSlackNotification("gear_checkin", ...)` after checkin completes |
| `src/app/api/reservations/route.ts` | Add `void sendSlackNotification("gear_reservation", ...)` after booking created |
| `src/app/api/shift-assignments/request/route.ts` | Add `void sendSlackNotification("shift_request", ...)` after requestShift |
| `src/lib/nav-sections.ts` | Add Slack to settings nav |
| `docs/AREA_NOTIFICATIONS.md` | Document new Slack channel |
| `docs/AREA_SETTINGS.md` | Add Slack sub-page |

---

## Settings Page Design (`/settings/slack`)

Matches the existing `settings-split` layout pattern (sidebar description + main form):

```
┌─────────────────────────────────────────────────────────┐
│  Slack Notifications                                      │
│  Send real-time notifications to a Slack channel          │
│  when key events occur in Wisconsin Creative.                   │
├─────────────────────────────────────────────────────────┤
│  [● Enable Slack notifications]                toggle     │
│                                                           │
│  Webhook URL                                              │
│  [https://hooks.slack.com/services/... ________] [Test]  │
│  ⓘ Create a webhook at api.slack.com/apps                │
│                                                           │
│  Notify on                                                │
│  [●] Gear checked in                                      │
│  [●] Reservation created                                  │
│  [●] Shift requested                                      │
│                                                           │
│                                          [Save Changes]   │
└─────────────────────────────────────────────────────────┘
```

**Test button** sends a sample message to verify the webhook works before saving.
**Admin-only** at the API level (matches escalation settings pattern — ADMIN-only PATCH).

---

## `src/lib/services/slack.ts` — Design Sketch

```ts
type SlackEventType = "gear_checkin" | "gear_reservation" | "shift_request";

interface SlackConfig {
  webhookUrl: string;
  enabled: boolean;
  notifications: Record<SlackEventType, boolean>;
}

async function getSlackConfig(): Promise<SlackConfig | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key: "slack" } });
  return row ? (row.value as SlackConfig) : null;
}

export async function sendSlackNotification(
  event: SlackEventType,
  data: SlackEventData[typeof event]
): Promise<void> {
  try {
    const config = await getSlackConfig();
    if (!config?.enabled || !config.notifications[event] || !config.webhookUrl) return;

    const payload = buildPayload(event, data);   // switch on event type → Block Kit JSON

    const res = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`[Slack] ${event} notification failed: ${res.status}`);
      // Report to Sentry in production
    }
  } catch (err) {
    console.error("[Slack] sendSlackNotification threw:", err);
    // Never throw — caller uses `void`, user must not see Slack errors
  }
}
```

Key design decisions:
- **Never throws** — Slack failure is a soft error, never surfaces to the end user
- **Single DB read per notification** — acceptable; can cache in-memory for hot paths later
- **No retry logic in V1** — webhook messages are low-stakes; retry complexity not worth it yet
- **Sentry capture** in production for observability without alerting users

---

## Implementation Plan (Thin Slices)

Following the Thin Slice Protocol:

### Slice 1 — Config + Settings UI
- `src/lib/services/slack.ts` (getConfig, stubs)
- `src/app/api/settings/slack/route.ts` (GET + PATCH)
- `src/app/(app)/settings/slack/page.tsx` (UI + test button)
- Add to nav

### Slice 2 — Notification Service + Event Wiring
- Implement `sendSlackNotification` + `buildPayload` for all 3 events
- Wire into `complete-checkin`, `reservations`, `shift-assignments/request`
- Manual test via test button + real events

### Slice 3 — Docs + Hardening
- Update `AREA_NOTIFICATIONS.md`, `AREA_SETTINGS.md`
- Add error observability (Sentry)
- Build check

---

## Open Questions for the Team

1. **Single channel or per-event channels?** — The simplest approach is one webhook URL (one channel gets all notifications). If you want check-ins going to `#gear-ops` and shift requests to `#scheduling`, we'd store multiple webhook URLs per event type. This adds UI complexity. Recommendation: start with one channel.

2. **Who sees the settings page?** — Escalation settings are ADMIN-only at the API. Should Slack settings also be ADMIN-only, or should STAFF be able to update the webhook URL too?

3. **App base URL for deep links?** — The Block Kit messages include links back to bookings/shifts. Server-side payload builders should use the existing `APP_URL` runtime env through `src/lib/env.ts`, not introduce a new `NEXT_PUBLIC_APP_URL`.

4. **Checkout check-in vs bulk check-in** — The `complete-checkin` route handles serialized items. `checkin-bulk` is a separate route. Should bulk-only check-ins also trigger a Slack notification? They represent the same user action — recommending yes.

5. **Reservation vs checkout notifications** — Right now the brief says "reserve gear" triggers a notification. Should a **checkout** being opened also notify? (That's when gear actually leaves the building.) Worth clarifying the intent.
