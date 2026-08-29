import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assertSafeGeneratedSql,
  nextMigrationDirectoryName,
  parseArguments,
} from "../scripts/prisma-migrate-create.mjs";

describe("offline Prisma migration generation", () => {
  it("parses the repository command contract", () => {
    expect(parseArguments(["--name", "football_game_day_roles"])).toEqual({
      name: "football_game_day_roles",
      allowDestructive: false,
    });
    expect(parseArguments(["--name", "drop_legacy", "--allow-destructive"])).toEqual({
      name: "drop_legacy",
      allowDestructive: true,
    });
    expect(() => parseArguments(["--name", "Football Roles"])).toThrow("lowercase snake_case");
    expect(() => parseArguments(["--unknown"])).toThrow("Unknown migration option");
  });

  it("chooses the next four-digit repository prefix", () => {
    expect(nextMigrationDirectoryName([
      "0137_web_push_subscriptions",
      "0138_sport_auto_assign_policy",
    ], "football_game_day_roles")).toBe("0139_football_game_day_roles");
  });

  it("blocks destructive SQL until explicitly acknowledged", () => {
    expect(() => assertSafeGeneratedSql('ALTER TABLE "users" ADD COLUMN "nickname" TEXT;')).not.toThrow();
    expect(() => assertSafeGeneratedSql('ALTER TABLE "users" DROP COLUMN "nickname";')).toThrow("destructive SQL");
    expect(() => assertSafeGeneratedSql(
      'ALTER TABLE "users" DROP COLUMN "nickname";',
      { allowDestructive: true },
    )).not.toThrow();
  });

  it("routes both create-only package commands through the offline wrapper", () => {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    expect(packageJson.scripts["db:migrate:new"]).toBe("node scripts/prisma-migrate-create.mjs");
    expect(packageJson.scripts["db:migrate:raw"]).toBe("node scripts/prisma-migrate-create.mjs");
  });
});
