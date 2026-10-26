import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, jsonRequest, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  audit: vi.fn(),
  enforceRateLimit: vi.fn(),
  db: {
    location: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    quickLink: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  enforceRateLimit: mocks.enforceRateLimit,
}));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));

import { GET as listLocations, POST as createLocation } from "@/app/api/locations/route";
import { DELETE as deleteLink, PATCH as patchLink } from "@/app/api/quick-links/[id]/route";

const admin = authUser(Role.ADMIN);
const staff = authUser(Role.STAFF);
const get = (query = "") => listLocations(new Request(`https://app.example.com/api/locations${query}`), routeCtx({}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(admin);
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.db.location.findMany.mockResolvedValue([{ id: "l1", name: "Camp Randall", address: "1440 Monroe St", active: true }]);
});

describe("GET /api/locations", () => {
  it("lists active locations by default", async () => {
    await get();

    expect(mocks.db.location.findMany).toHaveBeenCalledWith({ where: { active: true }, orderBy: { name: "asc" }, include: undefined });
  });

  it("lets an admin include inactive locations with usage counts", async () => {
    await get("?includeInactive=1");

    expect(mocks.db.location.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {}, include: { _count: expect.any(Object) } }));
  });

  it("keeps inactive locations from staff even when asked", async () => {
    mocks.requireAuth.mockResolvedValue(staff);

    await get("?includeInactive=1");

    expect(mocks.db.location.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true } }));
  });

  it("shows collaborators only names", async () => {
    mocks.requireAuth.mockResolvedValue({ ...authUser(Role.COLLABORATOR), capabilities: ["GEAR_CATALOG_VIEW"] });

    const res = await get();

    expect((await res.json()).data).toEqual([{ id: "l1", name: "Camp Randall" }]);
  });
});

describe("POST /api/locations", () => {
  it("creates a location, storing a blank address as empty", async () => {
    mocks.db.location.findUnique.mockResolvedValue(null);
    mocks.db.location.create.mockImplementation(async ({ data }) => ({ id: "l2", ...data }));

    const res = await createLocation(jsonRequest("/api/locations", "POST", { name: "  Kohl Center ", address: "   " }), routeCtx({}));

    expect(res.status).toBe(201);
    expect(mocks.db.location.create).toHaveBeenCalledWith({ data: { name: "Kohl Center", address: null, isHomeVenue: false } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "created", after: { name: "Kohl Center", address: null, isHomeVenue: false } }));
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(`locations:write:${admin.id}`, expect.anything());
  });

  it("refuses a duplicate name and keeps staff out", async () => {
    mocks.db.location.findUnique.mockResolvedValue({ id: "l1" });
    expect((await createLocation(jsonRequest("/api/locations", "POST", { name: "Camp Randall" }), routeCtx({}))).status).toBe(409);

    mocks.requireAuth.mockResolvedValue(staff);
    expect((await createLocation(jsonRequest("/api/locations", "POST", { name: "New" }), routeCtx({}))).status).toBe(403);
    expect(mocks.db.location.create).not.toHaveBeenCalled();
  });
});

describe("/api/quick-links/[id]", () => {
  const ctx = routeCtx({ id: "q1" });
  const before = { id: "q1", label: "Slate", url: "https://slate.example.com", detail: null, roles: [] };

  beforeEach(() => {
    mocks.db.quickLink.findUnique.mockResolvedValue(before);
  });

  it("edits a link and stores the audience as roles", async () => {
    mocks.db.quickLink.update.mockImplementation(async ({ data }) => ({ id: "q1", ...data }));

    const res = await patchLink(jsonRequest("/api/quick-links/q1", "PATCH", { label: "Slate", url: "https://slate.example.com/new", audience: "staff" }), ctx);

    expect(res.status).toBe(200);
    expect(mocks.db.quickLink.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "q1" },
      data: { label: "Slate", url: "https://slate.example.com/new", detail: null, roles: ["ADMIN", "STAFF"] },
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "updated", before }));
  });

  it("refuses an unsafe link", async () => {
    expect((await patchLink(jsonRequest("/api/quick-links/q1", "PATCH", { label: "Bad", url: "javascript:alert(1)", audience: "everyone" }), ctx)).status).toBe(400);
    expect(mocks.db.quickLink.update).not.toHaveBeenCalled();
  });

  it("deletes a link and audits what it was", async () => {
    const res = await deleteLink(jsonRequest("/api/quick-links/q1", "DELETE"), ctx);

    expect((await res.json()).data).toEqual({ id: "q1" });
    expect(mocks.db.quickLink.delete).toHaveBeenCalledWith({ where: { id: "q1" } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "deleted", entityId: "q1", before }));
  });

  it("returns 404 for a missing link and keeps staff out", async () => {
    mocks.db.quickLink.findUnique.mockResolvedValue(null);
    expect((await deleteLink(jsonRequest("/api/quick-links/q1", "DELETE"), ctx)).status).toBe(404);
    expect((await patchLink(jsonRequest("/api/quick-links/q1", "PATCH", { label: "Slate", url: "/resources", audience: "everyone" }), ctx)).status).toBe(404);

    mocks.requireAuth.mockResolvedValue(staff);
    expect((await deleteLink(jsonRequest("/api/quick-links/q1", "DELETE"), ctx)).status).toBe(403);
    expect(mocks.db.quickLink.delete).not.toHaveBeenCalled();
  });
});
