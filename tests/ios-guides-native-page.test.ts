import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

function appTabViewShell() {
  return source("ios/Wisconsin/Views/AppTabView.swift").split("// MARK: - Profile")[0] ?? "";
}

function guidesClientFunction(apiClient: string) {
  const match = apiClient.match(/func guides\([\s\S]*?\n    }\n/);
  return match?.[0] ?? "";
}

function guideDetailClientFunction(apiClient: string) {
  const match = apiClient.match(/func guide\(slug: String\)[\s\S]*?\n    }\n/);
  return match?.[0] ?? "";
}

describe("iOS native Guides page", () => {
  it("uses the existing read-only Resources API contract", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const guidesClient = guidesClientFunction(apiClient);
    const guideDetailClient = guideDetailClientFunction(apiClient);
    const models = source("ios/Wisconsin/Models/Models.swift");
    const listRoute = source("src/app/api/resources/route.ts");
    const detailRoute = source("src/app/api/resources/[id]/route.ts");

    expect(guidesClient).toContain("func guides(search: String? = nil, category: String? = nil) async throws -> [GuideListItem]");
    expect(guidesClient).toContain('request(path: "/api/resources", queryItems: items)');
    expect(guidesClient).not.toContain('request(path: "/api/resources/upload-image"');
    expect(guidesClient).not.toContain('method: "POST")');
    expect(guideDetailClient).toContain("func guide(slug: String) async throws -> GuideListItem");
    expect(guideDetailClient).toContain('request(path: "/api/resources/\\(slug)")');

    expect(models).toContain("enum ResourceType: String, Codable");
    expect(models).toContain("struct GuideListItem: Codable, Identifiable, Hashable");
    expect(models).toContain('searchText = try container.decodeIfPresent(String.self, forKey: .searchText) ?? ""');
    expect(models).toContain("markdown = try container.decodeIfPresent(String.self, forKey: .markdown) ?? \"\"");
    expect(models).toContain("targetRoles = try container.decodeIfPresent([String].self, forKey: .targetRoles) ?? []");
    expect(models).toContain("targetAreas = try container.decodeIfPresent([String].self, forKey: .targetAreas) ?? []");
    expect(models).toContain("published = try container.decodeIfPresent(Bool.self, forKey: .published) ?? true");

    expect(listRoute).toContain('const published = user.role === Role.STUDENT ? true : undefined;');
    expect(listRoute).toContain("const guides = await listGuides({ published, category, search, audience });");
    expect(detailRoute).toContain("if (user.role === Role.STUDENT && !guide.published)");
  });

  it("renders Guides with native SwiftUI list, search, refresh, and reader patterns", () => {
    const view = source("ios/Wisconsin/Views/GuidesView.swift");

    // Path-backed so the tab-reset gesture can pop the reader back to the list.
    expect(view).toContain("NavigationStack(path: $navigationPath) { configuredContent }");
    expect(view).toContain("List {");
    expect(view).toContain(".listStyle(.insetGrouped)");
    expect(view).toContain(".searchable(");
    expect(view).toContain("prompt: Text(\"Search guides\")");
    expect(view).toContain(".refreshable { await vm.load(forceRefresh: true) }");
    expect(view).toContain("ContentUnavailableView");
    // Value-based navigation, so the destination is registered once outside the
    // conditional content and the reset gesture can clear the path.
    expect(view).toContain("NavigationLink(value: guide)");
    expect(view).toContain(".navigationDestination(for: GuideListItem.self)");
    expect(view).toContain("GuideReaderView(guide: guide)");
    // The reader fetches full Markdown by slug; the response is bound first so a
    // superseded refresh can be discarded before it lands.
    expect(view).toContain("let fetched = try await APIClient.shared.guide(slug: guide.slug)");
    expect(view).toContain("loadedGuide = fetched");
    expect(view).toContain('Label("Couldn\'t load this guide", systemImage: "wifi.exclamationmark")');
    expect(view).toContain(".refreshable { await load(forceRefresh: true) }");
    expect(view).toContain("NativeMarkdownArticle(markdown: displayedGuide.markdown)");
    expect(view).toContain("GuideReaderHeader(");
    expect(view).toContain(".font(.title.weight(.bold))");
    expect(view).toContain(".navigationTitle(displayedGuide.title)");
    expect(view).toContain('Text("Updated \\(guide.updatedSummary) by \\(guide.author.name)")');
    expect(view).not.toContain("let summary: String");
    expect(view).toContain("if case .rule = block.kind { return true }");
    expect(view).toContain("GuideBlockView(block: block, isFirst: index == 0)");
    expect(view).toContain(".background(Color(.systemBackground))");
    expect(view).toContain(".background(Color.cardSurfaceRaised, in: Circle())");
    expect(view).toContain('.accessibilityLabel("Step \\(number). \\(text.plain)")');
    expect(view).not.toContain(".font(.gothamBold(size: 30))");
    // Inline runs are rendered from the parsed spans rather than re-parsed
    // with AttributedString, which dropped images and inline code styling.
    expect(view).toContain("GuideInlineLabel(");
    expect(view).toContain("piece.link = link");
    expect(view).not.toContain("AttributedString(markdown: markdown");
    expect(view).not.toContain("Edit");
    expect(view).not.toContain("markVerified");
    expect(view).not.toContain("upload-image");
  });

  it("wires native Guides into Settings and the regular-width Resources sidebar", () => {
    const appTab = appTabViewShell();
    const browse = source("ios/Wisconsin/Views/BrowseView.swift");

    expect(appTab).toContain('Tab("Browse", systemImage: "square.grid.2x2", value: 2)');
    expect(appTab).toContain("BrowseView()");
    expect(browse).toContain("GuidesView(wrapsInNavigationStack: false)");
    expect(appTab).toContain('Tab("Guides", systemImage: "book.closed", value: 6)');
    expect(appTab).toContain("GuidesView()");
    expect(appTab).not.toContain("https://wisconsincreative.com/resources");
    expect(browse).toContain("GuidesView(wrapsInNavigationStack: false)");
  });

  it("reaches Guides through Browse on compact width and the sidebar on regular width", () => {
    const appTab = appTabViewShell();
    const browse = source("ios/Wisconsin/Views/BrowseView.swift");
    const settings = source("ios/Wisconsin/Views/SettingsView.swift");

    expect(appTab).toContain('Tab("Browse", systemImage: "square.grid.2x2", value: 2)');
    expect(appTab).toContain("if showsSidebarDestinations {");
    expect(appTab).toContain(".tabPlacement(.sidebarOnly)");
    expect(browse).toContain("GuidesView(wrapsInNavigationStack: false)");

    // There is no Settings > Directory route. This test used to be named for
    // one, and AREA_RESOURCES.md documented it, but Settings only hosts account
    // security and notifications — Browse and the sidebar are the real paths.
    expect(settings).not.toContain("GuidesView");
  });
});
