-- Brand assets are separate from Markdown Resources so one logical file can
-- retain immutable replacement history without changing guide semantics.

CREATE TYPE "ResourceAssetKind" AS ENUM (
    'LOGO',
    'FONT',
    'GRAPHIC_ELEMENT',
    'TEMPLATE',
    'COLOR_REFERENCE',
    'PHOTO',
    'VIDEO',
    'DOCUMENT',
    'OTHER'
);

CREATE TYPE "ResourceAssetUploadStatus" AS ENUM (
    'PENDING',
    'COMPLETED'
);

CREATE TABLE "resource_asset_folders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "parent_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_asset_folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "resource_assets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "folder_id" TEXT NOT NULL,
    "kind" "ResourceAssetKind" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "current_version_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "resource_asset_versions" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "original_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "etag" TEXT,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_asset_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "resource_asset_uploads" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "folder_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "kind" "ResourceAssetKind" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "original_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "ResourceAssetUploadStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_asset_uploads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "resource_asset_folders_path_key" ON "resource_asset_folders"("path");
CREATE INDEX "resource_asset_folders_parent_id_idx" ON "resource_asset_folders"("parent_id");

CREATE UNIQUE INDEX "resource_assets_current_version_id_key" ON "resource_assets"("current_version_id");
CREATE UNIQUE INDEX "resource_assets_folder_id_normalized_name_key" ON "resource_assets"("folder_id", "normalized_name");
CREATE INDEX "resource_assets_folder_id_name_idx" ON "resource_assets"("folder_id", "name");

CREATE UNIQUE INDEX "resource_asset_versions_storage_path_key" ON "resource_asset_versions"("storage_path");
CREATE UNIQUE INDEX "resource_asset_versions_asset_id_version_number_key" ON "resource_asset_versions"("asset_id", "version_number");
CREATE INDEX "resource_asset_versions_asset_id_version_number_idx" ON "resource_asset_versions"("asset_id", "version_number");

CREATE UNIQUE INDEX "resource_asset_uploads_storage_path_key" ON "resource_asset_uploads"("storage_path");
CREATE INDEX "resource_asset_uploads_asset_id_version_number_idx" ON "resource_asset_uploads"("asset_id", "version_number");
CREATE INDEX "resource_asset_uploads_actor_id_status_idx" ON "resource_asset_uploads"("actor_id", "status");
CREATE INDEX "resource_asset_uploads_expires_at_status_idx" ON "resource_asset_uploads"("expires_at", "status");

ALTER TABLE "resource_asset_folders"
    ADD CONSTRAINT "resource_asset_folders_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "resource_asset_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "resource_asset_folders_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "resource_assets"
    ADD CONSTRAINT "resource_assets_folder_id_fkey"
    FOREIGN KEY ("folder_id") REFERENCES "resource_asset_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "resource_assets_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "resource_assets_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resource_asset_versions"
    ADD CONSTRAINT "resource_asset_versions_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "resource_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "resource_asset_versions_uploaded_by_id_fkey"
    FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resource_assets"
    ADD CONSTRAINT "resource_assets_current_version_id_fkey"
    FOREIGN KEY ("current_version_id") REFERENCES "resource_asset_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "resource_asset_uploads"
    ADD CONSTRAINT "resource_asset_uploads_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "resource_asset_uploads_folder_id_fkey"
    FOREIGN KEY ("folder_id") REFERENCES "resource_asset_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "resource_asset_uploads_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "resource_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Keep the required root container empty. The supplied guide and all brand
-- folders/files are added later through the authenticated UI, not seeded here.
INSERT INTO "resource_asset_folders" ("id", "name", "path", "created_at", "updated_at") VALUES
    ('resource-folder-brand-assets', 'Brand assets', 'brand-assets', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
