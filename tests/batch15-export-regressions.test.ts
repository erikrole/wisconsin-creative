import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  auditLog: { findMany: vi.fn(), count: vi.fn() },
  booking: { findMany: vi.fn(), count: vi.fn() },
  asset: { findMany: vi.fn(), count: vi.fn() },
  bulkSku: { findMany: vi.fn(), count: vi.fn() },
  user: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
} }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(), checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/services/status", () => ({ buildDerivedStatusWhere: vi.fn(), enrichAssetsWithStatusFromLoaded: vi.fn(async (rows) => rows) }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET as audit } from "@/app/api/audit/export/route";
import { GET as bookings } from "@/app/api/bookings/export/route";
import { GET as items } from "@/app/api/assets/export/route";
import { GET as users } from "@/app/api/users/export/route";
import { GET as directory } from "@/app/api/users/route";
const context = { params: Promise.resolve({}) };
const request = (query = "") => new Request(`https://app.example.com/api/test?${query}`);
const admin = { id: "admin", name: "Admin", email: "admin@example.com", role: "ADMIN" as const, avatarUrl: null };
const person = { id: "a", name: "Person", role: "STUDENT", email: "person@example.com", athleticsEmail: null, phone: null, title: "Assistant", gradYear: null, studentYearOverride: null, primaryArea: null, startDate: null, topSize: null, bottomSize: null, shoeSize: null, active: true, createdAt: new Date("2026-01-01"), location: null, sportAssignments: [], areaAssignments: [], directReport: null, directReportName: null };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(admin);
  for (const model of [db.auditLog, db.booking, db.asset, db.bulkSku, db.user]) {
    vi.mocked(model.findMany).mockResolvedValue([]);
    vi.mocked(model.count).mockResolvedValue(0);
  }
  vi.mocked(db.user.groupBy).mockResolvedValue([]);
});
describe("batch 15 export and directory regressions", () => {
  it.each(["from=bad", "to=bad", "from=2026-09-07&to=2026-09-06"])("rejects invalid audit export range %s before reading data", async (query) => {
    expect((await audit(request(query), context)).status).toBe(400);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
    expect(db.auditLog.count).not.toHaveBeenCalled();
  });
  it("retains inclusive valid audit date filters", async () => {
    expect((await audit(request("from=2026-09-07&to=2026-09-07"), context)).status).toBe(200);
    expect(db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { createdAt: { gte: new Date("2026-09-07"), lte: new Date("2026-09-07") } } }));
  });
  it.each([["audit", audit], ["bookings", bookings], ["items", items], ["users", users]] as const)("disables caching for %s CSV", async (_name, handler) => {
    const response = await handler(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("honors the collaborator export filter", async () => {
    await users(request("role=COLLABORATOR"), context);
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: expect.arrayContaining([{ role: "COLLABORATOR" }]) } }));
  });
  it("ignores an invalid area consistently with the directory instead of passing it to Prisma", async () => {
    await users(request("area=INVALID"), context);
    expect(JSON.stringify(vi.mocked(db.user.findMany).mock.calls[0])).not.toContain("INVALID");
  });
  it("normalizes location filters consistently with the directory", async () => {
    await users(request("locationId=%20main%20"), context);
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: expect.arrayContaining([{ locationId: "main" }]) } }));
  });
  it("bounds user export reads and marks truncated output", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue(Array.from({ length: 5001 }, () => person) as never);
    const response = await users(request(), context);
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5001 }));
    expect(response.headers.get("x-exported-count")).toBe("5000");
    expect(response.headers.get("x-truncated")).toBe("true");
    expect((await response.text()).split("\n")).toHaveLength(5001);
  });
  it("does not mark exactly 5000 users truncated", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue(Array.from({ length: 5000 }, () => person) as never);
    expect((await users(request(), context)).headers.get("x-truncated")).toBeNull();
  });
  it("keeps collaborator private fields out of Staff exports while preserving CSV columns", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...admin, role: "STAFF" });
    vi.mocked(db.user.findMany).mockResolvedValue([{ ...person, role: "COLLABORATOR", email: "private@example.com", topSize: "secret-size", directReportName: "Private Manager" }] as never);
    const response = await users(request(), context);
    const body = await response.text();
    expect(body).toContain("Person,COLLABORATOR");
    expect(body).not.toContain("private@example.com");
    expect(body).not.toContain("secret-size");
    expect(body).not.toContain("Private Manager");
    const [header, row] = body.split("\n");
    expect(row!.split(",")).toHaveLength(header!.split(",").length);
  });
  it("preserves full collaborator exports for admins", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([{ ...person, role: "COLLABORATOR", email: "private@example.com" }] as never);
    expect(await (await users(request(), context)).text()).toContain("private@example.com");
  });
  it.each(["name", "name_desc", "role", "created", "lastActive_desc"])("uses a unique directory tiebreaker for %s", async (sort) => {
    await directory(request(`sort=${sort}`), context);
    const order = vi.mocked(db.user.findMany).mock.calls[0]![0]!.orderBy as unknown[];
    expect(order.at(-1)).toEqual({ id: "asc" });
  });
  it.each([["audit", audit, "auditLog"], ["bookings", bookings, "booking"]] as const)("uses stable timestamp ties in capped %s exports", async (_name, handler, model) => {
    await handler(request(), context);
    expect(db[model].findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }));
  });
  it("keeps non-admin audit exports forbidden", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...admin, role: "STAFF" });
    expect((await audit(request(), context)).status).toBe(403);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
});
