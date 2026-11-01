import { beforeEach, describe, expect, it, vi } from "vitest";
import { LicenseCodeStatus, Prisma, Role } from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";

const { db } = vi.hoisted(() => {
  const db = {
    licenseCode: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    licenseCodeClaim: { findFirst: vi.fn(), create: vi.fn() },
    user: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db };
});

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: vi.fn() }));
vi.mock("@/lib/services/notifications", () => ({ sendPushToUser: vi.fn() }));

import {
  addUnknownOccupant,
  assignCodeToUser,
  bulkCreateCodes,
  bulkRenewCodes,
  claimCode,
  deleteCode,
  getActiveClaimForUser,
  listAllCodes,
  listCodes,
  retireCode,
} from "@/lib/services/licenses";

const day = (n: number) => new Date(`2026-10-${String(n).padStart(2, "0")}T15:00:00.000Z`);

function code(id: string, status: LicenseCodeStatus, activeClaims = 0, createdAt = day(1)) {
  return {
    id,
    status,
    createdAt,
    claims: Array.from({ length: activeClaims }, (_, i) => ({ id: `${id}-claim-${i}` })),
  };
}

function updatedData() {
  return db.licenseCode.update.mock.calls[0]?.[0]?.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.licenseCodeClaim.findFirst.mockResolvedValue(null);
  db.licenseCodeClaim.create.mockResolvedValue({});
  db.licenseCode.update.mockImplementation(async ({ data }: { data: object }) => data);
  db.user.findFirst.mockResolvedValue({ id: "maya", name: "Maya" });
});

describe("listing codes", () => {
  it("puts the most claimable codes first, then the oldest", async () => {
    db.licenseCode.findMany.mockResolvedValue([
      code("claimed", "CLAIMED", 2, day(1)),
      code("new-free", "AVAILABLE", 0, day(9)),
      code("partial", "PARTIAL", 1, day(2)),
      code("old-free", "AVAILABLE", 0, day(3)),
      code("retired", "RETIRED", 0, day(1)),
    ]);

    const rows = await listAllCodes();

    expect(rows.map((row) => row.id)).toEqual(["old-free", "new-free", "partial", "claimed", "retired"]);
  });

  it("hides retired codes from the everyday list", async () => {
    db.licenseCode.findMany.mockResolvedValue([]);

    await listCodes();

    expect(db.licenseCode.findMany.mock.calls[0]?.[0]?.where).toEqual({ status: { not: "RETIRED" } });
  });
});

describe("getActiveClaimForUser", () => {
  it("returns the held code with its claim, or null", async () => {
    db.licenseCodeClaim.findFirst.mockResolvedValueOnce({
      id: "claim-1",
      claimedAt: day(20),
      licenseCode: { id: "pm1", code: "PM-AAAA", label: "Desk 1", expiresAt: day(30) },
    });

    expect(await getActiveClaimForUser("maya")).toEqual({
      id: "pm1",
      code: "PM-AAAA",
      label: "Desk 1",
      expiresAt: day(30),
      claimedAt: day(20),
      claimId: "claim-1",
    });
    expect(await getActiveClaimForUser("maya")).toBeNull();
  });
});

describe("claimCode", () => {
  it("marks the first claim as partial and records who claimed it", async () => {
    db.licenseCode.findUnique.mockResolvedValue(code("pm1", "AVAILABLE"));

    await claimCode("pm1", "maya");

    expect(db.licenseCodeClaim.create.mock.calls[0]?.[0]?.data).toMatchObject({ licenseCodeId: "pm1", userId: "maya" });
    expect(updatedData()).toMatchObject({ status: "PARTIAL", claimedById: "maya" });
    expect(db.$transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });

  it("marks the second claim as claimed without changing the first claimer", async () => {
    db.licenseCode.findUnique.mockResolvedValue(code("pm1", "PARTIAL", 1));

    await claimCode("pm1", "sam");

    expect(updatedData()).toEqual({ status: "CLAIMED" });
  });

  it.each([
    ["the person already holds one", () => db.licenseCodeClaim.findFirst.mockResolvedValue({ id: "c" }), 409, /already have an active/],
    ["the code is missing", () => db.licenseCode.findUnique.mockResolvedValue(null), 404, /not found/],
    ["the code is retired", () => db.licenseCode.findUnique.mockResolvedValue(code("pm1", "RETIRED")), 409, /retired/],
    ["both slots are taken", () => db.licenseCode.findUnique.mockResolvedValue(code("pm1", "CLAIMED", 2)), 409, /fully claimed/],
  ])("refuses when %s", async (_label, arrange, status, message) => {
    db.licenseCode.findUnique.mockResolvedValue(code("pm1", "AVAILABLE"));
    arrange();

    await expect(claimCode("pm1", "maya")).rejects.toMatchObject({ status, message: expect.stringMatching(message) });
    expect(db.licenseCodeClaim.create).not.toHaveBeenCalled();
  });

  it("tries once more when it loses a race for the last slot", async () => {
    db.licenseCode.findUnique.mockResolvedValue(code("pm1", "PARTIAL", 1));
    db.$transaction.mockRejectedValueOnce(Object.assign(new Error("conflict"), { code: "P2034" }));

    await claimCode("pm1", "maya");

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(updatedData()).toEqual({ status: "CLAIMED" });
  });
});

describe("addUnknownOccupant", () => {
  it("fills a slot with a trimmed label and no user", async () => {
    db.licenseCode.findUnique.mockResolvedValue(code("pm1", "PARTIAL", 1));

    await addUnknownOccupant("pm1", "  Old laptop  ");

    expect(db.licenseCodeClaim.create.mock.calls[0]?.[0]?.data).toMatchObject({ userId: null, occupantLabel: "Old laptop" });
    expect(updatedData()).toEqual({ status: "CLAIMED" });
  });

  it("refuses a full code", async () => {
    db.licenseCode.findUnique.mockResolvedValue(code("pm1", "CLAIMED", 2));

    await expect(addUnknownOccupant("pm1", "Old laptop")).rejects.toMatchObject({ status: 409 });
  });
});

describe("assignCodeToUser", () => {
  it("assigns a free code to an active staff member or student", async () => {
    db.licenseCode.findUnique.mockResolvedValue(code("pm1", "AVAILABLE"));

    const result = await assignCodeToUser("pm1", "maya");

    expect(result.assignee).toEqual({ id: "maya", name: "Maya" });
    expect(updatedData()).toMatchObject({ status: "PARTIAL", claimedById: "maya" });
    expect(JSON.stringify(db.user.findFirst.mock.calls[0]?.[0]?.where)).toContain('"in":["ADMIN","STAFF","STUDENT"]');
  });

  it("names the person who already holds a license", async () => {
    db.licenseCodeClaim.findFirst.mockResolvedValue({ id: "c" });

    await expect(assignCodeToUser("pm1", "maya")).rejects.toMatchObject({
      status: 409,
      message: "Maya already has an active Photo Mechanic license.",
    });
  });

  it("refuses an unknown or inactive person", async () => {
    db.user.findFirst.mockResolvedValue(null);

    await expect(assignCodeToUser("pm1", "gone")).rejects.toMatchObject({ status: 404 });
    expect(db.licenseCode.findUnique).not.toHaveBeenCalled();
  });
});

describe("bulkCreateCodes", () => {
  it("creates only new codes and counts repeats and existing ones as skipped", async () => {
    db.licenseCode.findMany.mockResolvedValue([{ code: "PM-OLD" }]);
    db.licenseCode.createMany.mockResolvedValue({ count: 2 });

    const result = await bulkCreateCodes(" PM-1 \n\nPM-2\nPM-1\nPM-OLD\n", "erik", { accountEmail: "pm@wisc.edu" });

    expect(db.licenseCode.findMany.mock.calls[0]?.[0]?.where).toEqual({ code: { in: ["PM-1", "PM-2", "PM-OLD"] } });
    expect(db.licenseCode.createMany.mock.calls[0]?.[0]?.data).toEqual([
      { code: "PM-1", createdById: "erik", accountEmail: "pm@wisc.edu", expiresAt: undefined },
      { code: "PM-2", createdById: "erik", accountEmail: "pm@wisc.edu", expiresAt: undefined },
    ]);
    expect(result).toEqual({ created: 2, skipped: 2 });
  });

  it("skips everything without writing when every code exists", async () => {
    db.licenseCode.findMany.mockResolvedValue([{ code: "PM-1" }]);

    expect(await bulkCreateCodes("PM-1\nPM-1", "erik")).toEqual({ created: 0, skipped: 2 });
    expect(db.licenseCode.createMany).not.toHaveBeenCalled();
  });

  it("refuses an empty paste and an overlong code", async () => {
    await expect(bulkCreateCodes(" \n ", "erik")).rejects.toMatchObject({ status: 400, message: "No codes provided." });
    await expect(bulkCreateCodes(`PM-1\n${"x".repeat(121)}`, "erik")).rejects.toMatchObject({ status: 400 });
    expect(db.licenseCode.findMany).not.toHaveBeenCalled();
  });
});

describe("retiring and deleting", () => {
  it("retires or deletes a code with no one on it", async () => {
    db.licenseCode.findUnique.mockResolvedValue(code("pm1", "AVAILABLE"));

    await retireCode("pm1");
    await deleteCode("pm1");

    expect(updatedData()).toEqual({ status: "RETIRED" });
    expect(db.licenseCode.delete).toHaveBeenCalledWith({ where: { id: "pm1" } });
  });

  it("refuses while someone still holds a slot", async () => {
    db.licenseCode.findUnique.mockResolvedValue(code("pm1", "PARTIAL", 1));

    await expect(retireCode("pm1")).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/retire/) });
    await expect(deleteCode("pm1")).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/delete/) });
    expect(db.licenseCode.update).not.toHaveBeenCalled();
    expect(db.licenseCode.delete).not.toHaveBeenCalled();
  });

  it("answers 404 for a missing code", async () => {
    db.licenseCode.findUnique.mockResolvedValue(null);

    await expect(retireCode("nope")).rejects.toMatchObject({ status: 404 });
    await expect(deleteCode("nope")).rejects.toMatchObject({ status: 404 });
  });
});

describe("bulkRenewCodes", () => {
  it("renews only codes that are not retired", async () => {
    db.licenseCode.updateMany.mockResolvedValue({ count: 3 });

    expect(await bulkRenewCodes(["a", "b", "c", "d"], day(31))).toEqual({ updated: 3 });
    expect(db.licenseCode.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b", "c", "d"] }, status: { not: "RETIRED" } },
      data: { expiresAt: day(31) },
    });
  });
});

describe("releaseCode", () => {
  const claimDb = db as unknown as typeof db & { licenseCodeClaim: typeof db.licenseCodeClaim & { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    claimDb.licenseCodeClaim.findMany = vi.fn().mockResolvedValue([]);
    claimDb.licenseCodeClaim.findUnique = vi.fn();
    claimDb.licenseCodeClaim.update = vi.fn().mockResolvedValue({});
    claimDb.licenseCodeClaim.updateMany = vi.fn().mockResolvedValue({ count: 2 });
    db.licenseCode.update.mockImplementation(async ({ data }: { data: object }) => ({ id: "code-1", ...data }));
  });

  it("lets an admin clear every seat at once and reopens the code", async () => {
    const { releaseCode } = await import("@/lib/services/licenses");
    claimDb.licenseCodeClaim.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);

    const code = await releaseCode("code-1", "admin-1", true, { releaseAll: true }, Role.ADMIN);

    expect(code.status).toBe(LicenseCodeStatus.AVAILABLE);
    expect(claimDb.licenseCodeClaim.updateMany).toHaveBeenCalledWith({
      where: { licenseCodeId: "code-1", releasedAt: null },
      data: { releasedAt: expect.any(Date), releasedById: "admin-1" },
    });
    expect(updatedData()).toEqual({ status: LicenseCodeStatus.AVAILABLE, claimedById: null, claimedAt: null, nagSentAt: null });
    expect(vi.mocked(createAuditEntryTx)).toHaveBeenCalledWith(db, expect.objectContaining({
      action: "release", after: { status: LicenseCodeStatus.AVAILABLE, claimId: null, releaseAll: true, releasedById: "admin-1" },
    }));
  });

  it("refuses release-all from a non-admin and when nothing is claimed", async () => {
    const { releaseCode } = await import("@/lib/services/licenses");
    await expect(releaseCode("code-1", "maya", false, { releaseAll: true }, Role.STUDENT)).rejects.toMatchObject({ status: 403 });
    await expect(releaseCode("code-1", "admin-1", true, { releaseAll: true }, Role.ADMIN)).rejects.toMatchObject({ status: 409 });
    expect(claimDb.licenseCodeClaim.updateMany).not.toHaveBeenCalled();
  });

  it("releases the caller's own seat and downgrades the code to partial when another seat stays", async () => {
    const { releaseCode } = await import("@/lib/services/licenses");
    db.licenseCodeClaim.findFirst.mockResolvedValue({ id: "c-maya", userId: "maya", licenseCodeId: "code-1", releasedAt: null });
    claimDb.licenseCodeClaim.findMany.mockResolvedValue([{ id: "c-sam", userId: "sam", claimedAt: day(3) }]);

    const code = await releaseCode("code-1", "maya", false, {}, Role.STUDENT);

    expect(claimDb.licenseCodeClaim.update).toHaveBeenCalledWith({ where: { id: "c-maya" }, data: { releasedAt: expect.any(Date), releasedById: null } });
    expect(code).toMatchObject({ status: LicenseCodeStatus.PARTIAL, claimedById: "sam", claimedAt: day(3), nagSentAt: null });
    expect(vi.mocked(createAuditEntryTx)).toHaveBeenCalledWith(db, expect.objectContaining({
      after: { status: LicenseCodeStatus.PARTIAL, claimId: "c-maya", releaseAll: false, releasedById: null },
    }));
  });

  it("lets an admin release a specific claim, recording who did it, and 404s a stale or foreign claim id", async () => {
    const { releaseCode } = await import("@/lib/services/licenses");
    claimDb.licenseCodeClaim.findUnique.mockResolvedValue({ id: "c-sam", userId: "sam", licenseCodeId: "code-1", releasedAt: null });

    const code = await releaseCode("code-1", "admin-1", true, { claimId: "c-sam" }, Role.ADMIN);

    expect(claimDb.licenseCodeClaim.update).toHaveBeenCalledWith({ where: { id: "c-sam" }, data: { releasedAt: expect.any(Date), releasedById: "admin-1" } });
    expect(code.status).toBe(LicenseCodeStatus.AVAILABLE);

    await expect(releaseCode("code-1", "maya", false, { claimId: "c-sam" }, Role.STUDENT)).rejects.toMatchObject({ status: 403 });
    claimDb.licenseCodeClaim.findUnique.mockResolvedValue({ id: "c-sam", userId: "sam", licenseCodeId: "other-code", releasedAt: null });
    await expect(releaseCode("code-1", "admin-1", true, { claimId: "c-sam" }, Role.ADMIN)).rejects.toMatchObject({ status: 404 });
    claimDb.licenseCodeClaim.findUnique.mockResolvedValue({ id: "c-sam", userId: "sam", licenseCodeId: "code-1", releasedAt: day(2) });
    await expect(releaseCode("code-1", "admin-1", true, { claimId: "c-sam" }, Role.ADMIN)).rejects.toMatchObject({ status: 404 });
  });

  it("404s when the caller has no seat on the code", async () => {
    const { releaseCode } = await import("@/lib/services/licenses");

    await expect(releaseCode("code-1", "maya", false, {}, Role.STUDENT)).rejects.toMatchObject({ status: 404 });
    expect(claimDb.licenseCodeClaim.update).not.toHaveBeenCalled();
  });
});

describe("claim history", () => {
  it("lists a code's claims newest first with the claimant, and a person's claims with the code", async () => {
    const { getClaimHistory, getClaimHistoryForUser } = await import("@/lib/services/licenses");
    const findMany = vi.fn().mockResolvedValue([{ id: "c1" }]);
    (db as unknown as { licenseCodeClaim: { findMany: typeof findMany } }).licenseCodeClaim.findMany = findMany;

    await expect(getClaimHistory("code-1")).resolves.toEqual([{ id: "c1" }]);
    expect(findMany).toHaveBeenCalledWith({
      where: { licenseCodeId: "code-1" },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { claimedAt: "desc" },
      take: 50,
    });

    await getClaimHistoryForUser("maya", 5);
    expect(findMany).toHaveBeenLastCalledWith({
      where: { userId: "maya" },
      include: { licenseCode: { select: { id: true, label: true, expiresAt: true } } },
      orderBy: { claimedAt: "desc" },
      take: 5,
    });
  });
});
