import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingKind, CollaboratorPolicyStatus, Prisma, Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  policyFindMany: vi.fn(),
  policyFindUnique: vi.fn(),
  policyUpdateMany: vi.fn(),
  userGroupBy: vi.fn(),
  userFindMany: vi.fn(),
  userCount: vi.fn(),
  inviteGroupBy: vi.fn(),
  inviteCount: vi.fn(),
  bookingGroupBy: vi.fn(),
  affiliationCreate: vi.fn(),
  affiliationUpdate: vi.fn(),
  revisionCreate: vi.fn(),
  revisionFindFirst: vi.fn(),
  revisionFindMany: vi.fn(),
  grantDeleteMany: vi.fn(),
  grantCreateMany: vi.fn(),
  notificationCreateMany: vi.fn(),
  createAuditEntryTx: vi.fn(),
  txOptions: [] as unknown[],
}));

vi.mock("@/lib/db", () => {
  const client = {
    collaboratorPolicy: { findMany: mocks.policyFindMany, findUnique: mocks.policyFindUnique, updateMany: mocks.policyUpdateMany },
    collaboratorAffiliation: { create: mocks.affiliationCreate, update: mocks.affiliationUpdate },
    collaboratorPolicyRevision: { create: mocks.revisionCreate, findFirst: mocks.revisionFindFirst, findMany: mocks.revisionFindMany },
    collaboratorPolicyGrant: { deleteMany: mocks.grantDeleteMany, createMany: mocks.grantCreateMany },
    user: { groupBy: mocks.userGroupBy, findMany: mocks.userFindMany, count: mocks.userCount },
    allowedEmail: { groupBy: mocks.inviteGroupBy, count: mocks.inviteCount },
    booking: { groupBy: mocks.bookingGroupBy },
    notification: { createMany: mocks.notificationCreateMany },
  };
  return {
    db: {
      ...client,
      $transaction: vi.fn(async (fn: (tx: typeof client) => Promise<unknown>, options?: unknown) => {
        mocks.txOptions.push(options);
        return fn(client);
      }),
    },
  };
});
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.createAuditEntryTx }));

import {
  archiveCollaboratorAffiliation,
  createCollaboratorAffiliation,
  getCollaboratorPolicy,
  listCollaboratorPolicies,
  listCollaboratorPolicyHistory,
  previewCollaboratorPolicyChange,
  restoreCollaboratorPolicy,
} from "@/lib/services/collaborator-policies";

const actor = { id: "erik", role: Role.ADMIN };

function policy(id: string, over: Record<string, unknown> = {}, affiliationOver: Record<string, unknown> = {}) {
  return {
    id,
    affiliationId: `aff-${id}`,
    status: CollaboratorPolicyStatus.ACTIVE,
    version: 2,
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    affiliation: { id: `aff-${id}`, key: id.toUpperCase(), displayName: id, badgeLabel: id.slice(0, 3).toUpperCase(), archivedAt: null, ...affiliationOver },
    grants: [{ capabilityKey: "GEAR_CATALOG_VIEW" }, { capabilityKey: "MY_GEAR_VIEW" }, { capabilityKey: "RETIRED_FEATURE" }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.txOptions.length = 0;
  mocks.policyFindMany.mockResolvedValue([policy("btn"), policy("learfield")]);
  mocks.userGroupBy.mockResolvedValue([{ collaboratorPolicyId: "btn", _count: { _all: 4 } }]);
  mocks.inviteGroupBy.mockResolvedValue([{ collaboratorPolicyId: "learfield", _count: { _all: 2 } }]);
  mocks.userFindMany.mockResolvedValue([
    { id: "u1", collaboratorPolicyId: "btn" },
    { id: "u2", collaboratorPolicyId: "btn" },
    { id: "u3", collaboratorPolicyId: "learfield" },
  ]);
  mocks.bookingGroupBy.mockResolvedValue([
    { requesterUserId: "u1", kind: BookingKind.RESERVATION, _count: { _all: 2 } },
    { requesterUserId: "u2", kind: BookingKind.RESERVATION, _count: { _all: 1 } },
    { requesterUserId: "u2", kind: BookingKind.CHECKOUT, _count: { _all: 3 } },
    { requesterUserId: "someone-moved", kind: BookingKind.CHECKOUT, _count: { _all: 9 } },
  ]);
  mocks.policyUpdateMany.mockResolvedValue({ count: 1 });
});

describe("listCollaboratorPolicies", () => {
  it("counts each affiliation's people, invites and open bookings, and hides retired capabilities", async () => {
    const [btn, learfield] = await listCollaboratorPolicies();

    expect(btn).toMatchObject({
      id: "btn",
      capabilities: ["GEAR_CATALOG_VIEW", "MY_GEAR_VIEW"],
      counts: { activeUsers: 4, pendingInvites: 0, activeReservations: 3, activeCheckouts: 3 },
    });
    expect(learfield!.counts).toEqual({ activeUsers: 0, pendingInvites: 2, activeReservations: 0, activeCheckouts: 0 });
  });

  it("skips the count queries when there are no affiliations", async () => {
    mocks.policyFindMany.mockResolvedValue([]);
    mocks.userFindMany.mockResolvedValue([]);

    await expect(listCollaboratorPolicies()).resolves.toEqual([]);
    expect(mocks.userGroupBy).not.toHaveBeenCalled();
    expect(mocks.bookingGroupBy).not.toHaveBeenCalled();
  });
});

describe("getCollaboratorPolicy", () => {
  it("returns one affiliation with its counts", async () => {
    mocks.policyFindUnique.mockResolvedValue(policy("btn"));

    await expect(getCollaboratorPolicy("btn")).resolves.toMatchObject({ id: "btn", counts: { activeUsers: 4 } });
  });

  it("treats an archived affiliation as missing", async () => {
    mocks.policyFindUnique.mockResolvedValue(policy("btn", {}, { archivedAt: new Date() }));

    await expect(getCollaboratorPolicy("btn")).rejects.toMatchObject({ status: 404 });
  });
});

describe("createCollaboratorAffiliation", () => {
  beforeEach(() => {
    mocks.affiliationCreate.mockResolvedValue({ policy: { id: "new-policy", status: CollaboratorPolicyStatus.SUSPENDED } });
  });

  it("starts a new affiliation suspended with no capabilities, a first revision and an audit", async () => {
    const id = await createCollaboratorAffiliation({ actor, displayName: "  Learfield Studios  ", badgeLabel: " LRF " });

    expect(id).toBe("new-policy");
    expect(mocks.affiliationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        key: "LEARFIELD_STUDIOS",
        displayName: "Learfield Studios",
        badgeLabel: "LRF",
        policy: { create: { status: CollaboratorPolicyStatus.SUSPENDED, version: 1 } },
      }),
    }));
    expect(mocks.revisionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ version: 1, capabilities: [], actorUserId: "erik" }) });
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "created", entityId: "new-policy" }));
    expect(mocks.txOptions[0]).toEqual({ isolationLevel: "Serializable" });
  });

  it("folds accents and punctuation into a stable key", async () => {
    await createCollaboratorAffiliation({ actor, displayName: "Télé-Québec / Sports!", badgeLabel: "TQ" });

    expect(mocks.affiliationCreate.mock.calls[0]![0].data.key).toBe("TELE_QUEBEC_SPORTS");
  });

  it.each([
    ["an empty name", "   ", "BTN", "Affiliation name must be 1 to 80 characters"],
    ["a name over 80 characters", "x".repeat(81), "BTN", "Affiliation name must be 1 to 80 characters"],
    ["a one-letter badge", "Big Ten Network", "B", "Badge must be 2 to 12 characters"],
    ["a badge over 12 characters", "Big Ten Network", "BIGTENNETWORK", "Badge must be 2 to 12 characters"],
    ["a name with no usable key", "!!", "XX", "Affiliation name cannot produce a stable key"],
  ])("refuses %s", async (_label, displayName, badgeLabel, message) => {
    await expect(createCollaboratorAffiliation({ actor, displayName, badgeLabel })).rejects.toThrow(message);
    expect(mocks.affiliationCreate).not.toHaveBeenCalled();
  });

  it("explains a duplicate key", async () => {
    mocks.affiliationCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7" }));

    await expect(createCollaboratorAffiliation({ actor, displayName: "Big Ten Network", badgeLabel: "BTN" }))
      .rejects.toMatchObject({ status: 409, message: "An affiliation with that stable key already exists" });
  });

  it("rethrows other database errors", async () => {
    mocks.affiliationCreate.mockRejectedValue(new Error("db down"));

    await expect(createCollaboratorAffiliation({ actor, displayName: "Big Ten Network", badgeLabel: "BTN" })).rejects.toThrow("db down");
  });
});

describe("previewCollaboratorPolicyChange", () => {
  beforeEach(() => {
    mocks.policyFindUnique.mockResolvedValue(policy("btn"));
  });

  it("shows added dependencies and asks for confirmation when access shrinks", async () => {
    const preview = await previewCollaboratorPolicyChange({ policyId: "btn", capabilities: ["SCHEDULE_FOLLOW"] });

    expect(preview).toMatchObject({
      currentVersion: 2,
      added: expect.arrayContaining(["SCHEDULE_FOLLOW", "PUBLISHED_SCHEDULE_VIEW"]),
      removed: ["GEAR_CATALOG_VIEW", "MY_GEAR_VIEW"],
      adjustments: ["PUBLISHED_SCHEDULE_VIEW"],
      requiresConfirmation: true,
    });
  });

  it("needs no confirmation for a pure addition", async () => {
    const preview = await previewCollaboratorPolicyChange({ policyId: "btn", capabilities: ["GEAR_CATALOG_VIEW", "MY_GEAR_VIEW", "RESERVATION_CREATE"] });

    expect(preview).toMatchObject({ added: ["RESERVATION_CREATE"], removed: [], requiresConfirmation: false });
  });

  it("asks for confirmation before suspending an active affiliation", async () => {
    const preview = await previewCollaboratorPolicyChange({ policyId: "btn", status: CollaboratorPolicyStatus.SUSPENDED });

    expect(preview).toMatchObject({ removed: [], adjustments: [], requiresConfirmation: true });
  });
});

describe("listCollaboratorPolicyHistory", () => {
  it("lists revisions newest first", async () => {
    mocks.policyFindUnique.mockResolvedValue({ id: "btn" });
    mocks.revisionFindMany.mockResolvedValue([{ version: 2 }, { version: 1 }]);

    await expect(listCollaboratorPolicyHistory("btn")).resolves.toHaveLength(2);
    expect(mocks.revisionFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { policyId: "btn" }, orderBy: { version: "desc" } }));
  });

  it("answers 404 for an unknown policy", async () => {
    mocks.policyFindUnique.mockResolvedValue(null);

    await expect(listCollaboratorPolicyHistory("nope")).rejects.toMatchObject({ status: 404 });
  });
});

describe("restoreCollaboratorPolicy", () => {
  beforeEach(() => {
    mocks.policyFindUnique.mockResolvedValue(policy("btn"));
  });

  it("re-applies an earlier revision as a new version, audited as restored", async () => {
    mocks.revisionFindFirst.mockResolvedValue({ id: "rev-1", status: CollaboratorPolicyStatus.ACTIVE, capabilities: ["GEAR_CATALOG_VIEW", "MY_GEAR_VIEW", "RESERVATION_CREATE"] });

    await expect(restoreCollaboratorPolicy({ actor, policyId: "btn", revisionId: "rev-1", expectedVersion: 2 })).resolves.toBe(3);
    expect(mocks.revisionFindFirst).toHaveBeenCalledWith({ where: { id: "rev-1", policyId: "btn" } });
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "restored" }));
  });

  it("still needs acknowledgement when the old revision had less access", async () => {
    mocks.revisionFindFirst.mockResolvedValue({ id: "rev-1", status: CollaboratorPolicyStatus.ACTIVE, capabilities: ["MY_GEAR_VIEW"] });

    await expect(restoreCollaboratorPolicy({ actor, policyId: "btn", revisionId: "rev-1", expectedVersion: 2 }))
      .rejects.toMatchObject({ status: 409 });
    expect(mocks.policyUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses a revision from another policy", async () => {
    mocks.revisionFindFirst.mockResolvedValue(null);

    await expect(restoreCollaboratorPolicy({ actor, policyId: "btn", revisionId: "rev-other", expectedVersion: 2 }))
      .rejects.toMatchObject({ status: 404 });
  });

  it("refuses a corrupt revision", async () => {
    mocks.revisionFindFirst.mockResolvedValue({ id: "rev-1", status: CollaboratorPolicyStatus.ACTIVE, capabilities: [42] });

    await expect(restoreCollaboratorPolicy({ actor, policyId: "btn", revisionId: "rev-1", expectedVersion: 2 }))
      .rejects.toMatchObject({ status: 500 });
  });
});

describe("archiveCollaboratorAffiliation", () => {
  const archive = (expectedVersion = 2) => archiveCollaboratorAffiliation({ actor, policyId: "btn", expectedVersion });

  beforeEach(() => {
    mocks.policyFindUnique.mockResolvedValue(policy("btn", { status: CollaboratorPolicyStatus.SUSPENDED }));
    mocks.userCount.mockResolvedValue(0);
    mocks.inviteCount.mockResolvedValue(0);
  });

  it("archives a suspended, empty affiliation", async () => {
    await expect(archive()).resolves.toEqual({ archived: true });
    expect(mocks.affiliationUpdate).toHaveBeenCalledWith({ where: { id: "aff-btn" }, data: { archivedAt: expect.any(Date) } });
    expect(mocks.createAuditEntryTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "archived" }));
  });

  it("requires suspending first", async () => {
    mocks.policyFindUnique.mockResolvedValue(policy("btn"));

    await expect(archive()).rejects.toThrow("Suspend the affiliation before archiving it");
  });

  it.each([
    ["active collaborators", 1, 0],
    ["pending invitations", 0, 1],
  ])("refuses while it still has %s", async (_label, users, invites) => {
    mocks.userCount.mockResolvedValue(users);
    mocks.inviteCount.mockResolvedValue(invites);

    await expect(archive()).rejects.toMatchObject({ status: 409 });
    expect(mocks.affiliationUpdate).not.toHaveBeenCalled();
  });

  it("refuses a stale version and an already archived affiliation", async () => {
    await expect(archive(1)).rejects.toMatchObject({ status: 409 });

    mocks.policyFindUnique.mockResolvedValue(policy("btn", { status: CollaboratorPolicyStatus.SUSPENDED }, { archivedAt: new Date() }));
    await expect(archive()).rejects.toMatchObject({ status: 404 });
  });
});
