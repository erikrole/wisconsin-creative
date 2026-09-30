import { z } from "zod";
import {
  MAX_BULK_UNIT_NUMBER,
  MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
} from "@/lib/request-limits";

/**
 * Zod schemas for the kiosk-route boundary.
 *
 * Pair these with `Schema.parse(await req.json())` inside `withKiosk` handlers.
 * `fail()` (`src/lib/http.ts`) maps `ZodError` to a 400 with field-level
 * details, so handlers don't need to catch validation errors explicitly.
 */

const cuidish = z.string().min(1);
const bulkUnitNumber = z.number().int().positive().max(MAX_BULK_UNIT_NUMBER);

const checkoutCompleteItem = z.union([
  z.object({ assetId: cuidish }).strict(),
  z.object({
    bulkSkuId: cuidish,
    unitNumber: bulkUnitNumber,
  }).strict(),
]);

export const checkoutCompleteBody = z.object({
  actorId: cuidish,
  requestId: z.string().max(64).optional(),
  locationId: cuidish.optional(),
  items: z.array(checkoutCompleteItem)
    .min(1, "At least one item required")
    .max(MAX_EQUIPMENT_SELECTIONS_PER_REQUEST),
  eventId: cuidish.optional(),
  kitId: cuidish.optional(),
  customPurpose: z.string().trim().min(1).max(160).optional(),
  // No startsAt: checkout start is server-authoritative (the moment of completion).
  endsAt: z.string().datetime({ offset: true }).optional(),
}).superRefine((body, ctx) => {
  if (!body.eventId && !body.customPurpose) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["eventId"],
      message: "Select an event or enter what this checkout is for",
    });
  }
});
export type CheckoutCompleteBody = z.infer<typeof checkoutCompleteBody>;

export const checkoutAvailabilityBody = z.object({
  locationId: cuidish.optional(),
  items: z.array(checkoutCompleteItem)
    .min(1, "At least one item required")
    .max(MAX_EQUIPMENT_SELECTIONS_PER_REQUEST),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
});
export const activeCheckoutUpdateBody = z.object({
  actorId: cuidish,
  title: z.string().trim().min(1).max(160).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
}).refine((body) => body.title !== undefined || body.endsAt !== undefined, {
  message: "Title or return time is required",
});
export const activeCheckoutAddItemBody = z.object({
  actorId: cuidish,
  scanValue: z.string().trim().min(1, "Scan value required"),
});
export const activeCheckoutRemoveItemBody = z.object({
  actorId: cuidish,
  assetId: cuidish.optional(),
  bulkSkuId: cuidish.optional(),
  unitNumber: bulkUnitNumber.optional(),
}).refine((body) => {
  const serialized = !!body.assetId;
  const bulkUnit = !!body.bulkSkuId && body.unitNumber !== undefined;
  return serialized !== bulkUnit;
}, {
  message: "Provide either assetId or bulkSkuId plus unitNumber",
});
export const checkinCompleteBody = z.object({
  actorId: cuidish,
});
const scanBody = z.object({
  scanValue: z.string().trim().min(1, "Scan value required"),
  actorId: cuidish.optional(),
});

export const checkinScanBody = scanBody;
export const checkoutScanBody = scanBody;
export const pickupScanBody = scanBody.extend({
  // Extra off-plan scans add to the reservation. Pass "add" to keep a
  // substitution candidate and still add the scanned item beside it.
  intent: z.enum(["add"]).nullish(),
});
export const scanLookupBody = scanBody;

export const resolveKioskScanBody = z.object({
  scanValue: z.string().trim().min(1, "Scan value required").max(256),
  userId: cuidish.optional(),
});
export const pickupConfirmBody = z.object({
  actorId: cuidish,
  requestId: z.string().max(64).optional(),
  // Reservation pickups may hand over only the items already scanned. The
  // source reservation stays BOOKED until a later pickup finishes the rest.
  partial: z.boolean().optional().default(false),
});
export const pickupSubstituteBody = z.object({
  actorId: cuidish,
  scanValue: z.string().trim().min(1, "Scan value required"),
  reservedAssetId: cuidish,
});
/** Admin: create a kiosk device (`POST /api/kiosk-devices`). */
export const kioskDeviceCreateBody = z.object({
  name: z.string({ required_error: "Name and location are required" })
    .trim()
    .min(1, "Name and location are required")
    .max(100, "Kiosk name must be 100 characters or fewer"),
  locationId: z.string({ required_error: "Name and location are required" })
    .trim()
    .min(1, "Name and location are required"),
});

/** Admin: rename or (de)activate a kiosk device (`PATCH /api/kiosk-devices/[id]`). */
export const kioskDeviceUpdateBody = z.object({
  active: z.boolean().optional(),
  name: z.string()
    .trim()
    .min(1, "Kiosk name cannot be empty")
    .max(100, "Kiosk name must be 100 characters or fewer")
    .optional(),
}).refine((body) => body.active !== undefined || body.name !== undefined, {
  message: "No valid fields to update",
});

export const activateBody = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Invalid activation code format"),
});
