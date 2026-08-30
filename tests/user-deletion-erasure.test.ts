import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const deleteMany = vi.fn();
  const updateMany = vi.fn();
  const tx = {
    booking: { count: vi.fn(), findMany: vi.fn() },
    session: { deleteMany: vi.fn() },
    passwordResetToken: { deleteMany: vi.fn() },
    passkeyCredential: { deleteMany },
    passkeyChallenge: { deleteMany },
    deviceToken: { updateMany: vi.fn(), deleteMany },
    liveActivityStartToken: { updateMany: vi.fn(), deleteMany },
    liveActivityToken: { count: vi.fn(), deleteMany },
    liveActivityStart: { count: vi.fn(), deleteMany },
    webPushSubscription: { deleteMany },
    userAppInstallation: { deleteMany },
    notification: { deleteMany },
    favoriteItem: { deleteMany },
    favoriteItemFamily: { deleteMany },
    scheduleEventFollow: { deleteMany },
    studentAvailabilityBlock: { deleteMany },
    studentSportAssignment: { deleteMany },
    studentAreaAssignment: { deleteMany },
    studentBadge: { deleteMany },
    badgeStreak: { deleteMany },
    badgeEventReceipt: { deleteMany },
    allowedEmail: { updateMany },
    licenseCodeClaim: { updateMany },
    user: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  };

  return {
    tx,
    db: { $transaction: vi.fn() },
    hashPassword: vi.fn(),
    randomHex: vi.fn(),
    createAuditEntryTx: vi.fn(),
    revokeCompanionUser: vi.fn(),
    refreshCompanionProjection: vi.fn(),
    deleteImage: vi.fn(),
    isBlobUrl: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({
  hashPassword: mocks.hashPassword,
  randomHex: mocks.randomHex,
}));
vi.mock("@/lib/blob", () => ({
  deleteImage: mocks.deleteImage,
  isBlobUrl: mocks.isBlobUrl,
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.createAuditEntryTx }));
vi.mock("@/lib/services/reservation-schedule", () => ({
  releaseReservationManagedAssignmentTx: vi.fn(),
}));
vi.mock("@/lib/services/notifications", () => ({
  createShiftScheduleNotification: vi.fn(),
}));
vi.mock("@/lib/companion-store", () => ({ revokeCompanionUser: mocks.revokeCompanionUser }));
vi.mock("@/lib/services/companion-projection", () => ({
  refreshCompanionProjection: mocks.refreshCompanionProjection,
}));

import { deactivateUserWithCleanup } from "@/lib/services/user-deactivation";

type TransactionCallback = (tx: typeof mocks.tx) => Promise<unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.$transaction.mockImplementation(
    async (callback: TransactionCallback) => callback(mocks.tx),
  );
  mocks.hashPassword.mockResolvedValue("deleted-password-hash");
  mocks.randomHex.mockReturnValue("random-value");
  mocks.tx.user.findUnique.mockResolvedValue({
    email: "person@example.com",
    avatarUrl: "https://cdn.example.com/avatar.jpg",
  });
  mocks.tx.booking.count.mockResolvedValue(0);
  mocks.tx.booking.findMany.mockResolvedValue([]);
  mocks.tx.session.deleteMany.mockResolvedValue({ count: 2 });
  mocks.tx.passwordResetToken.deleteMany.mockResolvedValue({ count: 1 });
  mocks.tx.deviceToken.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.liveActivityStartToken.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.liveActivityToken.count.mockResolvedValue(0);
  mocks.tx.liveActivityStart.count.mockResolvedValue(0);
  for (const model of [
    mocks.tx.passkeyCredential,
    mocks.tx.passkeyChallenge,
    mocks.tx.deviceToken,
    mocks.tx.liveActivityStartToken,
    mocks.tx.liveActivityToken,
    mocks.tx.liveActivityStart,
    mocks.tx.webPushSubscription,
    mocks.tx.userAppInstallation,
    mocks.tx.notification,
    mocks.tx.favoriteItem,
    mocks.tx.favoriteItemFamily,
    mocks.tx.scheduleEventFollow,
    mocks.tx.studentAvailabilityBlock,
    mocks.tx.studentSportAssignment,
    mocks.tx.studentAreaAssignment,
    mocks.tx.studentBadge,
    mocks.tx.badgeStreak,
    mocks.tx.badgeEventReceipt,
  ]) {
    model.deleteMany.mockResolvedValue({ count: 1 });
  }
  mocks.tx.allowedEmail.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.licenseCodeClaim.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.user.updateMany.mockResolvedValue({ count: 0 });
  mocks.tx.user.update.mockResolvedValue({ id: "user-1", active: false });
  mocks.createAuditEntryTx.mockResolvedValue(undefined);
  mocks.revokeCompanionUser.mockResolvedValue(undefined);
  mocks.refreshCompanionProjection.mockResolvedValue({});
  mocks.deleteImage.mockResolvedValue(undefined);
  mocks.isBlobUrl.mockReturnValue(true);
});

describe("self-service account erasure", () => {
  it("pseudonymizes identity, removes direct personal records, and retains the audit boundary", async () => {
    const result = await deactivateUserWithCleanup({
      targetUserId: "user-1",
      actorId: "user-1",
      actorRole: "STUDENT",
      erasePersonalData: true,
      audit: {
        action: "account_self_deleted",
        before: { active: true },
        after: {
          active: false,
          personalData: "erased",
          authentication: "revoked",
          retainedRecords: ["historical custody", "audit attribution"],
        },
      },
    });

    expect(mocks.hashPassword).toHaveBeenCalledWith("deleted-account:random-value");
    expect(mocks.tx.passkeyCredential.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mocks.tx.notification.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mocks.tx.webPushSubscription.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mocks.tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user-1" },
      data: expect.objectContaining({
        active: false,
        name: "Deleted User",
        email: "deleted+user-1@deleted.invalid",
        passwordHash: "deleted-password-hash",
        avatarUrl: null,
        notificationPrefs: expect.anything(),
        icsToken: null,
      }),
    }));
    expect(mocks.deleteImage).toHaveBeenCalledWith("https://cdn.example.com/avatar.jpg");
    expect(mocks.revokeCompanionUser).toHaveBeenCalledWith("user-1");
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({
      action: "account_self_deleted",
      after: expect.objectContaining({
        personalData: "erased",
        authentication: "revoked",
        retainedRecords: ["historical custody", "audit attribution"],
      }),
    }));
    expect(result).toEqual({ cancelledIds: [], directReportsCleared: 0 });
  });
});
