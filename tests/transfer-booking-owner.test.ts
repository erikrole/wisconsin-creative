import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingStatus, Role } from "@prisma/client";
import { expectSerializableIsolation } from "./_helpers/assert-transaction";

type MockFn = ReturnType<typeof vi.fn>;
type TransferOwnerTx = {
  booking: Record<"findUnique" | "findUniqueOrThrow" | "update", MockFn>;
  user: Record<"findUnique", MockFn>;
  auditLog: Record<"create", MockFn>;
};

const transactionCalls: Array<{ options: unknown }> = [];

vi.mock("@/lib/db", () => {
  const mockTx = {
    booking: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  };

  return {
    db: {
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>, options?: unknown) => {
        transactionCalls.push({ options });
        return fn(mockTx);
      }),
      _mockTx: mockTx,
    },
  };
});

import { db } from "@/lib/db";
import { transferBookingOwner } from "@/lib/services/bookings";

const mockTx = (db as unknown as { _mockTx: TransferOwnerTx })._mockTx;

const currentRequester = {
  id: "cm000000000000000000000002",
  name: "Original Owner",
  email: "original@example.com",
};

const targetUser = {
  id: "cm000000000000000000000004",
  name: "New Owner",
  email: "new@example.com",
  active: true,
  hiddenFromRoster: false,
};

function activeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "cm000000000000000000000001",
    status: BookingStatus.BOOKED,
    updatedAt: new Date("2026-07-09T16:00:00Z"),
    requesterUserId: currentRequester.id,
    createdBy: "staff-1",
    requester: currentRequester,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionCalls.length = 0;
  mockTx.booking.findUnique.mockResolvedValue(activeBooking());
  mockTx.booking.findUniqueOrThrow.mockResolvedValue({ id: "cm000000000000000000000001" });
  mockTx.booking.update.mockResolvedValue({});
  mockTx.auditLog.create.mockResolvedValue({});
  mockTx.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
    if (where.id === "staff-1") return Promise.resolve({ role: Role.STAFF });
    if (where.id === currentRequester.id) return Promise.resolve({ role: Role.STUDENT });
    if (where.id === targetUser.id) return Promise.resolve(targetUser);
    return Promise.resolve(null);
  });
});

describe("transferBookingOwner", () => {
  it("BUG: rejects an owner transfer when the snapshot changed before the transaction", async () => {
    await expect(transferBookingOwner(
      activeBooking().id,
      "staff-1",
      { targetUserId: targetUser.id },
      new Date("2026-07-09T15:59:59Z"),
    )).rejects.toMatchObject({ status: 409 });

    expect(mockTx.user.findUnique).not.toHaveBeenCalled();
    expect(mockTx.booking.update).not.toHaveBeenCalled();
  });

  it("updates requester and writes an owner transfer audit entry", async () => {
    await transferBookingOwner(activeBooking().id, "staff-1", {
      targetUserId: targetUser.id,
      reason: "Operational owner changed.",
    });

    expect(mockTx.booking.update).toHaveBeenCalledWith({
      where: { id: activeBooking().id },
      data: { requesterUserId: targetUser.id },
    });
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: "staff-1",
          entityType: "booking",
          entityId: activeBooking().id,
          action: "owner_transferred",
          beforeJson: expect.objectContaining({
            requesterUserId: currentRequester.id,
            requesterName: currentRequester.name,
          }),
          afterJson: expect.objectContaining({
            requesterUserId: targetUser.id,
            requesterName: targetUser.name,
            reason: "Operational owner changed.",
            _actorRole: Role.STAFF,
          }),
        }),
      }),
    );
    expectSerializableIsolation(transactionCalls, 0);
  });

  it("allows a student owner to transfer their own booking", async () => {
    await transferBookingOwner(activeBooking().id, currentRequester.id, { targetUserId: targetUser.id });

    expect(mockTx.booking.update).toHaveBeenCalledWith({
      where: { id: activeBooking().id },
      data: { requesterUserId: targetUser.id },
    });
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: currentRequester.id,
          action: "owner_transferred",
          afterJson: expect.objectContaining({
            requesterUserId: targetUser.id,
            _actorRole: Role.STUDENT,
          }),
        }),
      }),
    );
  });

  it("rejects non-owner student actors", async () => {
    mockTx.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === "student-1") return Promise.resolve({ role: Role.STUDENT });
      if (where.id === targetUser.id) return Promise.resolve(targetUser);
      return Promise.resolve(null);
    });

    await expect(
      transferBookingOwner(activeBooking().id, "student-1", { targetUserId: targetUser.id }),
    ).rejects.toThrow("You do not have permission to transfer this booking");
    expect(mockTx.booking.update).not.toHaveBeenCalled();
  });

  it("rejects inactive target users", async () => {
    mockTx.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === "staff-1") return Promise.resolve({ role: Role.STAFF });
      if (where.id === targetUser.id) return Promise.resolve({ ...targetUser, active: false });
      return Promise.resolve(null);
    });

    await expect(
      transferBookingOwner(activeBooking().id, "staff-1", { targetUserId: targetUser.id }),
    ).rejects.toThrow("Cannot transfer ownership to an inactive user");
    expect(mockTx.booking.update).not.toHaveBeenCalled();
  });

  it("does not write audit for same-owner no-ops", async () => {
    await transferBookingOwner(activeBooking().id, "staff-1", { targetUserId: currentRequester.id });

    expect(mockTx.booking.update).not.toHaveBeenCalled();
    expect(mockTx.auditLog.create).not.toHaveBeenCalled();
  });
});
