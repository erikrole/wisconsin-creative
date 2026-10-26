import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, CUID_A, CUID_B, jsonRequest, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  checkRateLimit: vi.fn(),
  audit: vi.fn(),
  retireCode: vi.fn(),
  updateCodeDetails: vi.fn(),
  deleteCode: vi.fn(),
  assignCodeToUser: vi.fn(),
  addUnknownOccupant: vi.fn(),
  reportBrokenCode: vi.fn(),
  bulkCreateCodes: vi.fn(),
  bulkRenewCodes: vi.fn(),
  getActiveClaimForUser: vi.fn(),
  getClaimHistoryForUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));
vi.mock("@/lib/services/licenses", () => ({
  retireCode: mocks.retireCode,
  updateCodeDetails: mocks.updateCodeDetails,
  deleteCode: mocks.deleteCode,
  assignCodeToUser: mocks.assignCodeToUser,
  addUnknownOccupant: mocks.addUnknownOccupant,
  reportBrokenCode: mocks.reportBrokenCode,
  bulkCreateCodes: mocks.bulkCreateCodes,
  bulkRenewCodes: mocks.bulkRenewCodes,
  getActiveClaimForUser: mocks.getActiveClaimForUser,
  getClaimHistoryForUser: mocks.getClaimHistoryForUser,
}));

import { DELETE as deleteLicense, PATCH as patchLicense } from "@/app/api/licenses/[id]/route";
import { POST as occupy } from "@/app/api/licenses/[id]/occupy/route";
import { POST as reportBroken } from "@/app/api/licenses/[id]/report-broken/route";
import { PATCH as bulkRenew, POST as bulkCreate } from "@/app/api/licenses/bulk/route";
import { GET as myLicense } from "@/app/api/licenses/my/route";
import { GET as myHistory } from "@/app/api/licenses/my/history/route";

const staff = authUser(Role.STAFF);
const student = authUser(Role.STUDENT);
const ctx = routeCtx({ id: CUID_A });
const path = `/api/licenses/${CUID_A}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
});

describe("PATCH and DELETE /api/licenses/[id]", () => {
  it("keeps students out", async () => {
    mocks.requireAuth.mockResolvedValue(student);

    expect((await patchLicense(jsonRequest(path, "PATCH", { label: "x" }), ctx)).status).toBe(403);
    expect((await deleteLicense(jsonRequest(path, "DELETE"), ctx)).status).toBe(403);
    expect(mocks.updateCodeDetails).not.toHaveBeenCalled();
    expect(mocks.deleteCode).not.toHaveBeenCalled();
  });

  it("retires a code instead of editing it", async () => {
    mocks.retireCode.mockResolvedValue({ id: CUID_A, status: "RETIRED" });

    const res = await patchLicense(jsonRequest(path, "PATCH", { retire: true, label: "ignored" }), ctx);

    expect(res.status).toBe(200);
    expect(mocks.updateCodeDetails).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "retire", entityId: CUID_A, after: { status: "RETIRED" } }));
  });

  it("edits details, turning a date into a Date and keeping null as a clear", async () => {
    mocks.updateCodeDetails.mockResolvedValue({ id: CUID_A, label: "Seat 1", accountEmail: null, expiresAt: null });

    await patchLicense(jsonRequest(path, "PATCH", { label: "Seat 1", expiresAt: "2027-06-30T05:00:00.000Z" }), ctx);
    expect(mocks.updateCodeDetails).toHaveBeenLastCalledWith(CUID_A, { label: "Seat 1", accountEmail: undefined, expiresAt: new Date("2027-06-30T05:00:00.000Z") });

    await patchLicense(jsonRequest(path, "PATCH", { accountEmail: null, expiresAt: null }), ctx);
    expect(mocks.updateCodeDetails).toHaveBeenLastCalledWith(CUID_A, { label: undefined, accountEmail: null, expiresAt: null });

    await patchLicense(jsonRequest(path, "PATCH", {}), ctx);
    expect(mocks.updateCodeDetails).toHaveBeenLastCalledWith(CUID_A, { label: undefined, accountEmail: undefined, expiresAt: undefined });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "update", after: { label: "Seat 1", accountEmail: null, expiresAt: null } }));
  });

  it("rejects a bad email or a long label", async () => {
    expect((await patchLicense(jsonRequest(path, "PATCH", { accountEmail: "nope" }), ctx)).status).toBe(400);
    expect((await patchLicense(jsonRequest(path, "PATCH", { label: "x".repeat(201) }), ctx)).status).toBe(400);
    expect(mocks.updateCodeDetails).not.toHaveBeenCalled();
  });

  it("deletes and audits", async () => {
    const res = await deleteLicense(jsonRequest(path, "DELETE"), ctx);

    expect(res.status).toBe(200);
    expect(mocks.deleteCode).toHaveBeenCalledWith(CUID_A);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", entityId: CUID_A }));
  });
});

describe("POST /api/licenses/[id]/occupy", () => {
  it("assigns a known person", async () => {
    mocks.assignCodeToUser.mockResolvedValue({ code: { id: CUID_A, status: "CLAIMED" }, assignee: { id: CUID_B } });

    const res = await occupy(jsonRequest(`${path}/occupy`, "POST", { userId: CUID_B }), ctx);

    expect(res.status).toBe(201);
    expect(mocks.assignCodeToUser).toHaveBeenCalledWith(CUID_A, CUID_B);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "occupy", after: { assignedUserId: CUID_B, occupantLabel: null, status: "CLAIMED" } }));
  });

  it("records an outside occupant by name", async () => {
    mocks.addUnknownOccupant.mockResolvedValue({ id: CUID_A, status: "CLAIMED" });

    await occupy(jsonRequest(`${path}/occupy`, "POST", { label: "BTN producer" }), ctx);

    expect(mocks.addUnknownOccupant).toHaveBeenCalledWith(CUID_A, "BTN producer");
    expect(mocks.assignCodeToUser).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ after: { assignedUserId: null, occupantLabel: "BTN producer", status: "CLAIMED" } }));
  });

  it("refuses both a person and a name, and stops at the rate limit", async () => {
    expect((await occupy(jsonRequest(`${path}/occupy`, "POST", { userId: CUID_B, label: "x" }), ctx)).status).toBe(400);

    mocks.checkRateLimit.mockResolvedValue({ allowed: false });
    expect((await occupy(jsonRequest(`${path}/occupy`, "POST", { userId: CUID_B }), ctx)).status).toBe(429);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`license:occupy:${staff.id}`, expect.anything());
    expect(mocks.assignCodeToUser).not.toHaveBeenCalled();
  });
});

describe("POST /api/licenses/[id]/report-broken", () => {
  it("lets a student swap a broken code for a replacement", async () => {
    mocks.requireAuth.mockResolvedValue(student);
    mocks.reportBrokenCode.mockResolvedValue({ replacement: { id: CUID_B, code: "NEW" }, retired: { id: CUID_A } });

    const res = await reportBroken(jsonRequest(`${path}/report-broken`, "POST"), ctx);

    expect(res.status).toBe(200);
    expect(mocks.reportBrokenCode).toHaveBeenCalledWith(CUID_A, student.id, Role.STUDENT);
    expect((await res.json()).data).toEqual({ replacement: { id: CUID_B, code: "NEW" } });
  });

  it("stops at the rate limit", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false });

    expect((await reportBroken(jsonRequest(`${path}/report-broken`, "POST"), ctx)).status).toBe(429);
    expect(mocks.reportBrokenCode).not.toHaveBeenCalled();
  });
});

describe("/api/licenses/bulk", () => {
  it("imports pasted codes with optional email and expiry", async () => {
    mocks.bulkCreateCodes.mockResolvedValue({ created: 2, skipped: 1 });

    const res = await bulkCreate(jsonRequest("/api/licenses/bulk", "POST", { codes: "A\nB\nA", expiresAt: "2027-06-30T05:00:00.000Z" }), routeCtx({}));

    expect(res.status).toBe(201);
    expect(mocks.bulkCreateCodes).toHaveBeenCalledWith("A\nB\nA", staff.id, { accountEmail: undefined, expiresAt: new Date("2027-06-30T05:00:00.000Z") });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "bulk_create", entityId: "bulk", after: { created: 2, skipped: 1 } }));

    await bulkCreate(jsonRequest("/api/licenses/bulk", "POST", { codes: "C" }), routeCtx({}));
    expect(mocks.bulkCreateCodes).toHaveBeenLastCalledWith("C", staff.id, { accountEmail: undefined, expiresAt: undefined });
  });

  it("renews selected codes and audits the new date", async () => {
    mocks.bulkRenewCodes.mockResolvedValue({ renewed: 2 });

    const res = await bulkRenew(jsonRequest("/api/licenses/bulk", "PATCH", { action: "renew", ids: [CUID_A, CUID_B], expiresAt: "2027-06-30T05:00:00.000Z" }), routeCtx({}));

    expect(res.status).toBe(200);
    expect(mocks.bulkRenewCodes).toHaveBeenCalledWith([CUID_A, CUID_B], new Date("2027-06-30T05:00:00.000Z"));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "bulk_renew", after: { renewed: 2, expiresAt: "2027-06-30T05:00:00.000Z" } }));
  });

  it("refuses empty input, too many ids, and rate-limited callers", async () => {
    expect((await bulkCreate(jsonRequest("/api/licenses/bulk", "POST", { codes: "" }), routeCtx({}))).status).toBe(400);
    const ids = Array.from({ length: 201 }, (_, index) => `id-${index}`);
    expect((await bulkRenew(jsonRequest("/api/licenses/bulk", "PATCH", { action: "renew", ids, expiresAt: "2027-06-30T05:00:00.000Z" }), routeCtx({}))).status).toBe(400);

    mocks.checkRateLimit.mockResolvedValue({ allowed: false });
    expect((await bulkCreate(jsonRequest("/api/licenses/bulk", "POST", { codes: "A" }), routeCtx({}))).status).toBe(429);
    expect((await bulkRenew(jsonRequest("/api/licenses/bulk", "PATCH", { action: "renew", ids: [CUID_A], expiresAt: "2027-06-30T05:00:00.000Z" }), routeCtx({}))).status).toBe(429);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`license:bulk:${staff.id}`, expect.anything());
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`license:bulk-renew:${staff.id}`, expect.anything());
    expect(mocks.bulkCreateCodes).not.toHaveBeenCalled();
    expect(mocks.bulkRenewCodes).not.toHaveBeenCalled();
  });

  it("keeps students out", async () => {
    mocks.requireAuth.mockResolvedValue(student);

    expect((await bulkCreate(jsonRequest("/api/licenses/bulk", "POST", { codes: "A" }), routeCtx({}))).status).toBe(403);
  });
});

describe("a person's own license", () => {
  it("returns the active claim", async () => {
    mocks.requireAuth.mockResolvedValue(student);
    mocks.getActiveClaimForUser.mockResolvedValue({ id: "claim-1" });

    const res = await myLicense(new Request("https://app.example.com/api/licenses/my"), routeCtx({}));

    expect(mocks.getActiveClaimForUser).toHaveBeenCalledWith(student.id);
    expect((await res.json()).data).toEqual({ id: "claim-1" });
  });

  it("caps history at 100 rows", async () => {
    mocks.requireAuth.mockResolvedValue(student);
    mocks.getClaimHistoryForUser.mockResolvedValue([]);

    const res = await myHistory(new Request("https://app.example.com/api/licenses/my/history?limit=500"), routeCtx({}));

    expect(mocks.getClaimHistoryForUser).toHaveBeenCalledWith(student.id, 100);
    expect((await res.json()).limit).toBe(100);

    await myHistory(new Request("https://app.example.com/api/licenses/my/history?limit=10"), routeCtx({}));
    expect(mocks.getClaimHistoryForUser).toHaveBeenLastCalledWith(student.id, 10);
  });
});
