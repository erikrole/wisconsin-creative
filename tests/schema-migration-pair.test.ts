import { describe, expect, it } from "vitest";

// @ts-expect-error no declaration file for local .mjs script modules
import { evaluateSchemaMigrationPair } from "../scripts/check-schema-migration-pair.mjs";

describe("evaluateSchemaMigrationPair", () => {
  it("passes changes that do not touch the Prisma schema", () => {
    expect(evaluateSchemaMigrationPair({
      changedPaths: ["src/app/page.tsx"],
      prismaDiff: "ALTER TABLE users ADD COLUMN nickname TEXT;",
    })).toMatchObject({ ok: true, reason: "schema-unchanged" });
  });

  it("passes schema changes paired with migration SQL", () => {
    expect(evaluateSchemaMigrationPair({
      changedPaths: [
        "prisma/schema.prisma",
        "prisma/migrations/0142_add_nickname/migration.sql",
      ],
      prismaDiff: "ALTER TABLE users ADD COLUMN nickname TEXT;",
    })).toMatchObject({ ok: true, reason: "migration-paired" });
  });

  it("passes relation-only schema changes with no physical DDL", () => {
    expect(evaluateSchemaMigrationPair({
      changedPaths: ["prisma/schema.prisma"],
      prismaDiff: "-- This is an empty migration.\n",
    })).toMatchObject({ ok: true, reason: "no-physical-change" });
  });

  it("fails physical schema changes without migration SQL", () => {
    expect(evaluateSchemaMigrationPair({
      changedPaths: ["prisma/schema.prisma"],
      prismaDiff: "ALTER TABLE users ADD COLUMN nickname TEXT;",
    })).toMatchObject({ ok: false, reason: "missing-migration" });
  });
});
