import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("flagged damage report review", () => {
  it("shows the photo and a maintenance action on web, not just a Photo badge", () => {
    const banner = source("src/app/(app)/dashboard/flagged-report-dialog.tsx");
    expect(banner).toContain("function FlaggedReportDialog");
    expect(banner).toContain("src={item.imageUrl}");
    expect(banner).toContain("/api/assets/${item.assetId}/maintenance");
    expect(banner).toContain("Clear maintenance");
  });

  it("shows the photo and a maintenance action on iOS", () => {
    const model = source("ios/Wisconsin/Models/DashboardModels.swift");
    expect(model).toContain("let imageUrl: String?");
    expect(model).toContain("let assetStatus: String?");
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    expect(home).toContain("private struct FlaggedReportSheet: View");
    expect(home).toContain("AsyncImage(url: url)");
    expect(home).toContain("APIClient.shared.toggleAssetMaintenance(assetId: item.assetId)");
  });
});
