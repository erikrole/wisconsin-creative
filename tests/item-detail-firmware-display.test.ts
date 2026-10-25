import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("item detail firmware display", () => {
  it("returns firmware watch metadata from the asset detail API", () => {
    const route = source("src/app/api/assets/[id]/route.ts");

    expect(route).toContain("findFirmwareWatchTargetForAsset(asset.brand, asset.model)");
    expect(route).toContain("db.firmwareWatchTarget.findFirst");
    expect(route).toContain("latestVersion: true");
    expect(route).toContain("latestReleaseDate: true");
    expect(route).toContain("firmwareWatch,");
  });

  // Rendering of the Info tab is covered by tests/item-info-tab.test.ts.
  it("types the firmware watch and nullable serial fields the Info tab renders", () => {
    const types = source("src/app/(app)/items/[id]/types.ts");

    expect(types).toContain("firmwareWatch: {");
    expect(types).toContain("supportMode: \"ACTIVE\" | \"MAINTENANCE\" | \"UNKNOWN\"");
    expect(types).toContain("serialNumber: string | null;");
  });
});
