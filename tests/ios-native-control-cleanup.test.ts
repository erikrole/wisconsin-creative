import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

function sliceBetween(sourceText: string, start: string, end: string) {
  const startIndex = sourceText.indexOf(start);
  const endIndex = sourceText.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return sourceText.slice(startIndex, endIndex);
}

describe("iOS native control cleanup", () => {
  it("centers Scan in the empty Search state and replaces it when typing begins", () => {
    const search = source("ios/Wisconsin/Views/Search/GlobalSearchSheet.swift");

    expect(search).toContain(".searchable(");
    expect(search).toContain("var showsCancelButton = true");
    expect(search).toContain("if showsCancelButton");
    expect(search).toContain("text: $query");
    expect(search).toContain("placement: .navigationBarDrawer(displayMode: .always)");
    expect(search).toContain('prompt: Text(isCollaborator ? "Search reservable gear" : "Search items, bookings, people")');
    expect(search).toContain("if !isCollaborator");
    expect(search).toContain("SearchService.shared.search(query: query, gearOnly: isCollaborator)");
    expect(search).toContain(".onSubmit(of: .search) { commitSearch() }");
    expect(search).toContain('Label("Scan QR code", systemImage: "qrcode.viewfinder")');
    expect(search).toContain("VStack(spacing: 0)");
    expect(search).toContain("if trimmedQuery.isEmpty");
    expect(search).toContain("private var scannerEmptyState: some View");
    expect(search).toContain('Label("Scan a code", systemImage: "qrcode.viewfinder")');
    expect(search).toContain(".frame(maxWidth: .infinity, maxHeight: .infinity)");
    expect(search).toContain("query.trimmingCharacters(in: .whitespacesAndNewlines)");
    expect(search).toContain(".buttonStyle(.borderedProminent)");
    expect(search).toContain("private func presentScanner()");
    expect(search).toContain("isSearchPresented = false");
    expect(search).not.toContain("@FocusState private var fieldFocused");
    expect(search).not.toContain("private var searchBar");
    expect(search).not.toContain(".safeAreaInset(edge: .bottom");
    expect(search).not.toContain("ToolbarItemGroup(placement: .keyboard)");
    expect(search).not.toContain('TextField("Search items, bookings, people');
  });

  it("keeps Items search native and moves filters into toolbar menus", () => {
    const items = source("ios/Wisconsin/Views/ItemsView.swift");

    expect(items).toContain(".searchable(");
    expect(items).toContain("text: $vm.searchText");
    expect(items).toContain("placement: .navigationBarDrawer(displayMode: .always)");
    expect(items).toContain("ToolbarItemGroup(placement: .topBarTrailing)");
    expect(items).toContain('Label("Favorites", systemImage: vm.favoritesOnly ? "star.fill" : "star")');
    expect(items).toContain("AssetStatusFilterMenu(selected: $vm.selectedStatuses)");
    expect(items).toContain("ItemSortMenu(selected: $vm.sortOption)");
    expect(items).not.toContain("private var itemsControlStrip");
    expect(items).not.toContain("private struct ItemControlPill");
    expect(items).not.toContain("ScrollView(.horizontal, showsIndicators: false)");
  });

  it("uses native searchable for equipment search in Create Booking", () => {
    const picker = source("ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentPicker.swift");
    const sheet = source("ios/Wisconsin/Views/CreateBookingSheet.swift");

    expect(picker).toContain(".searchable(");
    expect(picker).toContain("placement: .navigationBarDrawer(displayMode: .always)");
    expect(picker).toContain('prompt: "Search all equipment"');
    expect(picker).not.toContain(".searchFocused($searchFocused)");
    expect(picker).toContain("ToolbarItem(placement: .bottomBar)");
    expect(picker).toContain(".refreshable");
    expect(picker).not.toContain(".toolbar(removing: .search)");
    expect(picker).not.toContain("equipmentSearchField");
    expect(picker).not.toContain('TextField("Search all equipment"');
    expect(sheet).toContain("Picker(selection: browseCategorySelection)");
    expect(sheet).toContain('Image(systemName: "barcode.viewfinder")');
    expect(sheet).toContain('.accessibilityLabel("Scan equipment")');
  });

  it("uses native bordered booking detail actions instead of glass buttons", () => {
    const booking = source("ios/Wisconsin/Views/BookingDetailView.swift");
    const actions = sliceBetween(
      booking,
      "private struct ActionsSection",
      "private struct BookingExtendBar",
    );
    const extendBar = sliceBetween(
      booking,
      "private struct BookingExtendBar",
      "// MARK: - Shared",
    );

    expect(actions).not.toContain(".buttonStyle(.glass)");
    expect(actions).toMatch(/Label\("Cancel Booking"[\s\S]*?\.buttonStyle\(\.bordered\)[\s\S]*?\.buttonBorderShape\(\.capsule\)[\s\S]*?\.controlSize\(\.large\)/);
    expect(extendBar).not.toContain(".buttonStyle(.glass)");
    expect(extendBar).toMatch(/Label\("Extend Return Date"[\s\S]*?\.buttonStyle\(\.bordered\)[\s\S]*?\.buttonBorderShape\(\.capsule\)[\s\S]*?\.controlSize\(\.large\)/);
    expect(extendBar).toContain(".background(.ultraThinMaterial)");
    expect(extendBar).not.toContain("Divider()");
  });
});
