ALTER TABLE "resources"
  ADD COLUMN "import_key" TEXT;

CREATE UNIQUE INDEX "resources_import_key_key"
  ON "resources"("import_key");
