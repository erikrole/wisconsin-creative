import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without types
import { buildReleaseNotes } from "../scripts/release-notes.mjs";

const entries = [
  { date: "2026-10-24", title: "Calmer Dashboard", type: "improvement", summary: "Quieter.", pr: 621 },
  { date: "2026-10-20", title: "Badges", type: "feature", summary: "New badges." },
  { date: "2026-09-30", title: "Old", type: "fixes", summary: "Before the cut." },
];

describe("buildReleaseNotes", () => {
  it("groups entries after the cut by type and links PRs", () => {
    const notes = buildReleaseNotes(entries, "2026-10-01", "o/r");
    expect(notes).toContain("## New\n\n- **Badges**: New badges.");
    expect(notes).toContain("- **Calmer Dashboard**: Quieter. ([#621](https://github.com/o/r/pull/621))");
    expect(notes).not.toContain("Old");
    expect(notes.indexOf("## New")).toBeLessThan(notes.indexOf("## Improved"));
  });

  it("returns null when nothing shipped after the cut", () => {
    expect(buildReleaseNotes(entries, "2026-10-24")).toBeNull();
  });
});
