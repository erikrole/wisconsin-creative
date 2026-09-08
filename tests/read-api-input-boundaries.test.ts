import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  auditLog: { findMany: vi.fn() },
  bulkSku: { findMany: vi.fn(), count: vi.fn() },
} }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(), REPORT_EXPORT_LIMIT: {} }));
vi.mock("@/lib/audit", () => ({ AUDIT_RETENTION_DAYS: 90, createAuditEntry: vi.fn() }));
vi.mock("@/lib/services/reports", () => ({
  getCheckoutReport: vi.fn(), getCheckoutReportExport: vi.fn(),
  parseCheckoutFocusDate: vi.fn(() => null),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCheckoutReport, getCheckoutReportExport } from "@/lib/services/reports";
import { GET as audit } from "@/app/api/audit/route";
import { GET as families } from "@/app/api/bulk-skus/route";
import { GET as report } from "@/app/api/reports/checkouts/route";

const context = { params: Promise.resolve({}) };
const request = (query: string) => new Request(`https://app.example.com/api/test?${query}`);
const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ id: "admin", role: "ADMIN", email: "admin@example.com", name: "Admin", avatarUrl: null });
  vi.mocked(db.auditLog.findMany).mockResolvedValue([]);
  vi.mocked(db.bulkSku.findMany).mockResolvedValue([]);
  vi.mocked(db.bulkSku.count).mockResolvedValue(0);
  vi.mocked(getCheckoutReport).mockResolvedValue({} as never);
});

describe("read API input boundaries", () => {
  it.each(["-1", "2.5", "10rows", "0"])("keeps audit take positive for limit %s", async (limit) => {
    expect((await audit(request(`limit=${limit}`), context)).status).toBe(200);
    expect(db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51 }));
  });
  it("caps audit pages at 100", async () => {
    await audit(request("limit=999999999999999999999"), context);
    expect(db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 101 }));
  });
  it.each(["from=bad", "to=bad", "from=2026-09-07&to=2026-09-06"])("rejects invalid date range %s before querying", async (query) => {
    expect((await audit(request(query), context)).status).toBe(400);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
  it.each(["garbage", cursor(null), cursor({ createdAt: "bad", id: "a" }), cursor({ createdAt: "2026-09-07", id: "" })])("rejects broken cursor %s", async (value) => {
    for (const key of ["cursor", "after"]) {
      expect((await audit(request(`${key}=${value}`), context)).status).toBe(400);
    }
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
  it("rejects conflicting directions", async () => {
    const value = cursor({ createdAt: "2026-09-07T00:00:00.000Z", id: "a" });
    expect((await audit(request(`cursor=${value}&after=${value}`), context)).status).toBe(400);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
  it("preserves valid live-tail ordering and date filters", async () => {
    const value = cursor({ createdAt: "2026-09-07T00:00:00.000Z", id: "a" });
    expect((await audit(request(`after=${value}&from=2026-09-01&limit=10`), context)).status).toBe(200);
    expect(db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 10, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      where: expect.objectContaining({ createdAt: { gte: new Date("2026-09-01") }, OR: expect.any(Array) }),
    }));
  });
  it.each(["limit=2.5&offset=3.5", "limit=Infinity&offset=Infinity"])("normalizes malformed family pagination %s", async (query) => {
    expect((await families(request(query), context)).status).toBe(200);
    expect(db.bulkSku.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50, skip: 0 }));
  });
  it("rejects excessive family offsets before querying", async () => {
    expect((await families(request("offset=10001"), context)).status).toBe(400);
    expect(db.bulkSku.findMany).not.toHaveBeenCalled();
  });
  it.each(["30days", "2.5", "1e2", "0", "367"])("rejects malformed report window %s for JSON and CSV", async (days) => {
    for (const format of ["json", "csv"]) {
      expect((await report(request(`days=${days}&format=${format}`), context)).status).toBe(400);
    }
    expect(getCheckoutReport).not.toHaveBeenCalled();
    expect(getCheckoutReportExport).not.toHaveBeenCalled();
  });
  it.each(["", "days=366"])("preserves valid report periods %s", async (query) => {
    expect((await report(request(query), context)).status).toBe(200);
    expect(getCheckoutReport).toHaveBeenCalledWith(query ? 366 : 30, null);
  });
  it("keeps audit admin-only", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "staff", role: "STAFF", email: "staff@example.com", name: "Staff", avatarUrl: null });
    expect((await audit(request(""), context)).status).toBe(403);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
});
