import { describe, expect, it } from "vitest";
import {
  availabilitySchema,
  createBulkSkuSchema,
  createCheckoutSchema,
  createReservationSchema,
  updateBookingSchema,
} from "@/lib/validation";
import {
  MAX_BULK_QUANTITY_PER_LINE,
  MAX_BULK_SKU_LINES_PER_REQUEST,
  MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
  MAX_LINKED_EVENTS_PER_BOOKING,
  MAX_NUMBERED_UNITS_PER_CREATE,
} from "@/lib/request-limits";

const ids = {
  requester: "cm000000000000000000000001",
  location: "cm000000000000000000000002",
  asset: "cm000000000000000000000003",
  bulk: "cm000000000000000000000004",
  bulkTwo: "cm000000000000000000000005",
  event: "cm000000000000000000000006",
  eventTwo: "cm000000000000000000000007",
  sourceReservation: "cm000000000000000000000008",
};

const basePayload = {
  title: "Road trip kit",
  requesterUserId: ids.requester,
  locationId: ids.location,
  startsAt: "2026-06-01T12:00:00.000Z",
  endsAt: "2026-06-01T18:00:00.000Z",
};

function cuid(index: number) {
  return `cm${index.toString(36).padStart(23, "0")}`;
}

describe("booking create validation", () => {
  it("requires reservation creation to include equipment", () => {
    expect(() => createReservationSchema.parse(basePayload)).toThrow("Add at least one piece of equipment");
  });

  it("allows checkout conversion payloads to omit explicit equipment when sourceReservationId is present", () => {
    expect(() => createCheckoutSchema.parse({
      ...basePayload,
      sourceReservationId: ids.sourceReservation,
    })).not.toThrow();
  });

  it("requires ad hoc checkout creation to include equipment", () => {
    expect(() => createCheckoutSchema.parse(basePayload)).toThrow("Add at least one piece of equipment");
  });

  it("rejects duplicate eventIds before booking creation", () => {
    expect(() => createCheckoutSchema.parse({
      ...basePayload,
      serializedAssetIds: [ids.asset],
      eventIds: [ids.event, ids.event],
    })).toThrow("eventIds must be unique");
  });

  it("allows five linked events for reservations and checkouts", () => {
    const eventIds = Array.from(
      { length: MAX_LINKED_EVENTS_PER_BOOKING },
      (_, index) => cuid(index + 10),
    );
    const tooManyEventIds = [...eventIds, cuid(100)];

    expect(() => createReservationSchema.parse({
      ...basePayload,
      serializedAssetIds: [ids.asset],
      eventIds,
    })).not.toThrow();
    expect(() => createCheckoutSchema.parse({
      ...basePayload,
      serializedAssetIds: [ids.asset],
      eventIds,
    })).not.toThrow();
    expect(() => createReservationSchema.parse({
      ...basePayload,
      serializedAssetIds: [ids.asset],
      eventIds: tooManyEventIds,
    })).toThrow(`Array must contain at most ${MAX_LINKED_EVENTS_PER_BOOKING} element(s)`);
    expect(() => createCheckoutSchema.parse({
      ...basePayload,
      serializedAssetIds: [ids.asset],
      eventIds: tooManyEventIds,
    })).toThrow(`Array must contain at most ${MAX_LINKED_EVENTS_PER_BOOKING} element(s)`);
  });

  it("rejects duplicate bulk items before booking creation", () => {
    expect(() => createReservationSchema.parse({
      ...basePayload,
      bulkItems: [
        { bulkSkuId: ids.bulk, quantity: 1 },
        { bulkSkuId: ids.bulk, quantity: 2 },
      ],
    })).toThrow("Duplicate bulk item");
  });

  it("accepts mixed serialized and unique bulk equipment", () => {
    const parsed = createReservationSchema.parse({
      ...basePayload,
      serializedAssetIds: [ids.asset],
      bulkItems: [
        { bulkSkuId: ids.bulk, quantity: 1 },
        { bulkSkuId: ids.bulkTwo, quantity: 2 },
      ],
      eventIds: [ids.event, ids.eventTwo],
    });

    expect(parsed.serializedAssetIds).toEqual([ids.asset]);
    expect(parsed.bulkItems).toHaveLength(2);
  });

  it("bounds serialized equipment fan-out at the request boundary", () => {
    const maximum = Array.from({ length: MAX_EQUIPMENT_SELECTIONS_PER_REQUEST }, (_, index) => cuid(index));

    expect(() => createReservationSchema.parse({
      ...basePayload,
      serializedAssetIds: maximum,
    })).not.toThrow();
    expect(() => createReservationSchema.parse({
      ...basePayload,
      serializedAssetIds: [...maximum, cuid(MAX_EQUIPMENT_SELECTIONS_PER_REQUEST)],
    })).toThrow(`Array must contain at most ${MAX_EQUIPMENT_SELECTIONS_PER_REQUEST} element(s)`);
    expect(() => availabilitySchema.parse({
      locationId: ids.location,
      startsAt: basePayload.startsAt,
      endsAt: basePayload.endsAt,
      serializedAssetIds: [...maximum, cuid(MAX_EQUIPMENT_SELECTIONS_PER_REQUEST)],
    })).toThrow(`Array must contain at most ${MAX_EQUIPMENT_SELECTIONS_PER_REQUEST} element(s)`);
    expect(() => updateBookingSchema.parse({
      serializedAssetIds: [...maximum, cuid(MAX_EQUIPMENT_SELECTIONS_PER_REQUEST)],
    })).toThrow(`Array must contain at most ${MAX_EQUIPMENT_SELECTIONS_PER_REQUEST} element(s)`);
  });

  it("bounds bulk-line fan-out and rejects unsafe quantities", () => {
    const maximum = Array.from({ length: MAX_BULK_SKU_LINES_PER_REQUEST }, (_, index) => ({
      bulkSkuId: cuid(index),
      quantity: 1,
    }));

    expect(() => createReservationSchema.parse({ ...basePayload, bulkItems: maximum })).not.toThrow();
    expect(() => createReservationSchema.parse({
      ...basePayload,
      bulkItems: [...maximum, { bulkSkuId: cuid(MAX_BULK_SKU_LINES_PER_REQUEST), quantity: 1 }],
    })).toThrow(`Array must contain at most ${MAX_BULK_SKU_LINES_PER_REQUEST} element(s)`);
    expect(() => createReservationSchema.parse({
      ...basePayload,
      bulkItems: [{ bulkSkuId: ids.bulk, quantity: MAX_BULK_QUANTITY_PER_LINE + 1 }],
    })).toThrow(`Number must be less than or equal to ${MAX_BULK_QUANTITY_PER_LINE}`);
  });

  it("caps only numbered item-family materialization, not quantity-tracked stock", () => {
    const baseBulkSku = {
      name: "Sony Battery",
      category: "Batteries",
      locationId: ids.location,
      binQrCodeValue: "SONY-BATTERY",
    };

    expect(() => createBulkSkuSchema.parse({
      ...baseBulkSku,
      trackByNumber: true,
      initialQuantity: MAX_NUMBERED_UNITS_PER_CREATE,
    })).not.toThrow();
    expect(() => createBulkSkuSchema.parse({
      ...baseBulkSku,
      trackByNumber: true,
      initialQuantity: MAX_NUMBERED_UNITS_PER_CREATE + 1,
    })).toThrow(`Create at most ${MAX_NUMBERED_UNITS_PER_CREATE} numbered units at once`);
    expect(() => createBulkSkuSchema.parse({
      ...baseBulkSku,
      trackByNumber: false,
      initialQuantity: MAX_NUMBERED_UNITS_PER_CREATE + 1,
    })).not.toThrow();
  });
});
