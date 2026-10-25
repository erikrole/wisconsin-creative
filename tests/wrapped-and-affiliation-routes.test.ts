import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, jsonRequest, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  enforceRateLimit: vi.fn(),
  getRecap: vi.fn(),
  resetRecap: vi.fn(),
  getPolicy: vi.fn(),
  updatePolicy: vi.fn(),
  archive: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  enforceRateLimit: mocks.enforceRateLimit,
}));
vi.mock("@/lib/services/wrapped", () => ({ getWrappedRecap: mocks.getRecap, resetWrappedRecap: mocks.resetRecap }));
vi.mock("@/lib/services/collaborator-policies", () => ({
  getCollaboratorPolicy: mocks.getPolicy,
  updateCollaboratorPolicy: mocks.updatePolicy,
  archiveCollaboratorAffiliation: mocks.archive,
}));

import { DELETE as resetWrapped, GET as getWrapped } from "@/app/api/wrapped/route";
import { DELETE as archiveAffiliation, GET as getAffiliation, PATCH as patchAffiliation } from "@/app/api/collaborator-affiliations/[id]/route";

const admin = authUser(Role.ADMIN);
const student = authUser(Role.STUDENT);
const wrapped = (query = "") => getWrapped(new Request(`https://app.example.com/api/wrapped${query}`), routeCtx({}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(student);
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.getRecap.mockResolvedValue({ slides: [] });
  mocks.getPolicy.mockResolvedValue({ id: "p1", version: 3 });
});

describe("/api/wrapped", () => {
  it("shows a person their own recap, not as a preview", async () => {
    expect(await (await wrapped()).json()).toEqual({ data: { slides: [] } });
    expect(mocks.getRecap).toHaveBeenCalledWith("student-1", { preview: false, readOnly: false });
  });

  it("lets only admins preview early or read someone else's recap, read-only", async () => {
    expect((await wrapped("?preview=1")).status).toBe(403);
    expect((await wrapped("?userId=staff-1")).status).toBe(403);
    expect((await wrapped(`?userId=${student.id}`)).status).toBe(200);
    expect(mocks.getRecap).toHaveBeenCalledTimes(1);

    mocks.requireAuth.mockResolvedValue(admin);
    await wrapped("?userId=student-1");
    expect(mocks.getRecap).toHaveBeenLastCalledWith("student-1", { preview: true, readOnly: true });
    await wrapped("?preview=true");
    expect(mocks.getRecap).toHaveBeenLastCalledWith("admin-1", { preview: true, readOnly: false });
  });

  it("returns 404 when there is no recap and keeps collaborators out", async () => {
    mocks.getRecap.mockResolvedValue(null);
    expect((await wrapped()).status).toBe(404);

    mocks.requireAuth.mockResolvedValue(authUser(Role.COLLABORATOR));
    expect((await wrapped()).status).toBe(403);
  });

  it("lets an admin regenerate one person's recap", async () => {
    mocks.resetRecap.mockResolvedValue(true);
    const reset = (query: string) => resetWrapped(new Request(`https://app.example.com/api/wrapped${query}`, { method: "DELETE", headers: { origin: "https://app.example.com" } }), routeCtx({}));

    expect((await reset("?userId=student-1")).status).toBe(403);

    mocks.requireAuth.mockResolvedValue(admin);
    expect((await reset("")).status).toBe(400);
    expect(await (await reset("?userId=student-1")).json()).toEqual({ data: { reset: true } });
    expect(mocks.resetRecap).toHaveBeenCalledWith("student-1");
  });
});

describe("/api/collaborator-affiliations/[id]", () => {
  const ctx = routeCtx({ id: "p1" });

  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue(admin);
  });

  it("reads one affiliation, admin only", async () => {
    expect(await (await getAffiliation(new Request("https://app.example.com/api/collaborator-affiliations/p1"), ctx)).json()).toEqual({ data: { id: "p1", version: 3 } });

    mocks.requireAuth.mockResolvedValue(authUser(Role.STAFF));
    expect((await getAffiliation(new Request("https://app.example.com/api/collaborator-affiliations/p1"), ctx)).status).toBe(403);
  });

  it("updates with a trimmed body, rate limited, and returns the fresh policy", async () => {
    const res = await patchAffiliation(jsonRequest("/api/collaborator-affiliations/p1", "PATCH", { expectedVersion: 3, displayName: "  Big Ten Network ", capabilities: ["MY_GEAR_VIEW"] }), ctx);

    expect(res.status).toBe(200);
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(`collaborator-policy:update:${admin.id}`, expect.anything());
    expect(mocks.updatePolicy).toHaveBeenCalledWith({ actor: admin, policyId: "p1", expectedVersion: 3, displayName: "Big Ten Network", capabilities: ["MY_GEAR_VIEW"] });
  });

  it("refuses a missing version or an over-long badge", async () => {
    expect((await patchAffiliation(jsonRequest("/api/collaborator-affiliations/p1", "PATCH", { displayName: "BTN" }), ctx)).status).toBe(400);
    expect((await patchAffiliation(jsonRequest("/api/collaborator-affiliations/p1", "PATCH", { expectedVersion: 3, badgeLabel: "Way too long badge" }), ctx)).status).toBe(400);
    expect(mocks.updatePolicy).not.toHaveBeenCalled();
  });

  it("archives with the expected version", async () => {
    mocks.archive.mockResolvedValue({ archived: true });

    const res = await archiveAffiliation(jsonRequest("/api/collaborator-affiliations/p1", "DELETE", { expectedVersion: 3 }), ctx);

    expect(await res.json()).toEqual({ archived: true });
    expect(mocks.archive).toHaveBeenCalledWith({ actor: admin, policyId: "p1", expectedVersion: 3 });
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(`collaborator-policy:archive:${admin.id}`, expect.anything());
  });
});
