import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("Schedule freshness source contract", () => {
  // The reads themselves (no-store, the option values) are behavior-tested in
  // tests/schedule-read.test.ts. This only checks every Schedule query uses them.
  it("overrides global React Query staleness for Schedule surfaces", () => {
    const hook = read("src/hooks/use-schedule-data.ts");

    expect(hook.match(/\.\.\.SCHEDULE_FRESH_QUERY_OPTIONS/g)?.length).toBe(5);
    expect(hook).not.toContain("staleTime: 60_000");
    expect(hook).not.toContain("staleTime: 30_000");
  });
});
