import { describe, expect, it } from "vitest";
import {
  FOOTBALL_GAMEDAY_KIT_ROLES,
  callingKitLabel,
  compareFootballGamedayKits,
  footballGamedayKitRoleLabel,
  footballGamedayKitRoleSchema,
  nullableFootballGamedayKitRoleSchema,
  optionalFootballGamedayKitRoleSchema,
} from "@/lib/football-gameday-kits";

describe("football gameday kit jobs", () => {
  it("names the eight video jobs SLOW1 through ROAM4", () => {
    expect(FOOTBALL_GAMEDAY_KIT_ROLES).toEqual([
      "SLOW1",
      "SLOW2",
      "BENCH",
      "ROAM1",
      "ROAM2",
      "ROAM3",
      "ROAM4",
    ]);
    expect(footballGamedayKitRoleLabel("SLOW1")).toBe("SLOW1");
    expect(footballGamedayKitRoleLabel("BENCH")).toBe("BENCH");
    expect(footballGamedayKitRoleLabel("ROAM4")).toBe("ROAM4");
    expect(footballGamedayKitRoleLabel("PHOTO1")).toBeNull();
  });

  it("sorts SLOW1 before ROAM kits and unnamed kits last", () => {
    const kits = [
      { name: "High 2", gamedayRole: null },
      { name: "ROAM2", gamedayRole: "ROAM2" },
      { name: "SLOW1 FX6", gamedayRole: "SLOW1" },
    ];
    expect([...kits].sort(compareFootballGamedayKits).map((kit) => kit.name)).toEqual([
      "SLOW1 FX6",
      "ROAM2",
      "High 2",
    ]);
  });

  it("shows the job first when calling a kit", () => {
    expect(callingKitLabel({ name: "SLOW1", gamedayRole: "SLOW1", contents: 6 })).toBe("SLOW1 · 6");
    expect(callingKitLabel({ name: "SLOW1 FX6", gamedayRole: "SLOW1", contents: 6 })).toBe(
      "SLOW1 · SLOW1 FX6 · 6",
    );
    expect(callingKitLabel({ name: "Interview", contents: 3 })).toBe("Interview · 3");
  });

  it("treats blank football jobs as unset", () => {
    expect(optionalFootballGamedayKitRoleSchema.parse("")).toBeUndefined();
    expect(optionalFootballGamedayKitRoleSchema.parse("SLOW2")).toBe("SLOW2");
    expect(nullableFootballGamedayKitRoleSchema.parse("")).toBeNull();
    expect(footballGamedayKitRoleSchema.safeParse("PHOTO1").success).toBe(false);
  });
});
