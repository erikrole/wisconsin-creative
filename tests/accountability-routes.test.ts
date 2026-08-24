import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/services/accountability", () => ({
  getCurrentAcademicYearStart: vi.fn(() => 2026),
  getAccountabilityReport: vi.fn(),
  excludeBookingFromAccountability: vi.fn(),
  restoreBookingToAccountability: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  REPORT_EXPORT_LIMIT: { max: 10, windowMs: 60_000 },
  SETTINGS_MUTATION_LIMIT: { max: 10, windowMs: 60_000 },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import {
  excludeBookingFromAccountability,
  getAccountabilityReport,
  restoreBookingToAccountability,
} from "@/lib/services/accountability";
import { GET } from "@/app/api/accountability/route";
import { POST } from "@/app/api/accountability/exclusions/route";
import { DELETE } from "@/app/api/accountability/exclusions/[bookingId]/route";

const admin = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  role: Role.ADMIN,
  avatarUrl: null,
};
const staff = { ...admin, id: "staff-1", role: Role.STAFF };
const student = { ...admin, id: "student-1", role: Role.STUDENT };
const collaborator = { ...admin, id: "collaborator-1", role: Role.COLLABORATOR };
const noParams = { params: Promise.resolve({}) };
const leaderboard = [
  {
    userId: "user-1",
    active: true,
    lateEventCount: 4,
    activeOverdueCount: 0,
    lastIncidentAt: "2026-08-20T12:00:00.000Z",
  },
  {
    userId: "user-2",
    active: true,
    lateEventCount: 3,
    activeOverdueCount: 1,
    lastIncidentAt: "2026-08-19T12:00:00.000Z",
  },
  {
    userId: "user-3",
    active: false,
    lateEventCount: 2,
    activeOverdueCount: 0,
    lastIncidentAt: "2026-08-18T12:00:00.000Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(admin);
  vi.mocked(getAccountabilityReport).mockResolvedValue({
    academicYear: { startYear: 2026, label: "2026-27" },
    methodology: {},
    metrics: {
      peopleNeedingAttention: 1,
      lateEvents: 2,
      activeOverdue: 1,
      totalLateHours: 8,
      excludedRecords: 1,
    },
    locations: [],
    leaderboard,
    excluded: [{ bookingId: "excluded-1", note: "Bad import" }],
  } as never);
});

describe("accountability routes", () => {
  it("serves the full admin report with normalized filters and cleanup capabilities", async () => {
    const response = await GET(
      new Request("https://app.example.com/api/accountability?year=2025&state=resolved&users=inactive"),
      noParams,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.capabilities).toEqual({ canExport: true, canManageExclusions: true });
    expect(body.metrics.excludedRecords).toBe(1);
    expect(body.excluded).toEqual([{ bookingId: "excluded-1", note: "Bad import" }]);
    expect(body.spotlightJeers).toHaveLength(3);
    expect(getAccountabilityReport).toHaveBeenCalledWith({
      startYear: 2025,
      locationId: undefined,
      incidentState: "resolved",
      userState: "inactive",
      sort: "events",
    });
  });

  it("accepts the late-time ranking and rejects an unknown sort", async () => {
    const response = await GET(
      new Request("https://app.example.com/api/accountability?sort=time"),
      noParams,
    );
    expect(response.status).toBe(200);
    expect(getAccountabilityReport).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "time" }),
    );

    const rejected = await GET(
      new Request("https://app.example.com/api/accountability?sort=alphabetical"),
      noParams,
    );
    expect(rejected.status).toBe(400);
  });

  it("accepts the overdue-extension incident filter", async () => {
    const response = await GET(
      new Request("https://app.example.com/api/accountability?state=extended"),
      noParams,
    );
    expect(response.status).toBe(200);
    expect(getAccountabilityReport).toHaveBeenCalledWith(
      expect.objectContaining({ incidentState: "extended" }),
    );
  });

  it.each([
    ["STAFF", staff],
    ["STUDENT", student],
  ])("serves a read-only leaderboard to %s without admin cleanup metadata", async (_label, actor) => {
    vi.mocked(requireAuth).mockResolvedValue(actor);
    const response = await GET(new Request("https://app.example.com/api/accountability"), noParams);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.capabilities).toEqual({ canExport: false, canManageExclusions: false });
    expect(body.metrics).toEqual({
      peopleNeedingAttention: 1,
      lateEvents: 2,
      activeOverdue: 1,
      totalLateHours: 8,
    });
    expect(body).not.toHaveProperty("excluded");
  });

  it("serves the same unique jeer set to every internal role", async () => {
    const sets: string[][] = [];

    for (const actor of [admin, staff, student]) {
      vi.mocked(requireAuth).mockResolvedValue(actor);
      const response = await GET(
        new Request("https://app.example.com/api/accountability"),
        noParams,
      );
      sets.push((await response.json()).spotlightJeers);
    }

    expect(sets[0]).toHaveLength(3);
    expect(new Set(sets[0]).size).toBe(3);
    expect(sets[1]).toEqual(sets[0]);
    expect(sets[2]).toEqual(sets[0]);
  });

  it("keeps external collaborators outside the internal leaderboard", async () => {
    vi.mocked(requireAuth).mockResolvedValue(collaborator);
    const response = await GET(new Request("https://app.example.com/api/accountability"), noParams);

    expect(response.status).toBe(403);
    expect(getAccountabilityReport).not.toHaveBeenCalled();
  });

  it("keeps CSV export admin-only and rejects it before report work", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staff);
    const response = await GET(
      new Request("https://app.example.com/api/accountability?format=csv"),
      noParams,
    );

    expect(response.status).toBe(403);
    expect(getAccountabilityReport).not.toHaveBeenCalled();
  });

  it("creates and restores exclusions with ADMIN identity", async () => {
    vi.mocked(excludeBookingFromAccountability).mockResolvedValue({ id: "ex-1" } as never);
    const postResponse = await POST(
      new Request("https://app.example.com/api/accountability/exclusions", {
        method: "POST",
        headers: {
          origin: "https://app.example.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ bookingId: "booking-1", reason: "TEST_DATA" }),
      }),
      noParams,
    );
    expect(postResponse.status).toBe(201);
    expect(excludeBookingFromAccountability).toHaveBeenCalledWith({
      bookingId: "booking-1",
      reason: "TEST_DATA",
      actorId: "admin-1",
      actorRole: Role.ADMIN,
    });

    vi.mocked(restoreBookingToAccountability).mockResolvedValue({ id: "ex-1" } as never);
    const deleteResponse = await DELETE(
      new Request("https://app.example.com/api/accountability/exclusions/booking-1", {
        method: "DELETE",
        headers: { origin: "https://app.example.com" },
      }),
      { params: Promise.resolve({ bookingId: "booking-1" }) },
    );
    expect(deleteResponse.status).toBe(200);
    expect(restoreBookingToAccountability).toHaveBeenCalledWith({
      bookingId: "booking-1",
      actorId: "admin-1",
      actorRole: Role.ADMIN,
    });
  });

  it("requires an explanation for Other", async () => {
    const response = await POST(
      new Request("https://app.example.com/api/accountability/exclusions", {
        method: "POST",
        headers: {
          origin: "https://app.example.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ bookingId: "booking-1", reason: "OTHER" }),
      }),
      noParams,
    );
    expect(response.status).toBe(400);
    expect(excludeBookingFromAccountability).not.toHaveBeenCalled();
  });

  it("keeps exclusion mutations admin-only after read access broadens", async () => {
    vi.mocked(requireAuth).mockResolvedValue(student);
    const response = await POST(
      new Request("https://app.example.com/api/accountability/exclusions", {
        method: "POST",
        headers: {
          origin: "https://app.example.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ bookingId: "booking-1", reason: "TEST_DATA" }),
      }),
      noParams,
    );

    expect(response.status).toBe(403);
    expect(excludeBookingFromAccountability).not.toHaveBeenCalled();
  });
});
