import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";
import { walkFiles } from "./_helpers/source-tree";

describe("full-color CSS token syntax", () => {
  it("does not wrap complete color tokens in hsl()", () => {
    const files = walkFiles("src", (name) => /\.(?:css|ts|tsx)$/.test(name), "style-sources");

    // Guard the guard: an empty sweep must not read as a pass.
    expect(files.length).toBeGreaterThan(100);

    const offenders = files.filter((file) => /hsl\(var\(--/.test(source(file)));
    expect(offenders).toEqual([]);
  });

  it("uses OKLCH mixing for partial-opacity arbitrary shadows", () => {
    const sources = [
      "src/app/(app)/schedule/_components/ListView.tsx",
      "src/app/(app)/schedule/_components/ScheduleFilters.tsx",
      "src/app/(app)/users/[id]/UserBadgesTab.tsx",
    ].map((path) => source(path));

    for (const source of sources) {
      expect(source).toContain("color-mix(in_oklch");
    }
  });
});
