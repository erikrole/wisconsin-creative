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
  });

  it("does not make a failed profile location-options load look like no saved location", () => {
    const source = readFileSync("src/app/(app)/staff/[id]/UserInfoTab.tsx", "utf8");

    expect(source).toContain("locationsLoading");
    expect(source).toContain("locationsError");
    expect(source).toContain("locationOptionsUnavailable");
    expect(source).toContain("Locations could not load, so profile location editing is unavailable.");
    expect(source).toContain("The saved profile location is still shown.");
    expect(source).toContain('aria-label="Location unavailable"');
    expect(source).toContain('{user.location || "No location"}');
    expect(source).toContain("Retry locations");
  });
});
