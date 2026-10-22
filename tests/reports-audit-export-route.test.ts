import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/services/reports", () => ({
  getAuditReport: vi.fn(),
  getAuditReportExport: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => undefined),
  REPORT_EXPORT_LIMIT: { max: 10, windowMs: 60_000 },
}));

import { requireAuth } from "@/lib/auth";
import { getAuditReport, getAuditReportExport } from "@/lib/services/reports";
import { GET as getAuditReportRoute } from "@/app/api/reports/audit/route";

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin One",
  role: Role.ADMIN,
  avatarUrl: null,
};

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

function authedGet(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(adminUser);
  vi.mocked(getAuditReport).mockResolvedValue({
    data: [],
    total: 0,
    byAction: [],
    byEntityType: [],
    limit: 25,
    offset: 0,
  } as never);
  vi.mocked(getAuditReportExport).mockResolvedValue({
    data: [
      {
        id: "audit-1",
        actor: "Creative Admin",
        actorId: "user-1",
        actorAvatarUrl: null,
        action: "asset_updated",
        entityType: "Asset",
        entityId: "asset-1",
        createdAt: new Date("2026-06-02T12:00:00.000Z"),
        beforeJson: null,
        afterJson: null,
      },
      {
        id: "audit-2",
        actor: "=Formula User",
        actorId: "user-2",
        actorAvatarUrl: null,
        action: "asset_deleted",
        entityType: "Asset",
        entityId: "asset-2",
        createdAt: new Date("2026-06-02T12:30:00.000Z"),
        beforeJson: null,
        afterJson: null,
      },
    ],
    total: 2,
    truncated: false,
    limit: 5000,
  } as never);
});

describe("audit report CSV export route", () => {
  it("keeps JSON browse semantics paginated", async () => {
    const res = await getAuditReportRoute(
      authedGet("/api/reports/audit?limit=25&offset=50&startDate=2026-06-01T00:00:00.000Z"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(getAuditReport).toHaveBeenCalledWith(
      25,
      50,
      "2026-06-01T00:00:00.000Z",
      null,
      null,
      null,
    );
    expect(getAuditReportExport).not.toHaveBeenCalled();
  });

  it("exports all matching audit report rows as bounded CSV", async () => {
    const res = await getAuditReportRoute(
      authedGet("/api/reports/audit?format=csv&startDate=2026-06-01T00:00:00.000Z&endDate=2026-06-02T23:59:59.999Z&action=asset_updated&entityType=asset"),
      { params: Promise.resolve({}) },
    );
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("audit-report-");
    expect(res.headers.get("X-Exported-Count")).toBe("2");
    expect(res.headers.get("X-Total-Count")).toBe("2");
    expect(getAuditReportExport).toHaveBeenCalledWith(
      "2026-06-01T00:00:00.000Z",
      "2026-06-02T23:59:59.999Z",
      "asset_updated",
      "asset",
    );
    expect(body).toContain("Timestamp,Actor,Action,Entity Type,Entity ID");
    expect(body).toContain("2026-06-02T12:00:00.000Z,Creative Admin,asset_updated,Asset,asset-1");
    expect(body).toContain("'=Formula User");
  });

  it("sets truncation headers when the filtered export is capped", async () => {
    vi.mocked(getAuditReportExport).mockResolvedValueOnce({
      data: [],
      total: 6000,
      truncated: true,
      limit: 5000,
    } as never);

    const res = await getAuditReportRoute(
      authedGet("/api/reports/audit?format=csv"),
      { params: Promise.resolve({}) },
    );

    expect(res.headers.get("X-Truncated")).toBe("true");
    expect(res.headers.get("X-Total-Count")).toBe("6000");
  });

  it("rejects invalid or inverted date ranges before report export", async () => {
    const invalid = await getAuditReportRoute(
      authedGet("/api/reports/audit?format=csv&startDate=not-a-date"),
      { params: Promise.resolve({}) },
    );
    const inverted = await getAuditReportRoute(
      authedGet("/api/reports/audit?format=csv&startDate=2026-06-03T00:00:00.000Z&endDate=2026-06-01T00:00:00.000Z"),
      { params: Promise.resolve({}) },
    );

    expect(invalid.status).toBe(400);
    expect(inverted.status).toBe(400);
    expect(getAuditReportExport).not.toHaveBeenCalled();
  });

  it("keeps the audit report admin-only for both browse and CSV export", async () => {
    vi.mocked(requireAuth).mockResolvedValue(staffUser);

    const browse = await getAuditReportRoute(
      authedGet("/api/reports/audit"),
      { params: Promise.resolve({}) },
    );
    const csv = await getAuditReportRoute(
      authedGet("/api/reports/audit?format=csv"),
      { params: Promise.resolve({}) },
    );

    expect(browse.status).toBe(403);
    expect(csv.status).toBe(403);
    expect(getAuditReport).not.toHaveBeenCalled();
    expect(getAuditReportExport).not.toHaveBeenCalled();
  });
});
