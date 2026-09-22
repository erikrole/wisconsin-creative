import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
// The bootstrapper is a plain ESM Node script with exported guards for regression coverage.
// @ts-expect-error no declaration file for local .mjs script modules
import { assertBootstrapSafe, generateBaselineSql } from "../scripts/bootstrap-empty-database.mjs";

describe("empty database bootstrap", () => {
  it("allows only a truly empty target or Prisma migration metadata", () => {
    expect(() => assertBootstrapSafe([])).not.toThrow();
    expect(() => assertBootstrapSafe(["_prisma_migrations"])).not.toThrow();
    expect(() => assertBootstrapSafe(["users"])).toThrow("target is not empty (users)");
  });

  it("generates the current schema baseline without a database connection", () => {
    const sql = generateBaselineSql();
    expect(sql).toContain('CREATE TABLE "users"');
    expect(sql).toContain('CREATE TABLE "asset_allocations"');
    expect(sql).not.toContain("postgresql://");
  });

  it("refuses the retired bootstrap before connecting or fabricating migration receipts", () => {
    const result = spawnSync(process.execPath, ["scripts/bootstrap-empty-database.mjs"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("bootstrap is retired");
    expect(result.stderr).toContain("preview:setup");
  });
});
