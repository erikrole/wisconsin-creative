import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("Operations progressive load contracts", () => {
  it("does not block the whole page on the slowest feed", () => {
    const page = source("src/app/(app)/operations/OperationsClient.tsx");

    expect(page).toContain("hasAnyData");
    expect(page).toContain("somethingStillLoading");
    expect(page).toContain("LaneSkeleton");
    expect(page).toContain("totalFailure");
    expect(page).toContain("Operations could not load");
    expect(page).not.toContain("const loading = (isAdmin && fixToday.loading) || hygiene.loading || batteries.loading");
  });

  it("renders lane placeholders while sibling feeds finish", () => {
    const page = source("src/app/(app)/operations/OperationsClient.tsx");

    expect(page).toContain("fixToday.loading && !fixToday.data");
    expect(page).toContain("hygiene.loading && !hygiene.data");
    expect(page).toContain("batteries.loading && !batteries.data");
    expect(page).toContain('title="Run the day"');
    expect(page).toContain('title="Keep data clean"');
  });
});

describe("Import wizard chrome contracts", () => {
  it("exposes a described header and accessible step rail", () => {
    const page = source("src/app/(app)/import/page.tsx");

    expect(page).toContain("Upload a CSV, map columns");
    expect(page).toContain('aria-label="Import steps"');
    expect(page).toContain("aria-current={current ? \"step\" : undefined}");
    expect(page).toContain('className="h-10"');
  });
});
