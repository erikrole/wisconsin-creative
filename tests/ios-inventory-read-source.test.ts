import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";
import { apiClientSource } from "./_helpers/ios-api-client-source";

describe("native kits and bulk inventory reads", () => {
  const api = apiClientSource();
  const browse = source("ios/Wisconsin/Views/BrowseView.swift");
  const kits = source("ios/Wisconsin/Views/KitsView.swift");
  const kitDetail = source("ios/Wisconsin/Views/KitDetailView.swift");
  const family = source("ios/Wisconsin/Views/BulkInventoryDetailView.swift");
  const batteries = source("ios/Wisconsin/Views/BatteryOpsView.swift");
  const items = source("ios/Wisconsin/Views/ItemsView.swift");
  const itemDetail = source("ios/Wisconsin/Views/ItemDetailView.swift");
  const composer = source("ios/Wisconsin/Views/CreateBooking/CreateBookingViewModel.swift");

  it("reads the shared kit, family, and battery routes", () => {
    expect(api).toContain('request(path: "/api/kits", queryItems: items)');
    expect(api).toContain('request(path: "/api/kits/\\(id)")');
    expect(api).toContain('request(path: "/api/bulk-skus/\\(id)")');
    expect(api).toContain('request(path: "/api/bulk-skus/batteries")');
    expect(batteries).not.toContain("repair-stale");
    expect(kits).not.toContain("method: \"POST\"");
    expect(family).not.toContain("method: \"POST\"");
  });

  it("reaches the screens from Browse and from the gear they belong to", () => {
    expect(browse).toContain("KitsView(wrapsInNavigationStack: false)");
    expect(browse).toContain("BatteryOpsView(wrapsInNavigationStack: false)");
    expect(browse).toContain('capabilities.contains("RESERVATION_CREATE") ? .kits : nil');
    expect(browse).toContain("rows.insert(.batteries, at: 5)");
    expect(items).toContain("BulkInventoryDetailView(skuId: route.id)");
    expect(source("ios/Wisconsin/Views/Search/GlobalSearchSheet.swift")).toContain("navigationPath.append(BulkSkuRoute(id: family.id))");
    expect(itemDetail).toContain("InventoryReadAccess.categoryBelongsInKits");
    expect(itemDetail).toContain("InventoryReadAccess.canOpenBatteryOps");
    expect(kitDetail).toContain("BulkInventoryDetailView(skuId: member.bulkSku.id)");
    expect(family).toContain("BatteryOpsView(wrapsInNavigationStack: false)");
  });

  it("keeps one reserve action and leaves authoring on the web", () => {
    expect(kitDetail).toContain("Reserve for an event");
    expect(family).toContain("Text(\"Reserve\")");
    expect(composer).toContain("func prefillCalledKit(id: String, locationId: String)");
    expect(composer).toContain("func prefillReservation(bulkSkuId: String, name: String, locationId: String)");
    expect(kits).toContain("Gameday kits are created on the web.");
    expect(batteries).toContain("Receiving, labels, and repairs stay on the web.");
    expect(family).toContain("Printing stays on the web.");
  });
});
