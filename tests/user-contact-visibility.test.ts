import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/role-preview", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/role-preview")>(),
  readRolePreviewCookie: vi.fn(async () => null),
}));
vi.mock("@/lib/services/game-record", () => ({
  getGameRecordForUser: vi.fn(async () => ({ games: 0, seasons: [] })),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { GET as getUserById } from "@/app/api/users/[id]/route";
import { GET as listUsers } from "@/app/api/users/route";
import { canReadContactDetails } from "@/lib/user-visibility";

function actor(id: string, role: Role) {
  return { id, email: `${id}@example.com`, name: id, role, avatarUrl: null };
}

function person(id: string, role: Role) {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    role,
    affiliation: null,
    collaboratorProfile: null,
    collaboratorPolicy: null,
    staffingType: "ST",
    phone: "(608) 555-0100",
    personalPhone: "(608) 555-0100",
    workPhone: "(608) 555-0200",
    workPhoneNotApplicable: false,
    slackHandle: null,
    slackProfileUrl: null,
    primaryArea: null,
    locationId: null,
    location: null,
    avatarUrl: null,
    active: true,
    hiddenFromRoster: false,
    title: null,
    gradYear: null,
    graduationTerm: null,
    studentYearOverride: null,
    lastActiveAt: null,
    createdAt: new Date("2026-06-24T12:00:00.000Z"),
    athleticsEmail: `${id}@athletics.wisc.edu`,
    startDate: null,
    directReportId: null,
    directReportName: null,
    directReport: null,
    topSize: null,
    topSizeFit: null,
    bottomSize: null,
    shoeSize: null,
    shoeSizeSystem: null,
    wiscardNumber: null,
    wiscardCardNumber: null,
    wiscardIssueCode: null,
    birthdayMonth: 4,
    birthdayDay: 12,
    birthYear: 1990,
    icsToken: null,
    sportAssignments: [],
    areaAssignments: [],
  };
}

async function readDetail(viewer: ReturnType<typeof actor>, target: ReturnType<typeof person>) {
  vi.mocked(requireAuth).mockResolvedValue(viewer);
  dbMock.user.findUnique.mockResolvedValue(target);
  const res = await getUserById(
    new Request(`https://app.example.com/api/users/${target.id}`, { headers: { host: "app.example.com" } }),
    { params: Promise.resolve({ id: target.id }) },
  );
  expect(res.status).toBe(200);
  return (await res.json()).data as Record<string, unknown>;
}

async function readList(viewer: ReturnType<typeof actor>, rows: ReturnType<typeof person>[]) {
  vi.mocked(requireAuth).mockResolvedValue(viewer);
  dbMock.user.findMany.mockResolvedValue(rows);
  dbMock.user.count.mockResolvedValue(rows.length);
  dbMock.user.groupBy.mockResolvedValue([]);
  const res = await listUsers(
    new Request("https://app.example.com/api/users", { headers: { host: "app.example.com" } }),
    { params: Promise.resolve({}) },
  );
  expect(res.status).toBe(200);
  return (await res.json()).data as Array<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("staff contact details stay out of student reads", () => {
  it("withholds a staff member's phones, athletics email and birthday from a student", async () => {
    const data = await readDetail(actor("student-1", Role.STUDENT), person("staff-1", Role.STAFF));

    expect(data.phone).toBeNull();
    expect(data.personalPhone).toBeNull();
    expect(data.workPhone).toBeNull();
    expect(data.athleticsEmail).toBeNull();
    expect(data.birthdayMonth).toBeNull();
    expect(data.birthdayDay).toBeNull();
    expect(data.name).toBe("staff-1");
  });

  it("keeps another student's contact details visible to a student", async () => {
    const data = await readDetail(actor("student-1", Role.STUDENT), person("student-2", Role.STUDENT));

    expect(data.phone).toBe("(608) 555-0100");
    expect(data.athleticsEmail).toBe("student-2@athletics.wisc.edu");
    expect(data.birthdayMonth).toBe(4);
  });

  it("shows staff their own and each other's details", async () => {
    expect((await readDetail(actor("staff-2", Role.STAFF), person("staff-1", Role.STAFF))).phone).toBe("(608) 555-0100");
    expect((await readDetail(actor("staff-1", Role.STAFF), person("staff-1", Role.STAFF))).workPhone).toBe("(608) 555-0200");
  });

  it("blanks staff phones in the user list for a student but keeps student phones", async () => {
    const rows = await readList(actor("student-1", Role.STUDENT), [person("admin-1", Role.ADMIN), person("student-2", Role.STUDENT)]);

    expect(rows.map((row) => row.phone)).toEqual([null, "(608) 555-0100"]);
  });

  it("matches the CSV export rule", () => {
    expect(canReadContactDetails(actor("student-1", Role.STUDENT), { id: "staff-1", role: Role.STAFF })).toBe(false);
    expect(canReadContactDetails(actor("staff-1", Role.STAFF), { id: "staff-1", role: Role.STAFF })).toBe(true);
    expect(canReadContactDetails(actor("admin-1", Role.ADMIN), { id: "staff-1", role: Role.STAFF })).toBe(true);
    expect(canReadContactDetails(actor("collab-1", Role.COLLABORATOR), { id: "student-1", role: Role.STUDENT })).toBe(true);
    expect(canReadContactDetails(actor("collab-1", Role.COLLABORATOR), { id: "admin-1", role: Role.ADMIN })).toBe(false);
  });
});
