import { describe, expect, it } from "vitest";
import { ShiftArea } from "@prisma/client";
import {
  createBulkSkuSchema,
  previewBlastSchema,
  markBulkUnitLabelsSchema,
  scanSchema,
  sportRosterBulkSchema,
  updateSportConfigGroupSchema,
  updateSportConfigSchema,
  updateBulkSkuSchema,
  upsertSportConfigSchema,
} from "@/lib/validation";
import {
  MAX_BULK_QUANTITY_PER_LINE,
  MAX_BULK_UNIT_NUMBER,
  MAX_NUMBERED_UNITS_PER_CREATE,
  MAX_SPORT_ROSTER_USERS_PER_REQUEST,
  MAX_SPORT_SHIFT_CONFIGS_PER_REQUEST,
} from "@/lib/request-limits";

const shiftConfigs = [
  ShiftArea.VIDEO,
  ShiftArea.PHOTO,
  ShiftArea.GRAPHICS,
  ShiftArea.SOCIAL,
  ShiftArea.COMMS,
  ShiftArea.LIVE_PRODUCTION,
].map((area) => ({ area }));

const bulkSkuInput = {
  name: "AA Batteries",
  category: "Power",
  locationId: "00000000-0000-4000-8000-000000000001",
  binQrCodeValue: "BIN-AA",
};

describe("shared mutation array bounds", () => {
  it("accepts an audience containing every supported blast area", () => {
    expect(previewBlastSchema.safeParse({
      target: { kind: "DYNAMIC", areas: Object.values(ShiftArea) },
    }).success).toBe(true);
  });

  it("accepts the roster maximum and rejects max plus one", () => {
    const maximum = Array.from(
      { length: MAX_SPORT_ROSTER_USERS_PER_REQUEST },
      (_, index) => `cm${index.toString(36).padStart(23, "0")}`,
    );

    expect(() => sportRosterBulkSchema.parse({
      sportCode: "FB",
      userIds: maximum,
    })).not.toThrow();
    expect(() => sportRosterBulkSchema.parse({
      sportCode: "FB",
      userIds: [
        ...maximum,
        `cm${MAX_SPORT_ROSTER_USERS_PER_REQUEST.toString(36).padStart(23, "0")}`,
      ],
    })).toThrow(`Too big: expected array to have <=${MAX_SPORT_ROSTER_USERS_PER_REQUEST} items`);
  });

  it("accepts the exact scan maxima", () => {
    const unitNumbers = Array.from(
      { length: MAX_NUMBERED_UNITS_PER_CREATE },
      (_, index) => index + 1,
    );
    unitNumbers[unitNumbers.length - 1] = MAX_BULK_UNIT_NUMBER;

    expect(() => scanSchema.parse({
      bookingId: "cm000000000000000000000001",
      phase: "CHECKOUT",
      scanType: "BULK_BIN",
      scanValue: "BIN-1",
      quantity: MAX_BULK_QUANTITY_PER_LINE,
      unitNumbers,
    })).not.toThrow();
  });

  it("rejects scan unit arrays and quantities at max plus one", () => {
    const baseScan = {
      bookingId: "cm000000000000000000000001",
      phase: "CHECKOUT" as const,
      scanType: "BULK_BIN" as const,
      scanValue: "BIN-1",
    };

    expect(() => scanSchema.parse({
      ...baseScan,
      unitNumbers: Array.from(
        { length: MAX_NUMBERED_UNITS_PER_CREATE + 1 },
        (_, index) => index + 1,
      ),
    })).toThrow(`Too big: expected array to have <=${MAX_NUMBERED_UNITS_PER_CREATE} items`);
    expect(() => scanSchema.parse({
      ...baseScan,
      quantity: MAX_BULK_QUANTITY_PER_LINE + 1,
    })).toThrow(`Too big: expected number to be <=${MAX_BULK_QUANTITY_PER_LINE}`);
    expect(() => scanSchema.parse({
      ...baseScan,
      unitNumbers: [MAX_BULK_UNIT_NUMBER + 1],
    })).toThrow(`Too big: expected number to be <=${MAX_BULK_UNIT_NUMBER}`);
  });

  it("rejects duplicate scan unit numbers", () => {
    expect(() => scanSchema.parse({
      phase: "CHECKOUT",
      scanType: "BULK_BIN",
      scanValue: "BIN-1",
      unitNumbers: [7, 7],
    })).toThrow("unitNumbers must be unique");
  });

  it("caps quantity-only creation while preserving the numbered materialization cap", () => {
    expect(() => createBulkSkuSchema.parse({
      ...bulkSkuInput,
      initialQuantity: MAX_BULK_QUANTITY_PER_LINE,
      trackByNumber: false,
    })).not.toThrow();
    expect(() => createBulkSkuSchema.parse({
      ...bulkSkuInput,
      initialQuantity: MAX_BULK_QUANTITY_PER_LINE + 1,
      trackByNumber: false,
    })).toThrow(`Too big: expected number to be <=${MAX_BULK_QUANTITY_PER_LINE}`);
    expect(() => createBulkSkuSchema.parse({
      ...bulkSkuInput,
      initialQuantity: MAX_NUMBERED_UNITS_PER_CREATE,
      trackByNumber: true,
    })).not.toThrow();
    expect(() => createBulkSkuSchema.parse({
      ...bulkSkuInput,
      initialQuantity: MAX_NUMBERED_UNITS_PER_CREATE + 1,
      trackByNumber: true,
    })).toThrow(`Create at most ${MAX_NUMBERED_UNITS_PER_CREATE} numbered units at once`);
  });

  it("caps bulk stock thresholds across create and update schemas", () => {
    expect(() => createBulkSkuSchema.parse({
      ...bulkSkuInput,
      minThreshold: MAX_BULK_QUANTITY_PER_LINE,
    })).not.toThrow();
    expect(() => createBulkSkuSchema.parse({
      ...bulkSkuInput,
      minThreshold: MAX_BULK_QUANTITY_PER_LINE + 1,
    })).toThrow(`Too big: expected number to be <=${MAX_BULK_QUANTITY_PER_LINE}`);
    expect(() => updateBulkSkuSchema.parse({
      minThreshold: MAX_BULK_QUANTITY_PER_LINE,
    })).not.toThrow();
    expect(() => updateBulkSkuSchema.parse({
      minThreshold: MAX_BULK_QUANTITY_PER_LINE + 1,
    })).toThrow(`Too big: expected number to be <=${MAX_BULK_QUANTITY_PER_LINE}`);
  });

  it("bounds the free-text bulk SKU category like every other string field", () => {
    expect(() => updateBulkSkuSchema.parse({ category: "Audio" })).not.toThrow();
    expect(() => updateBulkSkuSchema.parse({ category: "x".repeat(201) })).toThrow();
  });

  it("caps bulk-unit label numbers at the PostgreSQL Int maximum", () => {
    expect(() => markBulkUnitLabelsSchema.parse({
      unitNumbers: [MAX_BULK_UNIT_NUMBER],
      printed: true,
    })).not.toThrow();
    expect(() => markBulkUnitLabelsSchema.parse({
      unitNumbers: [MAX_BULK_UNIT_NUMBER + 1],
      printed: true,
    })).toThrow(`Too big: expected number to be <=${MAX_BULK_UNIT_NUMBER}`);
  });

  it("accepts all six sport shift areas across each mutation schema", () => {
    expect(shiftConfigs).toHaveLength(MAX_SPORT_SHIFT_CONFIGS_PER_REQUEST);
    expect(() => upsertSportConfigSchema.parse({ sportCode: "FB", shiftConfigs })).not.toThrow();
    expect(() => updateSportConfigSchema.parse({ shiftConfigs })).not.toThrow();
    expect(() => updateSportConfigGroupSchema.parse({
      codes: ["FB"],
      shiftConfigs,
    })).not.toThrow();
  });

  it("rejects a seventh shift config before checking area uniqueness", () => {
    const overLimit = [...shiftConfigs, { area: ShiftArea.VIDEO }];

    expect(() => upsertSportConfigSchema.parse({
      sportCode: "FB",
      shiftConfigs: overLimit,
    })).toThrow("Too big: expected array to have <=6 items");
    expect(() => updateSportConfigSchema.parse({ shiftConfigs: overLimit }))
      .toThrow("Too big: expected array to have <=6 items");
    expect(() => updateSportConfigGroupSchema.parse({
      codes: ["FB"],
      shiftConfigs: overLimit,
    })).toThrow("Too big: expected array to have <=6 items");
  });
});
