import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("Blasts web UI recovery contracts", () => {
  it("surfaces list load failures instead of an empty history", () => {
    const page = source("src/app/(app)/blasts/page.tsx");

    expect(page).toContain("error && !data");
    expect(page).toContain("Blasts are offline");
    expect(page).toContain("Could not load blasts");
    expect(page).toContain("waitingCount");
    expect(page).toContain("refreshing");
  });

  it("distinguishes detail load failure from a missing blast", () => {
    const page = source("src/app/(app)/blasts/[id]/page.tsx");

    expect(page).toContain("error && !data");
    expect(page).toContain("Blast detail is offline");
    expect(page).toContain("Blast not found");
    expect(page).toContain('href="/blasts"');
    expect(page).toContain("ToggleGroup");
    expect(page).toContain("md:hidden");
  });

  it("recovers when compose target lookups fail", () => {
    const dialog = source("src/app/(app)/blasts/_components/ComposeBlastDialog.tsx");

    expect(dialog).toContain("events.error && !events.data");
    expect(dialog).toContain("users.error && !users.data");
    expect(dialog).toContain("Couldn’t load events");
    expect(dialog).toContain("Couldn’t load people");
    expect(dialog).toContain("min-h-10");
  });
});

describe("Welcome web UI recovery contracts", () => {
  it("does not leave a permanent skeleton when profile completion fails", () => {
    const page = source("src/app/(app)/welcome/page.tsx");

    expect(page).toContain("isError && !data");
    expect(page).toContain("Could not load your welcome setup");
    expect(page).toContain("void refetch()");
    expect(page).toContain('window.location.replace("/")');
  });
});
