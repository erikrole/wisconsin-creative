import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const tx = {
  user: {
    create: vi.fn(),
  },
  allowedEmail: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx)),
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    allowedEmail: {
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
    collaboratorPolicy: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
  createAuditEntries: vi.fn(),
  createAuditEntryTx: vi.fn(),
}));

import { createAuditEntries, createAuditEntry, createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  createAllowedEmailInvite,
  createAllowedEmailInvitesBulk,
  previewAllowedEmailInvitesBulk,
  updatePendingAllowedEmailProfile,
} from "@/lib/services/onboarding-lifecycle";

const admin = { id: "admin-1", role: "ADMIN" as const };
const staff = { id: "staff-1", role: "STAFF" as const };

type OnboardingTransaction = typeof tx;

function existingUser(row: unknown) {
  return row as Awaited<ReturnType<typeof db.user.findUnique>>;
}

function userRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.user.findMany>>;
}

function allowedEmailRow(row: unknown) {
  return row as Awaited<ReturnType<typeof db.allowedEmail.create>>;
}

function allowedEmailRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.allowedEmail.findMany>>;
}

function createManyResult(count: number) {
  return { count } as Awaited<ReturnType<typeof db.allowedEmail.createMany>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.$transaction).mockImplementation(async (fn) =>
    (fn as unknown as (transaction: OnboardingTransaction) => Promise<unknown>)(tx)
  );
});

describe("onboarding lifecycle service", () => {
  it("blocks staff from inviting staff accounts", async () => {
    await expect(
      createAllowedEmailInvite({
        actor: staff,
        email: "staff@uw.edu",
        role: "STAFF",
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: "Only admins can pre-approve staff accounts",
    });
  });

  it("allows only admins to invite an active collaborator policy", async () => {
    await expect(
      createAllowedEmailInvite({
        actor: staff,
        email: "trey@example.com",
        role: "COLLABORATOR",
        affiliation: "BIG_TEN_NETWORK",
        collaboratorProfile: "BTN_STANDARD",
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: "Only admins can pre-approve collaborator accounts",
    });

    await expect(
      createAllowedEmailInvite({
        actor: admin,
        email: "trey@example.com",
        role: "COLLABORATOR",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Choose a recognized collaborator affiliation",
    });
  });

  it("persists policy metadata for an individually approved external email", async () => {
    vi.mocked(db.collaboratorPolicy.findUnique).mockResolvedValue({
      id: "policy-btn",
      status: "ACTIVE",
      affiliation: {
        id: "affiliation-btn",
        key: "BIG_TEN_NETWORK",
        displayName: "Big Ten Network",
        badgeLabel: "BTN",
        archivedAt: null,
      },
    } as never);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.allowedEmail.create).mockResolvedValue(allowedEmailRow({
      id: "allowed-btn",
      email: "trey@example.com",
      role: "COLLABORATOR",
      affiliation: "BIG_TEN_NETWORK",
      collaboratorProfile: "BTN_STANDARD",
      collaboratorPolicyId: "policy-btn",
      claimedAt: null,
      claimedById: null,
    }));

    const result = await createAllowedEmailInvite({
      actor: admin,
      email: "Trey@Example.com",
      role: "COLLABORATOR",
      collaboratorPolicyId: "policy-btn",
    });

    expect(result.skipped).toBe(false);
    expect(db.allowedEmail.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: "trey@example.com",
        role: "COLLABORATOR",
        affiliation: "BIG_TEN_NETWORK",
        collaboratorProfile: "BTN_STANDARD",
        collaboratorPolicyId: "policy-btn",
        createdById: "admin-1",
      }),
    }));
    expect(createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "allowed_email",
      after: expect.objectContaining({
        affiliation: "BIG_TEN_NETWORK",
        collaboratorProfile: "BTN_STANDARD",
        collaboratorPolicyId: "policy-btn",
      }),
    }));
  });

  it("backfills a claimed allowlist row for an existing registered user", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(existingUser({ id: "existing-user", role: "STAFF" }));
    vi.mocked(db.allowedEmail.create).mockResolvedValue(allowedEmailRow({
      id: "allowed-1",
      email: "existing@uw.edu",
      role: "STAFF",
      claimedAt: new Date("2026-06-03T12:00:00.000Z"),
      claimedById: "existing-user",
    }));

    const result = await createAllowedEmailInvite({
      actor: admin,
      email: "Existing@UW.edu",
      role: "STUDENT",
    });

    expect(result.skipped).toBe(false);
    expect(db.allowedEmail.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "existing@uw.edu",
          role: "STAFF",
          claimedById: "existing-user",
        }),
      }),
    );
    expect(createAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "allowed_email",
        after: expect.objectContaining({ source: "registered_user_backfill" }),
      }),
    );
  });

  it("returns a generic skip for duplicate invite creation", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.allowedEmail.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const result = await createAllowedEmailInvite({
      actor: admin,
      email: "existing@uw.edu",
      role: "STUDENT",
    });

    expect(result).toEqual({
      skipped: true,
      email: "existing@uw.edu",
      role: "STUDENT",
    });
    expect(createAuditEntry).not.toHaveBeenCalled();
  });

  it("bulk invite creation preserves generic skip counts and batched audit writes", async () => {
    vi.mocked(db.allowedEmail.findMany)
      .mockResolvedValueOnce(allowedEmailRows([{ email: "existing@uw.edu" }]))
      .mockResolvedValueOnce(allowedEmailRows([{ id: "allowed-1", email: "new@uw.edu", role: "STUDENT" }]));
    vi.mocked(db.user.findMany).mockResolvedValue([]);
    vi.mocked(db.allowedEmail.createMany).mockResolvedValue(createManyResult(1));

    const result = await createAllowedEmailInvitesBulk({
      actor: admin,
      emails: [
        { email: "New@UW.edu", role: "STUDENT" },
        { email: "Existing@UW.edu", role: "STUDENT" },
      ],
    });

    expect(result).toEqual({ created: 1, skipped: 1 });
    expect(db.allowedEmail.createMany).toHaveBeenCalledWith({
      data: [
        {
          email: "new@uw.edu",
          role: "STUDENT",
          createdById: "admin-1",
        },
      ],
      skipDuplicates: true,
    });
    expect(createAuditEntries).toHaveBeenCalledWith([
      expect.objectContaining({
        entityType: "allowed_email",
        entityId: "allowed-1",
        action: "created",
      }),
    ]);
  });

  it("stores pending student profile and assignment data on the invitation", async () => {
    vi.mocked(db.allowedEmail.findMany)
      .mockResolvedValueOnce(allowedEmailRows([]))
      .mockResolvedValueOnce(allowedEmailRows([{
        id: "allowed-student",
        email: "student@uw.edu",
        role: "STUDENT",
        affiliation: null,
        collaboratorProfile: null,
        collaboratorPolicyId: null,
        preloadedName: "Student One",
        preloadedPrimaryArea: "VIDEO",
        preloadedAreas: ["VIDEO", "SOCIAL"],
        preloadedSportCodes: ["WBB", "VB"],
      }]));
    vi.mocked(db.user.findMany).mockResolvedValue([]);
    vi.mocked(db.allowedEmail.createMany).mockResolvedValue(createManyResult(1));

    const result = await createAllowedEmailInvitesBulk({
      actor: admin,
      emails: [{
        email: "Student@UW.edu",
        role: "STUDENT",
        preloadedName: " Student One ",
        preloadedPrimaryArea: "VIDEO",
        preloadedAreas: ["VIDEO", "SOCIAL"],
        preloadedSportCodes: ["WBB", "VB", "WBB"],
      }],
    });

    expect(result).toEqual({ created: 1, skipped: 0 });
    expect(db.allowedEmail.createMany).toHaveBeenCalledWith({
      data: [{
        email: "student@uw.edu",
        role: "STUDENT",
        preloadedName: "Student One",
        preloadedPrimaryArea: "VIDEO",
        preloadedAreas: ["VIDEO", "SOCIAL"],
        preloadedSportCodes: ["WBB", "VB"],
        createdById: "admin-1",
      }],
      skipDuplicates: true,
    });
    expect(createAuditEntries).toHaveBeenCalledWith([
      expect.objectContaining({
        entityType: "allowed_email",
        after: expect.objectContaining({
          preloadedName: "Student One",
          preloadedAreas: ["VIDEO", "SOCIAL"],
          preloadedSportCodes: ["WBB", "VB"],
        }),
      }),
    ]);
  });

  it("updates an unclaimed student invitation profile in the transaction and audits the replacement", async () => {
    tx.allowedEmail.findUnique.mockResolvedValue({
      id: "allowed-student",
      email: "student@uw.edu",
      role: "STUDENT",
      claimedAt: null,
      claimedById: null,
      preloadedName: null,
      preloadedPrimaryArea: null,
      preloadedAreas: [],
      preloadedSportCodes: [],
    });
    tx.allowedEmail.update.mockResolvedValue({
      id: "allowed-student",
      email: "student@uw.edu",
      role: "STUDENT",
      claimedAt: null,
      claimedById: null,
      preloadedName: "Student One",
      preloadedPrimaryArea: "VIDEO",
      preloadedAreas: ["VIDEO", "SOCIAL"],
      preloadedSportCodes: ["WBB", "VB"],
    });

    const result = await updatePendingAllowedEmailProfile({
      actor: admin,
      id: "allowed-student",
      preloadedName: " Student One ",
      preloadedPrimaryArea: "VIDEO",
      preloadedAreas: ["VIDEO", "SOCIAL"],
      preloadedSportCodes: ["WBB", "VB", "WBB"],
    });

    expect(result.entry.preloadedName).toBe("Student One");
    expect(tx.allowedEmail.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "allowed-student" },
      data: {
        preloadedName: "Student One",
        preloadedPrimaryArea: "VIDEO",
        preloadedAreas: ["VIDEO", "SOCIAL"],
        preloadedSportCodes: ["WBB", "VB"],
      },
    }));
    expect(createAuditEntryTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        entityType: "allowed_email",
        entityId: "allowed-student",
        action: "pending_profile_updated",
      }),
    );
  });

  it("rejects preloaded profile data for a staff invitation", async () => {
    await expect(createAllowedEmailInvitesBulk({
      actor: admin,
      emails: [{
        email: "staff@uw.edu",
        role: "STAFF",
        preloadedName: "Staff Member",
        preloadedPrimaryArea: "VIDEO",
        preloadedAreas: ["VIDEO"],
        preloadedSportCodes: [],
      }],
    })).rejects.toMatchObject({
      status: 400,
      message: "Only student invitations can receive preloaded profile data",
    });
    expect(db.allowedEmail.createMany).not.toHaveBeenCalled();
  });

  it("previews bulk invite account status without creating rows", async () => {
    vi.mocked(db.allowedEmail.findMany).mockResolvedValue(allowedEmailRows([
      { email: "pending@uw.edu", role: "STUDENT", claimedAt: null },
      { email: "claimed@uw.edu", role: "STAFF", claimedAt: new Date("2026-06-03T12:00:00.000Z") },
    ]));
    vi.mocked(db.user.findMany).mockResolvedValue(userRows([
      { email: "existing@uw.edu", role: "STUDENT" },
    ]));

    const result = await previewAllowedEmailInvitesBulk({
      actor: admin,
      emails: [
        { email: "Ready@UW.edu", role: "STUDENT" },
        { email: "Pending@UW.edu", role: "STUDENT" },
        { email: "Claimed@UW.edu", role: "STAFF" },
        { email: "Existing@UW.edu", role: "STUDENT" },
        { email: "Ready@UW.edu", role: "STUDENT" },
      ],
    });

    expect(result.summary).toEqual({
      ready: 1,
      pending_invite: 1,
      claimed_invite: 1,
      existing_user: 1,
      duplicate: 1,
    });
    expect(result.rows.map((row) => row.status)).toEqual([
      "ready",
      "pending_invite",
      "claimed_invite",
      "existing_user",
      "duplicate",
    ]);
    expect(db.allowedEmail.createMany).not.toHaveBeenCalled();
    expect(createAuditEntries).not.toHaveBeenCalled();
  });
});
