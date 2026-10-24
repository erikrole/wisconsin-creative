import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role, ShiftWorkerType, type User } from "@prisma/client";

const dbMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
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
import { db } from "@/lib/db";
import { GET as getUserById } from "@/app/api/users/[id]/route";

function actor(id: string, role: Role) {
  return { id, email: `${id}@example.com`, name: id, role, avatarUrl: null };
}

function getReq(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "student-2",
    name: "Other Student",
    email: "other@example.com",
    passwordHash: "hash",
    forcePasswordChange: false,
    onboardingRequired: false,
    onboardingCompletedAt: null,
    role: Role.STUDENT,
    affiliation: null,
    collaboratorProfile: null,
    collaboratorPolicyId: null,
    staffingType: ShiftWorkerType.ST,
    phone: "(608) 555-0100",
    personalPhone: "(608) 555-0100",
    workPhone: null,
    workPhoneNotApplicable: false,
    slackHandle: null,
    slackProfileUrl: null,
    primaryArea: null,
    locationId: null,
    avatarUrl: null,
    active: true,
    hiddenFromRoster: false,
    title: null,
    gradYear: null,
    graduationTerm: null,
    studentYearOverride: null,
    lastActiveAt: null,
    createdAt: new Date("2026-06-24T12:00:00.000Z"),
    updatedAt: new Date("2026-06-24T12:00:00.000Z"),
    notificationPrefs: null,
    sidebarPrefs: null,
    gettingStarted: null,
    athleticsEmail: null,
    startDate: null,
    directReportId: null,
    directReportName: null,
    topSize: null,
    bottomSize: null,
    shoeSize: null,
    wiscardNumber: "9081234567",
    wiscardCardNumber: "6012345678901234",
    wiscardIssueCode: "03",
    profilePromptSnoozedUntil: null,
    topSizeFit: null,
    shoeSizeSystem: null,
    birthdayMonth: null,
    birthdayDay: null,
    birthYear: 2004,
    startTerm: null,
    startTermYear: null,
    deactivatedAt: null,
    icsToken: null,
    ...overrides,
  } as User;
}

async function readDetail(viewer: ReturnType<typeof actor>, targetId = "student-2") {
  vi.mocked(requireAuth).mockResolvedValue(viewer);
  const res = await getUserById(getReq(`/api/users/${targetId}`), { params: Promise.resolve({ id: targetId }) });
  expect(res.status).toBe(200);
  return (await res.json()).data as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.user.findUnique).mockResolvedValue({
    ...makeUser(),
    location: null,
    sportAssignments: [],
    areaAssignments: [],
    directReport: null,
    collaboratorPolicy: null,
  } as unknown as Awaited<ReturnType<typeof db.user.findUnique>>);
});

describe("user detail Wiscard visibility", () => {
  it("withholds another person's Wiscard identifiers from a student", async () => {
    const data = await readDetail(actor("student-1", Role.STUDENT));

    expect(data).not.toHaveProperty("wiscardNumber");
    expect(data).not.toHaveProperty("wiscardCardNumber");
    expect(data).not.toHaveProperty("wiscardIssueCode");
    expect(data).not.toHaveProperty("birthYear");
    // Directory contact details stay shared with the team.
    expect(data.phone).toBe("(608) 555-0100");
    expect(data.name).toBe("Other Student");
  });

  it("returns the identifiers to the person themselves", async () => {
    const data = await readDetail(actor("student-2", Role.STUDENT));

    expect(data.wiscardNumber).toBe("9081234567");
    expect(data.wiscardCardNumber).toBe("6012345678901234");
    expect(data.wiscardIssueCode).toBe("03");
  });

  it("returns the identifiers to staff and admins who manage profiles", async () => {
    for (const role of [Role.STAFF, Role.ADMIN]) {
      const data = await readDetail(actor(`${role.toLowerCase()}-1`, role));
      expect(data.wiscardCardNumber).toBe("6012345678901234");
      expect(data.wiscardIssueCode).toBe("03");
    }
  });
});
