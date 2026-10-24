import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  enforceRateLimit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    quickLink: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/quick-links/route";
import { audienceForRoles, canSeeQuickLink, isSafeQuickLinkUrl, quickLinkBody, rolesForAudience } from "@/lib/quick-links";

const ROWS = [
  { id: "a", label: "APM Music", url: "https://www.apmmusic.com", detail: null, roles: ["ADMIN", "STAFF", "STUDENT"] },
  { id: "b", label: "Budget sheet", url: "https://docs.google.com/spreadsheets/d/x", detail: null, roles: ["ADMIN"] },
  { id: "c", label: "Brand site", url: "https://example.com", detail: null, roles: [] },
];

function userWith(role: Role) {
  return { id: `u-${role}`, email: "x@example.com", name: "X", role, capabilities: [], avatarUrl: null };
}

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: { host: "app.example.com", ...(method === "GET" ? {} : { origin: "https://app.example.com", "content-type": "application/json" }) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.quickLink.findMany).mockResolvedValue(ROWS as never);
});

describe("quick link rules", () => {
  it("maps each audience to roles and back", () => {
    expect(rolesForAudience("everyone")).toEqual([]);
    expect(audienceForRoles(["STAFF", "ADMIN"]).id).toBe("staff");
    expect(audienceForRoles(rolesForAudience("admins")).id).toBe("admins");
  });

  it("shows an empty-roles link to everyone, collaborators included", () => {
    expect(canSeeQuickLink([], "COLLABORATOR")).toBe(true);
    expect(canSeeQuickLink(["ADMIN"], "STAFF")).toBe(false);
  });

  it("accepts https links and app paths only", () => {
    expect(isSafeQuickLinkUrl("https://www.apmmusic.com")).toBe(true);
    expect(isSafeQuickLinkUrl("/resources")).toBe(true);
    expect(isSafeQuickLinkUrl("http://example.com")).toBe(false);
    expect(isSafeQuickLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeQuickLinkUrl("//evil.example")).toBe(false);
    expect(quickLinkBody.safeParse({ label: "", url: "https://x.com", audience: "everyone" }).success).toBe(false);
  });
});

describe("/api/quick-links", () => {
  it("returns only the links a student may see", async () => {
    vi.mocked(requireAuth).mockResolvedValue(userWith(Role.STUDENT) as never);
    const res = await GET(request("/api/quick-links"), ctx);
    const json = await res.json();
    expect(json.data.map((r: { id: string }) => r.id)).toEqual(["a", "c"]);
  });

  it("returns every link to an admin managing the list", async () => {
    vi.mocked(requireAuth).mockResolvedValue(userWith(Role.ADMIN) as never);
    const res = await GET(request("/api/quick-links?manage=1"), ctx);
    expect((await res.json()).data).toHaveLength(3);
  });

  it("refuses the full list and edits to non-admins", async () => {
    vi.mocked(requireAuth).mockResolvedValue(userWith(Role.STAFF) as never);
    expect((await GET(request("/api/quick-links?manage=1"), ctx)).status).toBe(403);
    const res = await POST(request("/api/quick-links", "POST", { label: "X", url: "https://x.com", audience: "everyone" }), ctx);
    expect(res.status).toBe(403);
    expect(db.quickLink.create).not.toHaveBeenCalled();
  });

  it("adds a link at the end with the chosen audience", async () => {
    vi.mocked(requireAuth).mockResolvedValue(userWith(Role.ADMIN) as never);
    vi.mocked(db.quickLink.findFirst).mockResolvedValue({ sortOrder: 4 } as never);
    vi.mocked(db.quickLink.create).mockResolvedValue({ ...ROWS[1] } as never);
    const res = await POST(request("/api/quick-links", "POST", { label: "Budget sheet", url: "https://docs.google.com/spreadsheets/d/x", audience: "admins" }), ctx);
    expect(res.status).toBe(201);
    expect(vi.mocked(db.quickLink.create).mock.calls[0]![0].data).toMatchObject({ roles: ["ADMIN"], sortOrder: 5 });
  });
});
