import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("Resources UI ownership contracts", () => {
  it("provides URL-backed filtering plus quick-find navigation", () => {
    const page = source("src/app/(app)/resources/page.tsx");
    const palette = source("src/components/resources/ResourceCommandPalette.tsx");

    expect(page).toContain("<DebouncedSearchInput");
    expect(page).toContain("onValueChange={setSearchParam}");
    expect(page).toContain('aria-label="Filter resources"');
    expect(palette).toContain("Quick find");
    expect(palette).not.toContain("e.metaKey");
    expect(palette).not.toContain("⌘K");
  });

  it("does not turn failed guide or reference loads into empty directories", () => {
    const page = source("src/app/(app)/resources/page.tsx");

    expect(page).toContain("guidesError");
    expect(page).toContain("Could not load guides");
    expect(page).toContain("contactsError");
    expect(page).toContain("Could not load sport assignments");
    expect(page).toContain("OperationalPartialResultsAlert");
  });

  it("protects unsaved new-guide work and failed edit loads", () => {
    const create = source("src/app/(app)/resources/new/_components/NewGuideClient.tsx");
    const edit = source("src/app/(app)/resources/[slug]/edit/_components/EditGuideClient.tsx");

    expect(create).toContain('window.addEventListener("beforeunload"');
    expect(create).toContain("Discard this new guide?");
    expect(edit).toContain("Could not load this guide");
    expect(edit).toContain("You cannot edit this guide");
  });

  it("reports server-path clipboard failures", () => {
    const copy = source("src/components/resources/ServerPathCopy.tsx");

    expect(copy).toContain('toast.error("Could not copy the Media Drive path"');
  });
});
