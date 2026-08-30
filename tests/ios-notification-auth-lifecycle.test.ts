import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    booking: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    assetAllocation: { updateMany: vi.fn() },
    scanSession: { updateMany: vi.fn() },
    session: { deleteMany: vi.fn() },
    passwordResetToken: { deleteMany: vi.fn() },
    deviceToken: { updateMany: vi.fn() },
    liveActivityStartToken: { updateMany: vi.fn() },
    liveActivityToken: { count: vi.fn() },
    liveActivityStart: {
      count: vi.fn(),
      upsert: vi.fn(),
    },
    user: {
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  };

  return {
    tx,
    db: {
      $transaction: vi.fn(),
      deviceToken: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      booking: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      liveActivityStartToken: {
        updateMany: vi.fn(),
      },
      liveActivityToken: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
        count: vi.fn(),
      },
      liveActivityStart: {
        updateMany: vi.fn(),
        upsert: vi.fn(),
      },
    },
    createAuditEntryTx: vi.fn(),
    loadUserPrefs: vi.fn(),
    shouldDeliverPush: vi.fn(),
    shouldDeliverEmail: vi.fn(),
    shouldDeliverCategory: vi.fn(),
    sendPush: vi.fn(),
    startLiveActivity: vi.fn(),
    updateLiveActivity: vi.fn(),
    endLiveActivity: vi.fn(),
    revokeCompanionUser: vi.fn(),
    refreshCompanionProjection: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.createAuditEntryTx }));
vi.mock("@/lib/services/bookings-helpers", () => ({
  upsertBulkBalancesAndMovements: vi.fn(),
}));
vi.mock("@/lib/services/notification-prefs", () => ({
  loadUserPrefs: mocks.loadUserPrefs,
  shouldDeliverPush: mocks.shouldDeliverPush,
  shouldDeliverEmail: mocks.shouldDeliverEmail,
  shouldDeliverCategory: mocks.shouldDeliverCategory,
}));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(),
  buildNotificationEmail: vi.fn(),
}));
vi.mock("@/lib/services/checkout-policies", () => ({
  loadCheckoutPolicies: vi.fn(),
}));
vi.mock("@/lib/push/apns", () => ({
  sendPush: mocks.sendPush,
  startCheckoutReturnLiveActivityTokens: mocks.startLiveActivity,
  updateCheckoutReturnLiveActivityTokens: mocks.updateLiveActivity,
  endCheckoutReturnLiveActivityTokens: mocks.endLiveActivity,
}));
vi.mock("@/lib/env", () => ({
  env: { appTimezone: "America/Chicago" },
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/companion-store", () => ({
  revokeCompanionUser: mocks.revokeCompanionUser,
}));
vi.mock("@/lib/services/companion-projection", () => ({
  refreshCompanionProjection: mocks.refreshCompanionProjection,
}));

import { sendPushToUser } from "@/lib/services/notifications";
import {
  endCheckoutReturnLiveActivities,
  retryPendingCheckoutReturnLiveActivityEnds,
  startCheckoutReturnLiveActivityForBooking,
  startDueCheckoutReturnLiveActivities,
  sweepOverdueCheckoutReturnLiveActivities,
  updateCheckoutReturnLiveActivities,
} from "@/lib/services/live-activities";
import { deactivateUserWithCleanup } from "@/lib/services/user-deactivation";

type TransactionCallback = (tx: typeof mocks.tx) => Promise<unknown>;

beforeEach(() => {
  vi.clearAllMocks();

  mocks.db.$transaction.mockImplementation(
    async (callback: TransactionCallback) => callback(mocks.tx),
  );
  mocks.tx.booking.count.mockResolvedValue(0);
  mocks.tx.booking.findFirst.mockResolvedValue(null);
  mocks.tx.booking.findMany.mockResolvedValue([]);
  mocks.tx.session.deleteMany.mockResolvedValue({ count: 1 });
  mocks.tx.deviceToken.updateMany.mockResolvedValue({ count: 2 });
  mocks.tx.liveActivityStartToken.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.liveActivityToken.count.mockResolvedValue(3);
  mocks.tx.liveActivityStart.count.mockResolvedValue(4);
  mocks.tx.liveActivityStart.upsert.mockResolvedValue({ id: "start-1" });
  mocks.tx.passwordResetToken.deleteMany.mockResolvedValue({ count: 1 });
  mocks.tx.user.updateMany.mockResolvedValue({ count: 0 });
  mocks.tx.user.update.mockResolvedValue({ id: "user-1", active: false });
  mocks.createAuditEntryTx.mockResolvedValue(undefined);

  mocks.loadUserPrefs.mockResolvedValue(null);
  mocks.shouldDeliverPush.mockReturnValue(true);
  mocks.shouldDeliverEmail.mockReturnValue(true);
  mocks.shouldDeliverCategory.mockReturnValue(true);
  mocks.db.deviceToken.findMany.mockResolvedValue([]);
  mocks.sendPush.mockResolvedValue({ revoked: [] });
  mocks.revokeCompanionUser.mockResolvedValue(undefined);
  mocks.refreshCompanionProjection.mockResolvedValue({});

  mocks.db.booking.findMany.mockResolvedValue([]);
  mocks.db.booking.findFirst.mockResolvedValue(null);
  mocks.db.liveActivityToken.findMany.mockResolvedValue([]);
  mocks.db.liveActivityToken.count.mockResolvedValue(0);
  mocks.db.liveActivityToken.updateMany.mockResolvedValue({ count: 0 });
  mocks.db.liveActivityStart.updateMany.mockResolvedValue({ count: 0 });
});

describe("iOS notification authorization lifecycle", () => {
  it("persists reservation lifecycle notifications before returning a response", () => {
    for (const relativePath of [
      "src/app/api/reservations/route.ts",
      "src/app/api/reservations/[id]/cancel/route.ts",
    ]) {
      const route = readFileSync(path.join(process.cwd(), relativePath), "utf8");
      expect(route).toContain("await createReservationLifecycleNotification({");
      expect(route).not.toContain("void createReservationLifecycleNotification({");
    }
  });

  it("revokes every active push and Live Activity credential in the deactivation transaction", async () => {
    const result = await deactivateUserWithCleanup({
      targetUserId: "user-1",
      actorId: "admin-1",
      actorRole: "ADMIN",
    });

    expect(mocks.db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );

    const revokedAt = mocks.tx.deviceToken.updateMany.mock.calls[0]![0].data.revokedAt;
    expect(revokedAt).toBeInstanceOf(Date);
    expect(mocks.tx.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt },
    });
    expect(mocks.tx.liveActivityStartToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt },
    });
    expect(mocks.tx.liveActivityToken.count).toHaveBeenCalledWith({
      where: { userId: "user-1", endedAt: null },
    });
    expect(mocks.tx.liveActivityStart.count).toHaveBeenCalledWith({
      where: { userId: "user-1", endedAt: null },
    });
    expect(mocks.tx.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(mocks.tx, {
      actorId: "admin-1",
      actorRole: "ADMIN",
      entityType: "user",
      entityId: "user-1",
      action: "deactivation_cleanup",
      after: {
        cancelledBookingIds: [],
        cancelledCount: 0,
        directReportsCleared: 0,
        notificationAccessRevoked: {
          deviceTokens: 2,
          liveActivityStartTokens: 1,
          liveActivityTokensQueuedForEnd: 3,
          liveActivityStartsQueuedForEnd: 4,
          passwordResetTokens: 1,
        },
      },
    });
    expect(result).toEqual({
      cancelledIds: [],
      directReportsCleared: 0,
    });
    expect(mocks.refreshCompanionProjection).not.toHaveBeenCalled();
  });

  it("reports deactivation when companion access cannot be revoked", async () => {
    mocks.revokeCompanionUser.mockRejectedValue(new Error("Redis unavailable"));

    await expect(deactivateUserWithCleanup({
      targetUserId: "user-1",
      actorId: "admin-1",
      actorRole: "ADMIN",
    })).rejects.toMatchObject({
      status: 503,
      message: "The account was deactivated, but companion access could not be revoked. Retry the deactivation cleanup.",
    });

    expect(mocks.tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { active: false },
    });
  });

  it("selects ordinary APNs tokens only through an active user relation", async () => {
    await sendPushToUser("user-1", {
      title: "Schedule updated",
      category: "schedule",
    });

    expect(mocks.db.deviceToken.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        platform: "IOS",
        revokedAt: null,
        user: { active: true },
      },
      select: { token: true },
    });
    expect(mocks.sendPush).not.toHaveBeenCalled();
  });

  it("requires an active booking requester for both Live Activity start selectors", async () => {
    await startDueCheckoutReturnLiveActivities();
    await startCheckoutReturnLiveActivityForBooking({
      bookingId: "booking-1",
      expectedEndsAt: new Date("2026-07-28T18:00:00.000Z"),
    });

    const scheduledQuery = mocks.db.booking.findMany.mock.calls[0]![0];
    expect(scheduledQuery.where.requester).toEqual(expect.objectContaining({
      active: true,
    }));
    expect(
      scheduledQuery.select.requester.select.liveActivityStartTokens.where.user,
    ).toEqual({ active: true });

    const eventDrivenQuery = mocks.db.booking.findFirst.mock.calls[0]![0];
    expect(eventDrivenQuery.where.requester).toEqual(expect.objectContaining({
      active: true,
    }));
    expect(
      eventDrivenQuery.select.requester.select.liveActivityStartTokens.where.user,
    ).toEqual({ active: true });
  });

  it("does not record a scheduled start after deactivation wins the eligibility transaction", async () => {
    const endsAt = new Date("2026-07-28T18:00:00.000Z");
    mocks.db.booking.findMany.mockResolvedValue([{
      id: "booking-1",
      title: "Camera checkout",
      endsAt,
      requesterUserId: "user-1",
      requester: {
        name: "User One",
        avatarUrl: null,
        liveActivityStartTokens: [{ token: "start-token" }],
      },
    }]);
    mocks.startLiveActivity.mockResolvedValue({ revoked: [], ok: 1 });
    // The initial selector saw an active user. Deactivation commits before the
    // post-APNs Serializable ownership check, so the transaction sees no row.
    mocks.tx.booking.findFirst.mockResolvedValue(null);

    const result = await startDueCheckoutReturnLiveActivities({ now: new Date("2026-07-28T17:45:00.000Z") });

    expect(mocks.tx.booking.findFirst).toHaveBeenCalledWith({
      where: {
        id: "booking-1",
        requesterUserId: "user-1",
        kind: "CHECKOUT",
        status: "OPEN",
        endsAt,
        requester: {
          active: true,
          liveActivityStartTokens: {
            some: {
              token: { in: ["start-token"] },
              activity: "checkout_return",
              revokedAt: null,
            },
          },
        },
      },
      select: { id: true },
    });
    expect(mocks.tx.liveActivityStart.upsert).not.toHaveBeenCalled();
    expect(result.started).toBe(0);
    expect(mocks.db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
  });

  it("records an event-driven start only while the user still owns an active token", async () => {
    const endsAt = new Date("2026-07-28T18:00:00.000Z");
    mocks.db.booking.findFirst.mockResolvedValue({
      id: "booking-1",
      title: "Camera checkout",
      endsAt,
      requesterUserId: "user-1",
      requester: {
        name: "User One",
        avatarUrl: null,
        liveActivityStartTokens: [{ token: "start-token" }],
      },
    });
    mocks.startLiveActivity.mockResolvedValue({ revoked: [], ok: 1 });
    mocks.tx.booking.findFirst.mockResolvedValue({ id: "booking-1" });

    const result = await startCheckoutReturnLiveActivityForBooking({
      bookingId: "booking-1",
      expectedEndsAt: endsAt,
      now: new Date("2026-07-28T17:45:00.000Z"),
    });

    expect(mocks.tx.liveActivityStart.upsert).toHaveBeenCalledWith({
      where: {
        userId_bookingId_activity: {
          userId: "user-1",
          bookingId: "booking-1",
          activity: "checkout_return",
        },
      },
      update: {
        lastAttemptAt: new Date("2026-07-28T17:45:00.000Z"),
        endedAt: null,
      },
      create: {
        userId: "user-1",
        bookingId: "booking-1",
        activity: "checkout_return",
        startedAt: new Date("2026-07-28T17:45:00.000Z"),
        lastAttemptAt: new Date("2026-07-28T17:45:00.000Z"),
      },
    });
    expect(result).toEqual({ started: 1, revoked: 0, skipped: false });
  });

  it("treats revoked start-token ownership as a durable end queue", async () => {
    await retryPendingCheckoutReturnLiveActivityEnds({ limit: 50 });

    const pendingTokenQuery = mocks.db.liveActivityToken.findMany.mock.calls[0]![0];
    expect(pendingTokenQuery.where.OR).toContainEqual({
      user: {
        liveActivityStartTokens: {
          none: {
            activity: "checkout_return",
            revokedAt: null,
          },
        },
      },
    });
    const pendingStartUpdate = mocks.db.liveActivityStart.updateMany.mock.calls[0]![0];
    expect(pendingStartUpdate.where.OR).toContainEqual({
      user: {
        liveActivityStartTokens: {
          none: {
            activity: "checkout_return",
            revokedAt: null,
          },
        },
      },
    });
  });

  it("filters content updates to active users while allowing end delivery to inactive users", async () => {
    await sweepOverdueCheckoutReturnLiveActivities();
    await updateCheckoutReturnLiveActivities({
      bookingId: "booking-1",
      endsAt: new Date("2026-07-28T18:00:00.000Z"),
    });
    await endCheckoutReturnLiveActivities("booking-1");

    const sweepQuery = mocks.db.booking.findMany.mock.calls[0]![0];
    expect(sweepQuery.where.requester).toEqual({ active: true });
    expect(sweepQuery.where.liveActivityTokens.some.user).toEqual({ active: true });
    expect(sweepQuery.select.liveActivityTokens.where.user).toEqual({ active: true });

    const updateQuery = mocks.db.liveActivityToken.findMany.mock.calls[0]![0];
    const endQuery = mocks.db.liveActivityToken.findMany.mock.calls[1]![0];
    expect(updateQuery.where.user).toEqual({ active: true });
    expect(endQuery.where.user).toBeUndefined();
    expect(mocks.updateLiveActivity).not.toHaveBeenCalled();
    expect(mocks.endLiveActivity).not.toHaveBeenCalled();
  });

  it("records only accepted or permanently revoked Live Activity ends", async () => {
    mocks.db.liveActivityToken.findMany.mockResolvedValue([
      { token: "accepted-token", bookingId: "booking-1" },
      { token: "revoked-token", bookingId: "booking-1" },
      { token: "transient-token", bookingId: "booking-1" },
    ]);
    mocks.endLiveActivity.mockResolvedValue({
      accepted: ["accepted-token"],
      revoked: ["revoked-token"],
      ok: 1,
    });
    mocks.db.liveActivityToken.count.mockResolvedValue(1);

    const result = await endCheckoutReturnLiveActivities("booking-1");

    expect(mocks.db.liveActivityToken.updateMany).toHaveBeenCalledWith({
      where: {
        activity: "checkout_return",
        endedAt: null,
        token: { in: ["accepted-token", "revoked-token"] },
      },
      data: { endedAt: expect.any(Date) },
    });
    expect(mocks.db.liveActivityStart.updateMany).toHaveBeenCalledWith({
      where: {
        bookingId: { in: ["booking-1"] },
        activity: "checkout_return",
        endedAt: null,
        booking: {
          liveActivityTokens: {
            none: {
              activity: "checkout_return",
              endedAt: null,
            },
          },
        },
      },
      data: { endedAt: expect.any(Date) },
    });
    expect(result).toEqual({ selected: 3, ended: 2, pending: 1 });
  });
});
