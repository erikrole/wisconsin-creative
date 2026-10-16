import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const reports = read("ios/Wisconsin/Views/ReportsView.swift");
const client = read("ios/Wisconsin/Core/APIClient.swift");
const screens = [
  "ios/Wisconsin/Views/Reports/CheckoutReportView.swift",
  "ios/Wisconsin/Views/Reports/UtilizationReportView.swift",
  "ios/Wisconsin/Views/Reports/UsageReportView.swift",
  "ios/Wisconsin/Views/Reports/ScanReportView.swift",
  "ios/Wisconsin/Views/Reports/MissingUnitsReportView.swift",
  "ios/Wisconsin/Views/Reports/BadgeReportView.swift",
].map(read).join("\n");

describe("native report library", () => {
  it("opens the missing read-only reports from the existing Reports view", () => {
    expect(reports).toContain("UtilizationReportView()");
    expect(reports).toContain("CheckoutReportView()");
    expect(reports).toContain("MissingUnitsReportView()");
    expect(reports).toContain("ScanReportView()");
    expect(reports).toContain("BadgeReportView()");
    expect(reports).toContain("if vm.showsUsageReport");
    expect(reports).toContain("UsageReportView()");
    expect(reports).toContain("canViewUsageAnalytics()");
  });

  it("reads the shared report endpoints and never asks for a CSV export", () => {
    expect(client).toContain('path: "/api/reports/checkouts"');
    expect(client).toContain('path: "/api/reports/utilization"');
    expect(client).toContain('path: "/api/reports/usage"');
    expect(client).toContain('path: "/api/reports/scans"');
    expect(client).toContain('path: "/api/reports/bulk-losses"');
    expect(client).toContain('path: "/api/reports/badges"');
    expect(screens).not.toContain("format=csv");
    expect(screens).not.toContain("Export");
    expect(client).not.toContain('name: "format"');
  });

  it("keeps usage hidden unless the account flag allows it", () => {
    expect(client).toContain("resp.canViewUsageAnalytics ?? false");
    expect(screens).toContain("Usage counts are limited to the owner.");
  });
});
