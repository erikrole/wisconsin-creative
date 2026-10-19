import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/permissions";
import { DEFAULT_OTS_CONTROL, normalizeOtsControl, OTS_SCENARIOS, otsControlInputSchema } from "@/lib/services/ots-control";

describe("OTS board control", () => {
  it("falls back to live for a missing or malformed row, so the board never goes dark", () => {
    expect(normalizeOtsControl(undefined)).toEqual(DEFAULT_OTS_CONTROL);
    expect(normalizeOtsControl({ mode: "party" })).toEqual(DEFAULT_OTS_CONTROL);
    expect(normalizeOtsControl("live")).toEqual(DEFAULT_OTS_CONTROL);
  });

  it("keeps a valid stored row with who changed it", () => {
    const row = { mode: "demo", scenario: "walkoff", gamePk: null, updatedAt: "2026-10-24T23:00:00.000Z", updatedBy: "Erik Role" };
    expect(normalizeOtsControl(row)).toEqual(row);
  });

  it("accepts only numeric MLB game IDs and known scenarios", () => {
    expect(otsControlInputSchema.safeParse({ mode: "live", gamePk: "849815" }).success).toBe(true);
    expect(otsControlInputSchema.safeParse({ mode: "live", gamePk: "abc" }).success).toBe(false);
    expect(otsControlInputSchema.safeParse({ mode: "demo", scenario: "rain-delay" }).success).toBe(false);
    expect(otsControlInputSchema.parse({ mode: "hold" })).toEqual({ mode: "hold", scenario: "cycle", gamePk: null });
  });

  it("offers exactly the scenarios the board can play", () => {
    const board = readFileSync("public/ots/board.js", "utf8");
    const block = (name: string) => board.slice(board.indexOf(`const ${name} = {`), board.indexOf("\n  };", board.indexOf(`const ${name} = {`)));
    const keys = (name: string) => Array.from(block(name).matchAll(/^ {4}'?([a-z0-9-]+)'?:\s/gm), (m) => m[1]);
    const boardScenarios = ["cycle", "sim", ...keys("DEMO"), ...keys("GAMES")].sort();
    expect([...OTS_SCENARIOS].sort()).toEqual(boardScenarios);
    const control = readFileSync("public/ots/control.html", "utf8");
    for (const s of OTS_SCENARIOS) expect(control).toContain(`<option value="${s}">`);
  });

  it("lets only staff and admins change the board", () => {
    expect(PERMISSIONS.ots_board?.control).toEqual(["ADMIN", "STAFF"]);
  });
});
