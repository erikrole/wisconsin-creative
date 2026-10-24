import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, CUID_A, jsonRequest, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  checkRateLimit: vi.fn(),
  claimCode: vi.fn(),
  releaseCode: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/services/licenses", () => ({ claimCode: mocks.claimCode, releaseCode: mocks.releaseCode }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));

import { POST as claim } from "@/app/api/licenses/[id]/claim/route";
import { POST as release } from "@/app/api/licenses/[id]/release/route";

const student = authUser(Role.STUDENT);
const ctx = routeCtx({ id: CUID_A });

beforeEach(() => {
  mocks.requireAuth.mockResolvedValue(student);
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  mocks.claimCode.mockResolvedValue({ id: CUID_A, code: "ADOBE-1234", status: "CLAIMED" });
  mocks.releaseCode.mockResolvedValue({ id: CUID_A, status: "AVAILABLE" });
});

describe("POST /api/licenses/[id]/claim", () => {
  it("claims for the signed-in person, returns only id and code, and audits the claim", async () => {
    const res = await claim(jsonRequest(`/api/licenses/${CUID_A}/claim`, "POST"), ctx);

    expect(res.status).toBe(200);
    expect(mocks.claimCode).toHaveBeenCalledWith(CUID_A, student.id);
    expect((await res.json()).data).toEqual({ id: CUID_A, code: "ADOBE-1234" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "license_code", action: "claim", actorId: student.id }));
  });

  it("returns 429 without claiming once the per-person limit is spent", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false });
    const res = await claim(jsonRequest(`/api/licenses/${CUID_A}/claim`, "POST"), ctx);
    expect(res.status).toBe(429);
    expect(mocks.claimCode).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`license:claim:${student.id}`, expect.anything());
  });
});

describe("POST /api/licenses/[id]/release", () => {
  it("releases only the student's own claim when the body is empty", async () => {
    const res = await release(jsonRequest(`/api/licenses/${CUID_A}/release`, "POST"), ctx);
    expect(res.status).toBe(200);
    expect(mocks.releaseCode).toHaveBeenCalledWith(CUID_A, student.id, false, { claimId: undefined, releaseAll: false }, Role.STUDENT);
  });

  it("passes staff authority and a release-all request through", async () => {
    const staff = authUser(Role.STAFF);
    mocks.requireAuth.mockResolvedValue(staff);
    await release(jsonRequest(`/api/licenses/${CUID_A}/release`, "POST", { all: true }), ctx);
    expect(mocks.releaseCode).toHaveBeenCalledWith(CUID_A, staff.id, true, { claimId: undefined, releaseAll: true }, Role.STAFF);
  });

  it("treats a student's release-all as a request the service still scopes, never as admin", async () => {
    await release(jsonRequest(`/api/licenses/${CUID_A}/release`, "POST", { all: true }), ctx);
    expect(mocks.releaseCode).toHaveBeenCalledWith(CUID_A, student.id, false, expect.anything(), Role.STUDENT);
  });
});
