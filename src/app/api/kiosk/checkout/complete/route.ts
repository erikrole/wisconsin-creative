import { BookingKind, BookingStatus, BulkMovementKind, BulkUnitStatus, CalendarEventStatus, Prisma } from "@prisma/client";
import { after } from "next/server";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { createAuditEntryTx } from "@/lib/audit";
import { checkoutCompleteBody } from "@/lib/schemas/kiosk";
import { nextBookingRef } from "@/lib/services/booking-ref";
import { upsertBulkBalancesAndMovements } from "@/lib/services/bookings-helpers";
import { bulkRequestsFromCheckoutUnits, normalizeCheckoutCompleteItems } from "@/lib/services/kiosk-checkout-complete";
import { ACTIVE_BULK_UNIT_ALLOCATION_WHERE, CLAIMABLE_BULK_UNIT_WHERE, effectiveBulkUnitStatus } from "@/lib/bulk-unit-status";
import { checkAvailability, type AvailabilityResult } from "@/lib/services/availability";
import { parseDateRange } from "@/lib/time";
import { badges, earnedBadgesSince } from "@/lib/badges";
import { scheduleCheckoutReturnLiveActivity } from "@/lib/live-activity-workflow";
import { normalizeBookingTitle } from "@/lib/title-normalization";
import { normalizeCheckoutPolicies } from "@/lib/services/checkout-policies";
import { isSerializationConflict } from "@/lib/serialization";

const MAX_SERIALIZABLE_ATTEMPTS = 2;

function hasBlockingAvailabilityIssue(result: AvailabilityResult) {
  return result.conflicts.length > 0 || result.shortages.length > 0 || result.unavailableAssets.length > 0;
}

function prismaErrorText(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const meta = typeof error === "object" && error && "meta" in error
    ? JSON.stringify((error as { meta?: unknown }).meta ?? {})
    : "";
  return `${message} ${meta}`;
}

function isBookingAllocationConstraintError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  const text = prismaErrorText(error);

  if (code === "23P01" || text.includes("asset_allocations_no_overlap")) {
    return true;
  }

  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code === "P2002") {
    const target = (error.meta?.target as string[] | string | undefined) ?? "";
    const targetStr = Array.isArray(target) ? target.join(",") : String(target);
    return (
      targetStr.includes("asset_allocations_asset_id_active_unique") ||
      targetStr.includes("asset_id")
    );
  }

  return error.code === "P2004" && text.includes("asset_allocations");
}

async function withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === MAX_SERIALIZABLE_ATTEMPTS) {
        throw error;
      }
    }
  }
  throw new Error("Serializable checkout retry exhausted");
}

/**
 * Complete a kiosk checkout: create booking + allocations in one step.
 * This is the scan-first flow: items were validated during scanning,
 * now we create the booking and allocations atomically.
 */
export const POST = withKiosk(async (req, { kiosk }) => {
  const badgeWindowStart = new Date(Date.now() - 1);
  const body = checkoutCompleteBody.parse(await req.json());
  const actorId = body.actorId;
  const locationId = kiosk.locationId;
  const { assetIds, bulkUnitItems } = normalizeCheckoutCompleteItems(body.items);
  const customPurpose = body.customPurpose?.trim();

  const now = new Date();
  const eventWindowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  try {
    const { booking, refNumber } = await withSerializableRetry(() => db.$transaction(
      async (tx) => {
        const transactionalUser = await tx.user.findFirst({
          where: { id: actorId, active: true },
          select: { id: true, role: true },
        });
        if (!transactionalUser) throw new HttpError(404, "User not found");

        // Generate ref-number inside the transaction so the advisory lock
        // (held by `nextBookingRef`) serializes concurrent kiosk completions.
        const refNumber = await nextBookingRef(tx, "CO");

        const policyRow = await tx.systemConfig.findUnique({
          where: { key: "checkout_policies" },
          select: { value: true },
        });
        const policies = normalizeCheckoutPolicies(policyRow?.value);
        if (policies.maxItemsPerUser !== null) {
          const activeCheckoutCount = await tx.booking.count({
            where: {
              kind: BookingKind.CHECKOUT,
              requesterUserId: actorId,
              status: { in: [BookingStatus.OPEN, BookingStatus.PENDING_PICKUP] },
            },
          });
          if (activeCheckoutCount >= policies.maxItemsPerUser) {
            throw new HttpError(409, "This user already has the maximum number of active checkouts");
          }
        }

        const event = body.eventId
          ? await tx.calendarEvent.findFirst({
              where: {
                id: body.eventId,
                startsAt: { lte: eventWindowEnd },
                endsAt: { gte: now },
                status: { not: CalendarEventStatus.CANCELLED },
                isHidden: false,
                archivedAt: null,
              },
              select: { id: true, summary: true, sportCode: true, endsAt: true },
            })
          : null;
        if (body.eventId && !event) {
          throw new HttpError(400, "Selected event is no longer available");
        }

        // Linked-event checkouts without an explicit return time get event end
        // + 90 minutes — tear-down/travel buffer, matching the kiosk UI default.
        const linkedEventReturnBufferMs = 90 * 60 * 1000;
        const defaultEndsAt = event?.endsAt
          ? new Date(event.endsAt.getTime() + linkedEventReturnBufferMs)
          : null;
        const resolvedDefaultEndsAt =
          defaultEndsAt && defaultEndsAt > now
            ? defaultEndsAt
            : new Date(now.getTime() + policies.defaultLoanDays * 24 * 60 * 60 * 1000);
        const { start: startsAt, end: endsAt } = parseDateRange(
          now.toISOString(),
          body.endsAt ?? resolvedDefaultEndsAt.toISOString(),
        );

        const rawTitle = event?.summary ?? customPurpose;
        if (!rawTitle) {
          throw new HttpError(400, "Select an event or enter what this checkout is for");
        }
        const title = normalizeBookingTitle(rawTitle);
        // The pickup kiosk is captured on `pickupKioskDeviceId`, so we no longer
        // duplicate it as a note. Keep only a real user-entered purpose.
        const notes = event && customPurpose ? `Purpose: ${customPurpose}` : null;

        const availability = await checkAvailability(tx, {
          locationId,
          startsAt,
          endsAt,
          serializedAssetIds: assetIds,
          bulkItems: bulkRequestsFromCheckoutUnits(bulkUnitItems),
          bookingKind: BookingKind.CHECKOUT,
          includeBulkTurnaroundRisks: false,
        });
        if (hasBlockingAvailabilityIssue(availability)) {
          throw new HttpError(
            409,
            "One or more items are not available for the selected return time",
            availability,
          );
        }

        // Create the booking
        const b = await tx.booking.create({
          data: {
            kind: "CHECKOUT",
            status: "OPEN",
            title,
            eventId: event?.id,
            sportCode: event?.sportCode,
            requesterUserId: actorId,
            createdBy: actorId,
            locationId,
            startsAt,
            endsAt,
            refNumber,
            notes,
            pickupKioskDeviceId: kiosk.kioskId,
          },
        });

        if (event) {
          await tx.bookingEvent.create({
            data: {
              bookingId: b.id,
              eventId: event.id,
              ordinal: 0,
            },
          });
        }

        // Create serialized items + allocations
        const ids = assetIds;

        if (ids.length > 0) {
          await tx.bookingSerializedItem.createMany({
            data: ids.map((assetId) => ({
              bookingId: b.id,
              assetId,
              allocationStatus: "active",
            })),
          });

          await tx.assetAllocation.createMany({
            data: ids.map((assetId) => ({
              assetId,
              bookingId: b.id,
              startsAt,
              endsAt,
              active: true,
              kind: "CHECKOUT" as const,
            })),
          });

        }

        if (bulkUnitItems.length > 0) {
          const seenBulkUnits = new Set<string>();
          for (const item of bulkUnitItems) {
            const key = `${item.bulkSkuId}:${item.unitNumber}`;
            if (seenBulkUnits.has(key)) {
              throw new HttpError(409, "Duplicate battery unit in checkout");
            }
            seenBulkUnits.add(key);
          }

          const units = await tx.bulkSkuUnit.findMany({
            where: {
              OR: bulkUnitItems.map((item) => ({
                bulkSkuId: item.bulkSkuId,
                unitNumber: item.unitNumber,
              })),
            },
            include: {
              bulkSku: {
                select: {
                  id: true,
                  name: true,
                  active: true,
                },
              },
              allocations: {
                where: ACTIVE_BULK_UNIT_ALLOCATION_WHERE,
                take: 1,
                select: { id: true },
              },
            },
          });
          if (units.length !== bulkUnitItems.length) {
            throw new HttpError(404, "One or more battery units were not found");
          }

          // Effective status, not raw: an orphaned CHECKED_OUT flag with no
          // active allocation is claimable (every read path already reports
          // it available) — claiming self-heals the flag.
          const unavailable = units.find(
            (unit) => !unit.bulkSku.active || effectiveBulkUnitStatus(unit, unit.allocations[0]) !== BulkUnitStatus.AVAILABLE,
          );
          if (unavailable) {
            throw new HttpError(409, `${unavailable.bulkSku.name} #${unavailable.unitNumber} is no longer available`);
          }

          const updatedUnits = await tx.bulkSkuUnit.updateMany({
            where: {
              id: { in: units.map((unit) => unit.id) },
              ...CLAIMABLE_BULK_UNIT_WHERE,
            },
            data: { status: BulkUnitStatus.CHECKED_OUT },
          });
          if (updatedUnits.count !== units.length) {
            throw new HttpError(409, "One or more battery units are no longer available");
          }

          const unitsBySku = new Map<string, typeof units>();
          for (const unit of units) {
            unitsBySku.set(unit.bulkSkuId, [...(unitsBySku.get(unit.bulkSkuId) ?? []), unit]);
          }

          await tx.bookingBulkItem.createMany({
            data: [...unitsBySku.entries()].map(([bulkSkuId, skuUnits]) => ({
              bookingId: b.id,
              bulkSkuId,
              plannedQuantity: skuUnits.length,
              checkedOutQuantity: skuUnits.length,
            })),
          });
          const createdBulkItems = await tx.bookingBulkItem.findMany({
            where: {
              bookingId: b.id,
              bulkSkuId: { in: [...unitsBySku.keys()] },
            },
            select: { id: true, bulkSkuId: true },
          });
          if (createdBulkItems.length !== unitsBySku.size) {
            throw new Error("Failed to resolve created checkout bulk items");
          }
          const bulkItemIdBySku = new Map(createdBulkItems.map((item) => [item.bulkSkuId, item.id]));

          await tx.bookingBulkUnitAllocation.createMany({
            data: units.flatMap((unit) => {
              const bookingBulkItemId = bulkItemIdBySku.get(unit.bulkSkuId);
              if (!bookingBulkItemId) {
                throw new Error("Failed to match a checkout bulk unit to its booking item");
              }
              return [{
                bookingBulkItemId,
                bulkSkuUnitId: unit.id,
                checkedOutAt: now,
              }];
            }),
          });

          await upsertBulkBalancesAndMovements(tx, {
            locationId,
            bookingId: b.id,
            actorUserId: actorId,
            kind: BulkMovementKind.CHECKOUT,
            items: [...unitsBySku.entries()].map(([bulkSkuId, skuUnits]) => ({
              bulkSkuId,
              quantity: skuUnits.length,
            })),
          });
        }

        await createAuditEntryTx(tx, {
          actorId,
          actorRole: transactionalUser.role,
          entityType: "booking",
          entityId: b.id,
          action: "kiosk_checkout",
          after: {
            refNumber,
            itemCount: assetIds.length + bulkUnitItems.length,
            source: "KIOSK",
            kioskDeviceId: kiosk.kioskId,
            locationName: kiosk.locationName,
            eventId: body.eventId ?? null,
            customPurpose: customPurpose ?? null,
            title: b.title,
            startsAt: b.startsAt.toISOString(),
            endsAt: b.endsAt.toISOString(),
          },
        });

        return { booking: b, refNumber };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    ));

    // Badge evaluation stays outside the custody transaction, but is awaited
    // so the additive reward payload can reach the kiosk success screen.
    await badges.onCheckoutOpened({
      userId: actorId,
      bookingId: booking.id,
      source: "kiosk_checkout",
      sourceKey: booking.id,
    });
    const earnedBadges = await earnedBadgesSince(actorId, badgeWindowStart);

    after(async () => {
      await Promise.allSettled([
        scheduleCheckoutReturnLiveActivity({
          bookingId: booking.id,
          endsAt: booking.endsAt,
        }),
      ]);
    });

    return ok({
      bookingId: booking.id,
      refNumber,
      itemCount: assetIds.length + bulkUnitItems.length,
      endsAt: booking.endsAt,
      ...(earnedBadges.length > 0 ? { earnedBadges } : {}),
    });
  } catch (error) {
    if (isSerializationConflict(error)) {
      throw new HttpError(409, "Checkout changed while it was being created. Please retry");
    }

    if (isBookingAllocationConstraintError(error)) {
      throw new HttpError(409, "One or more items are no longer available");
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const target = (error.meta?.target as string[] | string | undefined) ?? "";
      const targetStr = Array.isArray(target) ? target.join(",") : String(target);
      // Booking.refNumber collision → race with another concurrent kiosk; retryable.
      if (targetStr.includes("ref_number") || targetStr.includes("refNumber")) {
        throw new HttpError(
          409,
          "Could not allocate a checkout reference — please retry",
        );
      }
      // BookingSerializedItem(bookingId, assetId) → item-level conflict.
      throw new HttpError(409, "One or more items are no longer available");
    }
    throw error;
  }
});
