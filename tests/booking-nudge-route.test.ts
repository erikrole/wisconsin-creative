import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingKind, BookingStatus, Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    notification: { createManyAndReturn: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/services/booking-rules", () => ({
  requireBookingAction: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/services/notifications", () => ({
  deferPush: vi.fn(),
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/services/checkout-policies", () => ({
  loadCheckoutPolicies: vi.fn().mockResolvedValue({
    defaultLoanDays: 1,
    gracePeriodHours: 0.5,
    maxItemsPerUser: null,
  }),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { createAuditEntry } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { deferPush, sendPushToUser } from "@/lib/services/notifications";
import { loadCheckoutPolicies } from "@/lib/services/checkout-policies";
import { POST } from "@/app/api/bookings/[id]/nudge/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

const overdueCheckout = {
  id: "cm000000000000000000000001",
  kind: BookingKind.CHECKOUT,
  status: BookingStatus.OPEN,
  title: "MBB Camera Kit",
  requesterUserId: "student-1",
  createdBy: "staff-1",
  startsAt: new Date("2026-07-20T12:00:00.000Z"),
  endsAt: new Date(Date.now() - 2 * 3_600_000),
};

function post() {
  return new Request(`https://app.example.com/api/bookings/${overdueCheckout.id}/nudge`, {
    method: "POST",
    headers: {
      host: "app.example.com",
      origin: "https://app.example.com",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 60_000 });
  vi.mocked(requireBookingAction).mockResolvedValue(overdueCheckout as never);
  vi.mocked(db.notification.createManyAndReturn).mockResolvedValue([{ id: "notification-1" }] as never);
  vi.mocked(db.user.findUnique).mockResolvedValue({ name: "Student One" } as never);
  vi.mocked(sendPushToUser).mockResolvedValue(undefined);
});

describe("POST /api/bookings/[id]/nudge", () => {
  it("creates the durable inbox row and defers an iOS overdue push", async () => {
    const res = await POST(post(), { params: Promise.resolve({ id: overdueCheckout.id }) });

    expect(res.status).toBe(200);
    expect(db.notification.createManyAndReturn).toHaveBeenCalledWith({
      skipDuplicates: true,
      select: { id: true },
      data: [expect.objectContaining({
        userId: "student-1",
        type: "overdue_nudge",
        title: "Please return your gear",
        body: expect.stringContaining("MBB Camera Kit"),
        payload: { bookingId: overdueCheckout.id, href: `/checkouts/${overdueCheckout.id}` },
        channel: "IN_APP",
        sentAt: expect.any(Date),
      })],
    });
    expect(sendPushToUser).toHaveBeenCalledWith("student-1", {
      title: "Please return your gear",
      subtitle: "MBB Camera Kit",
      body: expect.stringContaining("overdue"),
      payload: { bookingId: overdueCheckout.id, href: `/checkouts/${overdueCheckout.id}` },
      category: "checkoutOverdue",
      notificationId: "notification-1",
      collapseId: `checkout-${overdueCheckout.id}`,
    });
    expect(deferPush).toHaveBeenCalledWith(expect.any(Promise));
    expect(createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "staff-1",
      entityType: "booking",
      entityId: overdueCheckout.id,
      action: "overdue_nudge_sent",
    }));
  });

  it("treats a second nudge in the same hour as a silent success", async () => {
    vi.mocked(db.notification.createManyAndReturn).mockResolvedValue([] as never);

    const res = await POST(post(), { params: Promise.resolve({ id: overdueCheckout.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, alreadyNudged: true });
    expect(sendPushToUser).not.toHaveBeenCalled();
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it("does not dispatch push when inbox persistence fails", async () => {
    vi.mocked(db.notification.createManyAndReturn).mockRejectedValue(new Error("database unavailable"));

    const res = await POST(post(), { params: Promise.resolve({ id: overdueCheckout.id }) });

    expect(res.status).toBe(500);
    expect(sendPushToUser).not.toHaveBeenCalled();
    expect(deferPush).not.toHaveBeenCalled();
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it("does not allow a manual nudge during the checkout grace period", async () => {
    vi.mocked(requireBookingAction).mockResolvedValue({
      ...overdueCheckout,
      endsAt: new Date(Date.now() - 10 * 60_000),
    } as never);
    vi.mocked(loadCheckoutPolicies).mockResolvedValue({
      defaultLoanDays: 1,
      gracePeriodHours: 0.5,
      maxItemsPerUser: null,
    });

    const res = await POST(post(), { params: Promise.resolve({ id: overdueCheckout.id }) });

    expect(res.status).toBe(400);
    expect(db.notification.createManyAndReturn).not.toHaveBeenCalled();
  });
});
