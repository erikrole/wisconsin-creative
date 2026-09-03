import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  buildNotificationEmail: vi.fn().mockReturnValue("<p>notification</p>"),
}));
vi.mock("@/lib/push/apns", () => ({
  sendPush: vi.fn().mockResolvedValue({ revoked: [], accepted: [], ok: 0 }),
}));
vi.mock("@/lib/services/checkout-policies", () => ({
  loadCheckoutPolicies: vi.fn().mockResolvedValue({
    defaultLoanDays: 1,
    gracePeriodHours: 0.5,
    maxItemsPerUser: null,
  }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    booking: { findMany: vi.fn(), findUnique: vi.fn() },
    escalationRule: { findMany: vi.fn() },
    systemConfig: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    notification: { findMany: vi.fn(), create: vi.fn() },
    deviceToken: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { processOverdueNotifications } from "@/lib/services/notifications";

const rules = [
  { id: "due-2", type: "checkout_due_2h", title: "Due back in 2 hours", hoursFromDue: -2, notifyRequester: true, notifyAdmins: false, enabled: true, sortOrder: 0 },
  { id: "due-now", type: "checkout_due_now", title: "Due back now", hoursFromDue: 0, notifyRequester: true, notifyAdmins: false, enabled: true, sortOrder: 1 },
  { id: "grace", type: "checkout_overdue_grace", title: "Checkout overdue", hoursFromDue: 0, notifyRequester: true, notifyAdmins: false, enabled: true, sortOrder: 2 },
  { id: "overdue-4", type: "checkout_overdue_4h", title: "4 hours overdue", hoursFromDue: 4, notifyRequester: true, notifyAdmins: false, enabled: true, sortOrder: 3 },
  { id: "overdue-24", type: "checkout_overdue_24h", title: "1 day overdue", hoursFromDue: 24, notifyRequester: true, notifyAdmins: true, enabled: true, sortOrder: 4 },
];

function checkout(hoursOverdue: number, custodyScope: "PERSON" | "SHARED" = "PERSON") {
  return {
    id: "booking-1",
    kind: "CHECKOUT",
    status: "OPEN",
    title: "Camera kit",
    requesterUserId: "student-1",
    custodyScope,
    locationId: "location-1",
    createdBy: "staff-creator",
    endsAt: new Date(Date.now() - hoursOverdue * 3_600_000),
    requester: { id: "student-1", name: "Student One", email: "student@example.com" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.escalationRule.findMany).mockResolvedValue(rules as never);
  vi.mocked(db.notification.findMany).mockResolvedValue([]);
  vi.mocked(db.notification.create).mockResolvedValue({ id: "notification-1" } as never);
  vi.mocked(db.deviceToken.findMany).mockResolvedValue([]);
  vi.mocked(db.user.findUnique).mockResolvedValue({ active: true, notificationPrefs: null } as never);
  vi.mocked(db.systemConfig.findUnique).mockResolvedValue({
    key: "escalation",
    value: {
      maxRequesterNotificationsPerDueDate: 5,
      maxOperationalNotificationsPerDueDate: 20,
    },
  } as never);
  vi.mocked(db.systemConfig.findMany).mockResolvedValue([{
    key: "overdue_responders:location-1",
    value: { userIds: ["staff-responder"] },
  }] as never);
  vi.mocked(db.user.findMany).mockResolvedValue([
    { id: "staff-responder", name: "Gear Lead", email: "lead@example.com", role: "STAFF" },
    { id: "admin-1", name: "Admin One", email: "admin@example.com", role: "ADMIN" },
  ] as never);
});

describe("checkout escalation repair sweep", () => {
  it("sends only the highest eligible late stage", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([checkout(10)] as never);

    const result = await processOverdueNotifications();

    expect(result).toEqual({ scanned: 1, notificationsCreated: 2 });
    const createdTypes = vi.mocked(db.notification.create).mock.calls.map((call) => call[0].data.type);
    expect(createdTypes).toEqual(["checkout_overdue_4h", "checkout_overdue_4h"]);
    expect(vi.mocked(db.notification.create).mock.calls.map((call) => call[0].data.userId))
      .toEqual(["student-1", "staff-responder"]);
  });

  it("enforces the operational cap inside recipient fanout", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([checkout(30)] as never);
    vi.mocked(db.systemConfig.findUnique).mockResolvedValue({
      key: "escalation",
      value: {
        maxRequesterNotificationsPerDueDate: 5,
        maxOperationalNotificationsPerDueDate: 1,
      },
    } as never);
    vi.mocked(db.systemConfig.findMany).mockResolvedValue([{
      key: "overdue_responders:location-1",
      value: { userIds: ["staff-responder", "admin-1"] },
    }] as never);

    const result = await processOverdueNotifications();

    expect(result).toEqual({ scanned: 1, notificationsCreated: 2 });
    const operationalRows = vi.mocked(db.notification.create).mock.calls.filter((call) =>
      call[0].data.payload && (call[0].data.payload as Record<string, unknown>).recipientKind !== "requester"
    );
    expect(operationalRows).toHaveLength(1);
  });

  it("alerts operations but never the retained requester for shared custody", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([checkout(10, "SHARED")] as never);

    const result = await processOverdueNotifications();

    expect(result).toEqual({ scanned: 1, notificationsCreated: 1 });
    const call = vi.mocked(db.notification.create).mock.calls[0]![0].data;
    expect(call.userId).toBe("staff-responder");
    expect(call.body).toContain('Shared checkout "Camera kit"');
    expect(call.payload).toMatchObject({ recipientKind: "responder" });
  });
});
