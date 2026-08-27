-- Brand asset experience metadata and per-user favorites. Existing files and
-- immutable versions remain untouched; recent files stay browser-local.

ALTER TABLE "resource_asset_versions"
    ADD COLUMN "version_note" TEXT;

ALTER TABLE "resource_asset_uploads"
    ADD COLUMN "version_note" TEXT;

CREATE TABLE "resource_asset_favorites" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_asset_favorites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "resource_asset_favorites_user_id_asset_id_key"
    ON "resource_asset_favorites"("user_id", "asset_id");
CREATE INDEX "resource_asset_favorites_user_id_created_at_idx"
    ON "resource_asset_favorites"("user_id", "created_at");
CREATE INDEX "resource_asset_favorites_asset_id_idx"
    ON "resource_asset_favorites"("asset_id");

ALTER TABLE "resource_asset_favorites"
    ADD CONSTRAINT "resource_asset_favorites_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "resource_asset_favorites_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "resource_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
