import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("settings venue mappings location picker state", () => {
  it("does not silently degrade failed location loads to an empty picker", () => {
    const source = readFileSync("src/app/(app)/settings/locations/VenueMappings.tsx", "utf8");

    expect(source).toContain("error: locationsError");
    expect(source).toContain("reload: reloadLocations");
    expect(source).toContain("locationsUnavailable");
    expect(source).toContain("Locations could not load, so new venue mappings cannot be assigned yet.");
    expect(source).toContain("Retry locations");
    expect(source).toContain("disabled={addingMapping || locationsUnavailable}");
    expect(source).toContain("disabled={locationsUnavailable}");
  });
});
