import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockFindMany = vi.hoisted(() => vi.fn());
const mockUpdateMany = vi.hoisted(() => vi.fn());
const mockSetVapidDetails = vi.hoisted(() => vi.fn());
const mockSendNotification = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    webPushSubscription: {
      findMany: mockFindMany,
      updateMany: mockUpdateMany,
    },
  },
}));

vi.mock("web-push", () => ({
  setVapidDetails: mockSetVapidDetails,
  sendNotification: mockSendNotification,
}));

import { getWebPushPublicKey, sendWebPushToUser, sendWebPushToUsers } from "@/lib/push/web";

const originalPublicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
const originalPrivateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
const originalSubject = process.env.WEB_PUSH_SUBJECT;

const subscription = {
  userId: "student-1",
  endpoint: "https://push.example.test/subscription-1",
  p256dh: "public-key",
  auth: "auth-key",
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  delete process.env.WEB_PUSH_SUBJECT;
  mockFindMany.mockResolvedValue([]);
  mockUpdateMany.mockResolvedValue({ count: 0 });
  mockSendNotification.mockResolvedValue({ statusCode: 201 });
});

afterAll(() => {
  if (originalPublicKey === undefined) delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  else process.env.WEB_PUSH_VAPID_PUBLIC_KEY = originalPublicKey;
  if (originalPrivateKey === undefined) delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  else process.env.WEB_PUSH_VAPID_PRIVATE_KEY = originalPrivateKey;
  if (originalSubject === undefined) delete process.env.WEB_PUSH_SUBJECT;
  else process.env.WEB_PUSH_SUBJECT = originalSubject;
});

function configureWebPush() {
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "public-vapid-key";
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "private-vapid-key";
  process.env.WEB_PUSH_SUBJECT = "mailto:notifications@example.test";
}

describe("browser push transport", () => {
  it("is a no-op until VAPID configuration is present", async () => {
    const result = await sendWebPushToUser("student-1", { title: "Due soon" });

    expect(result).toEqual({ devices: 0, delivered: 0, revoked: 0 });
    expect(getWebPushPublicKey()).toBeNull();
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("sends an encrypted web-push payload through every active subscription", async () => {
    configureWebPush();
    mockFindMany.mockResolvedValue([subscription]);

    const result = await sendWebPushToUser("student-1", {
      title: "Checkout due",
      body: "Return the camera soon.",
      payload: { url: "/bookings/booking-1", bookingId: "booking-1" },
    });

    expect(result).toEqual({ devices: 1, delivered: 1, revoked: 0 });
    expect(mockSetVapidDetails).toHaveBeenCalledWith(
      "mailto:notifications@example.test",
      "public-vapid-key",
      "private-vapid-key",
    );
    expect(mockSendNotification).toHaveBeenCalledWith(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify({
        title: "Checkout due",
        body: "Return the camera soon.",
        url: "/bookings/booking-1",
      }),
      expect.objectContaining({ TTL: 86_400, urgency: "high", timeout: 5_000 }),
    );
  });

  it("falls back to the inbox and retires expired browser subscriptions", async () => {
    configureWebPush();
    mockFindMany.mockResolvedValue([subscription]);
    mockSendNotification.mockRejectedValue({ statusCode: 410 });

    const result = await sendWebPushToUsers(["student-1"], { title: "Schedule updated" });

    expect(result.get("student-1")).toEqual({ devices: 1, delivered: 0, revoked: 1 });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { endpoint: { in: [subscription.endpoint] } },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
