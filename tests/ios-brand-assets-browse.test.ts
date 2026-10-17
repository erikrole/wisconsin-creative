import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const browse = () => source("ios/Wisconsin/Views/BrowseView.swift");
const library = () => source("ios/Wisconsin/Views/BrandAssetsView.swift");
const models = () => source("ios/Wisconsin/Models/BrandAssetModels.swift");
const client = () => source("ios/Wisconsin/Core/APIClient.swift");

describe("iOS Brand assets browse", () => {
  it("adds a read-only Brand assets row for internal roles and keeps collaborators off it", () => {
    const menu = browse();
    const internalRows = menu.slice(
      menu.indexOf('guard session.currentUser?.role == "COLLABORATOR" else {'),
      menu.indexOf("let capabilities"),
    );

    expect(internalRows).toContain("[.scoreboard, .accountability, .events, .items, .kits, .guides, .brandAssets, .blasts, .licenses, .users]");
    expect(internalRows).toContain("rows.insert(.batteries, at: 5)");
    expect(menu).toContain('case .brandAssets: "Brand assets"');
    expect(menu).toContain("Logos, PDFs, and other brand files.");
    expect(menu).toContain("BrandAssetsView(wrapsInNavigationStack: false)");
    expect(menu).toContain('case .users: "Users"');

    const collaboratorRows = menu.slice(
      menu.indexOf("let capabilities"),
      menu.indexOf("var body: some View"),
    );
    expect(collaboratorRows).not.toContain(".brandAssets");
    expect(collaboratorRows).toContain(".scoreboard");
  });

  it("lists folders and files inside the Browse navigation stack", () => {
    const view = library();

    expect(view).toContain("var wrapsInNavigationStack = true");
    expect(view).toContain("brandAssets(");
    expect(view).toContain("BrandAssetFilePage(asset: asset)");
    expect(view).toContain("NavigationLink(value: BrandAssetFolderRoute(id: folder.id))");
    expect(view).toContain('placement: .navigationBarDrawer(displayMode: .always)');
    expect(view).toContain("guard appState.resetTab == 2 else { return }");
    expect(view).toContain("Uploading a version stays on the web.");
    expect(view).toContain("Sharing does not install it on this iPhone.");
    expect(view).toContain("ShareLink(item: fileURL)");
    expect(view).not.toMatch(/method:\s*"(POST|PATCH|DELETE|PUT)"/);
    expect(view).not.toContain("Restore");
    expect(view).not.toContain("Favorite");
    expect(view).not.toMatch(/\.foregroundStyle\(\.(red|green|blue|orange|purple)\)/);
  });

  it("reads the existing asset list and downloads the current file only", () => {
    const api = client();
    const catalog = models();

    expect(api).toContain('request(path: "/api/resources/assets", queryItems: items)');
    expect(api).toContain('request(path: "/api/resources/assets/\\(id)/download")');
    expect(api).toContain('items.append(.init(name: "scope", value: "all"))');
    expect(api).toContain("timeoutIntervalForResource = 180");
    expect(api).not.toContain("/api/resources/assets/complete");
    expect(api).not.toContain("/api/resources/assets/folders");
    expect(catalog).toContain("let brandAssetInlineByteLimit = 40 * 1024 * 1024");
    expect(catalog).toContain("default-src 'none'");
    expect(catalog).toContain("func brandAssetSVGDocument");
  });
});
