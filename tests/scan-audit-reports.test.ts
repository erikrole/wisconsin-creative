import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

const { db } = vi.hoisted(() => ({
  db: {
    scanEvent: { findMany: vi.fn(), count: vi.fn() },
    auditLog: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ db }));

import {
  getAuditReport,
  getAuditReportExport,
  getScanHistoryReport,
  getScanHistoryReportExport,
} from "@/lib/services/scan-audit-reports";

const at = new Date("2026-10-20T15:00:00.000Z");

function scan(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    scanType: "QR",
    scanValue: "raw-value",
    success: true,
    phase: "CHECKOUT",
    createdAt: at,
    actor: { id: "u1", name: "Avery", avatarUrl: null },
    asset: null,
    bulkSku: null,
    booking: { id: "b1", title: "Football vs Iowa" },
    ...overrides,
  };
}

/** Answers each count by whether it asks for successes, and by window. */
function scanCounts({ total, success, previous }: { total: number; success: number; previous?: [number, number] }) {
  db.scanEvent.count.mockImplementation(async ({ where }: { where: Prisma.ScanEventWhereInput }) => {
    const gte = (where.createdAt as Prisma.DateTimeFilter | undefined)?.gte as Date | undefined;
    const isPrevious = Boolean(previous && gte && gte < new Date("2026-10-08T00:00:00.000Z"));
    if (isPrevious) return where.success ? previous![1] : previous![0];
    return where.success ? success : total;
  });
}

function sqlText(call: unknown[]) {
  return (call[0] as string[]).join("?");
}

beforeEach(() => {
  vi.clearAllMocks();
  db.scanEvent.findMany.mockResolvedValue([]);
  db.$queryRaw.mockResolvedValue([]);
  db.auditLog.findMany.mockResolvedValue([]);
  db.auditLog.count.mockResolvedValue(0);
  db.auditLog.groupBy.mockResolvedValue([]);
  scanCounts({ total: 0, success: 0 });
});

describe("getScanHistoryReport", () => {
  it("names each scan by its item tag, then name, then family, then the raw value", async () => {
    db.scanEvent.findMany.mockResolvedValue([
      scan("s1", { asset: { id: "a1", assetTag: "ROAM2", name: "DJI Roam" } }),
      scan("s2", { asset: { id: "a2", assetTag: "", name: "Untagged tripod" } }),
      scan("s3", { bulkSku: { id: "k1", name: "NP-FZ100 battery" } }),
      scan("s4", { success: false, booking: { id: "b2", title: "Volleyball vs Penn State" } }),
    ]);

    const report = await getScanHistoryReport(50, 0);

    expect(report.data.map((row) => row.item)).toEqual(["ROAM2", "Untagged tripod", "NP-FZ100 battery", "raw-value"]);
    expect(report.data[0]).toMatchObject({ id: "s1", actor: "Avery", phase: "CHECKOUT", bookingId: "b1", createdAt: at });
  });

  it("filters by dates and a known phase, and ignores an unknown phase", async () => {
    await getScanHistoryReport(25, 50, "2026-10-01T05:00:00.000Z", "2026-10-15T05:00:00.000Z", "CHECKIN");

    expect(db.scanEvent.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        createdAt: { gte: new Date("2026-10-01T05:00:00.000Z"), lte: new Date("2026-10-15T05:00:00.000Z") },
        phase: "CHECKIN",
      },
      orderBy: { createdAt: "desc" },
      take: 25,
      skip: 50,
    });
    const daily = db.$queryRaw.mock.calls[0]!;
    expect(sqlText(daily)).toContain("WHERE");
    expect(daily.slice(1)).toContain("America/Chicago");

    vi.clearAllMocks();
    db.scanEvent.findMany.mockResolvedValue([]);
    db.$queryRaw.mockResolvedValue([]);
    scanCounts({ total: 0, success: 0 });
    await getScanHistoryReport(25, 0, null, null, "SHIP");
    expect(db.scanEvent.findMany.mock.calls[0]?.[0]?.where).toEqual({});
  });

  it("reports the success rate, daily counts in Madison days, and 100% with no scans", async () => {
    scanCounts({ total: 8, success: 6 });
    db.$queryRaw.mockResolvedValue([{ date: "2026-10-20", success: 6n, fail: 2n }]);

    const report = await getScanHistoryReport(50, 0);

    expect(report).toMatchObject({ total: 8, successCount: 6, successRate: 75, limit: 50, offset: 0 });
    expect(report.dailyScans).toEqual([{ date: "2026-10-20", success: 6, fail: 2 }]);
    // No range means no earlier window to compare with.
    expect(report.previousTotal).toBeNull();

    scanCounts({ total: 0, success: 0 });
    expect((await getScanHistoryReport(50, 0)).successRate).toBe(100);
  });

  it("compares with the window of the same length just before the range", async () => {
    scanCounts({ total: 10, success: 9, previous: [4, 3] });

    const report = await getScanHistoryReport(50, 0, "2026-10-08T05:00:00.000Z", "2026-10-15T05:00:00.000Z", "CHECKOUT");

    expect(report).toMatchObject({ previousTotal: 4, previousSuccessRate: 75 });
    const previousWhere = db.scanEvent.count.mock.calls
      .map(([args]) => args.where)
      .find((where) => !where.success && where.createdAt.gte < new Date("2026-10-08T00:00:00.000Z"));
    expect(previousWhere).toEqual({
      createdAt: { gte: new Date("2026-10-01T05:00:00.000Z"), lte: new Date("2026-10-08T04:59:59.999Z") },
      phase: "CHECKOUT",
    });
  });

  it("has no earlier window for a backwards range", async () => {
    const report = await getScanHistoryReport(50, 0, "2026-10-15T05:00:00.000Z", "2026-10-08T05:00:00.000Z");
    expect(report.previousTotal).toBeNull();
    expect(report.previousSuccessRate).toBeNull();
  });

  it("still answers when the list or the daily chart fails", async () => {
    db.scanEvent.findMany.mockRejectedValue(new Error("timeout"));
    db.$queryRaw.mockRejectedValue(new Error("timeout"));
    scanCounts({ total: 3, success: 3 });

    const report = await getScanHistoryReport(50, 0);

    expect(report).toMatchObject({ data: [], dailyScans: [], total: 3, successRate: 100 });
  });
});

describe("getScanHistoryReportExport", () => {
  it("exports up to the cap and says when it was cut short", async () => {
    db.scanEvent.findMany.mockResolvedValue([scan("s1")]);
    db.scanEvent.count.mockResolvedValue(5001);

    const report = await getScanHistoryReportExport(null, null, "CHECKOUT");

    expect(db.scanEvent.findMany.mock.calls[0]?.[0]).toMatchObject({ where: { phase: "CHECKOUT" }, take: 5000 });
    expect(report).toMatchObject({ total: 5001, truncated: true, limit: 5000 });
    expect(report.data[0]?.bookingTitle).toBe("Football vs Iowa");
  });
});

describe("getAuditReport", () => {
  function entry(id: string, actor: { id: string; name: string; avatarUrl: string | null } | null) {
    return { id, actor, entityType: "asset", entityId: "a1", action: "updated", createdAt: at, beforeJson: { name: "Old" }, afterJson: { name: "New" } };
  }

  it("lists entries with their actor, or System, and the top actions and entity types", async () => {
    db.auditLog.findMany.mockResolvedValue([entry("e1", { id: "u1", name: "Avery", avatarUrl: "x" }), entry("e2", null)]);
    db.auditLog.count.mockResolvedValue(2);
    db.auditLog.groupBy.mockImplementation(async ({ by }: { by: string[] }) => (
      by[0] === "action" ? [{ action: "updated", _count: 2 }] : [{ entityType: "asset", _count: 2 }]
    ));

    const report = await getAuditReport(20, 40, null, null, "updated", "asset");

    expect(report.data).toEqual([
      expect.objectContaining({ id: "e1", actor: "Avery", actorId: "u1", actorAvatarUrl: "x", beforeJson: { name: "Old" } }),
      expect.objectContaining({ id: "e2", actor: "System", actorId: null, actorAvatarUrl: null }),
    ]);
    expect(report).toMatchObject({
      total: 2,
      previousTotal: null,
      byAction: [{ action: "updated", count: 2 }],
      byEntityType: [{ entityType: "asset", count: 2 }],
      limit: 20,
      offset: 40,
    });
    expect(db.auditLog.findMany.mock.calls[0]?.[0]).toMatchObject({ where: { action: "updated", entityType: "asset" }, take: 20, skip: 40 });
  });

  it("counts the same-length window before the range", async () => {
    db.auditLog.count.mockImplementation(async ({ where }: { where: Prisma.AuditLogWhereInput }) => (
      ((where.createdAt as Prisma.DateTimeFilter).gte as Date) < new Date("2026-10-08T00:00:00.000Z") ? 7 : 12
    ));

    const report = await getAuditReport(20, 0, "2026-10-08T05:00:00.000Z", "2026-10-15T05:00:00.000Z", "updated");

    expect(report).toMatchObject({ total: 12, previousTotal: 7 });
    expect(db.auditLog.count.mock.calls[1]?.[0]?.where).toEqual({
      createdAt: { gte: new Date("2026-10-01T05:00:00.000Z"), lte: new Date("2026-10-08T04:59:59.999Z") },
      action: "updated",
    });
  });

  it("still answers when the breakdowns fail", async () => {
    db.auditLog.groupBy.mockRejectedValue(new Error("timeout"));
    db.auditLog.count.mockResolvedValue(4);

    const report = await getAuditReport(20, 0);

    expect(report).toMatchObject({ total: 4, byAction: [], byEntityType: [] });
  });
});

describe("getAuditReportExport", () => {
  it("exports up to the cap and flags truncation", async () => {
    db.auditLog.count.mockResolvedValue(12);

    const report = await getAuditReportExport("2026-10-01T05:00:00.000Z", null, null, "booking");

    expect(db.auditLog.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { createdAt: { gte: new Date("2026-10-01T05:00:00.000Z") }, entityType: "booking" },
      take: 5000,
    });
    expect(report).toMatchObject({ total: 12, truncated: false, limit: 5000 });
  });
});
