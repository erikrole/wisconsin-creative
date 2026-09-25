import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    deviceToken: { findMany: vi.fn(), updateMany: vi.fn() },
    notification: { count: vi.fn() },
    notificationDelivery: { createMany: vi.fn() },
  },
}));

vi.mock("@/lib/push/apns", () => ({ sendPush: vi.fn() }));
vi.mock("@/lib/push/web", () => ({ sendWebPushToUsers: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(), buildNotificationEmail: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { appTimezone: "America/Chicago" } }));

import { db } from "@/lib/db";
import { sendPush } from "@/lib/push/apns";
import { sendWebPushToUsers } from "@/lib/push/web";
import { sendPushToUser } from "@/lib/services/notifications";

function prefs(value: unknown) {
  vi.mocked(db.user.findUnique).mockResolvedValue({ notificationPrefs: value } as never);
}

function recorded() {
  return vi.mocked(db.notificationDelivery.createMany).mock.calls.flatMap((call) => (call[0]?.data ?? []) as unknown[]);
}

describe("notification delivery ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prefs(null);
    vi.mocked(sendWebPushToUsers).mockResolvedValue(new Map([["u1", { devices: 0, delivered: 0, revoked: 0 }]]));
    vi.mocked(db.deviceToken.findMany).mockResolvedValue([{ token: "t1" }] as never);
    vi.mocked(db.notification.count).mockResolvedValue(1 as never);
    vi.mocked(sendPush).mockResolvedValue({ revoked: [], accepted: ["t1"], ok: 1 } as never);
  });

  it("records why a push was suppressed", async () => {
    prefs({ pausedUntil: "2099-01-01T00:00:00.000Z" });

    await sendPushToUser("u1", { title: "Due", category: "checkoutDue", notificationId: "n1" });

    expect(sendPush).not.toHaveBeenCalled();
    expect(recorded()).toEqual([
      expect.objectContaining({ notificationId: "n1", category: "checkoutDue", channel: "apns", outcome: "suppressed", reason: "paused" }),
    ]);
  });

  it("records a sent push with its latency", async () => {
    await sendPushToUser("u1", { title: "Due", category: "checkoutDue", notificationId: "n1" });

    expect(recorded()).toEqual([
      expect.objectContaining({ channel: "apns", outcome: "sent", reason: null, latencyBucket: "under_1s" }),
    ]);
  });

  it("records a silent delivery and why", async () => {
    prefs({ push: { schedule: "silent" } });

    await sendPushToUser("u1", { title: "Shift assigned", category: "schedule", notificationId: "n1" });

    expect(recorded()).toEqual([expect.objectContaining({ outcome: "sent_silent", reason: "level_silent" })]);
  });

  it("records no device when neither iOS nor a browser is registered", async () => {
    vi.mocked(db.deviceToken.findMany).mockResolvedValue([] as never);

    await sendPushToUser("u1", { title: "Due", category: "checkoutDue", notificationId: "n1" });

    expect(recorded()).toEqual([expect.objectContaining({ channel: "apns", outcome: "no_device" })]);
  });

  it("records a rejected token and a browser delivery separately", async () => {
    vi.mocked(sendWebPushToUsers).mockResolvedValue(new Map([["u1", { devices: 1, delivered: 1, revoked: 0 }]]));
    vi.mocked(sendPush).mockResolvedValue({ revoked: ["t1"], accepted: [], ok: 0 } as never);

    await sendPushToUser("u1", { title: "Due", category: "checkoutDue", notificationId: "n1" });

    expect(recorded()).toEqual([
      expect.objectContaining({ channel: "web", outcome: "sent" }),
      expect.objectContaining({ channel: "apns", outcome: "bad_token" }),
    ]);
  });

  it("records nothing for pushes that don't announce an inbox row", async () => {
    await sendPushToUser("u1", { title: "Test", category: "checkoutDue" });

    expect(db.notificationDelivery.createMany).not.toHaveBeenCalled();
  });
});
