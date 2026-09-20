import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(),
    },
    location: {
      findMany: vi.fn(),
    },
    department: {
      findMany: vi.fn(),
    },
    bulkSku: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  enforceRateLimit: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET as getUsersExport } from "@/app/api/users/export/route";
import { GET as getUsersOrgChart } from "@/app/api/users/org-chart/route";
import { GET as getFormOptions } from "@/app/api/form-options/route";

const adminUser = {
  id: "admin-1",
  email: "admin@test.com",
  name: "Admin",
  role: Role.ADMIN,
  avatarUrl: null,
};

const staffUser = {
  id: "staff-1",
  email: "staff@test.com",
  name: "Staff",
  role: Role.STAFF,
  avatarUrl: null,
};

const studentUser = {
  id: "student-1",
  email: "student@test.com",
  name: "Student",
  role: Role.STUDENT,
  avatarUrl: null,
};

const noParams = { params: Promise.resolve({}) };

function makeGetRequest(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

function mockExportUsers() {
  vi.mocked(db.user.findMany).mockResolvedValue(users([
    {
      id: "admin-target",
      name: "Admin Target",
      role: Role.ADMIN,
      email: "admin-target@test.com",
      athleticsEmail: "admin-athletics@test.com",
      phone: "111-111-1111",
      title: "Director",
      gradYear: null,
      studentYearOverride: null,
      primaryArea: null,
      startDate: null,
      topSize: null,
      bottomSize: null,
      shoeSize: null,
      active: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      location: null,
      sportAssignments: [],
      areaAssignments: [],
      directReport: null,
      directReportName: null,
    },
    {
      id: "staff-target",
      name: "Staff Target",
      role: Role.STAFF,
      email: "staff-target@test.com",
      athleticsEmail: "staff-athletics@test.com",
      phone: "222-222-2222",
      title: "Coordinator",
      gradYear: null,
      studentYearOverride: null,
      primaryArea: null,
      startDate: null,
      topSize: null,
      bottomSize: null,
      shoeSize: null,
      active: true,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      location: null,
      sportAssignments: [],
      areaAssignments: [],
      directReport: null,
      directReportName: null,
    },
    {
      id: "student-target",
      name: "Student Target",
      role: Role.STUDENT,
      email: "student-target@test.com",
      athleticsEmail: "student-athletics@test.com",
      phone: "333-333-3333",
      title: null,
      gradYear: 2027,
      studentYearOverride: null,
      primaryArea: null,
      startDate: null,
      topSize: null,
      bottomSize: null,
      shoeSize: null,
      active: true,
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
      location: null,
      sportAssignments: [],
      areaAssignments: [],
      directReport: null,
      directReportName: null,
    },
  ]));
}

function users(rows: unknown) {
  return rows as Awaited<ReturnType<typeof db.user.findMany>>;
}

beforeEach(() => {
  vi.mocked(db.location.findMany).mockResolvedValue([]);
  vi.mocked(db.department.findMany).mockResolvedValue([]);
  vi.mocked(db.bulkSku.findMany).mockResolvedValue([]);
});

describe("user PII scope hardening", () => {
  it("redacts staff and admin sensitive contact fields from STAFF user exports", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    mockExportUsers();

    const res = await getUsersExport(makeGetRequest("/api/users/export"), noParams);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).not.toContain("admin-athletics@test.com");
    expect(body).not.toContain("111-111-1111");
    expect(body).not.toContain("staff-athletics@test.com");
    expect(body).not.toContain("222-222-2222");
    expect(body).toContain("student-athletics@test.com");
    expect(body).toContain("333-333-3333");
  });

  it("keeps full sensitive contact fields in ADMIN user exports", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    mockExportUsers();

    const res = await getUsersExport(makeGetRequest("/api/users/export"), noParams);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("admin-athletics@test.com");
    expect(body).toContain("111-111-1111");
    expect(body).toContain("staff-athletics@test.com");
    expect(body).toContain("222-222-2222");
  });

  it("disables caching for the users CSV export", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    mockExportUsers();

    const res = await getUsersExport(makeGetRequest("/api/users/export"), noParams);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("honors the collaborator export filter", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    mockExportUsers();

    await getUsersExport(makeGetRequest("/api/users/export?role=COLLABORATOR"), noParams);

    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: expect.arrayContaining([{ role: "COLLABORATOR" }]) } }),
    );
  });

  it("ignores an invalid area consistently with the directory instead of passing it to Prisma", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    mockExportUsers();

    await getUsersExport(makeGetRequest("/api/users/export?area=INVALID"), noParams);

    expect(JSON.stringify(vi.mocked(db.user.findMany).mock.calls[0])).not.toContain("INVALID");
  });

  it("normalizes location filters consistently with the directory", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    mockExportUsers();

    await getUsersExport(makeGetRequest("/api/users/export?locationId=%20main%20"), noParams);

    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: expect.arrayContaining([{ locationId: "main" }]) } }),
    );
  });

  it("bounds user export reads and marks truncated output", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    const person = {
      id: "a", name: "Person", role: "STUDENT" as const, email: "person@example.com", athleticsEmail: null,
      phone: null, title: "Assistant", gradYear: null, studentYearOverride: null, primaryArea: null,
      startDate: null, topSize: null, bottomSize: null, shoeSize: null, active: true,
      createdAt: new Date("2026-01-01"), location: null, sportAssignments: [], areaAssignments: [],
      directReport: null, directReportName: null,
    };
    vi.mocked(db.user.findMany).mockResolvedValue(users(Array.from({ length: 5001 }, () => person)));

    const response = await getUsersExport(makeGetRequest("/api/users/export"), noParams);

    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5001 }));
    expect(response.headers.get("x-exported-count")).toBe("5000");
    expect(response.headers.get("x-truncated")).toBe("true");
    expect((await response.text()).split("\n")).toHaveLength(5001);
  });

  it("does not mark exactly 5000 users truncated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    const person = {
      id: "a", name: "Person", role: "STUDENT" as const, email: "person@example.com", athleticsEmail: null,
      phone: null, title: "Assistant", gradYear: null, studentYearOverride: null, primaryArea: null,
      startDate: null, topSize: null, bottomSize: null, shoeSize: null, active: true,
      createdAt: new Date("2026-01-01"), location: null, sportAssignments: [], areaAssignments: [],
      directReport: null, directReportName: null,
    };
    vi.mocked(db.user.findMany).mockResolvedValue(users(Array.from({ length: 5000 }, () => person)));

    const response = await getUsersExport(makeGetRequest("/api/users/export"), noParams);

    expect(response.headers.get("x-truncated")).toBeNull();
  });

  it("keeps collaborator private fields out of Staff exports while preserving CSV columns", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    const collaborator = {
      id: "a", name: "Person", role: "COLLABORATOR" as const, email: "private@example.com", athleticsEmail: null,
      phone: null, title: "Assistant", gradYear: null, studentYearOverride: null, primaryArea: null,
      startDate: null, topSize: "secret-size", bottomSize: null, shoeSize: null, active: true,
      createdAt: new Date("2026-01-01"), location: null, sportAssignments: [], areaAssignments: [],
      directReport: null, directReportName: "Private Manager",
    };
    vi.mocked(db.user.findMany).mockResolvedValue(users([collaborator]));

    const response = await getUsersExport(makeGetRequest("/api/users/export"), noParams);
    const body = await response.text();

    expect(body).toContain("Person,COLLABORATOR");
    expect(body).not.toContain("private@example.com");
    expect(body).not.toContain("secret-size");
    expect(body).not.toContain("Private Manager");
    const [header, row] = body.split("\n");
    expect(row!.split(",")).toHaveLength(header!.split(",").length);
  });

  it("preserves full collaborator exports for admins", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminUser);
    const collaborator = {
      id: "a", name: "Person", role: "COLLABORATOR" as const, email: "private@example.com", athleticsEmail: null,
      phone: null, title: "Assistant", gradYear: null, studentYearOverride: null, primaryArea: null,
      startDate: null, topSize: null, bottomSize: null, shoeSize: null, active: true,
      createdAt: new Date("2026-01-01"), location: null, sportAssignments: [], areaAssignments: [],
      directReport: null, directReportName: null,
    };
    vi.mocked(db.user.findMany).mockResolvedValue(users([collaborator]));

    const response = await getUsersExport(makeGetRequest("/api/users/export"), noParams);

    expect(await response.text()).toContain("private@example.com");
  });

  it("blocks org chart reporting hierarchy from STUDENT callers", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await getUsersOrgChart(makeGetRequest("/api/users/org-chart"), noParams);

    expect(res.status).toBe(403);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("limits form-options user directory to self for STUDENT callers", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);
    vi.mocked(db.user.findMany).mockResolvedValue(users([
      { id: "student-1", name: "Student", avatarUrl: null },
    ]));

    const res = await getFormOptions(makeGetRequest("/api/form-options"), noParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { hiddenFromRoster: false },
            { id: "student-1", active: true },
          ],
        },
        select: { id: true, name: true, avatarUrl: true },
      }),
    );
    expect(body.data.users).toEqual([{ id: "student-1", name: "Student", avatarUrl: null }]);
  });
});
