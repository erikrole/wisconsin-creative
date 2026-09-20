import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildItemAssetTagSortKey, compareItemAssetTags } from "@/lib/item-asset-tag-sort";

/**
 * `assets.asset_tag_sort_key` lets the Items list paginate in Postgres instead
 * of loading every matching asset and sorting it in Node. Two things have to
 * hold for that to be safe:
 *
 *   1. ordering by the flattened key reproduces `compareItemAssetTags`, and
 *   2. the PL/pgSQL mirror in the migration stays paired with the TS helper.
 *
 * There is no database in this suite, so (2) is checked structurally: the
 * migration carries the same fixture list this test sorts, and the DDL/
 * trigger/index statements the route's `orderBy` depends on must be present.
 */
const MIGRATION_PATH = join(
  process.cwd(),
  "prisma/migrations/0151_asset_tag_sort_key/migration.sql",
);

const migrationSql = readFileSync(MIGRATION_PATH, "utf8");

function readMigrationFixtures() {
  const block = migrationSql.match(
    /-- SORT_KEY_FIXTURES_BEGIN\n([\s\S]*?)-- SORT_KEY_FIXTURES_END/,
  );
  if (!block) throw new Error("Migration 0151 is missing its SORT_KEY_FIXTURES block");
  return block[1]!
    .split("\n")
    .map((line) => line.replace(/^--\s{0,3}/, "").trimEnd())
    .filter((line) => line.trim().length > 0);
}

const FIXTURE_TAGS = readMigrationFixtures();

describe("asset tag sort key (migration 0151)", () => {
  it("keeps a non-empty fixture list in the migration", () => {
    expect(FIXTURE_TAGS.length).toBeGreaterThan(10);
    expect(FIXTURE_TAGS).toContain("FB 70-200 1");
    expect(FIXTURE_TAGS).toContain("70200 4");
  });

  it("orders fixtures the same way compareItemAssetTags does", () => {
    const byComparator = [...FIXTURE_TAGS].sort(compareItemAssetTags);
    const bySortKey = [...FIXTURE_TAGS].sort((a, b) => {
      const keyComparison = buildItemAssetTagSortKey(a).localeCompare(
        buildItemAssetTagSortKey(b),
        undefined,
        { sensitivity: "variant" },
      );
      if (keyComparison !== 0) return keyComparison;
      return a < b ? -1 : a > b ? 1 : 0;
    });

    expect(bySortKey).toEqual(byComparator);
  });

  it("produces a stable six-field key", () => {
    const key = buildItemAssetTagSortKey("FB 70-200 1");
    expect(key.split("")).toHaveLength(6);
    // family key, then prefix rank 1 (prefixed rows sort after bare ones).
    expect(key.split("")[1]).toBe("1");
    expect(buildItemAssetTagSortKey("70-200 1").split("")[1]).toBe("0");
    // numeric runs are zero-padded so 10 sorts after 2.
    expect(buildItemAssetTagSortKey("70-200 2") < buildItemAssetTagSortKey("70-200 10")).toBe(true);
  });

  it("applies the same family-token hyphenation the JS helper applies", () => {
    // 70200 and 70-200 are one family (first key field) but stay distinguishable
    // on the later fields, exactly as compareItemAssetTags treats them.
    const compact = buildItemAssetTagSortKey("70200 4").split("");
    const hyphenated = buildItemAssetTagSortKey("70-200 4").split("");
    expect(compact[0]).toBe(hyphenated[0]);
    expect(compact[0]).toBe(`${"0".repeat(10)}70-${"0".repeat(9)}200`);
    expect(compact[2]).toBe(hyphenated[2]);
    expect(compact).not.toEqual(hyphenated);
  });

  it("declares the column, trigger, and index the route orderBy depends on", () => {
    expect(migrationSql).toMatch(/ADD COLUMN IF NOT EXISTS "asset_tag_sort_key" TEXT COLLATE "C"/);
    expect(migrationSql).toMatch(/UPDATE "assets" SET "asset_tag_sort_key" = bg_asset_tag_sort_key\("asset_tag"\)/);
    expect(migrationSql).toMatch(/CREATE TRIGGER "assets_asset_tag_sort_key"/);
    expect(migrationSql).toMatch(/BEFORE INSERT OR UPDATE OF "asset_tag" ON "assets"/);
    expect(migrationSql).toMatch(/CREATE INDEX IF NOT EXISTS "assets_asset_tag_sort_key_idx"/);
  });

  it("keeps the PL/pgSQL prefix tables in sync with the TypeScript tables", () => {
    for (const prefix of ["BASE", "MBB", "WRESTLING", "XC"]) {
      expect(migrationSql).toContain(`'${prefix}'`);
    }
    for (const starter of ["ANTON/BAUER", "INSTA360", "PROGRADE", "SMALLRIG"]) {
      expect(migrationSql).toContain(`'${starter}'`);
    }
  });
});
