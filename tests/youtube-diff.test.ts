import { describe, expect, it } from "vitest";

import { wordDiff } from "@/lib/youtube/diff";

describe("wordDiff", () => {
  it("returns one unchanged run for identical text", () => {
    expect(wordDiff("Badgers win", "Badgers win")).toEqual([{ kind: "same", text: "Badgers win" }]);
  });

  it("marks replaced words as removed then added", () => {
    const parts = wordDiff("Highlights vs Robert Morris", "Highlights vs. Robert Morris");
    expect(parts.filter((p) => p.kind === "removed").map((p) => p.text)).toEqual(["vs"]);
    expect(parts.filter((p) => p.kind === "added").map((p) => p.text)).toEqual(["vs."]);
  });

  it("handles empty input on either side", () => {
    expect(wordDiff("", "New title")).toEqual([{ kind: "added", text: "New title" }]);
    expect(wordDiff("Old", "")).toEqual([{ kind: "removed", text: "Old" }]);
  });
});
