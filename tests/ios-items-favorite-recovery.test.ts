import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS Items favorite recovery", () => {
  it("keeps optimistic rollback visible when favorite updates fail", () => {
    const itemsView = source("ios/Wisconsin/Views/ItemsView.swift");

    expect(itemsView).toContain("func toggleFavorite(_ asset: Asset) async throws");
    expect(itemsView).toContain("applyFavorite(assetId: asset.id, value: asset.isFavorited)");
    expect(itemsView).toContain("throw error");
    expect(itemsView).toContain("@State private var toast: Toast?");
    expect(itemsView).toContain("private func toggleFavorite(_ asset: Asset) async");
    expect(itemsView).toContain("try await vm.toggleFavorite(asset)");
    expect(itemsView).toContain('Toast(message: "Couldn\'t update favorite", icon: "exclamationmark.triangle.fill", role: .error)');
    expect(itemsView).toContain(".toast($toast)");
  });
});
