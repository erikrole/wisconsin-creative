import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("labels page accessibility", () => {
  it("distinguishes serialized item and item-family label actions", () => {
    const source = readFileSync("src/app/(app)/labels/page.tsx", "utf8");

    expect(source).toContain("Open serialized item");
    expect(source).toContain("Open ${trackingLabel} ${family.name} at ${family.locationName}");
    expect(source).toContain("Select serialized item");
    expect(source).toContain("Select ${trackingLabel} ${family.name} at ${family.locationName}");
    expect(source).toContain("selectAriaLabel");
    expect(source).toContain("aria-label={item.selectAriaLabel}");
    expect(source).not.toContain("aria-label={`Select ${item.title}`}");
    expect(source).not.toContain("Open item family ${family.name}");
    expect(source).not.toContain("Select item family ${item.title}");
  });

  it("pages the whole catalog and skips the catalog status counts", () => {
    const page = readFileSync("src/app/(app)/labels/page.tsx", "utf8");
    const catalog = readFileSync("src/app/(app)/labels/label-catalog.ts", "utf8");

    expect(page).toContain("useLabelCatalog");
    expect(catalog).toContain("collectLabelCatalog");
    expect(catalog).toContain('sort: "assetTag"');
    expect(catalog).toContain('counts: "0"');
    expect(catalog).toContain("LABEL_CATALOG_PAGE_SIZE = 200");
  });
});
