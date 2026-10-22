import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  allowedEmail: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  studentAvailabilityBlock: { groupBy: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { GET } from "@/app/api/users/onboarding-readiness/route";

const noParams = { params: Promise.resolve({}) };

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    name: "Student Person",
    role: "STUDENT",
    email: "student@wisc.edu",
    athleticsEmail: "student@athletics.wisc.edu",
    phone: "(608) 555-0100",
    personalPhone: "(608) 555-0100",
    workPhone: null,
    workPhoneNotApplicable: false,
    wiscardCardNumber: "1234567890",
    wiscardIssueCode: "1",
    studentYearOverride: "JUNIOR",
    gradYear: 2027,
    graduationTerm: "SPRING",
    topSizeFit: null,
    topSize: null,
    shoeSizeSystem: null,
    shoeSize: null,
    avatarUrl: null,
    profilePromptSnoozedUntil: null,
    createdAt: new Date("2026-10-19T12:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    id: "admin-1",
    name: "Admin",
    email: "admin@wisc.edu",
    role: "ADMIN",
    avatarUrl: null,
  });
  dbMock.allowedEmail.findMany.mockResolvedValue([]);
  dbMock.user.findMany.mockResolvedValue([account()]);
  dbMock.studentAvailabilityBlock.groupBy.mockResolvedValue([]);
});

describe("GET /api/users/onboarding-readiness", () => {
  it("adds account age and, for students only, whether they have said when they can't work", async () => {
    dbMock.user.findMany.mockResolvedValue([
      account(),
      account({ id: "user-2", name: "Has Classes" }),
      account({ id: "staff-1", name: "Staff Person", role: "STAFF" }),
    ]);
    dbMock.studentAvailabilityBlock.groupBy.mockResolvedValue([{ userId: "user-2", _count: { _all: 3 } }]);
    const body = await (await GET(new Request("https://app.example.com/api/users/onboarding-readiness"), noParams)).json();
    const byId = Object.fromEntries(body.data.accounts.map((a: { id: string }) => [a.id, a]));
    expect(byId["user-1"]).toEqual(expect.objectContaining({ hasUnavailableTimes: false, createdAt: "2026-10-19T12:00:00.000Z" }));
    expect(byId["user-2"].hasUnavailableTimes).toBe(true);
    expect(byId["staff-1"].hasUnavailableTimes).toBeNull();
  });

  it("returns derived readiness without exposing private profile values", async () => {
    const response = await GET(new Request("https://app.example.com/api/users/onboarding-readiness"), noParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.accounts[0]).toEqual(expect.objectContaining({
      id: "user-1",
      operationalReady: true,
      profileComplete: false,
      missingFields: ["clothingSize", "shoeSize", "photo"],
    }));
    expect(body.data.accounts[0]).not.toHaveProperty("personalPhone");
    expect(body.data.accounts[0]).not.toHaveProperty("wiscardCardNumber");
    expect(dbMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true, hiddenFromRoster: false },
    }));
  });

  it("treats collaborators as operationally ready without requiring a phone", async () => {
    dbMock.user.findMany.mockResolvedValue([account({
      id: "collab-1",
      name: "Guest",
      role: "COLLABORATOR",
      email: "guest@example.com",
      athleticsEmail: null,
      personalPhone: null,
      wiscardCardNumber: null,
      wiscardIssueCode: null,
      studentYearOverride: null,
      gradYear: null,
      graduationTerm: null,
    })]);

    const response = await GET(new Request("https://app.example.com/api/users/onboarding-readiness"), noParams);
    const body = await response.json();

    expect(body.data.accounts[0]).toEqual(expect.objectContaining({
      operationalReady: true,
      profileComplete: false,
      missingFields: ["photo"],
    }));
  });

  it("keeps an existing collaborator phone outside onboarding completion", async () => {
    dbMock.user.findMany.mockResolvedValue([account({
      id: "collab-2",
      name: "Guest",
      role: "COLLABORATOR",
      email: "guest2@example.com",
      athleticsEmail: null,
      personalPhone: "(608) 555-0199",
      wiscardCardNumber: null,
      wiscardIssueCode: null,
      studentYearOverride: null,
      gradYear: null,
      graduationTerm: null,
    })]);

    const response = await GET(new Request("https://app.example.com/api/users/onboarding-readiness"), noParams);
    const body = await response.json();

    expect(body.data.accounts[0]).toEqual(expect.objectContaining({
      operationalReady: true,
      profileComplete: false,
      missingFields: ["photo"],
    }));
  });
});
