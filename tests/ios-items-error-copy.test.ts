import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS Items error copy", () => {
  it("maps initial and pagination load failures to recovery-oriented copy", () => {
    const itemsView = source("ios/Wisconsin/Views/ItemsView.swift");

    expect(itemsView).toContain("self.error = itemListErrorMessage(error)");
    expect(itemsView).toContain("self.pageError = itemListErrorMessage(error, loadingMore: true)");
    expect(itemsView).toContain("private func itemListErrorMessage(_ error: Error, loadingMore: Bool = false) -> String");
    expect(itemsView).toContain("Couldn't load items. Check your connection and try again.");
    expect(itemsView).toContain("Couldn't load more items. Check your connection and try again.");
    expect(itemsView).toContain("Items could not be read. Refresh and try again.");
    expect(itemsView).not.toContain("self.error = error.localizedDescription");
    expect(itemsView).not.toContain("self.pageError = error.localizedDescription");
  });
});
