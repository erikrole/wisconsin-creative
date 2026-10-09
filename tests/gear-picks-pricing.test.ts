import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { HttpError } from "@/lib/http";
import {
  findGearSku,
  GEAR_CATALOG,
  isItemAllowedForFit,
  itemsForFit,
  kitEntryForStyle,
  normalizeApparelSize,
} from "@/lib/gear-picks/catalog";
import { defaultSizeFor } from "@/app/(app)/gear/gear-pick-state";
import { isGearPickCycleOpen, priceGearPickLines } from "@/lib/gear-picks/pricing";
import { aggregateGearPickTotals, buildGearPicksCsvRows, gearPickLineDto } from "@/lib/services/gear-picks";
import type { GearPickAdminParticipant } from "@/lib/gear-picks/types";

const MEN_TEE = "6021649-005"; // Athletics SS Tee, MEN, $15.00
const WOMEN_FULL_ZIP = "6021628-005"; // Unstoppable Fleece Full-Zip, WOMEN, $67.50
const UNISEX_CAP = "6026519-280"; // Blitzing Stretch Fit Cap, UNISEX headwear, $21.50
const UNISEX_SHOE = "6024284-104"; // UA Icon Lo, UNISEX footwear, $77.00

function expectHttp(fn: () => unknown, status: number, message: RegExp) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(status);
    expect((error as HttpError).message).toMatch(message);
    return;
  }
  throw new Error("expected an HttpError");
}

describe("gear pick catalog", () => {
  it("indexes every color as a unique style-code SKU with cent prices", () => {
    const skuCount = GEAR_CATALOG.items.reduce((sum, item) => sum + item.colors.length, 0);
    const seen = new Set(GEAR_CATALOG.items.flatMap((item) => item.colors.map((color) => `${item.style}-${color.code}`)));
    expect(seen.size).toBe(skuCount);
    expect(findGearSku(WOMEN_FULL_ZIP)?.unitPriceCents).toBe(6750);
    expect(findGearSku("0000000-000")).toBeNull();
  });

  it("filters the catalog by fit, always including unisex items", () => {
    const men = itemsForFit("MEN");
    const women = itemsForFit("WOMEN");
    expect(men.every((item) => item.fit === "MEN" || item.fit === "UNISEX")).toBe(true);
    expect(women.every((item) => item.fit === "WOMEN" || item.fit === "UNISEX")).toBe(true);
    expect(men.some((item) => item.fit === "UNISEX")).toBe(true);
    expect(isItemAllowedForFit({ fit: "WOMEN" }, "MEN")).toBe(false);
  });

  it("maps the profile 2XL size to the picker's XXL", () => {
    expect(normalizeApparelSize("2xl")).toBe("XXL");
    expect(normalizeApparelSize(" m ")).toBe("M");
    expect(normalizeApparelSize(null)).toBeNull();
  });
});

describe("kitEntryForStyle", () => {
  it("matches a catalog style that is already in the fit's free kit", () => {
    expect(kitEntryForStyle("MEN", "6021712")).toMatchObject({ kind: "STANDARD_ISSUE", code: "834" }); // Drive Polo
    expect(kitEntryForStyle("MEN", "6021649")).toMatchObject({ kind: "CORE_KIT" }); // Athletics SS Tee
    expect(kitEntryForStyle("WOMEN", "6021628")).toMatchObject({ kind: "STANDARD_ISSUE" }); // Unstoppable Fleece Full-Zip
  });

  it("only looks at the participant's own fit kit", () => {
    expect(kitEntryForStyle("WOMEN", "6021712")).toBeNull();
    expect(kitEntryForStyle("MEN", "6021626")).toBeNull();
  });
});

describe("priceGearPickLines", () => {
  it("prices lines from the catalog and snapshots unit prices", () => {
    const result = priceGearPickLines({
      fit: "MEN",
      allowanceCents: 18_500,
      lines: [
        { sku: MEN_TEE, size: "l", quantity: 2 },
        { sku: UNISEX_CAP, size: "M/L", quantity: 1 },
        { sku: UNISEX_SHOE, size: "10.5", quantity: 1 },
      ],
    });
    expect(result.totalCents).toBe(2 * 1500 + 2150 + 7700);
    expect(result.lines[0]).toMatchObject({
      sku: MEN_TEE,
      style: "6021649",
      colorCode: "005",
      size: "L",
      quantity: 2,
      unitPriceCents: 1500,
      lineTotalCents: 3000,
    });
    expect(result.lines[1]?.size).toBe("M/L");
  });

  it("allows a total exactly at the allowance and rejects one cent over", () => {
    expect(
      priceGearPickLines({ fit: "MEN", allowanceCents: 7500, lines: [{ sku: MEN_TEE, size: "M", quantity: 5 }] }).totalCents,
    ).toBe(7500);
    expectHttp(
      () => priceGearPickLines({ fit: "MEN", allowanceCents: 7499, lines: [{ sku: MEN_TEE, size: "M", quantity: 5 }] }),
      400,
      /over your \$74\.99 allowance/,
    );
  });

  it("rejects unknown SKUs and items outside the participant's fit", () => {
    expectHttp(
      () => priceGearPickLines({ fit: "MEN", allowanceCents: 18_500, lines: [{ sku: "6021649-999", size: "M", quantity: 1 }] }),
      400,
      /isn't in this year's catalog/,
    );
    expectHttp(
      () => priceGearPickLines({ fit: "MEN", allowanceCents: 18_500, lines: [{ sku: WOMEN_FULL_ZIP, size: "M", quantity: 1 }] }),
      400,
      /isn't part of your catalog/,
    );
    expect(
      priceGearPickLines({ fit: "WOMEN", allowanceCents: 35_000, lines: [{ sku: WOMEN_FULL_ZIP, size: "M", quantity: 1 }] }).totalCents,
    ).toBe(6750);
  });

  it.each([0, 6, 1.5])("rejects quantity %s", (quantity) => {
    expectHttp(
      () => priceGearPickLines({ fit: "MEN", allowanceCents: 100_000, lines: [{ sku: MEN_TEE, size: "M", quantity }] }),
      400,
      /between 1 and 5/,
    );
  });

  it.each([
    [MEN_TEE, "  "], [UNISEX_SHOE, null], [UNISEX_CAP, null], [UNISEX_CAP, "OSFA"],
    ["6026509-280", "OSFA"], ["6013320-001", "10.5"], ["6021743-001", "M"],
  ])("rejects missing or unavailable sizes for %s (%s)", (sku, size) => {
    expectHttp(() => priceGearPickLines({ fit: "MEN", allowanceCents: 100_000, lines: [{ sku: sku!, size, quantity: 1 }] }), 400, /Choose (a|an available) size/);
  });

  it("normalizes unsized adjustable hats without treating fitted hats as one size", () => {
    expect(priceGearPickLines({fit: "MEN", allowanceCents: 100_000, lines: [{sku: "6026515-280", quantity: 1}]}).lines[0]?.size).toBe("OSFA");
  });

  it("uses profile sizes only for a matching garment and shoe system", () => {
    const profile = {topSize: "M", topSizeFit: "MENS" as const, shoeSize: "10", shoeSizeSystem: "US_WOMENS" as const};
    const size = (sku: string) => defaultSizeFor(findGearSku(sku)!.item, profile);
    expect(size(MEN_TEE)).toBe("M");
    expect(size(WOMEN_FULL_ZIP)).toBeNull();
    expect(size("6021627-005")).toBeNull();
    expect(size(UNISEX_CAP)).toBeNull();
    expect(size(UNISEX_SHOE)).toBeNull();
    expect(size("6013320-001")).toBeNull();
    expect(size("6013321-001")).toBe("10");
    expect(defaultSizeFor(findGearSku("6013321-001")!.item, {...profile, shoeSize: "10.5"})).toBeNull();
  });

  it("rejects oversized free-text sizes and duplicate SKU + size lines", () => {
    expectHttp(
      () => priceGearPickLines({ fit: "MEN", allowanceCents: 18_500, lines: [{ sku: MEN_TEE, size: "EXTRA-EXTRA-LARGE", quantity: 1 }] }),
      400,
      /up to 12 characters/,
    );
    expectHttp(
      () =>
        priceGearPickLines({
          fit: "MEN",
          allowanceCents: 18_500,
          lines: [
            { sku: MEN_TEE, size: "m", quantity: 1 },
            { sku: MEN_TEE, size: "M", quantity: 1 },
          ],
        }),
      400,
      /listed twice/,
    );
  });
});

describe("isGearPickCycleOpen", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  it("stays open with no deadline and before it, and closes at the deadline", () => {
    expect(isGearPickCycleOpen(null, now)).toBe(true);
    expect(isGearPickCycleOpen(new Date("2026-10-07T12:00:01Z"), now)).toBe(true);
    expect(isGearPickCycleOpen(new Date("2026-10-07T12:00:00Z"), now)).toBe(false);
  });
});

describe("admin aggregation and CSV rows", () => {
  const line = (sku: string, size: string | null, quantity: number, unitPriceCents: number) =>
    gearPickLineDto({ sku, style: sku.split("-")[0]!, colorCode: sku.split("-")[1]!, size, quantity, unitPriceCents });

  const participant = (name: string, lines: ReturnType<typeof line>[], submittedAt: string | null): GearPickAdminParticipant => ({
    id: `p-${name}`,
    fit: "MEN",
    allowanceCents: 18_500,
    user: { id: `u-${name}`, name, email: `${name}@example.com`, active: true, topSize: null, shoeSize: null },
    status: submittedAt ? "SUBMITTED" : "DRAFT",
    submission: {
      version: 1,
      totalCents: lines.reduce((sum, entry) => sum + entry.lineTotalCents, 0),
      submittedAt,
      updatedAt: "2026-10-07T12:00:00.000Z",
      lines,
    },
  });

  it("totals quantities by SKU and size across people", () => {
    const totals = aggregateGearPickTotals([
      line(MEN_TEE, "M", 2, 1500),
      line(MEN_TEE, "M", 1, 1500),
      line(MEN_TEE, "L", 1, 1500),
    ]);
    expect(totals).toEqual([
      expect.objectContaining({ sku: MEN_TEE, size: "L", quantity: 1, totalCents: 1500 }),
      expect.objectContaining({ sku: MEN_TEE, size: "M", quantity: 3, totalCents: 4500 }),
    ]);
  });

  it("builds one Staff Pick row per submitted line and leaves drafts out", () => {
    const rows = buildGearPicksCsvRows([
      participant("Erik Role", [line(MEN_TEE, "L", 2, 1500), line(UNISEX_CAP, null, 1, 2150)], "2026-10-07T15:00:00.000Z"),
      participant("Jerry Mao", [line(MEN_TEE, "S", 1, 1500)], null),
    ]);
    expect(rows).toEqual([
      {
        group: "Staff Pick",
        person: "Erik Role",
        itemNumber: MEN_TEE,
        item: "Athletics SS Tee",
        color: findGearSku(MEN_TEE)!.color.label,
        size: "L",
        quantity: 2,
        unitPrice: "15.00",
        lineTotal: "30.00",
        submittedAt: "2026-10-07T15:00:00.000Z",
      },
      expect.objectContaining({ itemNumber: UNISEX_CAP, size: "", unitPrice: "21.50", lineTotal: "21.50" }),
    ]);
  });
});
