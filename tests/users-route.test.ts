import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    calendarEvent: {
      groupBy: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@/lib/services/bookings-helpers", () => ({
  upsertBulkBalancesAndMovements: vi.fn(),
}));

vi.mock("@/lib/services/user-deactivation", () => ({
  deactivateUserWithCleanup: vi.fn(),
}));

vi.mock("@/lib/companion-store", () => ({
  revokeCompanionUser: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { GET } from "@/app/api/users/route";
import { GET as GET_DETAIL, PATCH } from "@/app/api/users/[id]/route";
import { deactivateUserWithCleanup } from "@/lib/services/user-deactivation";
import { revokeCompanionUser } from "@/lib/companion-store";

const adminUser = {
  id: "cm000000000000000000000001",
  email: "admin@test.com",
  name: "Admin",
  role: "ADMIN" as const,
  avatarUrl: null,
};

const targetId = "cm000000000000000000000002";
const managerId = "cm000000000000000000000003";

function patchRequest(body: Record<string, unknown>) {
  return new Request(`https://app.example.com/api/users/${targetId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

function detailRequest() {
  return new Request(`https://app.example.com/api/users/${targetId}`, {
    headers: { host: "app.example.com" },
  });
}

function routeParams(id = targetId) {
  return { params: Promise.resolve({ id }) };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: targetId,
    name: "Student One",
    email: "student@test.com",
    role: "STUDENT",
    staffingType: "ST",
    locationId: null,
    location: null,
    phone: null,
    personalPhone: null,
    workPhone: null,
    workPhoneNotApplicable: false,
    slackHandle: null,
    slackProfileUrl: null,
    primaryArea: null,
    avatarUrl: null,
    active: true,
    hiddenFromRoster: false,
    lastActiveAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    sportAssignments: [],
    areaAssignments: [],
    title: null,
    athleticsEmail: null,
    startDate: null,
    directReportId: null,
    directReportName: null,
    directReport: null,
    gradYear: 2027,
    studentYearOverride: null,
    topSize: null,
    bottomSize: null,
    shoeSize: null,
    topSizeFit: null,
    shoeSizeSystem: null,
    birthdayMonth: 7,
    birthdayDay: 15,
    birthYear: 1995,
    ...overrides,
  };
}

function userRows(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.user.findMany>>;
}

function userRow(row: unknown) {
  return row as Awaited<ReturnType<typeof db.user.findUnique>>;
}

function updatedUser(row: unknown) {
  return row as Awaited<ReturnType<typeof db.user.update>>;
}

function roleGroups(rows: unknown[]) {
  return rows as Awaited<ReturnType<typeof db.user.groupBy>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(adminUser);
  vi.mocked(db.user.findMany).mockResolvedValue([]);
  vi.mocked(db.user.count).mockResolvedValue(0);
  vi.mocked(db.user.groupBy).mockResolvedValue([]);
  vi.mocked(db.calendarEvent.groupBy).mockResolvedValue([]);
  vi.mocked(db.calendarEvent.count).mockResolvedValue(0);
  vi.mocked(db.user.update).mockResolvedValue(updatedUser(makeUser({ directReportId: managerId })));
  vi.mocked(revokeCompanionUser).mockResolvedValue(undefined);
});

describe("GET /api/users", () => {
  it("allows students to browse the visible user directory", async () => {
    const student = { ...adminUser, id: "student-viewer", role: "STUDENT" as const };
    vi.mocked(requireAuth).mockResolvedValue(student);
    vi.mocked(db.user.findMany).mockResolvedValue(userRows([
      makeUser({ id: targetId }),
      makeUser({ id: "other-user", name: "Other User" }),
    ]));
    vi.mocked(db.user.count).mockResolvedValue(2);
    vi.mocked(db.user.groupBy).mockResolvedValue(roleGroups([{ role: "STUDENT", _count: { _all: 2 } }]));

    const res = await GET(
      new Request("https://app.example.com/api/users"),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();
    const where = vi.mocked(db.user.findMany).mock.calls.at(-1)?.[0]?.where as { AND?: unknown[] };

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(where).toMatchObject({
      AND: expect.arrayContaining([{ hiddenFromRoster: false }, { active: true }]),
    });
    expect(where?.AND).not.toContainEqual({ id: "student-viewer" });
  });

  it("returns sportAssignments when present in the users list response", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue(userRows([
      makeUser({
        id: targetId,
        name: "Student One",
        sportAssignments: [
          { sportCode: "VB", defaultTraveler: true },
          { sportCode: "FB", defaultTraveler: false },
        ],
        location: { id: "loc-1", name: "Camp Randall" },
      }),
    ]));
    vi.mocked(db.user.count).mockResolvedValue(1);
    vi.mocked(db.user.groupBy).mockResolvedValue(roleGroups([
      { role: "STUDENT", _count: { _all: 1 } },
    ]));

    const res = await GET(
      new Request("https://app.example.com/api/users"),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          sportAssignments: {
            select: {
              sportCode: true,
              defaultTraveler: true,
            },
          },
        }),
      }),
    );
    expect(body.data[0].sportAssignments).toEqual([
      { sportCode: "VB", defaultTraveler: true },
      { sportCode: "FB", defaultTraveler: false },
    ]);
  });

  it("returns lastActiveAt and supports last-active sorting", async () => {
    const lastActiveAt = new Date("2026-05-13T14:00:00.000Z");
    vi.mocked(db.user.findMany).mockResolvedValue(userRows([
      makeUser({
        id: targetId,
        name: "Student One",
        lastActiveAt,
        location: { id: "loc-1", name: "Camp Randall" },
      }),
    ]));
    vi.mocked(db.user.count).mockResolvedValue(1);
    vi.mocked(db.user.groupBy).mockResolvedValue(roleGroups([
      { role: "STUDENT", _count: { _all: 1 } },
    ]));

    const res = await GET(
      new Request("https://app.example.com/api/users?sort=lastActive_desc"),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { lastActiveAt: { sort: "desc", nulls: "last" } },
          { name: "asc" },
        ],
      }),
    );
    expect(body.data[0].lastActiveAt).toBe("2026-05-13T14:00:00.000Z");
  });
});

describe("GET /api/users/[id]", () => {
  it("lets students read another visible user's profile", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ...adminUser,
      id: "student-viewer",
      role: "STUDENT",
    });
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(userRow(makeUser({
      id: targetId,
      hiddenFromRoster: false,
    })));

    const res = await GET_DETAIL(
      detailRequest(),
      routeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe(targetId);
  });

  it("omits the birth year when staff view another user's profile", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...adminUser, id: managerId, role: "STAFF" });
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(userRow(makeUser()));

    const res = await GET_DETAIL(detailRequest(), routeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.birthdayMonth).toBe(7);
    expect(body.data.birthdayDay).toBe(15);
    expect(body.data).not.toHaveProperty("birthYear");
  });

  it("returns the birth year to admins", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(userRow(makeUser()));

    const res = await GET_DETAIL(detailRequest(), routeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.birthYear).toBe(1995);
  });
});

describe("PATCH /api/users/[id]", () => {
  it("blocks staff from changing another user's birth year", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...adminUser, id: managerId, role: "STAFF" });
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(userRow(makeUser()));

    const res = await PATCH(patchRequest({ birthYear: 1996 }), routeParams());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("Only the user or an admin");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("saves distinct phone fields while keeping the legacy phone synced to personal", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(userRow(makeUser({
      phone: "608-555-0100",
      personalPhone: "608-555-0100",
    })));
    vi.mocked(db.user.update).mockResolvedValueOnce(updatedUser(makeUser({
      phone: "(608) 555-0111",
      personalPhone: "(608) 555-0111",
      workPhone: "(608) 555-0222",
      workPhoneNotApplicable: false,
    })));

    const res = await PATCH(
      patchRequest({
        personalPhone: "608-555-0111",
        workPhone: "608-555-0222",
      }),
      routeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phone: "(608) 555-0111",
        personalPhone: "(608) 555-0111",
        workPhone: "(608) 555-0222",
        workPhoneNotApplicable: false,
      }),
    }));
    expect(body.data).toEqual(expect.objectContaining({
      personalPhone: "(608) 555-0111",
      workPhone: "(608) 555-0222",
      workPhoneNotApplicable: false,
    }));
    expect(createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      after: expect.objectContaining({
        personalPhone: "***0111",
        workPhone: "***0222",
      }),
    }));
    expect(JSON.stringify(vi.mocked(createAuditEntry).mock.calls.at(-1))).not.toContain("608-555");
  });

  it("stores split Wiscard values while preserving the combined kiosk lookup", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(userRow(makeUser({
      wiscardCardNumber: null,
      wiscardIssueCode: null,
    })));
    vi.mocked(db.user.update).mockResolvedValueOnce(updatedUser(makeUser({
      wiscardCardNumber: "9070324810",
      wiscardIssueCode: "2",
      wiscardNumber: "90703248102",
    })));

    const res = await PATCH(
      patchRequest({ wiscardCardNumber: "9070324810", wiscardIssueCode: "2" }),
      routeParams(),
    );

    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        wiscardCardNumber: "9070324810",
        wiscardIssueCode: "2",
        wiscardNumber: "90703248102",
      }),
    }));
    expect(JSON.stringify(vi.mocked(createAuditEntry).mock.calls.at(-1))).not.toContain("9070324810");
  });

  it("stores birthday month and day with a nullable birth year", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(userRow(makeUser()));
    vi.mocked(db.user.update).mockResolvedValueOnce(updatedUser(makeUser({
      birthdayMonth: 7,
      birthdayDay: 15,
      birthYear: null,
    })));

    const res = await PATCH(
      patchRequest({ birthdayMonth: 7, birthdayDay: 15, birthYear: null }),
      routeParams(),
    );

    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ birthdayMonth: 7, birthdayDay: 15, birthYear: null }),
    }));
  });

  it("rejects profile changes bundled with destructive deactivation", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(userRow(makeUser({ active: true })));

    const res = await PATCH(
      patchRequest({ active: false, name: "Changed during deactivation" }),
      routeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Deactivate the user separately");
    expect(deactivateUserWithCleanup).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("retries companion cleanup for an account that is already inactive", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(userRow(makeUser({ active: false })));
    vi.mocked(db.user.update).mockResolvedValueOnce(updatedUser(makeUser({ active: false })));

    const res = await PATCH(patchRequest({ active: false }), routeParams());

    expect(res.status).toBe(200);
    expect(revokeCompanionUser).toHaveBeenCalledWith(targetId);
    expect(deactivateUserWithCleanup).not.toHaveBeenCalled();
  });

  it("reports when already-inactive companion cleanup still cannot finish", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(userRow(makeUser({ active: false })));
    vi.mocked(revokeCompanionUser).mockRejectedValueOnce(new Error("Redis unavailable"));

    const res = await PATCH(patchRequest({ active: false }), routeParams());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "The account is inactive, but companion access could not be revoked. Retry setting the account to inactive.",
    });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("saves a linked direct report when the reporting chain is valid", async () => {
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce(userRow(makeUser()))
      .mockResolvedValueOnce(userRow({ id: managerId, directReportId: null }));

    const res = await PATCH(
      patchRequest({ directReportId: managerId }),
      routeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: targetId },
        data: {
          directReportId: managerId,
          directReportName: null,
        },
      }),
    );
    expect(createAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "updated",
        before: expect.objectContaining({ directReportId: null }),
        after: expect.objectContaining({ directReportId: managerId }),
      }),
    );
    expect(body.data.directReportId).toBe(managerId);
  });

  it("rejects a missing linked direct report before updating the user", async () => {
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce(userRow(makeUser()))
      .mockResolvedValueOnce(null);

    const res = await PATCH(
      patchRequest({ directReportId: managerId }),
      routeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Direct report user not found");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects direct-report cycles before updating the user", async () => {
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce(userRow(makeUser()))
      .mockResolvedValueOnce(userRow({ id: managerId, directReportId: targetId }));

    const res = await PATCH(
      patchRequest({ directReportId: managerId }),
      routeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("reporting cycle");
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
