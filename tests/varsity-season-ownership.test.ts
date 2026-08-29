import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  findUsers: vi.fn(),
  findOwners: vi.fn(),
  updateOwner: vi.fn(),
  createOwners: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { $transaction: mocks.transaction },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntryTx: mocks.audit,
}));

import { handoffVarsityOwnership, varsityOwnershipHandoffSchema } from "@/lib/services/varsity-season-ownership";

const tx = {
  user: { findMany: mocks.findUsers },
  varsitySeasonOwner: {
    findMany: mocks.findOwners,
    update: mocks.updateOwner,
    createMany: mocks.createOwners,
  },
};

const input = {
  sportCode: "WSOC",
  area: "PHOTO" as const,
  startsOn: "2026-09-01",
  endsOn: "2026-12-31",
  userIds: ["student-1", "student-2"],
};

describe("varsity season ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.findUsers.mockResolvedValue(input.userIds.map((id) => ({
      id,
      staffingType: "ST",
      primaryArea: "PHOTO",
      areaAssignments: [],
      sportAssignments: [{ id: `roster-${id}` }],
    })));
    mocks.findOwners
      .mockResolvedValueOnce([{
        id: "prior-1",
        userId: "student-old",
        startsOn: new Date("2026-07-01T00:00:00.000Z"),
        endsOn: new Date("2026-12-31T00:00:00.000Z"),
      }])
      .mockResolvedValueOnce([]);
    mocks.updateOwner.mockResolvedValue({});
    mocks.createOwners.mockResolvedValue({ count: 2 });
    mocks.audit.mockResolvedValue(undefined);
  });

  it("accepts multiple co-primary owners only for non-Big-Six Photo, Video, or Graphics", () => {
    expect(varsityOwnershipHandoffSchema.parse({ ...input, userIds: ["student-1", "student-1", "student-2"] }).userIds).toEqual(input.userIds);
    expect(() => varsityOwnershipHandoffSchema.parse({ ...input, sportCode: "FB" })).toThrow(/Big Six/);
    expect(() => varsityOwnershipHandoffSchema.parse({ ...input, area: "SOCIAL" })).toThrow();
  });

  it("closes the prior interval, creates co-owner rows, and audits one SERIALIZABLE handoff", async () => {
    await handoffVarsityOwnership(input, { id: "admin-1", role: Role.ADMIN });

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.updateOwner).toHaveBeenCalledWith({
      where: { id: "prior-1" },
      data: { endsOn: new Date("2026-08-31T00:00:00.000Z") },
    });
    expect(mocks.createOwners).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ sportCode: "WSOC", area: "PHOTO", userId: "student-1", createdById: "admin-1" }),
      expect.objectContaining({ sportCode: "WSOC", area: "PHOTO", userId: "student-2", createdById: "admin-1" }),
    ] });
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({
      actorId: "admin-1",
      action: "varsity_season_ownership_handoff",
      before: { owners: [expect.objectContaining({ id: "prior-1" })] },
    }));
  });

  it("rejects an overlap with a scheduled future handoff before writing", async () => {
    mocks.findOwners.mockReset();
    mocks.findOwners.mockResolvedValueOnce([{
      id: "future-1",
      userId: "student-future",
      startsOn: new Date("2026-10-01T00:00:00.000Z"),
      endsOn: new Date("2026-12-31T00:00:00.000Z"),
    }]);

    await expect(handoffVarsityOwnership(input, { id: "admin-1", role: Role.ADMIN })).rejects.toThrow(/overlaps another ownership period/);
    expect(mocks.updateOwner).not.toHaveBeenCalled();
    expect(mocks.createOwners).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
