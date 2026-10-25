import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, jsonRequest, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  listKits: vi.fn(),
  createKit: vi.fn(),
  suggest: vi.fn(),
  availability: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));
vi.mock("@/lib/services/kits", () => ({ listKits: mocks.listKits, createKit: mocks.createKit, suggestFootballGamedayKit: mocks.suggest }));
vi.mock("@/lib/services/kit-list-availability", () => ({ summarizeKitListAvailability: mocks.availability }));

import { GET, POST } from "@/app/api/kits/route";

const staff = authUser(Role.STAFF);
const student = authUser(Role.STUDENT);
const list = (query = "") => GET(new Request(`https://app.example.com/api/kits${query}`), routeCtx({}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.listKits.mockResolvedValue({ data: [{ id: "k1" }, { id: "k2" }], total: 2 });
  mocks.availability.mockResolvedValue(new Map([["k1", { serialized: 4, unavailable: 1 }]]));
  mocks.suggest.mockResolvedValue("k2");
});

describe("GET /api/kits", () => {
  it("passes filters through and adds availability, defaulting to zero", async () => {
    const res = await list("?q=%20ROAM%20&location_id=loc-1&include_archived=true&sort=name&order=desc&limit=10&offset=20");
    const body = await res.json();

    expect(mocks.listKits).toHaveBeenCalledWith({ search: "ROAM", locationId: "loc-1", includeArchived: true, sortBy: "name", sortOrder: "desc", limit: 10, offset: 20 });
    expect(mocks.availability).toHaveBeenCalledWith(["k1", "k2"]);
    expect(body.data).toEqual([
      { id: "k1", availability: { serialized: 4, unavailable: 1 } },
      { id: "k2", availability: { serialized: 0, unavailable: 0 } },
    ]);
    expect(body).toEqual(expect.objectContaining({ total: 2, limit: 10, offset: 20, suggestedKitId: null }));
  });

  it("never shows archived kits to students", async () => {
    mocks.requireAuth.mockResolvedValue(student);

    await list("?include_archived=true");

    expect(mocks.listKits).toHaveBeenCalledWith(expect.objectContaining({ includeArchived: false, search: undefined, locationId: undefined }));
  });

  it("suggests a gameday kit for the requester at a location", async () => {
    const body = await (await list("?location_id=loc-1&requester_user_id=ada")).json();

    expect(mocks.suggest).toHaveBeenCalledWith({ requesterUserId: "ada", locationId: "loc-1" });
    expect(body.suggestedKitId).toBe("k2");
  });

  it("only suggests for the student themselves", async () => {
    mocks.requireAuth.mockResolvedValue(student);

    await list("?location_id=loc-1&requester_user_id=ada");
    expect(mocks.suggest).toHaveBeenCalledWith({ requesterUserId: student.id, locationId: "loc-1" });

    await list("?location_id=loc-1");
    await list("?requester_user_id=ada");
    expect(mocks.suggest).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/kits", () => {
  it("creates a kit as the signed-in staff member", async () => {
    mocks.createKit.mockResolvedValue({ id: "k3" });

    const res = await POST(jsonRequest("/api/kits", "POST", { name: "ROAM kit", locationId: "loc-1" }), routeCtx({}));

    expect(res.status).toBe(201);
    expect(mocks.createKit).toHaveBeenCalledWith(expect.objectContaining({ name: "ROAM kit", locationId: "loc-1" }), staff.id, Role.STAFF);
  });

  it("requires a name and keeps students out", async () => {
    expect((await POST(jsonRequest("/api/kits", "POST", { name: "", locationId: "loc-1" }), routeCtx({}))).status).toBe(400);

    mocks.requireAuth.mockResolvedValue(student);
    expect((await POST(jsonRequest("/api/kits", "POST", { name: "Kit", locationId: "loc-1" }), routeCtx({}))).status).toBe(403);
    expect(mocks.createKit).not.toHaveBeenCalled();
  });
});
