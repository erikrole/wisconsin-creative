import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, jsonRequest, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  db: {
    announcement: { findMany: vi.fn(), create: vi.fn() },
    user: { groupBy: vi.fn() },
  },
  requireAuth: vi.fn(),
  audit: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  enforceRateLimit: mocks.enforceRateLimit,
}));

import { GET, POST } from "@/app/api/announcements/route";

const admin = authUser(Role.ADMIN);
const now = new Date("2026-10-25T18:00:00.000Z");
const row = (extra: Record<string, unknown>) => ({
  id: "a1", kind: "UPDATE", title: "New scanner", body: "Try it", ctaLabel: null, ctaUrl: null, imageUrls: [], imageAlt: null,
  roles: [], showOnWeb: true, showOnIos: true, publishedAt: null, endsAt: null, createdAt: now,
  createdBy: { name: "Erik" }, _count: { dismissals: 0 }, ...extra,
});
const draft = { kind: "NOTICE", title: " Gear room closed ", body: "Back Monday", roles: ["STUDENT"], showOnWeb: true, showOnIos: false };
const list = async () => (await (await GET(new Request("https://app.example.com/api/announcements"), routeCtx({}))).json()).data;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.requireAuth.mockResolvedValue(admin);
  mocks.db.user.groupBy.mockResolvedValue([
    { role: Role.ADMIN, _count: { _all: 2 } },
    { role: Role.STAFF, _count: { _all: 5 } },
    { role: Role.STUDENT, _count: { _all: 20 } },
    { role: Role.COLLABORATOR, _count: { _all: 9 } },
  ]);
  mocks.db.announcement.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "new-1", ...data }));
});
afterEach(() => { vi.useRealTimers(); });

describe("GET /api/announcements", () => {
  it("is admin only", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STAFF));
    expect((await GET(new Request("https://app.example.com/api/announcements"), routeCtx({}))).status).toBe(403);
  });

  it("sizes reach from active people who can see it, never collaborators, and labels each state", async () => {
    mocks.db.announcement.findMany.mockResolvedValue([
      row({ id: "everyone", publishedAt: new Date("2026-10-20T12:00:00Z"), _count: { dismissals: 4 } }),
      row({ id: "students", roles: [Role.STUDENT], publishedAt: new Date("2026-10-30T12:00:00Z") }),
      row({ id: "team", roles: [Role.ADMIN, Role.STAFF], publishedAt: new Date("2026-10-01T12:00:00Z"), endsAt: new Date("2026-10-02T12:00:00Z") }),
      row({ id: "draft" }),
    ]);

    const data = await list();

    expect(data.map((a: Record<string, unknown>) => [a.id, a.audienceSize, a.state])).toEqual([
      ["everyone", 27, "live"],
      ["students", 20, "scheduled"],
      ["team", 7, "ended"],
      ["draft", 27, "draft"],
    ]);
    expect(data[0]).toMatchObject({ seenCount: 4, createdByName: "Erik" });
    expect(data[0]).not.toHaveProperty("createdBy");
    expect(mocks.db.user.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true } }));
  });
});

describe("POST /api/announcements", () => {
  it("saves a draft with blanks as nulls and audits it as created", async () => {
    const res = await POST(jsonRequest("/api/announcements", "POST", draft), routeCtx({}));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "new-1" });
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(`announcements:write:${admin.id}`, expect.anything());
    expect(mocks.db.announcement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Gear room closed", ctaLabel: null, ctaUrl: null, imageAlt: null, endsAt: null,
        imageUrls: [], publishedAt: null, createdById: admin.id,
      }),
    });
    expect(mocks.db.announcement.create.mock.calls[0][0].data).not.toHaveProperty("publish");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "create", entityId: "new-1" }));
  });

  it("publishes straight away when asked", async () => {
    await POST(jsonRequest("/api/announcements", "POST", { ...draft, publish: true }), routeCtx({}));

    expect(mocks.db.announcement.create.mock.calls[0][0].data.publishedAt).toEqual(now);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "publish", after: expect.objectContaining({ publishedAt: now }) }));
  });

  it("refuses a hidden announcement, a half-filled button or a past end before saving", async () => {
    for (const body of [
      { ...draft, showOnWeb: false },
      { ...draft, ctaLabel: "Open" },
      { ...draft, endsAt: "2026-10-24T12:00:00.000Z" },
    ]) {
      expect((await POST(jsonRequest("/api/announcements", "POST", body), routeCtx({}))).status).toBe(400);
    }
    expect(mocks.db.announcement.create).not.toHaveBeenCalled();

    mocks.requireAuth.mockResolvedValue(authUser(Role.STAFF));
    expect((await POST(jsonRequest("/api/announcements", "POST", draft), routeCtx({}))).status).toBe(403);
  });
});
