import { BlastSeverity, GraduationTerm, ResourceType, Role, ShiftArea, ShiftWorkerType, StudentYear } from "@prisma/client";
import { z } from "zod";
import { sanitizeText } from "./sanitize";
import { isSportCode, normalizeSportCode } from "./sports";
import { normalizeBookingTitle } from "./title-normalization";
import { nullableProfilePhoneSchema } from "./profile-phone";
import {
  MAX_BULK_QUANTITY_PER_LINE,
  MAX_BULK_SKU_LINES_PER_REQUEST,
  MAX_BULK_UNIT_NUMBER,
  MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
  MAX_LINKED_EVENTS_PER_BOOKING,
  MAX_NUMBERED_UNITS_PER_CREATE,
  MAX_SPORT_CONFIG_GROUP_CODES_PER_REQUEST,
  MAX_SPORT_ROSTER_USERS_PER_REQUEST,
  MAX_SPORT_SHIFT_CONFIGS_PER_REQUEST,
} from "./request-limits";

const cuidSchema = z.string().cuid();
const uuidSchema = z.string().uuid();
const bulkUnitNumberSchema = z.number().int().positive().max(MAX_BULK_UNIT_NUMBER);

export const databaseIdSchema = z.string().trim().min(1).refine(
  (value) => cuidSchema.safeParse(value).success || uuidSchema.safeParse(value).success,
  { message: "Invalid id" },
);

/** APNs credentials are raw bytes encoded as hexadecimal by the native app. */
export const apnsTokenSchema = z.string()
  .min(2)
  .max(512)
  .regex(/^(?:[0-9a-fA-F]{2})+$/, "APNs token must be an even-length hexadecimal string");

const maxDecimal10_2 = 99_999_999.99;

export const moneyDecimalSchema = z.number()
  .finite()
  .nonnegative()
  .max(maxDecimal10_2)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, {
    message: "Enter a value with no more than two decimal places",
  });

export function normalizeHttpUrl(value: string): string {
  const trimmed = value.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("Enter a valid http or https URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Enter a valid http or https URL");
  }
  const normalized = parsed.toString();
  if (normalized.length > 2000) {
    throw new Error("URL must be 2,000 characters or fewer");
  }
  return normalized;
}

export const nullableHttpUrlSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string()
    .trim()
    .nullable()
    .transform((value, ctx) => {
      if (value === null) return null;
      try {
        return normalizeHttpUrl(value);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof Error ? error.message : "Enter a valid http or https URL",
        });
        return z.NEVER;
      }
    }),
);

/** Sanitize user-facing text fields in a booking payload */
export function sanitizeBookingFields<T extends Record<string, unknown>>(data: T): T {
  const d = data as Record<string, unknown>;
  if (typeof d.title === "string") d.title = normalizeBookingTitle(sanitizeText(d.title));
  if (typeof d.notes === "string") d.notes = sanitizeText(d.notes);
  return data;
}

const bulkItemSchema = z.object({
  bulkSkuId: z.string().cuid(),
  quantity: z.number().int().positive().max(MAX_BULK_QUANTITY_PER_LINE),
});

const bulkItemsSchema = z.array(bulkItemSchema)
  .max(MAX_BULK_SKU_LINES_PER_REQUEST)
  .default([])
  .superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.bulkSkuId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate bulk item",
        path: [index, "bulkSkuId"],
      });
      return;
    }
    seen.add(item.bulkSkuId);
  });
});

const eventIdsListSchema = z.array(z.string().cuid()).max(MAX_LINKED_EVENTS_PER_BOOKING).superRefine((ids, ctx) => {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "eventIds must be unique",
        path: [index],
      });
      return;
    }
    seen.add(id);
  });
});

const eventIdsSchema = eventIdsListSchema.optional();

export const sportCodeSchema = z.string()
  .trim()
  .min(1)
  .transform((value) => normalizeSportCode(value))
  .refine(isSportCode, { message: "Invalid sport code" });

export const optionalSportCodeSchema = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}, sportCodeSchema.optional());

export const nullableSportCodeSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}, sportCodeSchema.nullable());

export const availabilitySchema = z.object({
  locationId: z.string().cuid(),
  startsAt: z.string(),
  endsAt: z.string(),
  serializedAssetIds: z.array(z.string().cuid()).max(MAX_EQUIPMENT_SELECTIONS_PER_REQUEST).default([]),
  bulkItems: bulkItemsSchema,
  excludeBookingId: z.string().cuid().optional(),
  // Optional so older clients keep legacy behavior; when present, preflight
  // applies the same per-kind availableForCheckout/availableForReservation
  // gating the commit path enforces, so the two can't disagree.
  kind: z.enum(["RESERVATION", "CHECKOUT"]).optional()
});

const bookingBaseShape = {
  title: z.string().trim().min(1).max(500),
  requesterUserId: z.string().cuid(),
  locationId: z.string().cuid(),
  startsAt: z.string(),
  endsAt: z.string(),
  serializedAssetIds: z.array(z.string().cuid()).max(MAX_EQUIPMENT_SELECTIONS_PER_REQUEST).default([]),
  bulkItems: bulkItemsSchema,
  eventId: z.string().cuid().optional(),
  eventIds: eventIdsSchema,
  sportCode: optionalSportCodeSchema,
  notes: z.string().max(10000).optional(),
  shiftAssignmentId: z.string().cuid().optional(),
  kitId: z.string().cuid().optional(),
  sourceDraftId: z.string().cuid().optional(),
} as const;

function eventIdsExclusive(v: { eventId?: string; eventIds?: string[] }): boolean {
  return !(v.eventId && v.eventIds && v.eventIds.length > 0);
}
const eventIdsExclusiveMsg = {
  message: "Provide either eventId or eventIds, not both",
  path: ["eventIds"] as (string | number)[],
};

function hasSelectedEquipment(v: { serializedAssetIds?: string[]; bulkItems?: Array<{ quantity: number }> }): boolean {
  return (v.serializedAssetIds?.length ?? 0) > 0 || (v.bulkItems?.length ?? 0) > 0;
}

function hasSelectedEquipmentOrSourceReservation(
  v: { serializedAssetIds?: string[]; bulkItems?: Array<{ quantity: number }>; sourceReservationId?: string },
): boolean {
  return Boolean(v.sourceReservationId) || hasSelectedEquipment(v);
}

const equipmentRequiredMsg = {
  message: "Add at least one piece of equipment",
  path: ["serializedAssetIds"] as (string | number)[],
};

export const createReservationSchema = z.object(bookingBaseShape)
  .refine(eventIdsExclusive, eventIdsExclusiveMsg)
  .refine(hasSelectedEquipment, equipmentRequiredMsg);

export const createCheckoutSchema = z.object({
  ...bookingBaseShape,
  endsAt: z.string().optional(),
  sourceReservationId: z.string().cuid().optional(),
})
  .refine(eventIdsExclusive, eventIdsExclusiveMsg)
  .refine(hasSelectedEquipmentOrSourceReservation, equipmentRequiredMsg);

export const startScanSessionSchema = z.object({
  phase: z.enum(["CHECKOUT", "CHECKIN"]),
  deviceContext: z.string().max(500).optional()
});

export const scanSchema = z.object({
  phase: z.enum(["CHECKOUT", "CHECKIN"]),
  scanType: z.enum(["SERIALIZED", "BULK_BIN"]),
  scanValue: z.string().trim().min(1),
  quantity: z.number().int().positive().max(MAX_BULK_QUANTITY_PER_LINE).optional(),
  unitNumbers: z.array(bulkUnitNumberSchema)
    .max(MAX_NUMBERED_UNITS_PER_CREATE)
    .superRefine((unitNumbers, ctx) => {
      const seen = new Set<number>();
      unitNumbers.forEach((unitNumber, index) => {
        if (seen.has(unitNumber)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "unitNumbers must be unique",
            path: [index],
          });
        }
        seen.add(unitNumber);
      });
    })
    .optional(),
  deviceContext: z.string().max(500).optional()
});

export const checkinReportSchema = z.object({
  assetId: z.string().min(1),
  type: z.enum(["DAMAGED", "LOST"]),
  description: z.string().max(1000).optional(),
});

export const overrideSchema = z.object({
  reason: z.string().min(5).max(1000),
  details: z.record(z.unknown()).optional()
});

export const createBulkSkuSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  categoryId: databaseIdSchema.nullable().optional(),
  unit: z.string().min(1).default("ea"),
  locationId: databaseIdSchema,
  binQrCodeValue: z.string().min(1),
  minThreshold: z.number().int().min(0).max(MAX_BULK_QUANTITY_PER_LINE).default(0),
  active: z.boolean().default(true),
  initialQuantity: z.number().int().min(0).max(MAX_BULK_QUANTITY_PER_LINE).default(0),
  trackByNumber: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.trackByNumber && value.initialQuantity > MAX_NUMBERED_UNITS_PER_CREATE) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_big,
      maximum: MAX_NUMBERED_UNITS_PER_CREATE,
      inclusive: true,
      type: "number",
      path: ["initialQuantity"],
      message: `Create at most ${MAX_NUMBERED_UNITS_PER_CREATE} numbered units at once`,
    });
  }
});

export const updateBulkSkuSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  category: z.string().optional(),
  categoryId: databaseIdSchema.nullable().optional(),
  departmentId: databaseIdSchema.nullable().optional(),
  unit: z.string().min(1).max(100).optional(),
  locationId: databaseIdSchema.optional(),
  minThreshold: z.number().int().min(0).max(MAX_BULK_QUANTITY_PER_LINE).optional(),
  purchasePrice: moneyDecimalSchema.nullable().optional(),
  purchaseLink: nullableHttpUrlSchema.optional(),
  notes: z.string().max(5000).nullable().optional(),
  active: z.boolean().optional(),
}).strict();

export const addBulkUnitsSchema = z.object({
  count: z.number().int().min(1).max(500),
  reason: z.string().trim().min(3).max(500).optional(),
  productId: databaseIdSchema.nullable().optional(),
});

const bulkSkuProductFields = {
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().min(1).max(120),
  model: z.string().trim().max(120).nullable().optional(),
};

export const createBulkSkuProductSchema = z.object(bulkSkuProductFields).strict();

export const updateBulkSkuProductSchema = z.object({
  name: bulkSkuProductFields.name.optional(),
  brand: bulkSkuProductFields.brand.optional(),
  model: bulkSkuProductFields.model,
  active: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one product field is required");

export const assignBulkUnitProductSchema = z.object({
  productId: databaseIdSchema.nullable(),
}).strict();

export const updateBulkUnitSchema = z.object({
  status: z.enum(["AVAILABLE", "LOST", "RETIRED"]),
  notes: z.string().max(1000).optional(),
  reason: z.string().trim().min(3).max(500).optional()
});

export const bulkUnitLabelExportQuerySchema = z.object({
  scope: z.enum(["unprinted", "all"]).default("unprinted"),
});

export const markBulkUnitLabelsSchema = z.object({
  unitNumbers: z.array(bulkUnitNumberSchema).min(1).max(500),
  printed: z.literal(true),
});

export const adjustBulkSchema = z.object({
  quantityDelta: z.number().int().min(-1_000_000).max(1_000_000).refine((x) => x !== 0, "quantityDelta cannot be 0"),
  reason: z.string().min(3).max(500)
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  rememberMe: z.boolean().optional(),
  companion: z.boolean().optional(),
});

export const authDiscoverySchema = z.object({
  email: z.string().trim().max(254).email(),
});

const passkeyResponseSchema = z.object({
  id: z.string().min(1).max(512),
  rawId: z.string().min(1).max(512),
  response: z.object({
    clientDataJSON: z.string().min(1),
    authenticatorData: z.string().optional(),
    attestationObject: z.string().optional(),
    signature: z.string().optional(),
    userHandle: z.string().nullable().optional(),
    transports: z.array(z.string()).max(8).optional(),
  }).passthrough(),
  type: z.literal("public-key"),
  clientExtensionResults: z.record(z.unknown()).optional(),
  authenticatorAttachment: z.string().optional(),
}).passthrough();

export const passkeyLoginOptionsSchema = z.object({
  rememberMe: z.boolean().optional(),
});

export const passkeyRegistrationOptionsSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
});

export const passkeyRegistrationVerifySchema = z.object({
  response: passkeyResponseSchema,
  name: z.string().trim().max(80).optional(),
});

export const passkeyAuthenticationVerifySchema = z.object({
  response: passkeyResponseSchema,
});

export const passkeyRevokeSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().max(254).email(),
  wiscardNumber: z.string().trim().max(128).nullable().optional(),
  password: z.string().min(8).max(128)
});

export const forgotPasswordSchema = z.object({
  email: z.string().email()
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128)
});

export const resetPasswordAccountSchema = z.object({
  token: z.string().min(1)
});

export const roleSchema = z.nativeEnum(Role);

export const slackHandleSchema = z.string()
  .trim()
  .max(80)
  .refine((value) => value === "" || /^@?[A-Za-z0-9._-]+$/.test(value), {
    message: "Slack handle can include letters, numbers, dots, underscores, and hyphens",
  })
  .nullable()
  .optional();

export function normalizeSlackHandle(value: string | null | undefined) {
  if (value == null) return null;
  const normalized = value.trim().replace(/^@+/, "");
  return normalized ? `@${normalized}` : null;
}

function isSlackProfileUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "slack.com" || url.hostname.endsWith(".slack.com"));
  } catch {
    return false;
  }
}

export const slackProfileUrlSchema = z.string()
  .trim()
  .max(500)
  .refine((value) => value === "" || isSlackProfileUrl(value), {
    message: "Slack profile URL must be an https:// Slack URL",
  })
  .nullable()
  .optional();

export function normalizeSlackProfileUrl(value: string | null | undefined) {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export const wiscardNumberSchema = z.string()
  .trim()
  .max(128)
  .nullable()
  .optional();

export function normalizeWiscardNumber(value: string | null | undefined) {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export const wiscardCardNumberSchema = z.string().trim().regex(/^\d{10}$/, "Wiscard card number must be 10 digits").nullable().optional();
export const wiscardIssueCodeSchema = z.string().trim().regex(/^\d$/, "Wiscard issue code must be 1 digit").nullable().optional();

export function validateBirthdayParts(value: { birthdayMonth?: number | null; birthdayDay?: number | null; birthYear?: number | null }, ctx: z.RefinementCtx) {
  const month = value.birthdayMonth;
  const day = value.birthdayDay;
  if ((month == null) !== (day == null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Birthday month and day must be saved together", path: [month == null ? "birthdayMonth" : "birthdayDay"] });
    return;
  }
  if (month != null && day != null) {
    const year = value.birthYear ?? 2000;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid birthday", path: ["birthdayDay"] });
    }
  }
}

// Fields a user is allowed to edit on their own profile.
// Direct report and assignments are intentionally excluded — staff/admin only.
export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: nullableProfilePhoneSchema,
  personalPhone: nullableProfilePhoneSchema,
  workPhone: nullableProfilePhoneSchema,
  wiscardNumber: wiscardNumberSchema,
  wiscardCardNumber: wiscardCardNumberSchema,
  wiscardIssueCode: wiscardIssueCodeSchema,
  slackHandle: slackHandleSchema,
  slackProfileUrl: slackProfileUrlSchema,
  locationId: z.string().cuid().nullable().optional(),
  title: z.string().max(120).nullable().optional(),
  athleticsEmail: z.string().email().max(255).nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  gradYear: z.number().int().min(1900).max(2100).nullable().optional(),
  graduationTerm: z.nativeEnum(GraduationTerm).nullable().optional(),
  studentYearOverride: z.nativeEnum(StudentYear).nullable().optional(),
  topSize: z.string().max(40).nullable().optional(),
  topSizeFit: z.enum(["UNISEX", "WOMENS", "MENS"]).nullable().optional(),
  bottomSize: z.string().max(40).nullable().optional(),
  shoeSize: z.string().max(40).nullable().optional(),
  shoeSizeSystem: z.enum(["US_WOMENS", "US_MENS"]).nullable().optional(),
  birthdayMonth: z.number().int().min(1).max(12).nullable().optional(),
  birthdayDay: z.number().int().min(1).max(31).nullable().optional(),
  birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
}).superRefine(validateBirthdayParts);

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8).max(128)
});

export const updateUserRoleSchema = z.object({
  role: z.nativeEnum(Role),
  collaboratorPolicyId: z.string().min(1).max(100).nullable().optional(),
});

export const updateBookingSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  requesterUserId: z.string().cuid().optional(),
  locationId: z.string().cuid().optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  serializedAssetIds: z.array(z.string().cuid()).max(MAX_EQUIPMENT_SELECTIONS_PER_REQUEST).optional(),
  bulkItems: bulkItemsSchema.optional(),
  notes: z.string().max(10000).optional()
});

export const extendBookingSchema = z.object({
  endsAt: z.string().datetime({ offset: true })
});

export const transferBookingOwnerSchema = z.object({
  targetUserId: z.string().cuid(),
  reason: z.string().trim().max(1000).optional(),
});

export const updateBookingEventsSchema = z.object({
  eventIds: eventIdsListSchema,
});

export const sportShiftConfigSchema = z.object({
  area: z.nativeEnum(ShiftArea),
  homeCount: z.number().int().min(0).max(20).optional(),
  awayCount: z.number().int().min(0).max(20).optional(),
  homeStaffCount: z.number().int().min(0).max(20).optional(),
  homeStudentCount: z.number().int().min(0).max(20).optional(),
  awayStaffCount: z.number().int().min(0).max(20).optional(),
  awayStudentCount: z.number().int().min(0).max(20).optional(),
});

const sportShiftConfigsSchema = z.array(sportShiftConfigSchema)
  .max(MAX_SPORT_SHIFT_CONFIGS_PER_REQUEST)
  .superRefine((shiftConfigs, ctx) => {
    const seenAreas = new Set<ShiftArea>();
    shiftConfigs.forEach((shiftConfig, index) => {
      if (seenAreas.has(shiftConfig.area)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Shift config areas must be unique",
          path: [index, "area"],
        });
      }
      seenAreas.add(shiftConfig.area);
    });
  });

export const upsertSportConfigSchema = z.object({
  sportCode: sportCodeSchema,
  active: z.boolean().optional(),
  shiftConfigs: sportShiftConfigsSchema.optional(),
  shiftStartOffset: z.number().int().min(0).max(480).optional(),
  shiftEndOffset: z.number().int().min(0).max(480).optional(),
});

export const updateSportConfigSchema = z.object({
  active: z.boolean().optional(),
  shiftConfigs: sportShiftConfigsSchema.optional(),
  shiftStartOffset: z.number().int().min(0).max(480).optional(),
  shiftEndOffset: z.number().int().min(0).max(480).optional(),
});

/** Group update — apply the same patch atomically to N sport codes. */
export const updateSportConfigGroupSchema = z
  .object({
    codes: z.array(sportCodeSchema)
      .min(1)
      .max(MAX_SPORT_CONFIG_GROUP_CODES_PER_REQUEST)
      .superRefine((codes, ctx) => {
        const seenCodes = new Set<string>();
        codes.forEach((code, index) => {
          if (seenCodes.has(code)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Sport codes must be unique",
              path: [index],
            });
          }
          seenCodes.add(code);
        });
      }),
    active: z.boolean().optional(),
    shiftConfigs: sportShiftConfigsSchema.optional(),
    shiftStartOffset: z.number().int().min(0).max(480).optional(),
    shiftEndOffset: z.number().int().min(0).max(480).optional(),
  })
  .refine(
    (d) =>
      d.active !== undefined ||
      d.shiftConfigs !== undefined ||
      d.shiftStartOffset !== undefined ||
      d.shiftEndOffset !== undefined,
    { message: "Provide at least one field to update" }
  );

export const sportRosterSchema = z.object({
  userId: z.string().cuid(),
  sportCode: sportCodeSchema,
});

export const sportRosterBulkSchema = z.object({
  userIds: z.array(z.string().cuid()).min(1).max(MAX_SPORT_ROSTER_USERS_PER_REQUEST),
  sportCode: sportCodeSchema,
});

export const createShiftSchema = z.object({
  shiftGroupId: z.string().cuid(),
  area: z.nativeEnum(ShiftArea),
  workerType: z.nativeEnum(ShiftWorkerType),
  startsAt: z.string(),
  endsAt: z.string(),
  callStartsAt: z.string().optional().nullable(),
  callEndsAt: z.string().optional().nullable(),
  notes: z.string().max(5000).optional(),
});

export const updateShiftSchema = z.object({
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  callStartsAt: z.string().optional().nullable(),
  callEndsAt: z.string().optional().nullable(),
  notes: z.string().max(5000).optional(),
});

export const updateShiftGroupSchema = z.object({
  notes: z.string().max(5000).optional(),
});

export const assignShiftSchema = z.object({
  shiftId: z.string().cuid(),
  userId: z.string().cuid(),
  callStartsAt: z.string().optional().nullable(),
  callEndsAt: z.string().optional().nullable(),
  callNote: z.string().max(500).optional().nullable(),
  notes: z.string().max(5000).optional(),
});

export const updateShiftAssignmentSchema = z.object({
  callStartsAt: z.string().optional().nullable(),
  callEndsAt: z.string().optional().nullable(),
  callNote: z.string().max(500).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export const requestShiftSchema = z.object({
  shiftId: z.string().cuid(),
  notes: z.string().max(5000).optional(),
});

export const swapShiftSchema = z.object({
  targetUserId: z.string().cuid(),
});

export const postTradeSchema = z.object({
  shiftAssignmentId: z.string().cuid(),
  notes: z.string().max(5000).optional(),
});

export const studentAreaSchema = z.object({
  userId: z.string().cuid(),
  area: z.nativeEnum(ShiftArea),
  isPrimary: z.boolean().default(false),
});

export const updateUserSchedulingSchema = z.object({
  phone: z.string().max(20).optional().nullable(),
  primaryArea: z.nativeEnum(ShiftArea).optional().nullable(),
});

const internalAllowedEmailSchema = z.object({
  email: z.string().max(254).email(),
  role: z.enum(["STAFF", "STUDENT"]).default("STUDENT"),
  affiliation: z.null().optional(),
  collaboratorProfile: z.null().optional(),
  collaboratorPolicyId: z.null().optional(),
  preloadedName: z.string().trim().min(1).max(100).nullable().optional(),
  preloadedPrimaryArea: z.nativeEnum(ShiftArea).nullable().optional(),
  preloadedAreas: z.array(z.nativeEnum(ShiftArea)).max(6).optional().default([]),
  preloadedSportCodes: z.array(sportCodeSchema).max(30).optional().default([]),
});

const collaboratorAllowedEmailSchema = z.object({
  email: z.string().max(254).email(),
  role: z.literal("COLLABORATOR"),
  collaboratorPolicyId: z.string().min(1).max(100).optional(),
  affiliation: z.literal("BIG_TEN_NETWORK").optional(),
  collaboratorProfile: z.literal("BTN_STANDARD").optional(),
}).refine(
  (value) => Boolean(value.collaboratorPolicyId) || (
    value.affiliation === "BIG_TEN_NETWORK" && value.collaboratorProfile === "BTN_STANDARD"
  ),
  { message: "Choose an active collaborator affiliation" },
);

export const createAllowedEmailSchema = z.union([
  internalAllowedEmailSchema,
  collaboratorAllowedEmailSchema,
]);

export const updateAllowedEmailProfileSchema = z.object({
  preloadedName: z.string().trim().min(1).max(100).nullable(),
  preloadedPrimaryArea: z.nativeEnum(ShiftArea).nullable(),
  preloadedAreas: z.array(z.nativeEnum(ShiftArea)).max(6),
  preloadedSportCodes: z.array(sportCodeSchema).max(30),
}).strict();

export const createAllowedEmailBulkSchema = z.object({
  emails: z.array(createAllowedEmailSchema).min(1).max(50),
});

export const createGuideSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  type: z.nativeEnum(ResourceType).optional().default(ResourceType.GENERAL),
  category: z.string().min(1, "Category is required").max(100),
  content: z.unknown().optional(),
  markdown: z.string().max(200_000).optional(),
  targetRoles: z.array(z.nativeEnum(Role)).max(3).optional().default([]),
  targetAreas: z.array(z.nativeEnum(ShiftArea)).max(4).optional().default([]),
  featured: z.boolean().optional().default(false),
  featuredRank: z.number().int().min(1).max(999).nullable().optional(),
  published: z.boolean().optional().default(false),
});

export const updateGuideSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  type: z.nativeEnum(ResourceType).optional(),
  category: z.string().min(1).max(100).optional(),
  content: z.unknown().optional(),
  markdown: z.string().max(200_000).optional(),
  targetRoles: z.array(z.nativeEnum(Role)).max(3).optional(),
  targetAreas: z.array(z.nativeEnum(ShiftArea)).max(4).optional(),
  featured: z.boolean().optional(),
  featuredRank: z.number().int().min(1).max(999).nullable().optional(),
  published: z.boolean().optional(),
  markVerified: z.boolean().optional(),
  // Optimistic concurrency: client sends the updatedAt of the guide it loaded.
  expectedUpdatedAt: z.string().datetime().optional(),
});

// ── Blasts ──────────────────────────────────────────────

/** One blast may not name more people than a sender could plausibly have picked. */
export const MAX_BLAST_TARGET_USERS = 200;

export const blastTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("EVENT_CREW"),
    eventId: databaseIdSchema,
  }),
  z.object({
    kind: z.literal("USERS"),
    userIds: z.array(databaseIdSchema).min(1).max(MAX_BLAST_TARGET_USERS),
  }),
  z.object({
    kind: z.literal("DYNAMIC"),
    areas: z.array(z.nativeEnum(ShiftArea)).max(5).optional(),
    workerTypes: z.array(z.nativeEnum(ShiftWorkerType)).max(2).optional(),
    sportCodes: z.array(sportCodeSchema).max(30).optional(),
  }),
// The refinement sits on the union rather than the DYNAMIC member: zod's
// discriminatedUnion only accepts plain objects as options, not ZodEffects.
]).superRefine((target, ctx) => {
  if (target.kind !== "DYNAMIC") return;
  const selected = (target.areas?.length ?? 0) + (target.workerTypes?.length ?? 0) + (target.sportCodes?.length ?? 0);
  if (selected === 0) {
    // An empty dynamic spec would silently resolve to everyone.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Pick at least one area, worker type, or sport",
      path: ["areas"],
    });
  }
});

export const createBlastSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(1000),
  severity: z.nativeEnum(BlastSeverity).default("INFO"),
  requiresAck: z.boolean().default(true),
  expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
  target: blastTargetSchema,
});

export const previewBlastSchema = z.object({
  target: blastTargetSchema,
});
