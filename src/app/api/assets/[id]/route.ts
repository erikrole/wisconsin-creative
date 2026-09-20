import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission, requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { BookingStatus, Prisma } from "@prisma/client";
import { deriveAssetStatus } from "@/lib/services/status";
import { createAuditEntry } from "@/lib/audit";
import { canonicalFirmwareIdentity } from "@/lib/firmware-watch-targets";
import { databaseIdSchema, moneyDecimalSchema, nullableHttpUrlSchema } from "@/lib/validation";
import { sanitizeCollaboratorPickerAsset } from "@/lib/collaborator-gear";
import { buildAssetTagSortFields } from "@/lib/item-asset-tag-sort";

const nullableTrimmedString = (max = 500) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable(),
  );

const nullableDateString = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().date().nullable(),
);

const optionalText = z.string().trim();

const patchAssetSchema = z
  .object({
    assetTag: z.string().trim().min(1).optional(),
    name: nullableTrimmedString(500).optional(),
    type: z.string().trim().min(1).optional(),
    brand: optionalText.optional(),
    model: optionalText.optional(),
    serialNumber: nullableTrimmedString(500).optional(),
    qrCodeValue: z.string().trim().min(1).optional(),
    purchaseDate: nullableDateString.optional(),
    purchasePrice: moneyDecimalSchema.nullable().optional(),
    warrantyDate: nullableDateString.optional(),
    residualValue: moneyDecimalSchema.nullable().optional(),
    locationId: databaseIdSchema.optional(),
    categoryId: databaseIdSchema.nullable().optional(),
    departmentId: databaseIdSchema.nullable().optional(),
    status: z.enum(["AVAILABLE", "MAINTENANCE", "RETIRED"]).optional(),
    notes: z.string().max(10000).optional(),
    linkUrl: nullableHttpUrlSchema.optional(),
    availableForReservation: z.boolean().optional(),
    availableForCheckout: z.boolean().optional(),
    availableForCustody: z.boolean().optional(),
  })
  .strict();

function parseNotes(notes: string | null) {
  if (!notes) return null;
  try {
    const parsed: unknown = JSON.parse(notes);
    // JSON.parse also accepts scalars and arrays ("1234", "true", "[…]").
    // Only a plain object is import metadata — anything else is a real
    // user-typed note and must stay visible (and `metadata` must stay an
    // object shape for the iOS decoder).
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function findFirmwareWatchTargetForAsset(brandValue: string, modelValue: string) {
  const identity = canonicalFirmwareIdentity(brandValue, modelValue);
  if (!identity) return null;
  const { brand, model } = identity;

  const target = await db.firmwareWatchTarget.findFirst({
    where: {
      enabled: true,
      brand,
      model,
    },
    select: {
      id: true,
      productName: true,
      brand: true,
      model: true,
      sourceUrl: true,
      supportMode: true,
      supportNote: true,
      latestVersion: true,
      latestReleaseDate: true,
      lastCheckedAt: true,
      lastError: true,
    },
  });

  if (!target) return null;

  return {
    ...target,
    latestReleaseDate: target.latestReleaseDate?.toISOString() ?? null,
    lastCheckedAt: target.lastCheckedAt?.toISOString() ?? null,
  };
}

export const GET = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermissionOrCollaboratorCapability(user, "asset", "view", "GEAR_CATALOG_VIEW");

  if (user.role === "COLLABORATOR") {
    const [asset, computedStatus] = await Promise.all([
      db.asset.findFirst({
        where: {
          id: params.id,
          parentAssetId: null,
          availableForReservation: true,
          status: { not: "RETIRED" },
        },
        select: {
          id: true,
          assetTag: true,
          name: true,
          brand: true,
          model: true,
          imageUrl: true,
          location: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
        },
      }),
      deriveAssetStatus(params.id).catch(() => null),
    ]);
    if (!asset) throw new HttpError(404, "Asset not found");
    return ok({
      data: sanitizeCollaboratorPickerAsset({
        ...asset,
        computedStatus: computedStatus ?? "UNAVAILABLE",
      }),
    });
  }

  const [asset, derivedStatus, bookingHistory, activeAllocs, upcomingReservations, accessories, favoriteRow] = await Promise.all([
    db.asset.findUnique({
      where: { id: params.id },
      include: { location: true, category: true, department: { select: { id: true, name: true } }, parent: { select: { id: true, assetTag: true, name: true, brand: true, model: true } } }
    }),
    deriveAssetStatus(params.id).catch(() => null),
    db.bookingSerializedItem.findMany({
      where: { assetId: params.id },
      include: {
        booking: {
          include: {
            requester: { select: { id: true, name: true, avatarUrl: true } },
            location: { select: { id: true, name: true } },
            event: { select: { id: true, summary: true, sportCode: true, opponent: true, isHome: true, startsAt: true, endsAt: true } }
          }
        }
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    }),
    db.assetAllocation.findMany({
      where: {
        assetId: params.id,
        active: true,
        booking: { status: { in: [BookingStatus.BOOKED, BookingStatus.PENDING_PICKUP, BookingStatus.OPEN] } },
      },
      include: {
        booking: {
          select: {
            id: true,
            kind: true,
            status: true,
            title: true,
            startsAt: true,
            endsAt: true,
            requester: { select: { name: true, avatarUrl: true } },
          },
        },
      },
    }),
    db.bookingSerializedItem.findMany({
      where: {
        assetId: params.id,
        booking: {
          kind: "RESERVATION",
          status: { in: [BookingStatus.DRAFT, BookingStatus.BOOKED, BookingStatus.OPEN] },
          endsAt: { gt: new Date() },
        },
      },
      include: {
        booking: {
          select: {
            id: true,
            title: true,
            status: true,
            startsAt: true,
            endsAt: true,
            requester: { select: { name: true } },
          },
        },
      },
      orderBy: { booking: { startsAt: "asc" } },
      take: 10,
    }),
    db.asset.findMany({
      where: { parentAssetId: params.id },
      select: {
        id: true,
        assetTag: true,
        name: true,
        brand: true,
        model: true,
        serialNumber: true,
        status: true,
        type: true,
        imageUrl: true,
      },
      orderBy: { assetTag: "asc" },
    }),
    db.favoriteItem.findUnique({
      where: { userId_assetId: { userId: user.id, assetId: params.id } },
      select: { id: true },
    }),
  ]);

  if (!asset) {
    throw new HttpError(404, "Asset not found");
  }

  const computedStatus = derivedStatus ?? asset.status;

  // Build active booking info for status line
  let activeBooking: { id: string; kind: string; status: string; title: string; startsAt: string; endsAt: string; requesterName: string; requesterAvatarUrl: string | null } | null = null;
  const activeAlloc = activeAllocs.find((alloc) => {
    if (computedStatus === "CHECKED_OUT") {
      return alloc.booking.kind === "CHECKOUT" && alloc.booking.status === BookingStatus.OPEN;
    }
    if (computedStatus === "PENDING_PICKUP") {
      return alloc.booking.kind === "CHECKOUT" && alloc.booking.status === BookingStatus.PENDING_PICKUP;
    }
    if (computedStatus === "RESERVED") {
      return alloc.booking.kind === "RESERVATION" && alloc.booking.status === BookingStatus.BOOKED && alloc.startsAt <= new Date();
    }
    return false;
  });
  if (activeAlloc) {
    activeBooking = {
      id: activeAlloc.booking.id,
      kind: activeAlloc.booking.kind,
      status: activeAlloc.booking.status,
      title: activeAlloc.booking.title,
      startsAt: activeAlloc.booking.startsAt.toISOString(),
      endsAt: activeAlloc.booking.endsAt.toISOString(),
      requesterName: activeAlloc.booking.requester?.name ?? "Unknown",
      requesterAvatarUrl: activeAlloc.booking.requester?.avatarUrl ?? null,
    };
  }

  // Check if item has any booking history (for delete gating)
  const hasBookingHistory = bookingHistory.length > 0;

  const parsedMeta = parseNotes(asset.notes);
  const firmwareWatch = await findFirmwareWatchTargetForAsset(asset.brand, asset.model);

  return ok({
    data: {
      ...asset,
      // If notes is JSON metadata (from imports), suppress it as user-visible text.
      // The structured metadata is exposed via the `metadata` field instead.
      notes: parsedMeta ? null : asset.notes,
      computedStatus,
      isFavorited: !!favoriteRow,
      metadata: parsedMeta,
      activeBooking,
      hasBookingHistory,
      parentAsset: asset.parent ?? null,
      accessories,
      firmwareWatch,
      upcomingReservations: (() => {
        const seen = new Set<string>();
        if (activeBooking) seen.add(activeBooking.id);
        return upcomingReservations
          .filter((r) => {
            if (seen.has(r.booking.id)) return false;
            seen.add(r.booking.id);
            return true;
          })
          .map((r) => ({
            bookingId: r.booking.id,
            title: r.booking.title,
            status: r.booking.status,
            startsAt: r.booking.startsAt,
            endsAt: r.booking.endsAt,
            requesterName: r.booking.requester?.name ?? "Unknown",
          }));
      })(),
      history: bookingHistory.map((entry) => ({
        id: entry.id,
        createdAt: entry.createdAt,
        booking: {
          id: entry.booking.id,
          kind: entry.booking.kind,
          status: entry.booking.status,
          title: entry.booking.title,
          startsAt: entry.booking.startsAt,
          endsAt: entry.booking.endsAt,
          sportCode: entry.booking.sportCode,
          requester: entry.booking.requester,
          location: entry.booking.location,
          event: entry.booking.event ? {
            id: entry.booking.event.id,
            summary: entry.booking.event.summary,
            sportCode: entry.booking.event.sportCode,
            opponent: entry.booking.event.opponent,
            isHome: entry.booking.event.isHome,
            startsAt: entry.booking.event.startsAt,
            endsAt: entry.booking.event.endsAt,
          } : null,
        },
      })),
    },
  });
});

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "asset", "edit");

  const body = patchAssetSchema.parse(await req.json());

  const before = await db.asset.findUnique({ where: { id: params.id } });
  if (!before) throw new HttpError(404, "Asset not found");

  await validateAssetFieldReferences(body);

  let asset;
  try {
    const updateData: Prisma.AssetUpdateInput = {
      ...body,
      // Keep the persisted operational sort key in step with the tag.
      ...(body.assetTag !== undefined ? buildAssetTagSortFields(body.assetTag) : {}),
      ...(body.purchaseDate !== undefined
        ? { purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : null }
        : {}),
      ...(body.warrantyDate !== undefined
        ? { warrantyDate: body.warrantyDate ? new Date(body.warrantyDate) : null }
        : {}),
    };

    asset = await db.asset.update({
      where: { id: params.id },
      data: updateData,
      include: { location: true, category: true, department: { select: { id: true, name: true } } },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = (err.meta?.target as string[]) ?? [];
      if (target.includes("qr_code_value")) {
        throw new HttpError(409, "QR code already in use by another asset");
      }
      if (target.includes("asset_tag")) {
        throw new HttpError(409, "Asset tag already in use by another asset");
      }
      if (target.includes("serial_number")) {
        throw new HttpError(409, "Serial number already in use by another asset");
      }
      throw new HttpError(409, "A unique constraint was violated");
    }
    throw err;
  }

  // Build granular before/after diff for changed fields only
  const changedKeys = Object.keys(body);
  const beforeDiff: Record<string, unknown> = {};
  const afterDiff: Record<string, unknown> = {};
  for (const key of changedKeys) {
    const beforeVal = (before as Record<string, unknown>)[key];
    const afterVal = (asset as Record<string, unknown>)[key];
    beforeDiff[key] = beforeVal ?? null;
    afterDiff[key] = afterVal ?? null;
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "asset",
    entityId: params.id,
    action: "updated",
    before: beforeDiff,
    after: afterDiff,
  });

  return ok({ data: asset });
});

async function validateAssetFieldReferences(body: z.infer<typeof patchAssetSchema>) {
  const [location, category, department] = await Promise.all([
    body.locationId
      ? db.location.findUnique({ where: { id: body.locationId }, select: { id: true } })
      : Promise.resolve({ id: null }),
    body.categoryId
      ? db.category.findUnique({ where: { id: body.categoryId }, select: { id: true } })
      : Promise.resolve({ id: null }),
    body.departmentId
      ? db.department.findUnique({ where: { id: body.departmentId }, select: { id: true } })
      : Promise.resolve({ id: null }),
  ]);

  if (body.locationId && !location) throw new HttpError(400, "Location not found");
  if (body.categoryId && !category) throw new HttpError(400, "Category not found");
  if (body.departmentId && !department) throw new HttpError(400, "Department not found");
}

export const DELETE = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "asset", "delete");

  const { id } = params;
  const asset = await db.asset.findUnique({ where: { id } });
  if (!asset) throw new HttpError(404, "Asset not found");

  // Atomic: check booking history + delete in one transaction to prevent TOCTOU
  await db.$transaction(async (tx) => {
    const [bookingCount, activeAllocCount] = await Promise.all([
      tx.bookingSerializedItem.count({ where: { assetId: id } }),
      tx.assetAllocation.count({ where: { assetId: id, active: true } }),
    ]);

    if (bookingCount > 0 || activeAllocCount > 0) {
      throw new HttpError(
        409,
        "Cannot delete: this item has booking history. Use Retire instead."
      );
    }

    await tx.asset.delete({ where: { id } });
  });

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "asset",
    entityId: id,
    action: "deleted",
    before: { assetTag: asset.assetTag, type: asset.type },
  });

  return ok({ success: true });
});
