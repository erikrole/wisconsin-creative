import { describe, expect, it } from "vitest";
import {
  activeCheckoutRemoveItemBody,
  checkoutAvailabilityBody,
  checkoutCompleteBody,
} from "@/lib/schemas/kiosk";
import {
  MAX_BULK_UNIT_NUMBER,
  MAX_CHECKOUT_DISTINCT_BULK_SKUS_PER_REQUEST,
  MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
} from "@/lib/request-limits";
import {
  bulkRequestsFromCheckoutUnits,
  normalizeCheckoutCompleteItems,
} from "@/lib/services/kiosk-checkout-complete";

function items(count: number) {
  return Array.from({ length: count }, (_, index) => ({ assetId: `asset-${index}` }));
}

describe("kiosk request resource boundaries", () => {
  it.each([
    ["checkout completion", checkoutCompleteBody, {
      actorId: "user-1",
      customPurpose: "Practice checkout",
    }],
    ["availability preview", checkoutAvailabilityBody, {
      startsAt: "2026-07-17T12:00:00.000Z",
      endsAt: "2026-07-18T12:00:00.000Z",
    }],
  ])("caps %s item fan-out before route work", (_name, schema, base) => {
    expect(() => schema.parse({
      ...base,
      items: items(MAX_EQUIPMENT_SELECTIONS_PER_REQUEST),
    })).not.toThrow();

    expect(() => schema.parse({
      ...base,
      items: items(MAX_EQUIPMENT_SELECTIONS_PER_REQUEST + 1),
    })).toThrow(`Too big: expected array to have <=${MAX_EQUIPMENT_SELECTIONS_PER_REQUEST} items`);
  });

  it("caps the distinct bulk-SKU fan-out while allowing many units of one SKU", () => {
    const maximum = Array.from({ length: MAX_CHECKOUT_DISTINCT_BULK_SKUS_PER_REQUEST }, (_, index) => ({
      bulkSkuId: `sku-${index}`,
      unitNumber: 1,
    }));

    expect(bulkRequestsFromCheckoutUnits([
      ...Array.from({ length: 500 }, (_, index) => ({ bulkSkuId: "sku-shared", unitNumber: index + 1 })),
    ])).toEqual([{ bulkSkuId: "sku-shared", quantity: 500 }]);
    expect(bulkRequestsFromCheckoutUnits(maximum)).toHaveLength(MAX_CHECKOUT_DISTINCT_BULK_SKUS_PER_REQUEST);
    expect(() => bulkRequestsFromCheckoutUnits([
      ...maximum,
      { bulkSkuId: "sku-overflow", unitNumber: 1 },
    ])).toThrow(`at most ${MAX_CHECKOUT_DISTINCT_BULK_SKUS_PER_REQUEST} distinct bulk item types`);
  });

  it.each([
    ["checkout completion", checkoutCompleteBody, {
      actorId: "user-1",
      customPurpose: "Practice checkout",
    }],
    ["availability preview", checkoutAvailabilityBody, {
      startsAt: "2026-07-17T12:00:00.000Z",
      endsAt: "2026-07-18T12:00:00.000Z",
    }],
  ])("caps %s unit numbers at the PostgreSQL Int maximum", (_name, schema, base) => {
    expect(() => schema.parse({
      ...base,
      items: [{ bulkSkuId: "sku-1", unitNumber: MAX_BULK_UNIT_NUMBER }],
    })).not.toThrow();
    expect(() => schema.parse({
      ...base,
      items: [{ bulkSkuId: "sku-1", unitNumber: MAX_BULK_UNIT_NUMBER + 1 }],
    })).toThrow(`Too big: expected number to be <=${MAX_BULK_UNIT_NUMBER}`);
  });

  it("caps active-checkout removal unit numbers at the PostgreSQL Int maximum", () => {
    expect(() => activeCheckoutRemoveItemBody.parse({
      actorId: "user-1",
      bulkSkuId: "sku-1",
      unitNumber: MAX_BULK_UNIT_NUMBER,
    })).not.toThrow();
    expect(() => activeCheckoutRemoveItemBody.parse({
      actorId: "user-1",
      bulkSkuId: "sku-1",
      unitNumber: MAX_BULK_UNIT_NUMBER + 1,
    })).toThrow(`Too big: expected number to be <=${MAX_BULK_UNIT_NUMBER}`);
  });

  it("caps legacy parsed unit IDs at the PostgreSQL Int maximum", () => {
    expect(normalizeCheckoutCompleteItems([
      { assetId: `bulk:sku-1:unit:${MAX_BULK_UNIT_NUMBER}` },
    ]).bulkUnitItems).toEqual([
      { bulkSkuId: "sku-1", unitNumber: MAX_BULK_UNIT_NUMBER },
    ]);
    expect(() => normalizeCheckoutCompleteItems([
      { assetId: `bulk:sku-1:unit:${MAX_BULK_UNIT_NUMBER + 1}` },
    ])).toThrow(`between 1 and ${MAX_BULK_UNIT_NUMBER}`);
  });

  it("rejects the same physical kiosk unit across direct and legacy item formats", () => {
    const { bulkUnitItems } = normalizeCheckoutCompleteItems([
      { bulkSkuId: "sku-1", unitNumber: 7 },
      { assetId: "bulk:sku-1:unit:7" },
    ]);

    expect(() => bulkRequestsFromCheckoutUnits(bulkUnitItems))
      .toThrow("same bulk unit more than once");
  });

  it("rejects ambiguous kiosk items with both serialized and bulk identities", () => {
    expect(() => checkoutCompleteBody.parse({
      actorId: "user-1",
      customPurpose: "Practice checkout",
      items: [{ assetId: "asset-1", bulkSkuId: "sku-1", unitNumber: 7 }],
    })).toThrow();
  });
});

describe("kiosk scan and id field ceilings", () => {
  it("rejects oversize scan values and ids at the schema boundary", async () => {
    const { checkoutScanBody, checkinCompleteBody, activeCheckoutAddItemBody } = await import("@/lib/schemas/kiosk");
    expect(checkoutScanBody.safeParse({ scanValue: "A".repeat(256) }).success).toBe(true);
    expect(checkoutScanBody.safeParse({ scanValue: "A".repeat(257) }).success).toBe(false);
    expect(activeCheckoutAddItemBody.safeParse({ actorId: "u1", scanValue: "A".repeat(257) }).success).toBe(false);
    expect(checkinCompleteBody.safeParse({ actorId: "x".repeat(129) }).success).toBe(false);
  });
});
