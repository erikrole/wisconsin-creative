import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("item info sidebar hardening", () => {
  it("keeps procurement fields strict and contextual", () => {
    const source = readFileSync("src/app/(app)/items/[id]/ItemInfoTab.tsx", "utf8");

    expect(source).toContain("function parseUsdDraft");
    expect(source).toContain("Enter a valid USD amount");
    expect(source).toContain("function CurrencyInputField");
    expect(source).toContain('inputMode="decimal"');
    expect(source).toContain('autoComplete="off"');
    expect(source).toContain('new Intl.NumberFormat("en-US"');
    expect(source).toContain('label="Purchase price"');
    expect(source).toContain('saveField("purchasePrice", v)');
    expect(source).toContain("Number(parseUsdDraft(value))");
    expect(source).not.toContain("parseFloat(value)");
  });

  it("normalizes product links and keeps source context visible", () => {
    const source = readFileSync("src/app/(app)/items/[id]/ItemInfoTab.tsx", "utf8");
    const helper = readFileSync("src/lib/external-url.ts", "utf8");

    expect(source).toContain('import { externalUrlHost, normalizeExternalUrl } from "@/lib/external-url";');
    expect(helper).toContain("new URL(withScheme)");
    expect(helper).toContain('parsed.protocol !== "http:" && parsed.protocol !== "https:"');
    expect(helper).toContain('`https://${trimmed}`');
    expect(helper).toContain("export function externalUrlHost");
    expect(source).toContain("sourceHost &&");
    expect(source).toContain('copyWithFeedback(openUrl, "link")');
    expect(source).not.toContain("navigator.clipboard.writeText(openUrl)");
    expect(source).toContain('window.open(openUrl, "_blank", "noopener")');
  });

  it("keeps the info sidebar grouped for fast scanning", () => {
    const source = readFileSync("src/app/(app)/items/[id]/ItemInfoTab.tsx", "utf8");

    expect(source).toContain("FieldGroup } from \"@/components/SaveableField\"");
    expect(source).toContain('<FieldGroup label="Product">');
    expect(source).toContain('<FieldGroup label="Organization">');
    expect(source).toContain('<FieldGroup label="Procurement">');
    expect(source).toContain("<FieldGroup>");
    expect(source).toContain("Identity");
    expect(source).toContain("FirmwareWatchPanel");
  });
});
