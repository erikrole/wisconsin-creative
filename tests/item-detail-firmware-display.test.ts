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

  it("types and renders the editable firmware badge on the Info tab", () => {
    const types = source("src/app/(app)/items/[id]/types.ts");
    const infoTab = source("src/app/(app)/items/[id]/ItemInfoTab.tsx");

    expect(types).toContain("firmwareWatch: {");
    expect(types).toContain("supportMode: \"ACTIVE\" | \"MAINTENANCE\" | \"UNKNOWN\"");
    expect(infoTab).toContain("function FirmwareWatchPanel");
    expect(infoTab).toContain("Identity");
    expect(infoTab).not.toContain("Scan identity");
    expect(infoTab).toContain("installedFirmwareVersion");
    expect(infoTab).toContain("firmwareBadgeVariant");
    expect(infoTab).toContain("Set firmware");
    expect(infoTab).toContain("Outdated");
    expect(infoTab).toContain("Newest");
    expect(infoTab).toContain("Checked");
    expect(infoTab).toContain("Mark updated to {latestLabel}");
    expect(infoTab).toContain("Sony update page");
    expect(infoTab).toContain("Official firmware source");
    expect(infoTab).toContain("asset.firmwareWatch &&");
    expect(infoTab).toContain('saveField("metadata.installedFirmwareVersion", v)');
    expect(infoTab).toContain('timeZone: "UTC"');
  });

  it("keeps nullable serialized fields render-safe on item detail", () => {
    const types = source("src/app/(app)/items/[id]/types.ts");
    const infoTab = source("src/app/(app)/items/[id]/ItemInfoTab.tsx");

    expect(types).toContain("serialNumber: string | null;");
    expect(infoTab).toContain("value: string | null | undefined;");
    expect(infoTab).toContain("const normalizedValue = value ?? \"\";");
    expect(infoTab).toContain("const isDirty = draft.trim() !== normalizedValue;");
    expect(infoTab).toContain("value={asset.serialNumber}");
  });
});
