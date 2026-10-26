import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("user detail location options state", () => {
  it("passes form-options location loading, error, and retry state into the profile info tab", () => {
    const source = readFileSync("src/app/(app)/staff/[id]/page.tsx", "utf8");

    expect(source).toContain("error: formOptionsError");
    expect(source).toContain("reload: reloadFormOptions");
    expect(source).toContain("locationsLoading={formOptionsLoading}");
    expect(source).toContain("locationsError={Boolean(formOptionsError)}");
    expect(source).toContain("onRetryLocations={reloadFormOptions}");
    // What the tab does with that state is rendered in tests/user-info-tab.test.ts.
  });
});
