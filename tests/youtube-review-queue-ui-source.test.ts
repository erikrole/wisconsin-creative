import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const queue = source("src/app/(app)/youtube/ReviewQueue.tsx");

describe("YouTube review queue recovery", () => {
  it("offers Refresh from the empty library state and Retry after a failed refresh", () => {
    expect(queue).toContain("EmptyContent");
    expect(queue).toContain("No uploads loaded");
    expect(queue).toContain("Refresh library");
    expect(queue).toContain("Retry refresh");
    expect(queue).toContain("The last refresh failed:");
  });

  it("clears view, sport, visibility, search, and raw-clip filters together", () => {
    expect(queue).toContain("clearFilters");
    expect(queue).toContain("Clear filters");
    expect(queue).toContain('setView("queue")');
    expect(queue).toContain('setSport("All sports")');
    expect(queue).toContain('setPrivacy("All visibility")');
    expect(queue).toContain('setSearch("")');
    expect(queue).toContain("setShowRaw(false)");
  });
});
