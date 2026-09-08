import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET as getUsers } from "@/app/api/users/route";
import { GET as getUser } from "@/app/api/users/[id]/route";

const collaborator = {
  id: "collab-1",
  email: "trey@example.com",
  name: "Trey",
  role: Role.COLLABORATOR,
  affiliation: "BIG_TEN_NETWORK" as const,
  collaboratorProfile: "BTN_STANDARD" as const,
  avatarUrl: null,
  capabilities: ["PEOPLE_DIRECTORY_VIEW" as const],
};

const publicUser = {
  id: "user-1",
  name: "Taylor Teammate",
  email: "private@example.com",
  role: Role.STAFF,
  affiliation: "INTERNAL",
  collaboratorProfile: null,
  collaboratorPolicy: null,
  staffingType: "FT",
  phone: "6085551212",
  slackHandle: "private",
  slackProfileUrl: "https://example.com/private",
  primaryArea: "VIDEO",
  locationId: "location-1",
  location: { name: "Kellner Hall" },
  avatarUrl: "/avatar.jpg",
  active: true,
  hiddenFromRoster: false,
  sportAssignments: [{ sportCode: "FB", defaultTraveler: true }],
  title: "Producer",
  gradYear: null,
  studentYearOverride: null,
  lastActiveAt: new Date("2026-07-23T15:00:00.000Z"),
};

function request(path: string) {
  return new Request(`https://app.example.com${path}`, {
    headers: { host: "app.example.com" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(collaborator);
});

describe("collaborator People directory", () => {
  it("requires the explicit directory capability", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...collaborator, capabilities: [] });

    const response = await getUsers(request("/api/users"), { params: Promise.resolve({}) });

    expect(response.status).toBe(403);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("lists only work-safe fields and prevents email search inference", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([publicUser] as never);
    vi.mocked(db.user.count).mockResolvedValue(1);
    vi.mocked(db.user.groupBy).mockResolvedValue([{ role: Role.STAFF, _count: { _all: 1 } }] as never);

    const response = await getUsers(request("/api/users?q=Taylor&active=all&sort=email"), {
      params: Promise.resolve({}),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          { active: true, hiddenFromRoster: false },
          { OR: [{ name: { contains: "Taylor", mode: "insensitive" } }] },
        ]),
      }),
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }));
    expect(body.data[0]).toMatchObject({
      id: "user-1",
      name: "Taylor Teammate",
      email: "",
      phone: null,
      slackHandle: null,
      title: "Producer",
      primaryArea: "VIDEO",
      location: "Kellner Hall",
      sportAssignments: [],
      lastActiveAt: null,
    });
    expect(body.data[0]).not.toHaveProperty("personalPhone");
    expect(body.data[0]).not.toHaveProperty("wiscardNumber");
  });

  it("returns a minimized active profile and never queries hidden or inactive users", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue({
      id: publicUser.id,
      name: publicUser.name,
      role: publicUser.role,
      affiliation: publicUser.affiliation,
      collaboratorProfile: null,
      collaboratorPolicy: null,
      staffingType: publicUser.staffingType,
      title: publicUser.title,
      primaryArea: publicUser.primaryArea,
      locationId: publicUser.locationId,
      location: publicUser.location,
      avatarUrl: publicUser.avatarUrl,
      active: true,
      gradYear: null,
      studentYearOverride: null,
    } as never);

    const response = await getUser(request("/api/users/user-1"), {
      params: Promise.resolve({ id: "user-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(db.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user-1", active: true, hiddenFromRoster: false },
    }));
    expect(body.data).toMatchObject({
      name: "Taylor Teammate",
      email: "",
      phone: null,
      personalPhone: null,
      workPhone: null,
      wiscardNumber: null,
      slackHandle: null,
      createdAt: null,
      title: "Producer",
      primaryArea: "VIDEO",
      location: "Kellner Hall",
      sportAssignments: [],
      areaAssignments: [],
    });
  });
});
