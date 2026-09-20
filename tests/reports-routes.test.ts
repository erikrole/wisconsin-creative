import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/services/reports", () => ({
  getUtilizationReport: vi.fn(),
  getUtilizationReportExport: vi.fn(),
  getCheckoutReport: vi.fn(),
  getCheckoutReportExport: vi.fn(),
  getBulkLossReport: vi.fn(),
  getBulkLossReportExport: vi.fn(),
  getOverdueReport: vi.fn(),
  getOverdueReportExport: vi.fn(),
  getScanHistoryReport: vi.fn(),
  getScanHistoryReportExport: vi.fn(),
  parseCheckoutFocusDate: vi.fn((value: string | null) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null,
  ),
  parseUtilizationReportPeriod: vi.fn((value: string | null) => {
    const parsed = Number.parseInt(value ?? "", 10);
    return [30, 90, 365].includes(parsed) ? parsed : 90;
  }),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => undefined),
  REPORT_EXPORT_LIMIT: { max: 10, windowMs: 60_000 },
}));

import { requireAuth } from "@/lib/auth";
import {
  getUtilizationReport,
  getUtilizationReportExport,
  getCheckoutReport,
  getCheckoutReportExport,
  getBulkLossReport,
  getBulkLossReportExport,
  getOverdueReport,
  getOverdueReportExport,
  getScanHistoryReport,
  getScanHistoryReportExport,
} from "@/lib/services/reports";
import { GET as getUtilizationReportRoute } from "@/app/api/reports/utilization/route";
import { GET as getCheckoutReportRoute } from "@/app/api/reports/checkouts/route";
import { GET as getBulkLossReportRoute } from "@/app/api/reports/bulk-losses/route";
import { GET as getOverdueReportRoute } from "@/app/api/reports/overdue/route";
import { GET as getScanReport } from "@/app/api/reports/scans/route";

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
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
  vi.mocked(getUtilizationReport).mockResolvedValue({
    totalAssets: 1,
    statusCounts: { AVAILABLE: 1 },
    byLocation: [{ location: "Main Cage", count: 1 }],
    byType: [{ type: "Camera", count: 1 }],
    byDepartment: [{ department: "Creative", count: 1 }],
  } as never);
  vi.mocked(getUtilizationReportExport).mockResolvedValue({
    data: [
      {
        assetTag: "=CAM-001",
        name: "Camera Kit",
        type: "Camera",
        brand: "Sony",
        model: "FX6",
        computedStatus: "CHECKED_OUT",
        storedStatus: "AVAILABLE",
        location: "Main Cage",
        department: "Creative",
        category: "Cinema Cameras",
        availableForReservation: true,
        availableForCheckout: true,
        availableForCustody: false,
        periodCheckouts: 4,
        periodCustodyDays: "6.25",
        periodUtilizationRate: "6.9%",
        lastCheckedOutAt: "2026-05-30T09:00:00.000Z",
        updatedAt: "2026-06-02T12:00:00.000Z",
      },
    ],
    days: 90,
    total: 1,
    truncated: false,
    limit: 5000,
  } as never);
  vi.mocked(getCheckoutReport).mockResolvedValue({
    days: 30,
    totalCheckouts: 0,
    overdueCheckouts: 0,
    dailyTrend: [],
    heatmap: [],
    recentCheckouts: [],
    topRequesters: [],
  } as never);
  vi.mocked(getCheckoutReportExport).mockResolvedValue({
    data: [
      {
        id: "checkout-1",
        title: "Game Day Checkout",
        status: "OPEN",
        startsAt: new Date("2026-06-02T10:00:00.000Z"),
        endsAt: new Date("2026-06-02T12:00:00.000Z"),
        createdAt: new Date("2026-06-01T12:00:00.000Z"),
        requester: "Creative Admin",
        location: "Main Cage",
        itemCount: 3,
        isOverdue: true,
      },
      {
        id: "checkout-2",
        title: "Practice Checkout",
        status: "COMPLETED",
        startsAt: new Date("2026-06-01T10:00:00.000Z"),
        endsAt: new Date("2026-06-01T12:00:00.000Z"),
        createdAt: new Date("2026-06-01T09:00:00.000Z"),
        requester: "=Formula User",
        location: "Main Cage",
        itemCount: 1,
        isOverdue: false,
      },
    ],
    total: 2,
    truncated: false,
    limit: 5000,
  } as never);
  vi.mocked(getBulkLossReport).mockResolvedValue({
    totalLost: 0,
    bySku: [],
    byUser: [],
    recentLosses: [],
    batteryAudit: {
      totals: {
        skuCount: 0,
        totalUnits: 0,
        available: 0,
        checkedOut: 0,
        lost: 0,
        retired: 0,
        lossRate: 0,
        repeatPatternCount: 0,
      },
      bySku: [],
      missingUnits: [],
      checkoutHistory: [],
      repeatPatterns: [],
    },
  } as never);
  vi.mocked(getBulkLossReportExport).mockResolvedValue({
    data: [
      {
        section: "Battery missing units",
        itemFamily: "Sony NP-FZ100 Battery",
        category: "",
        location: "",
        unitNumber: 7,
        person: "=Formula User",
        booking: "CO-1001",
        timestamp: "2026-06-02T12:00:00.000Z",
        count: 1,
        status: "LOST",
        detail: "Last checkout 2026-06-01T12:00:00.000Z",
        notes: "Missing after event",
      },
      {
        section: "Battery family summary",
        itemFamily: "Sony NP-FZ100 Battery",
        category: "Camera Batteries",
        location: "Main Cage",
        unitNumber: "",
        person: "",
        booking: "",
        timestamp: "2026-06-02T12:00:00.000Z",
        count: 2,
        status: "8 available; 1 checked out; 0 retired; 10 total",
        detail: "Missing units: 7, 8",
        notes: "",
      },
    ],
    total: 2,
    truncated: false,
    limit: 5000,
  } as never);
  vi.mocked(getOverdueReport).mockResolvedValue({
    totalOverdueBookings: 1,
    leaderboard: [
      {
        userId: "user-1",
        name: "Creative Admin",
        overdueCount: 1,
        totalOverdueHours: 3,
        bookings: [],
      },
    ],
  } as never);
  vi.mocked(getOverdueReportExport).mockResolvedValue({
    data: [
      {
        bookingId: "booking-1",
        requester: "Creative Admin",
        title: "Game Day Checkout",
        endsAt: "2026-06-02T12:00:00.000Z",
        overdueHours: 3,
        location: "Main Cage",
        itemCount: 3,
        itemSummary: "CAM-1; AA Batteries x2",
      },
      {
        bookingId: "booking-2",
        requester: "=Formula User",
        title: "Practice Checkout",
        endsAt: "2026-06-01T12:00:00.000Z",
        overdueHours: 27,
        location: "Main Cage",
        itemCount: 1,
        itemSummary: "Mic Kit",
      },
    ],
    total: 2,
    truncated: false,
    limit: 5000,
  } as never);
  vi.mocked(getScanHistoryReport).mockResolvedValue({
    data: [],
    total: 0,
    successCount: 0,
    successRate: 0,
    dailyScans: [],
    limit: 50,
    offset: 0,
  } as never);
  vi.mocked(getScanHistoryReportExport).mockResolvedValue({
    data: [
      {
        id: "scan-1",
        actor: "Creative Admin",
        scanType: "QR",
        scanValue: "qr-1",
        success: true,
        phase: "CHECKIN",
        item: "Camera A",
        bookingId: "booking-1",
        bookingTitle: "Game Day Checkout",
        createdAt: new Date("2026-06-02T12:00:00.000Z"),
      },
      {
        id: "scan-2",
        actor: "=Formula User",
        scanType: "QR",
        scanValue: "qr-2",
        success: false,
        phase: "CHECKIN",
        item: "Camera B",
        bookingId: "booking-2",
        bookingTitle: "Practice Checkout",
        createdAt: new Date("2026-06-02T12:30:00.000Z"),
      },
    ],
    total: 2,
    truncated: false,
    limit: 5000,
  } as never);
});

describe("reports routes", () => {
  it("serves utilization report JSON without using the export service", async () => {
    const res = await getUtilizationReportRoute(
      authedGet("/api/reports/utilization"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(getUtilizationReport).toHaveBeenCalled();
    expect(getUtilizationReportExport).not.toHaveBeenCalled();
  });

  it("exports utilization inventory rows as bounded CSV", async () => {
    const res = await getUtilizationReportRoute(
      authedGet("/api/reports/utilization?format=csv"),
      { params: Promise.resolve({}) },
    );
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("utilization-report-");
    expect(res.headers.get("X-Exported-Count")).toBe("1");
    expect(res.headers.get("X-Total-Count")).toBe("1");
    expect(getUtilizationReport).not.toHaveBeenCalled();
    expect(getUtilizationReportExport).toHaveBeenCalled();
    expect(body).toContain("Asset Tag,Name,Type,Brand,Model,Derived Status,Stored Status,Location,Department,Category,Reservable,Checkoutable,Custody,Checkouts (period),Custody Days (period),Utilization (period),Last Checked Out,Updated At");
    expect(body).toContain("'=CAM-001,Camera Kit,Camera,Sony,FX6,CHECKED_OUT,AVAILABLE,Main Cage,Creative,Cinema Cameras,true,true,false,4,6.25,6.9%,2026-05-30T09:00:00.000Z,2026-06-02T12:00:00.000Z");
  });

  it("scopes the utilization export to the requested period", async () => {
    const res = await getUtilizationReportRoute(
      authedGet("/api/reports/utilization?format=csv&days=365"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(getUtilizationReportExport).toHaveBeenCalledWith(365);
    expect(res.headers.get("Content-Disposition")).toContain("utilization-report-365d-");
  });

  it("falls back to the default utilization period when days is invalid", async () => {
    const res = await getUtilizationReportRoute(
      authedGet("/api/reports/utilization?days=notanumber"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(getUtilizationReport).toHaveBeenCalledWith(90);
  });

  it("sets utilization export truncation headers when the inventory export is capped", async () => {
    vi.mocked(getUtilizationReportExport).mockResolvedValueOnce({
      data: [],
      total: 6000,
      truncated: true,
      limit: 5000,
    } as never);

    const res = await getUtilizationReportRoute(
      authedGet("/api/reports/utilization?format=csv"),
      { params: Promise.resolve({}) },
    );

    expect(res.headers.get("X-Truncated")).toBe("true");
    expect(res.headers.get("X-Total-Count")).toBe("6000");
  });

  it("passes validated checkout report days to the browse service", async () => {
    const res = await getCheckoutReportRoute(
      authedGet("/api/reports/checkouts?days=90"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(getCheckoutReport).toHaveBeenCalledWith(90, null);
    expect(getCheckoutReportExport).not.toHaveBeenCalled();
  });

  it("scopes the checkout row list to a focused day", async () => {
    const res = await getCheckoutReportRoute(
      authedGet("/api/reports/checkouts?days=90&date=2026-06-01"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(getCheckoutReport).toHaveBeenCalledWith(90, "2026-06-01");
  });

  it("ignores a malformed focus date", async () => {
    const res = await getCheckoutReportRoute(
      authedGet("/api/reports/checkouts?days=30&date=not-a-date"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(getCheckoutReport).toHaveBeenCalledWith(30, null);
  });

  it("exports all matching checkout rows as bounded CSV", async () => {
    const res = await getCheckoutReportRoute(
      authedGet("/api/reports/checkouts?format=csv&days=90"),
      { params: Promise.resolve({}) },
    );
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("checkouts-report-");
    expect(res.headers.get("X-Exported-Count")).toBe("2");
    expect(res.headers.get("X-Total-Count")).toBe("2");
    expect(getCheckoutReport).not.toHaveBeenCalled();
    expect(getCheckoutReportExport).toHaveBeenCalledWith(90);
    expect(body).toContain("Title,Requester,Status,Due,Items,Overdue");
    expect(body).toContain("Game Day Checkout,Creative Admin,OPEN,2026-06-02T12:00:00.000Z,3,true");
    expect(body).toContain("'=Formula User");
  });

  it("sets checkout export truncation headers when the filtered export is capped", async () => {
    vi.mocked(getCheckoutReportExport).mockResolvedValueOnce({
      data: [],
      total: 6000,
      truncated: true,
      limit: 5000,
    } as never);

    const res = await getCheckoutReportRoute(
      authedGet("/api/reports/checkouts?format=csv&days=30"),
      { params: Promise.resolve({}) },
    );

    expect(res.headers.get("X-Truncated")).toBe("true");
    expect(res.headers.get("X-Total-Count")).toBe("6000");
  });

  it("serves overdue report JSON without using the export service", async () => {
    const res = await getOverdueReportRoute(
      authedGet("/api/reports/overdue"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(getOverdueReport).toHaveBeenCalled();
    expect(getOverdueReportExport).not.toHaveBeenCalled();
  });

  it("exports overdue booking rows as bounded CSV", async () => {
    const res = await getOverdueReportRoute(
      authedGet("/api/reports/overdue?format=csv"),
      { params: Promise.resolve({}) },
    );
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("overdue-report-");
    expect(res.headers.get("X-Exported-Count")).toBe("2");
    expect(res.headers.get("X-Total-Count")).toBe("2");
    expect(getOverdueReport).not.toHaveBeenCalled();
    expect(getOverdueReportExport).toHaveBeenCalled();
    expect(body).toContain("Requester,Booking,Due,Overdue Hours,Location,Outstanding Items,Item Summary");
    expect(body).toContain("Creative Admin,Game Day Checkout,2026-06-02T12:00:00.000Z,3,Main Cage,3,CAM-1; AA Batteries x2");
    expect(body).toContain("'=Formula User");
  });

  it("sets overdue export truncation headers when the overdue export is capped", async () => {
    vi.mocked(getOverdueReportExport).mockResolvedValueOnce({
      data: [],
      total: 6000,
      truncated: true,
      limit: 5000,
    } as never);

    const res = await getOverdueReportRoute(
      authedGet("/api/reports/overdue?format=csv"),
      { params: Promise.resolve({}) },
    );

    expect(res.headers.get("X-Truncated")).toBe("true");
    expect(res.headers.get("X-Total-Count")).toBe("6000");
  });

  it("serves missing units report JSON without using the export service", async () => {
    const res = await getBulkLossReportRoute(
      authedGet("/api/reports/bulk-losses"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(getBulkLossReport).toHaveBeenCalled();
    expect(getBulkLossReportExport).not.toHaveBeenCalled();
  });

  it("exports missing-unit evidence sections as bounded CSV", async () => {
    const res = await getBulkLossReportRoute(
      authedGet("/api/reports/bulk-losses?format=csv"),
      { params: Promise.resolve({}) },
    );
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("missing-units-report-");
    expect(res.headers.get("X-Exported-Count")).toBe("2");
    expect(res.headers.get("X-Total-Count")).toBe("2");
    expect(getBulkLossReport).not.toHaveBeenCalled();
    expect(getBulkLossReportExport).toHaveBeenCalled();
    expect(body).toContain("Section,Item Family,Category,Location,Unit Number,Person,Booking,Timestamp,Count,Status,Detail,Notes");
    expect(body).toContain("Battery missing units,Sony NP-FZ100 Battery,,,7,'=Formula User,CO-1001,2026-06-02T12:00:00.000Z,1,LOST,Last checkout 2026-06-01T12:00:00.000Z,Missing after event");
    expect(body).toContain("Battery family summary,Sony NP-FZ100 Battery,Camera Batteries,Main Cage,,,,2026-06-02T12:00:00.000Z,2,8 available; 1 checked out; 0 retired; 10 total,\"Missing units: 7, 8\",");
  });

  it("sets missing units export truncation headers when the evidence export is capped", async () => {
    vi.mocked(getBulkLossReportExport).mockResolvedValueOnce({
      data: [],
      total: 6000,
      truncated: true,
      limit: 5000,
    } as never);

    const res = await getBulkLossReportRoute(
      authedGet("/api/reports/bulk-losses?format=csv"),
      { params: Promise.resolve({}) },
    );

    expect(res.headers.get("X-Truncated")).toBe("true");
    expect(res.headers.get("X-Total-Count")).toBe("6000");
  });

  it("rejects invalid checkout export days before calling the export service", async () => {
    const res = await getCheckoutReportRoute(
      authedGet("/api/reports/checkouts?format=csv&days=999999"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(getCheckoutReportExport).not.toHaveBeenCalled();
  });

  it("bounds checkout report lookback before calling the service", async () => {
    const res = await getCheckoutReportRoute(
      authedGet("/api/reports/checkouts?days=999999"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(getCheckoutReport).not.toHaveBeenCalled();
  });

  it("rejects invalid scan phases before calling the report service", async () => {
    const res = await getScanReport(
      authedGet("/api/reports/scans?phase=RETURN"),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid phase");
    expect(getScanHistoryReport).not.toHaveBeenCalled();
  });

  it("rejects invalid scan report dates before calling the report service", async () => {
    const res = await getScanReport(
      authedGet("/api/reports/scans?startDate=not-a-date"),
      { params: Promise.resolve({}) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid startDate");
    expect(getScanHistoryReport).not.toHaveBeenCalled();
  });

  it("passes validated scan filters to the report service", async () => {
    const res = await getScanReport(
      authedGet("/api/reports/scans?limit=25&offset=50&phase=CHECKIN&startDate=2026-05-01T00:00:00.000Z&endDate=2026-05-10T00:00:00.000Z"),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(getScanHistoryReport).toHaveBeenCalledWith(
      25,
      50,
      "2026-05-01T00:00:00.000Z",
      "2026-05-10T00:00:00.000Z",
      "CHECKIN",
    );
    expect(getScanHistoryReportExport).not.toHaveBeenCalled();
  });

  it("exports all matching scan rows as bounded CSV", async () => {
    const res = await getScanReport(
      authedGet("/api/reports/scans?format=csv&limit=25&offset=50&phase=CHECKIN&startDate=2026-05-01T00:00:00.000Z&endDate=2026-05-10T00:00:00.000Z"),
      { params: Promise.resolve({}) },
    );
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("scan-report-");
    expect(res.headers.get("X-Exported-Count")).toBe("2");
    expect(res.headers.get("X-Total-Count")).toBe("2");
    expect(getScanHistoryReport).not.toHaveBeenCalled();
    expect(getScanHistoryReportExport).toHaveBeenCalledWith(
      "2026-05-01T00:00:00.000Z",
      "2026-05-10T00:00:00.000Z",
      "CHECKIN",
    );
    expect(body).toContain("Timestamp,Actor,Item,Phase,Booking,Result");
    expect(body).toContain("2026-06-02T12:00:00.000Z,Creative Admin,Camera A,CHECKIN,Game Day Checkout,ok");
    expect(body).toContain("'=Formula User");
  });

  it("sets scan export truncation headers when the filtered export is capped", async () => {
    vi.mocked(getScanHistoryReportExport).mockResolvedValueOnce({
      data: [],
      total: 6000,
      truncated: true,
      limit: 5000,
    } as never);

    const res = await getScanReport(
      authedGet("/api/reports/scans?format=csv"),
      { params: Promise.resolve({}) },
    );

    expect(res.headers.get("X-Truncated")).toBe("true");
    expect(res.headers.get("X-Total-Count")).toBe("6000");
  });

  it("rejects invalid scan export filters before calling the export service", async () => {
    const invalidPhase = await getScanReport(
      authedGet("/api/reports/scans?format=csv&phase=RETURN"),
      { params: Promise.resolve({}) },
    );
    const invertedDates = await getScanReport(
      authedGet("/api/reports/scans?format=csv&startDate=2026-06-03T00:00:00.000Z&endDate=2026-06-01T00:00:00.000Z"),
      { params: Promise.resolve({}) },
    );

    expect(invalidPhase.status).toBe(400);
    expect(invertedDates.status).toBe(400);
    expect(getScanHistoryReportExport).not.toHaveBeenCalled();
  });
});
