import { describe, it, expect } from "vitest";
// @ts-expect-error plain ESM script
import { COMMANDS, localizeTimes, parseArgs, toChicago } from "../scripts/wc.mjs";

describe("wc cli helpers", () => {
  it("shows instants in America/Chicago, never Z", () => {
    expect(toChicago("2026-10-30T18:00:00Z")).toBe("2026-10-30T13:00:00-05:00");
    expect(toChicago("2026-12-01T18:00:00.000Z")).toBe("2026-12-01T12:00:00-06:00");
    expect(localizeTimes({ a: [{ at: "2026-10-30T18:00:00Z" }], b: "keep" })).toEqual({
      a: [{ at: "2026-10-30T13:00:00-05:00" }],
      b: "keep",
    });
  });

  it("parses flags and positionals", () => {
    expect(parseArgs(["schedule", "assign", "g", "--dry-run", "--from=2026-10-01", "--to", "x"])).toEqual({
      positional: ["schedule", "assign", "g"],
      flags: { "dry-run": true, from: "2026-10-01", to: "x" },
    });
  });

  it("lists every command once with usage", () => {
    const names = COMMANDS.map((c: { name: string }) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(COMMANDS.every((c: { usage: string }) => c.usage.length > 0)).toBe(true);
  });
});
