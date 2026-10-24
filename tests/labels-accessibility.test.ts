import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("labels page accessibility", () => {
  it("names serialized and family rows by what they are", () => {
    const source = readFileSync("src/app/(app)/labels/LabelsHelper.tsx", "utf8");

    expect(source).toContain("ariaLabel: `serialized item ${asset.assetTag}`");
    expect(source).toContain('${numbered ? "numbered" : "quantity"} family ${family.name} at ${family.locationName}');
    expect(source).toContain("`Add ${item.ariaLabel} to the print sheet`");
    expect(source).toContain("`Remove ${item.ariaLabel} from the print sheet`");
    expect(source).toContain("aria-pressed={added}");
  });

  it("labels the sheet controls per entry", () => {
    const sheet = readFileSync("src/app/(app)/labels/PrintSheet.tsx", "utf8");

    expect(sheet).toContain("aria-label={`Copies of ${label}`}");
    expect(sheet).toContain("aria-label={`Remove ${entry.title}`}");
    expect(sheet).toContain("aria-label={`What to print for ${entry.title}`}");
    expect(sheet).toContain("aria-label={`Edit printed text for ${entry.title}`}");
  });

  it("announces the sheet count and keeps template headings visible under the sheet header", () => {
    const sheet = readFileSync("src/app/(app)/labels/PrintSheet.tsx", "utf8");

    expect(sheet).toContain('aria-live="polite"');
    expect(sheet).toMatch(/<header className="sticky top-0 z-20 flex h-16 /);
    expect(sheet).toMatch(/key=\{`heading-\$\{group\.kind\}`\} className="sticky top-16 z-10/);
  });

  it("lets the P-touch CSV download without the USB preflight", () => {
    const sheet = readFileSync("src/app/(app)/labels/PrintSheet.tsx", "utf8");

    expect(sheet).toContain("disabled={Boolean(choicesBlocked || draftIssue)}");
  });

  it("pages the whole catalog and skips the catalog status counts", () => {
    const helper = readFileSync("src/app/(app)/labels/LabelsHelper.tsx", "utf8");
    const catalog = readFileSync("src/app/(app)/labels/label-catalog.ts", "utf8");

    expect(helper).toContain("useLabelCatalog");
    expect(catalog).toContain("collectLabelCatalog");
    expect(catalog).toContain('sort: "assetTag"');
    expect(catalog).toContain('counts: "0"');
    expect(catalog).toContain("LABEL_CATALOG_PAGE_SIZE = 200");
  });
});
