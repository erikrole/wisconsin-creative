import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tab = readFileSync("src/app/(app)/users/[id]/UserScoreboardTab.tsx", "utf8");
const service = readFileSync("src/lib/services/scoreboard.ts", "utf8");

describe("profile Scoreboard sport filter", () => {
  it("lets the route own the current season instead of hard-coding it in the client", () => {
    expect(tab).toContain("new URLSearchParams({ limit: String(INITIAL_LIMIT) })");
    expect(tab).not.toContain('season: "2026-27"');
  });

  it("holds its options from an unfiltered read", () => {
    // The route narrows its own breakdowns, so a filtered response only carries
    // the sports that survived the filter.
    expect(service).toContain("if (filters.sportCode) where.sportCode = filters.sportCode;");

    expect(tab).toContain("const [sportOptions, setSportOptions] = useState<SportOption[]>([]);");
    expect(tab).toContain("const isUnfiltered = resultFilter === \"all\" && sportFilter === \"all\";");
    // Only a settled, unfiltered response may replace the held list.
    expect(tab).toContain("if (!data || !isUnfiltered || loading || refreshing) return;");
    // The dropdown must never be built from whatever the current response holds.
    expect(tab).not.toContain("data.bySport.filter((bucket) => bucket.key !== null)");
  });

  it("names a selected sport the option list does not carry", () => {
    expect(tab).toContain("const selectedIsListed = sportFilter === \"all\"");
    expect(tab).toContain("[...listedSports, { key: sportFilter, label: sportFilter }]");
  });

  it("hides the control instead of offering an empty filter", () => {
    expect(tab).toContain("{sportChoices.length > 0 ? (");
  });

  it("guards and recovers paged reads without shrinking filter targets", () => {
    expect(tab).toContain("const loadingMoreRef = useRef(false);");
    expect(tab).toContain("const loadMoreAbortRef = useRef<AbortController | null>(null);");
    expect(tab).toContain("requestUrlRef.current !== requestUrl");
    expect(tab).toContain("mergeScoreboardEvents(");
    expect(tab).toContain("extraEvents.nextCursor !== undefined");
    expect(tab).toContain("Couldn’t load more games");
    expect(tab).toContain('loading={loadingMore}');
    expect(tab).toContain('value="WIN" className="h-10 text-xs"');
    expect(tab).toContain('className="h-10 w-[190px] text-xs"');
  });
});
