import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { HttpError } from "@/lib/http";
import {
  findGearSku,
  GEAR_CATALOG,
  isItemAllowedForFit,
  itemsForFit,
  normalizeApparelSize,
} from "@/lib/gear-picks/catalog";
import { isGearPickCycleOpen, priceGearPickLines } from "@/lib/gear-picks/pricing";
import { aggregateGearPickTotals, buildGearPicksCsvRows, gearPickLineDto } from "@/lib/services/gear-picks";
import type { GearPickAdminParticipant } from "@/lib/gear-picks/types";

const MEN_TEE = "6021649-005"; // Athletics SS Tee, MEN, $15.00
const WOMEN_FULL_ZIP = "6021628-005"; // Unstoppable Fleece Full-Zip, WOMEN, $67.50
const UNISEX_CAP = "6026519-280"; // Blitzing Stretch Fit Cap, UNISEX headwear, $21.50
const UNISEX_SHOE = "6024284-104"; // UA Icon Lo, UNISEX footwear, $75.00

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

describe("priceGearPickLines", () => {
  it("prices lines from the catalog and snapshots unit prices", () => {
    const result = priceGearPickLines({
      fit: "MEN",
      allowanceCents: 18_500,
      lines: [
        { sku: MEN_TEE, size: "l", quantity: 2 },
        { sku: UNISEX_CAP, size: null, quantity: 1 },
        { sku: UNISEX_SHOE, size: "10.5", quantity: 1 },
      ],
    });
    expect(result.totalCents).toBe(2 * 1500 + 2150 + 7500);
    expect(result.lines[0]).toMatchObject({
      sku: MEN_TEE,
      style: "6021649",
      colorCode: "005",
      size: "L",
      quantity: 2,
      unitPriceCents: 1500,
      lineTotalCents: 3000,
    });
    expect(result.lines[1]?.size).toBeNull();
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

  it("requires a size for apparel but not for headwear or footwear", () => {
    expectHttp(
      () => priceGearPickLines({ fit: "MEN", allowanceCents: 18_500, lines: [{ sku: MEN_TEE, size: "  ", quantity: 1 }] }),
      400,
      /Choose a size/,
    );
    expect(
      priceGearPickLines({
        fit: "MEN",
        allowanceCents: 18_500,
        lines: [
          { sku: UNISEX_CAP, quantity: 1 },
          { sku: UNISEX_SHOE, size: null, quantity: 1 },
        ],
      }).lines.map((line) => line.size),
    ).toEqual([null, null]);
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
