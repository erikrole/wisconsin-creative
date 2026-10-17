import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/lib/services/schedule-exports", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/schedule-exports")>("@/lib/services/schedule-exports");
  return {
    ...actual,
    buildScheduleExport: vi.fn(),
  };
});

import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { buildScheduleExport } from "@/lib/services/schedule-exports";
import { GET } from "@/app/api/schedule/export/route";

function req(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

describe("schedule export route", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({
      id: "staff-1",
      name: "Staff",
      email: "staff@example.com",
      role: Role.STAFF,
      avatarUrl: null,
    });
    vi.mocked(enforceRateLimit).mockResolvedValue(undefined);
    vi.mocked(buildScheduleExport).mockResolvedValue({
      csv: "A,B\n1,2\n",
      filename: "schedule-roster.csv",
      exportedCount: 1,
      total: 1,
      truncated: false,
      limit: 5000,
    });
  });

  it("returns CSV with report permission, rate limit, and export count headers", async () => {
    const res = await GET(req("/api/schedule/export?type=roster&startDate=2026-07-01T00:00:00Z&endDate=2026-07-08T00:00:00Z"), { params: Promise.resolve({}) });
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toBe("A,B\n1,2\n");
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("schedule-roster.csv");
    expect(res.headers.get("x-exported-count")).toBe("1");
    expect(enforceRateLimit).toHaveBeenCalledWith("schedule:export:staff-1", { max: 10, windowMs: 60_000 });
    expect(buildScheduleExport).toHaveBeenCalledWith(expect.objectContaining({
      type: "roster",
      sportCode: null,
      includeArchived: false,
    }));
  });

  it("normalizes sportCode query filters before building the export", async () => {
    const res = await GET(req("/api/schedule/export?type=roster&sportCode=vb"), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(buildScheduleExport).toHaveBeenCalledWith(expect.objectContaining({
      sportCode: "VB",
    }));
  });

  it("rejects unknown sportCode query filters before building the export", async () => {
    const res = await GET(req("/api/schedule/export?type=roster&sportCode=football"), { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    expect(buildScheduleExport).not.toHaveBeenCalled();
  });

  it("keeps an evening event on the last Chicago day inside the default window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T18:00:00.000Z"));

    const res = await GET(req("/api/schedule/export?type=roster"), { params: Promise.resolve({}) });
    const eveningOnLastDay = new Date("2026-10-25T01:00:00.000Z");
    const nextChicagoMidnight = new Date("2026-10-25T05:00:00.000Z");
    const call = vi.mocked(buildScheduleExport).mock.calls[0]?.[0];

    expect(res.status).toBe(200);
    expect(call?.parsedStartDate).toEqual(new Date("2026-10-17T05:00:00.000Z"));
    expect(call?.parsedEndDate).toEqual(new Date(nextChicagoMidnight.getTime() - 1));
    expect(eveningOnLastDay.getTime()).toBeLessThanOrEqual(call!.parsedEndDate.getTime());
  });

  it("denies students before building an export", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      id: "student-1",
      name: "Student",
      email: "student@example.com",
      role: Role.STUDENT,
      avatarUrl: null,
    });

    const res = await GET(req("/api/schedule/export?type=roster"), { params: Promise.resolve({}) });

    expect(res.status).toBe(403);
    expect(buildScheduleExport).not.toHaveBeenCalled();
  });
});
