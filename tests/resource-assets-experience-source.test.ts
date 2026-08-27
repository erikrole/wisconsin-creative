import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("Brand asset experience source contracts", () => {
  it("adds version notes and personal favorites without seeding content", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/0136_brand_asset_experience/migration.sql");

    expect(schema).toContain("versionNote");
    expect(schema).toContain("model ResourceAssetFavorite");
    expect(migration).toContain('ALTER TABLE "resource_asset_versions"');
    expect(migration).toContain('CREATE TABLE "resource_asset_favorites"');
    expect(migration).not.toContain("2026 Brand Guide");
    expect(migration).not.toContain("INSERT INTO");
  });

  it("supports all-folder search, kind/sort/favorite filters, and folder location context", () => {
    const service = source("src/lib/resource-assets.ts");
    const route = source("src/app/api/resources/assets/route.ts");

    expect(service).toContain('scope?: "folder" | "all"');
    // Descendant scope must not leak a sibling that merely shares a name prefix.
    expect(service).toContain("{ path: folder.path }, { path: { startsWith: `${folder.path}/` } }");
    expect(service).not.toContain("startsWith: folder.path }");
    expect(service).toContain("favoritesOnly");
    expect(service).toContain('input.sort === "updated"');
    expect(service).toContain("currentVersion: { is: { originalName");
    expect(route).toContain('searchParams.get("kind")');
    expect(route).toContain('searchParams.get("favorites") === "1"');
    expect(route).toContain('searchParams.get("scope") === "all"');
  });

  it("restores a prior version by copying private storage into a new immutable row", () => {
    const service = source("src/lib/resource-assets.ts");
    const storage = source("src/lib/resource-assets-storage.ts");
    const route = source("src/app/api/resources/assets/[id]/restore/route.ts");

    expect(service).toContain("restoreResourceAssetVersion");
    expect(service).toContain("copyResourceAsset(source.storagePath");
    expect(service).toContain("resource_asset_version_restored");
    expect(service).toContain("Restored from version");
    expect(service).toContain("deleteResourceAsset(copied.pathname)");
    expect(storage).toContain("copy(pathname, targetPathname");
    expect(route).toContain('requirePermission(user.role, "resource", "edit")');
  });

  it("keeps favorites authenticated and audited", () => {
    const service = source("src/lib/resource-assets.ts");
    const route = source("src/app/api/resources/assets/[id]/favorite/route.ts");

    expect(service).toContain("toggleResourceAssetFavorite");
    expect(service).toContain("resource_asset_favorite_added");
    expect(service).toContain("resource_asset_favorite_removed");
    expect(route).toContain('requirePermission(user.role, "resource", "favorite")');
  });

  it("exposes previews, recents, links, resilient uploads, and conflict choices in the UI", () => {
    const component = source("src/components/resources/BrandAssetLibrary.tsx");
    const downloadRoute = source("src/app/api/resources/assets/[id]/download/route.ts");
    const middleware = source("src/middleware.ts");

    expect(component).toContain("FontSpecimen");
    expect(component).toContain("AssetPreviewDialog");
    expect(component).toContain("Recent files");
    expect(component).toContain("Copy internal link");
    expect(component).toContain("Retry failed");
    expect(component).toContain("Upload as new version");
    expect(component).toContain("What changed");
    expect(component).toContain("Make current");
    expect(downloadRoute).toContain('"X-Frame-Options": inline ? "SAMEORIGIN" : "DENY"');
    expect(middleware).toContain("connect-src 'self' https://vercel.com https://*.public.blob.vercel-storage.com");
  });

  it("keeps the Brand assets surface focused on a Drive-style file browser", () => {
    const component = source("src/components/resources/BrandAssetLibrary.tsx");
    const page = source("src/app/(app)/resources/page.tsx");

    expect(component).toContain("function LibraryRail");
    expect(component).toContain("Suggested folders");
    expect(component).toContain("onViewChange");
    expect(component).toContain("DropdownMenuContent");
    expect(component).toContain("<Table>");
    expect(component).toContain('label={`Actions for ${asset.name}`}');
    expect(component).toContain('placeholder="Search in Brand assets"');
    expect(page).toContain('description={resourceTab === "brand-assets" ? undefined');
  });

  it("keeps nested folders reachable and offers drop-to-upload and column sorting", () => {
    const component = source("src/components/resources/BrandAssetLibrary.tsx");
    const service = source("src/lib/resource-assets.ts");

    // The folder grid used to be root-only, which stranded every nested folder.
    expect(component).toContain('const showFolders = libraryView === "home" && !showingGlobalResults');
    expect(component).not.toContain('libraryView === "home" && !folderId && !showingGlobalResults');
    expect(component).toContain("childFolders={libraryData.folders}");
    expect(service).not.toContain('folders: scope === "all" ? [] :');

    expect(component).toContain("function SortableHead");
    expect(component).toContain("dropHandlers");
    expect(component).toContain("Drop files into");
    expect(component).toContain("initialFiles");
    expect(component).toContain("openedLinkRef");
  });
});
