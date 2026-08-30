import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

const SERVICE = "ios/Wisconsin/Core/SearchService.swift";
const SHEET = "ios/Wisconsin/Views/Search/GlobalSearchSheet.swift";

describe("iOS search partial results", () => {
  it("awaits each search source independently", () => {
    const service = source(SERVICE);

    // The regression this guards: a single `try await (a, b, c, d)` tuple made
    // one failing endpoint discard the three that succeeded, so a flaky people
    // lookup hid the item a student scanned for.
    expect(service).not.toContain("try await (\n            itemsTask, reservationsTask, checkoutsTask, usersTask\n        )");
    for (const task of ["itemsTask", "reservationsTask", "checkoutsTask", "usersTask"]) {
      expect(service).toContain(`try? await ${task}`);
    }
  });

  it("still reports a total outage as an error rather than as no matches", () => {
    const service = source(SERVICE);

    expect(service).toContain("if unavailable.count == SearchSource.allCases.count {");
    expect(service).toContain("throw APIError.serverError(");
  });

  it("names the sources that did not answer", () => {
    const service = source(SERVICE);

    expect(service).toContain("enum SearchSource");
    expect(service).toContain("var unavailableSources: Set<SearchSource>");
    expect(service).toContain("var partialResultNotice: String?");
    // The notice has to name what is missing; a bare "some results failed"
    // leaves the reader unable to judge whether the list is trustworthy.
    expect(service).toContain("didn't load. Showing everything else.");
  });

  it("shows the partial notice even when the surviving sources matched nothing", () => {
    const sheet = source(SHEET);

    // "No matches" would be false if the sources that could have matched are
    // exactly the ones that failed.
    expect(sheet).toContain("results.hasKnownMatches || results.partialResultNotice != nil");
    expect(sheet).toContain("results.partialResultNotice");
  });
});
