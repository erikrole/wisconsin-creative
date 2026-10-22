import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const queries = readFileSync("src/lib/badges/queries.ts", "utf8");
const migration = readFileSync("prisma/migrations/0191_badge_celebrated_at/migration.sql", "utf8");

describe("badge celebration is acknowledged once on the server", () => {
  it("claims unshown awards atomically before returning them", () => {
    expect(queries).toContain('SET "celebrated_at" = now()');
    expect(queries).toContain('"celebrated_at" IS NULL');
    expect(queries).toContain('RETURNING "id"');
  });

  it("treats every award that already exists as shown", () => {
    expect(migration).toContain('ADD COLUMN "celebrated_at"');
    expect(migration).toContain('SET "celebrated_at" = "awarded_at"');
  });
});
