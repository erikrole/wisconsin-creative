import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/badges/queries", () => ({
  awardBadgeManually: vi.fn(),
  ensureManualBadgeDefinition: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({
  captureBadgeError: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { awardBadgeManually, ensureManualBadgeDefinition } from "@/lib/badges/queries";
import { createAuditEntry } from "@/lib/audit";
import { captureBadgeError } from "@/lib/observability";
import { POST } from "@/app/api/badges/award/bulk/route";

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  role: "ADMIN" as const,
  avatarUrl: null,
};

const definitionId = "cmbadge000000000000001";

function makePostRequest(body: unknown) {
  return new Request("https://app.example.com/api/badges/award/bulk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

function targetRows(rows: Array<{ id: string; name: string }>) {
  return rows as Awaited<ReturnType<typeof db.user.findMany>>;
}

function manualAward(row: unknown) {
  return row as Awaited<ReturnType<typeof awardBadgeManually>>;
}

function awardRow(userId: string, id = `award-${userId}`) {
  return manualAward({
    id,
    userId,
    definitionId,
    awardedAt: new Date("2026-08-31T12:00:00.000Z"),
    source: "MANUAL",
    note: "Team recognition",
    definition: {
      id: definitionId,
      key: "event_hero",
      name: "Event Hero",
      description: "Standout help during an event.",
      icon: "Trophy",
      category: "MILESTONE",
      kind: "RULE",
      trigger: "manual",
      threshold: null,
      ruleKey: null,
      active: true,
      sortOrder: 10,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BADGES_ENABLED = "true";
  vi.mocked(requireAuth).mockResolvedValue(adminUser);
  vi.mocked(db.user.findMany).mockResolvedValue(targetRows([
    { id: "user-1", name: "First User" },
    { id: "user-2", name: "Second User" },
  ]));
  vi.mocked(awardBadgeManually).mockImplementation(async ({ userId }) => awardRow(userId) as never);
  vi.mocked(ensureManualBadgeDefinition).mockResolvedValue({
    id: definitionId,
    key: "custom_event_hero",
    name: "Event Hero",
    active: true,
  });
  vi.mocked(createAuditEntry).mockResolvedValue(undefined);
});

describe("POST /api/badges/award/bulk", () => {
  it("requires an admin before resolving the group", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...adminUser, role: "STAFF" as const });

    const response = await POST(makePostRequest({ definitionId }), { params: Promise.resolve({}) });

    expect(response.status).toBe(403);
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(awardBadgeManually).not.toHaveBeenCalled();
  });

  it("returns before querying or awarding when badges are disabled", async () => {
    process.env.BADGES_ENABLED = "false";

    const response = await POST(makePostRequest({ definitionId }), { params: Promise.resolve({}) });

    expect(response.status).toBe(409);
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(awardBadgeManually).not.toHaveBeenCalled();
  });

  it("resolves all active users matching the current directory filters", async () => {
    const response = await POST(makePostRequest({
      filters: {
        q: "crew",
        role: "STUDENT",
        locationId: "location-1",
        area: "VIDEO",
        year: "SENIOR",
      },
      definitionId,
      note: "Team recognition",
    }), { params: Promise.resolve({}) });
    const body = await response.json();
    const query = vi.mocked(db.user.findMany).mock.calls[0]?.[0];

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ requested: 2, awarded: 2, skipped: 0, failed: 0 });
    expect(awardBadgeManually).toHaveBeenCalledTimes(2);
    expect(createAuditEntry).toHaveBeenCalledTimes(2);
    expect(query).toMatchObject({
      take: 201,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
      where: {
        AND: expect.arrayContaining([
          { hiddenFromRoster: false },
          { role: "STUDENT" },
          { locationId: "location-1" },
          { active: true },
        ]),
      },
    });
    expect(query?.where).toMatchObject({
      AND: expect.arrayContaining([
        { OR: [{ name: { contains: "crew", mode: "insensitive" } }, { email: { contains: "crew", mode: "insensitive" } }] },
        { OR: [{ primaryArea: "VIDEO" }, { areaAssignments: { some: { area: "VIDEO" } } }] },
      ]),
    });
  });

  it("resolves only explicitly selected active users", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue(targetRows([
      { id: "user-2", name: "Second User" },
    ]));

    const response = await POST(makePostRequest({
      userIds: ["user-2"],
      definitionId,
    }), { params: Promise.resolve({}) });
    const body = await response.json();
    const query = vi.mocked(db.user.findMany).mock.calls[0]?.[0];

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ requested: 1, awarded: 1, skipped: 0, failed: 0 });
    expect(awardBadgeManually).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-2" }));
    expect(query).toMatchObject({
      take: 201,
      where: {
        AND: expect.arrayContaining([
          { id: { in: ["user-2"] } },
          { AND: expect.arrayContaining([{ hiddenFromRoster: false }, { active: true }]) },
        ]),
      },
    });
  });

  it("skips duplicate awards and continues with the rest of the group", async () => {
    vi.mocked(awardBadgeManually)
      .mockResolvedValueOnce(awardRow("user-1"))
      .mockRejectedValueOnce(new HttpError(409, "Badge already awarded"));

    const response = await POST(makePostRequest({ definitionId }), { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ requested: 2, awarded: 1, skipped: 1, failed: 0 });
    expect(body.data.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: "user-1", status: "awarded" }),
      expect.objectContaining({ userId: "user-2", status: "skipped", reason: "Already has this badge" }),
    ]));
    expect(createAuditEntry).toHaveBeenCalledTimes(1);
  });

  it("reports an unexpected per-user failure without aborting the batch", async () => {
    vi.mocked(awardBadgeManually)
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(awardRow("user-2"));

    const response = await POST(makePostRequest({ definitionId }), { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ requested: 2, awarded: 1, skipped: 0, failed: 1 });
    expect(body.data.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: "user-1", status: "failed", reason: "Could not award this badge" }),
      expect.objectContaining({ userId: "user-2", status: "awarded" }),
    ]));
    expect(captureBadgeError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      operation: "bulkBadgeAward",
      userId: "user-1",
    }));
  });

  it("resolves a custom definition once before fanning out awards", async () => {
    const response = await POST(makePostRequest({
      customDefinition: {
        name: "Event Hero",
        description: "Standout help during an event.",
        icon: "Trophy",
      },
    }), { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    expect(ensureManualBadgeDefinition).toHaveBeenCalledTimes(1);
    expect(awardBadgeManually).toHaveBeenCalledWith(expect.objectContaining({
      definitionId,
      awardedById: adminUser.id,
    }));
  });

  it("does not create a custom definition when the group is empty", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue(targetRows([]));

    const response = await POST(makePostRequest({
      customDefinition: {
        name: "Empty group badge",
        description: "No users should receive this yet.",
        icon: "Trophy",
      },
    }), { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ requested: 0, awarded: 0, skipped: 0, failed: 0 });
    expect(ensureManualBadgeDefinition).not.toHaveBeenCalled();
    expect(awardBadgeManually).not.toHaveBeenCalled();
  });

  it("rejects an over-large group before any award work", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue(targetRows(
      Array.from({ length: 201 }, (_, index) => ({ id: `user-${index}`, name: `User ${index}` })),
    ));

    const response = await POST(makePostRequest({ definitionId }), { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toContain("more than 200 active users");
    expect(awardBadgeManually).not.toHaveBeenCalled();
    expect(createAuditEntry).not.toHaveBeenCalled();
  });
});
