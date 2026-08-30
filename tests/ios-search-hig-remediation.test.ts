import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS global Search HIG remediation", () => {
  const service = source("ios/Wisconsin/Core/SearchService.swift");
  const sheet = source("ios/Wisconsin/Views/Search/GlobalSearchSheet.swift");
  const row = source("ios/Wisconsin/Views/Search/SearchResultRow.swift");

  it("keeps server totals and cursors for every paginated source", () => {
    expect(service).toContain("struct SearchPage");
    expect(service).toContain("let total: Int");
    expect(service).toContain("let nextOffset: Int");
    expect(service).toContain("var sourceTotals: [SearchSource: Int] = [:]");
    expect(service).toContain("var sourceNextOffsets: [SearchSource: Int] = [:]");
    expect(service).toContain("mutating func apply(_ page: SearchPage, for source: SearchSource, appending: Bool)");
    expect(service).toContain("func hasMore(for source: SearchSource) -> Bool");
    expect(service).toContain("func loadMore(");
    for (const sourceCall of [
      "api.assets(",
      "api.reservations(",
      "api.checkouts(",
      "api.users(",
    ]) {
      expect(service).toContain(sourceCall);
    }
    expect(service).toContain("offset: offset");
  });

  it("shows loaded-versus-total truth and a bounded continuation action", () => {
    expect(sheet).toContain("results.hasKnownMatches || results.partialResultNotice != nil");
    expect(sheet).toContain("sectionHeader(\"Items\", source: .items)");
    expect(sheet).toContain("Text(loaded == total ? \"\\(total)\" : \"\\(loaded) of \\(total)\")");
    expect(sheet).toContain("if results.hasMore(for: .items)");
    expect(sheet).toContain("private func moreResultsRow(for source: SearchSource)");
    expect(sheet).toContain("Show more \\(source.label.lowercased())");
    expect(sheet).toContain("SearchService.shared.loadMore(");
    expect(sheet).toContain("loadMoreErrors[source]");
  });

  it("makes typed and scanned family results reserveable", () => {
    expect(sheet).toContain("private func startReservation(forFamily family: AssetFamilySearchResult)");
    expect(sheet).toContain("composer.prefillReservation(forFamily: family)");
    expect(sheet).toContain("ItemFamilyResultRow(family: family, showsReserveAction: true)");
    expect(sheet).toContain("Starts a reservation for this item family.");
    expect(sheet).toContain("suppressNextQuerySearch = true");
    expect(row).toContain("var showsReserveAction = false");
    expect(row).toContain('Label("Reserve", systemImage: "plus.circle")');
  });

  it("keeps recents visible across roles and records real result use", () => {
    expect(sheet).toContain("if trimmedQuery.isEmpty {");
    expect(sheet).toContain("recentsView");
    expect(sheet).not.toContain("if isCollaborator {\n                            recentsView");
    expect(sheet).toContain("private func rememberActiveQuery()");
    expect(sheet).toContain("rememberActiveQuery()\n                            navigationPath.append");
    expect(sheet).toContain("rememberActiveQuery()\n                            startReservation(forFamily: family)");
  });
});
