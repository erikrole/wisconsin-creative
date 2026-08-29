import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/services/bulk-schedule-assignment", () => ({
  getBulkAssignmentPreview: vi.fn(),
  applyBulkScheduleAssignment: vi.fn(),
}));

import { POST as retiredAutoAssignRoute } from "@/app/api/shift-groups/[id]/auto-assign/route";
import { POST as bulkPreviewRoute } from "@/app/api/schedule/bulk-assignment/preview/route";
import { POST as bulkApplyRoute } from "@/app/api/schedule/bulk-assignment/apply/route";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { applyBulkScheduleAssignment, getBulkAssignmentPreview } from "@/lib/services/bulk-schedule-assignment";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: "STAFF" as const,
  staffingType: "FT" as const,
  avatarUrl: null,
  forcePasswordChange: false,
};

const studentUser = {
  ...staffUser,
  id: "student-1",
  role: "STUDENT" as const,
  staffingType: "ST" as const,
};

function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

function request(path: string, method: "GET" | "POST" = "GET", body?: unknown) {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: {
      host: "app.example.com",
      ...(method === "POST" ? { origin: "https://app.example.com" } : {}),
    },
    ...(body === undefined ? {} : {
      body: JSON.stringify(body),
      headers: {
        host: "app.example.com",
        origin: "https://app.example.com",
        "Content-Type": "application/json",
      },
    }),
  });
}

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const scope = {
  sportCodes: [],
  rangeStartsAt: "2026-10-01T00:00:00.000Z",
  rangeEndsAt: "2026-10-02T00:00:00.000Z",
  area: null,
  workerScope: "ALL" as const,
  requireFullCrew: false,
  period: "custom" as const,
};
const proposal = {
  proposalId: "group-1:shift-1:student-1",
  shiftGroupId: "group-1",
  shiftId: "shift-1",
  eventId: "event-1",
  userId: "student-1",
};

describe("retired Shift Detail auto-assign mutation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("BUG: rate-limits staff and never mutates through the legacy route", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);

    const res = await retiredAutoAssignRoute(
      request("/api/shift-groups/group-1/auto-assign", "POST"),
      params({ id: "group-1" }),
    );

    expect(res.status).toBe(410);
    expect(enforceRateLimit).toHaveBeenCalledWith(
      "shift:auto-assign:staff-1",
      { max: 10, windowMs: 60_000 },
    );
  });

  it("preserves the shift manage permission guard before the rate limit", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await retiredAutoAssignRoute(
      request("/api/shift-groups/group-1/auto-assign", "POST"),
      params({ id: "group-1" }),
    );

    expect(res.status).toBe(403);
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });
});

describe("canonical auto-assign authority", () => {
  it("BUG: removes the legacy direct-write service and Shift Detail fetches", () => {
    const panel = read("src/components/ShiftDetailPanel.tsx");
    const mutationRoute = read("src/app/api/shift-groups/[id]/auto-assign/route.ts");
    const previewRoute = read("src/app/api/shift-groups/[id]/auto-assign/preview/route.ts");

    expect(existsSync(resolve(root, "src/lib/services/auto-assign.ts"))).toBe(false);
    expect(panel).not.toContain("/api/shift-groups/${group.id}/auto-assign");
    expect(panel).toContain("Auto assign is managed on the Schedule page.");
    expect(mutationRoute).not.toContain("autoAssignShiftGroup");
    expect(previewRoute).not.toContain("getAutoFillPreview");
    expect(mutationRoute).toContain("new HttpError(410");
    expect(previewRoute).toContain("new HttpError(410");
  });

  it("keeps preview and apply on the rate-limited, audited working-copy boundary", () => {
    const previewRoute = read("src/app/api/schedule/bulk-assignment/preview/route.ts");
    const applyRoute = read("src/app/api/schedule/bulk-assignment/apply/route.ts");
    const service = read("src/lib/services/bulk-schedule-assignment.ts");

    for (const route of [previewRoute, applyRoute]) {
      expect(route).toContain("withAuth");
      expect(route).toContain('requirePermission(user.role, "shift", "manage")');
      expect(route).toContain("enforceRateLimit");
    }
    expect(service).toContain("preview.fingerprint");
    expect(service).toContain("matchingPreview.publishedVersion !== group.publishedVersion");
    expect(service).toContain("if (group.workingCopy) throw new HttpError(409");
    expect(service).toContain("Prisma.TransactionIsolationLevel.Serializable");
    expect(service).toContain("applyWorkingScheduleCommand");
    expect(service).toContain("workingVersion: 1");
    expect(service).toContain("createAuditEntriesTx");
    expect(service).toContain('action: "schedule_bulk_assignment_staged"');
    expect(service).toContain("enqueueRelease");
  });
});

describe("canonical bulk auto-assign routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("BUG: protects the preview route with shift.manage before rate limiting", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(getBulkAssignmentPreview).mockResolvedValue({} as Awaited<ReturnType<typeof getBulkAssignmentPreview>>);

    const res = await bulkPreviewRoute(
      request("/api/schedule/bulk-assignment/preview", "POST", scope),
      params({}),
    );

    expect(res.status).toBe(200);
    expect(enforceRateLimit).toHaveBeenCalledWith(
      "shift:bulk-assignment:preview:staff-1",
      { max: 20, windowMs: 60_000 },
    );
    expect(getBulkAssignmentPreview).toHaveBeenCalledWith(scope);
  });

  it("BUG: denies a student on the canonical preview route before rate limiting", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await bulkPreviewRoute(
      request("/api/schedule/bulk-assignment/preview", "POST", scope),
      params({}),
    );

    expect(res.status).toBe(403);
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(getBulkAssignmentPreview).not.toHaveBeenCalled();
  });

  it("BUG: rate-limits an authorized canonical apply before invoking the staging service", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(applyBulkScheduleAssignment).mockResolvedValue({
      batchId: "00000000-0000-0000-0000-000000000001",
      releaseAt: "2026-10-01T00:00:00.000Z",
      eventCount: 1,
      assignmentCount: 1,
    });

    const res = await bulkApplyRoute(
      request("/api/schedule/bulk-assignment/apply", "POST", {
        scope,
        fingerprint: "a".repeat(64),
        proposals: [proposal],
      }),
      params({}),
    );

    expect(res.status).toBe(200);
    expect(enforceRateLimit).toHaveBeenCalledWith(
      "shift:bulk-assignment:apply:staff-1",
      { max: 10, windowMs: 60_000 },
    );
    expect(applyBulkScheduleAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: "a".repeat(64), proposals: [proposal] }),
      staffUser,
      expect.any(Function),
    );
  });

  it("BUG: protects the apply route with shift.manage before rate limiting", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await bulkApplyRoute(
      request("/api/schedule/bulk-assignment/apply", "POST", {
        scope,
        fingerprint: "a".repeat(64),
        proposals: [proposal],
      }),
      params({}),
    );

    expect(res.status).toBe(403);
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(applyBulkScheduleAssignment).not.toHaveBeenCalled();
  });
});
