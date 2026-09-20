import { describe, expect, it } from "vitest";
import { CALLOUT_TYPES as EDITOR_CALLOUT_TYPES } from "@/lib/editor-snippets";
import { CALLOUT_TYPES as READER_CALLOUT_TYPES } from "@/lib/remark-callouts";
import { source } from "./_helpers/source";

describe("Guide Markdown callout contract", () => {
  it("keeps the web reader, editor, and iOS kind lists in lockstep", () => {
    expect([...EDITOR_CALLOUT_TYPES]).toEqual(READER_CALLOUT_TYPES.map((type) => type.toUpperCase()));

    const ios = source("ios/Wisconsin/Views/GuideMarkdown.swift");
    for (const type of READER_CALLOUT_TYPES) {
      expect(ios).toContain(`case ${type}`);
    }
    expect(ios).toContain("case copy(String)");
    expect(ios).toContain('language == "copy" || language == "path"');
    expect(ios).toContain("omittingDuplicateLeadHeading");

    const contract = source("docs/GUIDE_MARKDOWN.md");
    expect(contract).toContain("SHORTCUT");
    expect(contract).toContain("`⌘K`");
    expect(contract).toContain("```copy");
    expect(contract).toContain("Do not start a guide with `# Title`");
    expect(contract).toContain("Do not use GFM task lists");
  });
});
