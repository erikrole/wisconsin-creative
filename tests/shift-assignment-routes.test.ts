import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, CUID_A, CUID_B, jsonRequest, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  enforceRateLimit: vi.fn(),
  initiateSwap: vi.fn(),
  audit: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.enforceRateLimit, SCHEDULE_MUTATION_LIMIT: { max: 30, windowMs: 60_000 } }));
vi.mock("@/lib/services/shift-assignments", () => ({ initiateSwap: mocks.initiateSwap }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/db", () => ({ db: { shiftAssignment: { findUnique: mocks.findUnique, update: mocks.update } } }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));

import { POST as swap } from "@/app/api/shift-assignments/[id]/swap/route";
import { PATCH as attendance } from "@/app/api/shift-assignments/[id]/attendance/route";

const staff = authUser(Role.STAFF);

beforeEach(() => {
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.initiateSwap.mockResolvedValue({ id: "assignment-new", shiftId: "shift-1" });
  mocks.findUnique.mockResolvedValue({ id: CUID_A, attended: null });
  mocks.update.mockImplementation(async ({ data }) => ({ id: CUID_A, attended: data.attended }));
});

describe("POST /api/shift-assignments/[id]/swap", () => {
  it("hands the shift to the target person and audits who it moved from", async () => {
    const res = await swap(jsonRequest(`/api/shift-assignments/${CUID_A}/swap`, "POST", { targetUserId: CUID_B }), routeCtx({ id: CUID_A }));

    expect(res.status).toBe(201);
    expect(mocks.initiateSwap).toHaveBeenCalledWith(CUID_A, CUID_B, staff.id);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "shift_swapped",
      entityId: "assignment-new",
      before: { fromAssignmentId: CUID_A },
      after: { userId: CUID_B, shiftId: "shift-1" },
    }));
  });

  it("forbids students and rejects a malformed target", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STUDENT));
    const denied = await swap(jsonRequest(`/api/shift-assignments/${CUID_A}/swap`, "POST", { targetUserId: CUID_B }), routeCtx({ id: CUID_A }));
    expect(denied.status).toBe(403);

    mocks.requireAuth.mockResolvedValue(staff);
    const bad = await swap(jsonRequest(`/api/shift-assignments/${CUID_A}/swap`, "POST", { targetUserId: "nobody" }), routeCtx({ id: CUID_A }));
    expect(bad.status).toBe(400);
    expect(mocks.initiateSwap).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/shift-assignments/[id]/attendance", () => {
  it("records attended, missed and cleared with the previous value audited", async () => {
    for (const value of [true, false, null]) {
      const res = await attendance(jsonRequest(`/api/shift-assignments/${CUID_A}/attendance`, "PATCH", { attended: value }), routeCtx({ id: CUID_A }));
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ id: CUID_A, attended: value });
    }
    expect(mocks.audit).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "attendance_updated",
      before: { attended: null },
      after: { attended: null },
    }));
  });

  it("returns 404 for an unknown assignment without writing", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const res = await attendance(jsonRequest(`/api/shift-assignments/${CUID_A}/attendance`, "PATCH", { attended: true }), routeCtx({ id: CUID_A }));
    expect(res.status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("forbids students and rejects a non-boolean", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STUDENT));
    expect((await attendance(jsonRequest(`/api/shift-assignments/${CUID_A}/attendance`, "PATCH", { attended: true }), routeCtx({ id: CUID_A }))).status).toBe(403);

    mocks.requireAuth.mockResolvedValue(staff);
    expect((await attendance(jsonRequest(`/api/shift-assignments/${CUID_A}/attendance`, "PATCH", { attended: "yes" }), routeCtx({ id: CUID_A }))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
