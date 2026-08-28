import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPORT_AUTO_ASSIGN_POLICY,
  policyAllowsWorkerType,
  resolveSportAutoAssignPolicy,
  SPORT_AUTO_ASSIGN_POLICIES,
  SPORT_AUTO_ASSIGN_POLICY_LABELS,
  SportAutoAssignPolicy,
} from "@/lib/sport-auto-assign-policy";

describe("sport auto-assign policy", () => {
  it("leaves an unconfigured sport behaving exactly as before", () => {
    expect(DEFAULT_SPORT_AUTO_ASSIGN_POLICY).toBe(SportAutoAssignPolicy.FULL_CREW);
    expect(resolveSportAutoAssignPolicy(new Map(), "MSOC")).toBe(SportAutoAssignPolicy.FULL_CREW);
  });

  it("treats a non-sport event as fully automatable", () => {
    const policies = new Map([["FB", SportAutoAssignPolicy.HOLD]]);
    expect(resolveSportAutoAssignPolicy(policies, null)).toBe(SportAutoAssignPolicy.FULL_CREW);
    expect(resolveSportAutoAssignPolicy(policies, undefined)).toBe(SportAutoAssignPolicy.FULL_CREW);
    expect(resolveSportAutoAssignPolicy(policies, "")).toBe(SportAutoAssignPolicy.FULL_CREW);
  });

  it("resolves a configured sport to its own policy", () => {
    const policies = new Map([
      ["FB", SportAutoAssignPolicy.HOLD],
      ["MBB", SportAutoAssignPolicy.STAFF_ONLY],
    ]);
    expect(resolveSportAutoAssignPolicy(policies, "FB")).toBe(SportAutoAssignPolicy.HOLD);
    expect(resolveSportAutoAssignPolicy(policies, "MBB")).toBe(SportAutoAssignPolicy.STAFF_ONLY);
  });

  it("fills both classes under FULL_CREW", () => {
    expect(policyAllowsWorkerType(SportAutoAssignPolicy.FULL_CREW, "FT")).toBe(true);
    expect(policyAllowsWorkerType(SportAutoAssignPolicy.FULL_CREW, "ST")).toBe(true);
  });

  it("fills staff and leaves students open under STAFF_ONLY", () => {
    expect(policyAllowsWorkerType(SportAutoAssignPolicy.STAFF_ONLY, "FT")).toBe(true);
    expect(policyAllowsWorkerType(SportAutoAssignPolicy.STAFF_ONLY, "ST")).toBe(false);
  });

  it("fills nothing under HOLD", () => {
    expect(policyAllowsWorkerType(SportAutoAssignPolicy.HOLD, "FT")).toBe(false);
    expect(policyAllowsWorkerType(SportAutoAssignPolicy.HOLD, "ST")).toBe(false);
  });

  it("labels every policy", () => {
    for (const policy of SPORT_AUTO_ASSIGN_POLICIES) {
      expect(SPORT_AUTO_ASSIGN_POLICY_LABELS[policy].length).toBeGreaterThan(0);
    }
  });
});

describe("the Big 6 policies seeded by migration 0138", () => {
  const migration = "prisma/migrations/0138_sport_auto_assign_policy/migration.sql";

  it("holds Football and staffs the other five", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(migration, "utf8");

    expect(sql).toContain("'FB',   true, 'HOLD'");
    for (const code of ["MBB", "WBB", "MHKY", "WHKY", "VB"]) {
      expect(sql).toMatch(new RegExp(`'${code}',\\s+true, 'STAFF_ONLY'`));
    }
    // Insert, not update alone: a sport with no config row would otherwise
    // fall through to FULL_CREW and be assigned against its stated policy.
    expect(sql).toContain('ON CONFLICT ("sport_code") DO UPDATE');
    expect(sql).toContain("DEFAULT 'FULL_CREW'");
  });
});
