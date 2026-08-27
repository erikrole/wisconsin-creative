import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("Brand asset library source contracts", () => {
  it("keeps the PDF and category folders out of migration seed data", () => {
    const migration = source("prisma/migrations/0135_brand_asset_library/migration.sql");
    expect(migration).toContain('CREATE TABLE "resource_asset_versions"');
    expect(migration).toContain("resource-folder-brand-assets");
    expect(migration).toContain("resource_asset_uploads_asset_id_version_number_idx");
    expect(migration).not.toContain("resource-folder-brand-logos");
    expect(migration).not.toContain("2026 Brand Guide");
  });

  it("models stable logical files, immutable versions, and short-lived upload intents", () => {
    const schema = source("prisma/schema.prisma");
    const service = source("src/lib/resource-assets.ts");
    const uploadModel = schema.slice(schema.indexOf("model ResourceAssetUpload"));

    expect(schema).toContain("model ResourceAssetFolder");
    expect(schema).toContain("model ResourceAssetVersion");
    expect(schema).toContain("model ResourceAssetUpload");
    expect(schema).toContain("currentVersionId String?");
    expect(schema).toContain("@@unique([folderId, normalizedName])");
    expect(uploadModel).not.toContain("@@unique([assetId, versionNumber])");
    expect(service).toContain("Prisma.TransactionIsolationLevel.Serializable");
    expect(service).toContain("resource_asset_version_uploaded");
    expect(service).toContain("headResourceAsset(intent.storagePath)");
    expect(service).toContain("currentVersionId: version.id");
  });

  it("binds client Blob uploads to an authenticated upload intent", () => {
    const tokenRoute = source("src/app/api/resources/assets/upload-token/route.ts");
    const component = source("src/components/resources/BrandAssetLibrary.tsx");

    expect(tokenRoute).toContain("handleUpload");
    expect(tokenRoute).toContain("pathname !== intent.storagePath");
    expect(tokenRoute).toContain("maximumSizeInBytes: intent.sizeBytes");
    expect(tokenRoute).toContain("intent.actorId !== user.id");
    expect(component).toContain('@vercel/blob/client');
    expect(component).toContain('access: "private"');
    expect(component).toContain("multipart: item.file.size > 4 * 1024 * 1024");
    expect(component).toContain("Upload new version");
    expect(component).toContain("earlier versions are not deleted");
  });

  it("keeps API reads/downloads authenticated and avoids returning raw Blob URLs", () => {
    const listRoute = source("src/app/api/resources/assets/route.ts");
    const downloadRoute = source("src/app/api/resources/assets/[id]/download/route.ts");
    const storage = source("src/lib/resource-assets-storage.ts");
    const env = source("src/lib/env.ts");

    expect(listRoute).toContain('requirePermission(user.role, "resource", "view")');
    expect(downloadRoute).toContain('requirePermission(user.role, "resource", "view")');
    expect(downloadRoute).toContain('"Content-Disposition"');
    expect(downloadRoute).toContain('"X-Content-Type-Options": "nosniff"');
    expect(downloadRoute).not.toContain("blob.url");
    expect(storage).toContain('access: "private"');
    expect(storage).toContain("if (error instanceof HttpError) throw error");
    expect(env).toContain("RESOURCE_ASSET_BLOB_READ_WRITE_TOKEN");
  });

  it("commits version numbers at finalize time and names folder conflicts clearly", () => {
    const service = source("src/lib/resource-assets.ts");

    // Two replacements prepared at once both reserve N+1; the winner must not
    // cost the other upload its immutable version row.
    expect(service).toContain("const versionNumber = (latest?.versionNumber ?? 0) + 1;");
    expect(service).toContain("versionNumber,\n            originalName: current.originalName,");
    expect(service).toContain("already exists here.");
    expect(service).toContain("status: ResourceAssetUploadStatus.PENDING,");
  });

  it("sandboxes inline SVG and streams the stored object's own length", () => {
    const downloadRoute = source("src/app/api/resources/assets/[id]/download/route.ts");

    expect(downloadRoute).toContain('version.contentType === "image/svg+xml"');
    expect(downloadRoute).toContain('"Content-Security-Policy": "sandbox;');
    expect(downloadRoute).toContain('"Content-Length": String(blob.blob.size)');
  });

  it("places the library under an explicit Resources tab without changing guide filters", () => {
    const page = source("src/app/(app)/resources/page.tsx");
    const brief = source("docs/BRIEF_BRAND_ASSET_LIBRARY_V1.md");

    expect(page).toContain('searchParams.get("tab") === "brand-assets"');
    expect(page).toContain("BrandAssetLibrary");
    expect(page).toContain('href="/resources?tab=brand-assets"');
    expect(brief).toContain("no PDF, asset, or category-folder records are seeded");
    expect(brief).toContain("Uploading a replacement");
  });
});
