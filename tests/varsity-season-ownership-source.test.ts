import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BIG_SIX_SPORT_CODES, isBigSixSportCode, VARSITY_OWNERSHIP_AREAS } from "@/lib/sports";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("varsity season ownership source contracts", () => {
  it("keeps the accepted classification code-owned and bounded", () => {
    expect(BIG_SIX_SPORT_CODES).toEqual(["FB", "MBB", "WBB", "MHKY", "WHKY", "VB"]);
    expect(VARSITY_OWNERSHIP_AREAS).toEqual(["VIDEO", "PHOTO", "GRAPHICS"]);
    expect(isBigSixSportCode("FB")).toBe(true);
    expect(isBigSixSportCode("WSOC")).toBe(false);
  });

  it("persists effective ownership history with restrictive actor and owner references", () => {
    const schema = read("prisma/schema.prisma");
    const migration = read("prisma/migrations/0140_varsity_season_ownership/migration.sql");
    expect(schema).toContain("model VarsitySeasonOwner");
    expect(schema).toContain("@@unique([sportCode, area, userId, startsOn])");
    expect(migration).toContain('CREATE TABLE "varsity_season_owners"');
    expect(migration.match(/ON DELETE RESTRICT/g)).toHaveLength(2);
  });

  it("limits the Admin editor to non-Big-Six sports and retains handoff history", () => {
    const wizard = read("src/components/schedule/SportSetupWizard.tsx");
    const editor = read("src/components/schedule/VarsityOwnershipEditor.tsx");
    expect(wizard).toContain('currentUser?.role === "ADMIN"');
    expect(wizard).toContain("!isBigSixSportCode(sport.sportCode)");
    expect(wizard).toContain("<VarsityOwnershipEditor");
    expect(editor).toContain("Primary season coverage");
    expect(editor).toContain("History:");
    expect(editor).toContain("Save handoff");
  });

  it("prefers only current eligible owners and explicitly refuses roster fallback", () => {
    const service = read("src/lib/services/bulk-schedule-assignment.ts");
    const types = read("src/lib/bulk-schedule-assignment-types.ts");
    expect(service).toContain("activeOwnerIds(ownershipRows");
    expect(service).toContain("scores.filter((score) => ownerIds.has(score.userId))");
    expect(service).toContain('reasonCode: "varsity_owner_unavailable"');
    expect(service).toContain("Auto assign does not fall back to another roster member.");
    expect(service).toContain("A proposed varsity owner is no longer current. Review the preview again.");
    expect(types).toContain('| "varsity_owner_unavailable"');
  });
});
