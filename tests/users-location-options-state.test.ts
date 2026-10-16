import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("users location options state", () => {
  it("does not silently treat failed form-options locations as no-location user data", () => {
    const source = readFileSync("src/app/(app)/staff/page.tsx", "utf8");

    expect(source).toContain("error: formOptionsError");
    expect(source).toContain("reload: reloadFormOptions");
    expect(source).toContain("Locations could not load. User location filters are unavailable until locations are readable.");
    expect(source).toContain("locationsLoading={formOptionsLoading}");
    expect(source).toContain("locationsError={Boolean(formOptionsError)}");
    expect(source).toContain("onClick={reloadFormOptions}");
  });

  it("keeps invite-first onboarding independent from location assignment data", () => {
    const source = readFileSync("src/components/onboarding/OnboardingDialog.tsx", "utf8");

    expect(source).toContain("Users set their own password the first time they sign in.");
    expect(source).toContain("name=\"bulkInvitationRows\"");
    expect(source).toContain("name=\"singleInvitationEmail\"");
    expect(source).not.toContain("locationsLoading");
    expect(source).not.toContain("locationsError");
    expect(source).not.toContain("onRetryLocations");
    expect(source).not.toContain("locationOptionsUnavailable");
  });

  it("marks the roster location filter unavailable when location options are loading or failed", () => {
    const source = readFileSync("src/app/(app)/staff/UserFilters.tsx", "utf8");

    expect(source).toContain("locationsLoading");
    expect(source).toContain("locationsError");
    expect(source).toContain("locationFilterUnavailable");
    expect(source).toContain('aria-label={locationsError ? "Location filter unavailable" : "Location filter"}');
    expect(source).toContain("Locations unavailable");
    expect(source).toContain("Loading locations");
  });
});
