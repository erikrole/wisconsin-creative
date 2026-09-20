import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS item list identity", () => {
  it("centralizes tag-first item identity in Swift models", () => {
    const assetModels = source("ios/Wisconsin/Models/AssetModels.swift");
    const itemListText = source("ios/Wisconsin/Shared/ItemListText.swift");
    const bookingModels = source("ios/Wisconsin/Models/Models.swift");
    const kioskModels = source("ios/Wisconsin/Kiosk/KioskModels.swift");
    const kioskStore = source("ios/Wisconsin/Kiosk/KioskStore.swift");

    expect(assetModels).toContain("var itemListPrimaryTitle: String");
    expect(assetModels).toContain("assetTag.nonBlankText ?? displayName");
    expect(assetModels).toContain("var itemListSecondaryTitle: String?");
    expect(itemListText).toContain("func isSameListText(as other: String) -> Bool");

    expect(bookingModels).toContain("struct BookingAsset");
    expect(bookingModels).toContain("assetTag.nonBlankText ?? displayName.nonBlankText ?? \"Item\"");
    expect(bookingModels).toContain("var assignedUnitNumbers: [Int]");
    expect(bookingModels).toContain("return unitTags.nonBlankText ?? bulkSku.name");

    expect(kioskModels).toContain("tagName.nonBlankText ?? name");
    expect(kioskStore).toContain("tagName.nonBlankText ?? name");
  });

  it("renders serialized iOS item rows with asset tags as the primary header", () => {
    const itemsView = source("ios/Wisconsin/Views/ItemsView.swift");
    const bookingDetail = source("ios/Wisconsin/Views/BookingDetailView.swift");
    const createRows = source("ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentRows.swift");
    const createSheet = source("ios/Wisconsin/Views/CreateBookingSheet.swift");
    const searchRow = source("ios/Wisconsin/Views/Search/SearchResultRow.swift");
    const linkWizard = source("ios/Wisconsin/Views/DevTools/LinkStickerWizard.swift");

    for (const file of [itemsView, bookingDetail, createRows, createSheet, searchRow, linkWizard]) {
      expect(file).toContain("itemListPrimaryTitle");
      expect(file).toContain("itemListSecondaryTitle");
      expect(file).toContain(".font(.gothamBold");
    }

    expect(createRows).not.toContain("Text(asset.displayName)");
    expect(createSheet).not.toContain("Text(asset.displayName)");
    expect(searchRow).not.toContain("asset.name ?? asset.assetTag ?? asset.displayName");
  });

  it("renders kiosk item rows tag-first, including numbered bulk units", () => {
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");
    const components = source("ios/Wisconsin/Kiosk/KioskComponents.swift");
    const pickup = source("ios/Wisconsin/Kiosk/KioskPickupView.swift");
    const returns = source("ios/Wisconsin/Kiosk/KioskReturnView.swift");

    expect(checkout).toContain("var primaryTitle: String");
    expect(checkout).toContain("let tags = unitNumbers.map { \"#\\($0)\" }.joined(separator: \" \")");
    expect(checkout).toContain("Text(group.primaryTitle)");
    expect(checkout).toContain(".font(.gothamBold(size: 16))");
    expect(checkout).not.toContain("Text(group.title)");

    expect(idle).toContain("Text(group.primaryTitle)");
    expect(idle).not.toContain("Text(group.title)");
    expect(components).toContain("Text(tag)");
    expect(components).toContain(".font(.gothamBold(size: 16))");
    expect(pickup).toContain("tag: confirmedItemOverrides[item.id]?.itemListPrimaryTitle");
    expect(returns).toContain("tag: item.itemListPrimaryTitle");
  });
});
