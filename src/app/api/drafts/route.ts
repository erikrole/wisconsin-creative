import { BookingCustodyScope, BookingKind, Prisma, Role } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { ok, HttpError } from "@/lib/http";
import { requirePermission, requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { z } from "zod";
import { optionalSportCodeSchema } from "@/lib/validation";
import { normalizeBookingTitle } from "@/lib/title-normalization";
import {
  assertSupportedReservationPickupLocation,
  defaultReservationPickupLocationId,
} from "@/lib/services/reservation-pickup-location";
import {
  MAX_BULK_QUANTITY_PER_LINE,
  MAX_BULK_SKU_LINES_PER_REQUEST,
  MAX_EQUIPMENT_SELECTIONS_PER_REQUEST,
  MAX_LINKED_EVENTS_PER_BOOKING,
} from "@/lib/request-limits";

const saveDraftSchema = z.object({
  id: z.string().cuid().optional(),
  kind: z.enum(["CHECKOUT", "RESERVATION"]),
  custodyScope: z.nativeEnum(BookingCustodyScope).default(BookingCustodyScope.PERSON),
  title: z.string().max(200).default(""),
  requesterUserId: z.string().cuid().optional(),
  locationId: z.string().cuid().optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  eventId: z.string().cuid().nullable().optional(),
  eventIds: z.array(z.string().cuid()).max(MAX_LINKED_EVENTS_PER_BOOKING).optional(),
  sportCode: optionalSportCodeSchema,
  notes: z.string().max(10000).optional(),
  serializedAssetIds: z
    .array(z.string().cuid())
    .max(MAX_EQUIPMENT_SELECTIONS_PER_REQUEST)
    .default([]),
  bulkItems: z
    .array(z.object({
      bulkSkuId: z.string().cuid(),
      quantity: z.number().int().positive().max(MAX_BULK_QUANTITY_PER_LINE),
    }))
    .max(MAX_BULK_SKU_LINES_PER_REQUEST)
    .default([]),
}).superRefine((body, ctx) => {
  if (new Set(body.serializedAssetIds).size !== body.serializedAssetIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["serializedAssetIds"],
      message: "serializedAssetIds must be unique",
    });
  }
  const bulkSkuIds = body.bulkItems.map((item) => item.bulkSkuId);
  if (new Set(bulkSkuIds).size !== bulkSkuIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bulkItems"],
      message: "bulkItems must contain unique bulkSkuId values",
    });
  }
});

function dedupeIds(ids: string[]) {
  return Array.from(new Set(ids));
}

function draftExpiryCutoff(now = new Date()) {
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
}

async function resolveDraftEventLinks(tx: Prisma.TransactionClient, body: z.infer<typeof saveDraftSchema>) {
  if (body.eventId && body.eventIds && body.eventIds.length > 0) {
    throw new HttpError(400, "Provide either eventId or eventIds, not both");
  }

  const requestedEventIds = body.eventIds && body.eventIds.length > 0
    ? dedupeIds(body.eventIds)
    : body.eventId ? [body.eventId] : [];

  if (requestedEventIds.length === 0) {
    return { primaryEventId: null, sortedEventIds: [] as string[] };
  }

  const events = await tx.calendarEvent.findMany({
    where: { id: { in: requestedEventIds } },
    select: { id: true, startsAt: true },
  });

  if (events.length !== requestedEventIds.length) {
    throw new HttpError(400, "One or more eventIds do not exist");
  }

  const sortedEventIds = events
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map((event) => event.id);

  return { primaryEventId: sortedEventIds[0] ?? null, sortedEventIds };
}

/** GET /api/drafts — list current user's drafts */
export const GET = withAuth(async (_req, { user }) => {
  requirePermissionOrCollaboratorCapability(user, "booking", "view", "MY_GEAR_VIEW");

  const drafts = await db.booking.findMany({
    where: { status: "DRAFT", createdBy: user.id, updatedAt: { gte: draftExpiryCutoff() } },
    orderBy: { updatedAt: "desc" },
    take: 10,
    include: {
      location: { select: { id: true, name: true } },
      _count: { select: { serializedItems: true, bulkItems: true } },
    },
  });

  return ok({
    data: drafts.map((d) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      locationName: d.location?.name ?? null,
      startsAt: d.startsAt.toISOString(),
      endsAt: d.endsAt.toISOString(),
      itemCount: d._count.serializedItems + d._count.bulkItems,
      updatedAt: d.updatedAt.toISOString(),
    })),
  });
});

/** POST /api/drafts — create or update a draft booking */
export const POST = withAuth(async (req, { user }) => {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  const body = saveDraftSchema.parse(rawBody);
  if (body.kind === BookingKind.RESERVATION) {
    requirePermissionOrCollaboratorCapability(user, "booking", "create", "RESERVATION_CREATE");
  } else {
    requirePermission(user.role, "checkout", "create");
  }
  if (body.custodyScope === BookingCustodyScope.SHARED) {
    requirePermission(user.role, "checkout", "manage_custody");
    body.requesterUserId = user.id;
  }

  if (user.role === Role.STUDENT || user.role === Role.COLLABORATOR) {
    body.requesterUserId = user.id;
  }

  // Default dates: now + 4 hours if not provided
  const now = new Date();
  const fourHoursLater = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const startsAt = body.startsAt ? new Date(body.startsAt) : now;
  const endsAt = body.endsAt ? new Date(body.endsAt) : fourHoursLater;

  const locationId = body.locationId ?? (
    body.kind === BookingKind.RESERVATION
      ? await defaultReservationPickupLocationId()
      : await defaultLocationId()
  );
  if (body.kind === BookingKind.RESERVATION) {
    await assertSupportedReservationPickupLocation(locationId);
  }

  const bookingData = {
    kind: body.kind as "CHECKOUT" | "RESERVATION",
    custodyScope: body.custodyScope,
    title: normalizeBookingTitle(body.title || "Untitled draft"),
    status: "DRAFT" as const,
    requesterUserId: body.requesterUserId ?? user.id,
    locationId,
    startsAt,
    endsAt,
    createdBy: user.id,
    sportCode: body.sportCode ?? null,
    notes: body.notes ?? null,
  };

  const draftId = await db.$transaction(async (tx) => {
    if (body.id) {
      // Ownership and lifecycle are checked inside the same transaction as the
      // replacement writes so a concurrent mutation cannot turn a stale
      // pre-check into an update of a non-draft booking.
      const existing = await tx.booking.findFirst({
        where: { id: body.id, status: "DRAFT", createdBy: user.id },
        select: {
          id: true,
          kind: true,
          custodyScope: true,
          title: true,
          requesterUserId: true,
          locationId: true,
          startsAt: true,
          endsAt: true,
          eventId: true,
          sportCode: true,
          notes: true,
          serializedItems: { select: { assetId: true } },
          bulkItems: { select: { bulkSkuId: true, plannedQuantity: true } },
          events: { orderBy: { ordinal: "asc" }, select: { eventId: true } },
        },
      });
      if (!existing) {
        throw new HttpError(404, "Draft not found");
      }
      if (existing.kind !== body.kind) {
        throw new HttpError(400, "Draft kind cannot be changed");
      }

      const { primaryEventId, sortedEventIds } = await resolveDraftEventLinks(tx, body);
      await tx.booking.update({ where: { id: body.id! }, data: { ...bookingData, eventId: primaryEventId } });
      // Replace items and event links
      await tx.bookingSerializedItem.deleteMany({ where: { bookingId: body.id! } });
      await tx.bookingBulkItem.deleteMany({ where: { bookingId: body.id! } });
      await tx.bookingEvent.deleteMany({ where: { bookingId: body.id! } });
      if (body.serializedAssetIds.length > 0) {
        await tx.bookingSerializedItem.createMany({
          data: body.serializedAssetIds.map((assetId) => ({
            bookingId: body.id!,
            assetId,
            allocationStatus: "draft",
          })),
        });
      }
      if (body.bulkItems.length > 0) {
        await tx.bookingBulkItem.createMany({
          data: body.bulkItems.map((bi) => ({
            bookingId: body.id!,
            bulkSkuId: bi.bulkSkuId,
            plannedQuantity: bi.quantity,
          })),
        });
      }
      if (sortedEventIds.length > 0) {
        await tx.bookingEvent.createMany({
          data: sortedEventIds.map((eventId, ordinal) => ({
            bookingId: body.id!,
            eventId,
            ordinal,
          })),
        });
      }
      await createAuditEntryTx(tx, {
        actorId: user.id,
        actorRole: user.role,
        entityType: "booking",
        entityId: body.id,
        action: "draft_updated",
        before: {
          kind: existing.kind,
          custodyScope: existing.custodyScope,
          title: existing.title,
          requesterUserId: existing.requesterUserId,
          locationId: existing.locationId,
          startsAt: existing.startsAt,
          endsAt: existing.endsAt,
          eventId: existing.eventId,
          eventIds: existing.events.map((event) => event.eventId),
          sportCode: existing.sportCode,
          notes: existing.notes,
          serializedAssetIds: existing.serializedItems.map((item) => item.assetId),
          bulkItems: existing.bulkItems.map((item) => ({
            bulkSkuId: item.bulkSkuId,
            quantity: item.plannedQuantity,
          })),
        },
        after: {
          kind: body.kind,
          custodyScope: bookingData.custodyScope,
          title: bookingData.title,
          requesterUserId: bookingData.requesterUserId,
          locationId: bookingData.locationId,
          startsAt,
          endsAt,
          eventIds: sortedEventIds,
          sportCode: bookingData.sportCode,
          notes: bookingData.notes,
          serializedAssetIds: body.serializedAssetIds,
          bulkItems: body.bulkItems,
        },
      });
      return body.id;
    }

    const { primaryEventId, sortedEventIds } = await resolveDraftEventLinks(tx, body);
    const booking = await tx.booking.create({ data: { ...bookingData, eventId: primaryEventId } });
    if (body.serializedAssetIds.length > 0) {
      await tx.bookingSerializedItem.createMany({
        data: body.serializedAssetIds.map((assetId) => ({
          bookingId: booking.id,
          assetId,
          allocationStatus: "draft",
        })),
      });
    }
    if (body.bulkItems.length > 0) {
      await tx.bookingBulkItem.createMany({
        data: body.bulkItems.map((bi) => ({
          bookingId: booking.id,
          bulkSkuId: bi.bulkSkuId,
          plannedQuantity: bi.quantity,
        })),
      });
    }
    if (sortedEventIds.length > 0) {
      await tx.bookingEvent.createMany({
        data: sortedEventIds.map((eventId, ordinal) => ({
          bookingId: booking.id,
          eventId,
          ordinal,
        })),
      });
    }
    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "booking",
      entityId: booking.id,
      action: "draft_created",
      after: {
        kind: body.kind,
        custodyScope: bookingData.custodyScope,
        title: bookingData.title,
        requesterUserId: bookingData.requesterUserId,
        locationId: bookingData.locationId,
        startsAt,
        endsAt,
        eventIds: sortedEventIds,
        sportCode: bookingData.sportCode,
        notes: bookingData.notes,
        serializedAssetIds: body.serializedAssetIds,
        bulkItems: body.bulkItems,
      },
    });
    return booking.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return ok({ data: { id: draftId } }, body.id ? 200 : 201);
});

/** Get first location as fallback when none specified */
async function defaultLocationId(): Promise<string> {
  const loc = await db.location.findFirst({ select: { id: true } });
  if (!loc) throw new HttpError(500, "No locations configured. Please add a location in Settings.");
  return loc.id;
}
