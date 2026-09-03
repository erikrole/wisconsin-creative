import { BookingCustodyScope, BookingKind, BookingStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { resolveKioskScanBody } from "@/lib/schemas/kiosk";
import { findAssetByScanValue } from "@/lib/services/kiosk-scan";
import { findBulkUnitByScanValue } from "@/lib/services/bulk-unit-scans";
import { kioskRosterUserWhere } from "@/lib/user-visibility";
import { normalizeTeamAbbreviations } from "@/lib/title-normalization";
import { normalizeWiscardNumber } from "@/lib/validation";

const requesterSelect = {
  id: true,
  name: true,
  avatarUrl: true,
  role: true,
  affiliation: true,
} as const;

const bookingSelect = {
  id: true,
  title: true,
  kind: true,
  status: true,
  custodyScope: true,
  startsAt: true,
  endsAt: true,
  locationId: true,
  location: { select: { id: true, name: true } },
  requester: { select: requesterSelect },
} as const;

type BookingCandidate = {
  id: string;
  title: string;
  kind: BookingKind;
  status: BookingStatus;
  custodyScope: BookingCustodyScope;
  startsAt: Date;
  endsAt: Date;
  locationId: string;
  location: { id: string; name: string };
  requester: {
    id: string;
    name: string;
    avatarUrl: string | null;
    role: string;
    affiliation: string | null;
  };
};

function displayUser(user: BookingCandidate["requester"]) {
  return user;
}

function displayBooking(booking: BookingCandidate) {
  return {
    id: booking.id,
    title: normalizeTeamAbbreviations(booking.title),
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    location: booking.location,
    custodyScope: booking.custodyScope,
  };
}

function blocked(code: string, message: string, item?: unknown, booking?: BookingCandidate) {
  return ok({
    kind: "blocked",
    code,
    message,
    item,
    booking: booking ? displayBooking(booking) : undefined,
    expectedRequester: booking && booking.custodyScope !== BookingCustodyScope.SHARED ? displayUser(booking.requester) : undefined,
  });
}

function actionable(
  action: "checkout" | "pickup" | "return",
  item: unknown,
  booking?: BookingCandidate,
) {
  return ok({
    kind: "action",
    action,
    item,
    booking: booking ? displayBooking(booking) : undefined,
    expectedRequester: booking && booking.custodyScope !== BookingCustodyScope.SHARED ? displayUser(booking.requester) : undefined,
  });
}

function pending(disposition: "available" | "booked_reservation" | "active_custody", item: unknown, booking?: BookingCandidate) {
  return ok({
    kind: "pending_identity",
    disposition,
    item,
    booking: booking ? displayBooking(booking) : undefined,
    expectedRequester: booking && booking.custodyScope !== BookingCustodyScope.SHARED ? displayUser(booking.requester) : undefined,
  });
}

export const POST = withKiosk(async (req, { kiosk }) => {
  await enforceRateLimit(`kiosk:resolve-scan:${kiosk.kioskId}`, { max: 180, windowMs: 60_000 });
  const { scanValue, userId } = resolveKioskScanBody.parse(await req.json());
  const now = new Date();

  const wiscardNumber = normalizeWiscardNumber(scanValue);
  const [identity, asset, unit] = await Promise.all([
    wiscardNumber
      ? db.user.findFirst({
          where: {
            ...kioskRosterUserWhere(),
            wiscardNumber,
          },
          select: requesterSelect,
        })
      : null,
    findAssetByScanValue(scanValue, {
      id: true,
      assetTag: true,
      name: true,
      status: true,
      availableForCheckout: true,
      availableForCustody: true,
      locationId: true,
      location: { select: { id: true, name: true } },
      category: { select: { name: true } },
    }),
    findBulkUnitByScanValue(scanValue),
  ]);

  const itemCount = Number(Boolean(asset)) + Number(Boolean(unit));
  if (identity && itemCount > 0 || itemCount > 1) {
    return ok({ kind: "ambiguous", message: "This code matches more than one kiosk target." });
  }
  if (identity) return ok({ kind: "identity", user: identity });
  if (!asset && !unit) return ok({ kind: "unknown", message: "No person or item matches that code." });

  if (asset) {
    const item = {
      id: asset.id,
      name: asset.name || asset.assetTag,
      tagName: asset.assetTag,
      type: asset.category?.name ?? "Item",
      location: asset.location,
    };
    if (asset.status !== "AVAILABLE" || !asset.availableForCustody) {
      return blocked("item_unavailable", `${item.name} cannot be used for kiosk custody while marked ${asset.status.toLowerCase()}.`, item);
    }

    const allocation = await db.assetAllocation.findFirst({
      where: { assetId: asset.id, active: true },
      orderBy: { createdAt: "desc" },
      select: { kind: true, booking: { select: bookingSelect } },
    });
    const booking = allocation?.booking as BookingCandidate | undefined;
    if (booking?.kind === BookingKind.CHECKOUT && booking.status === BookingStatus.OPEN) {
      if (!userId) return pending("active_custody", item, booking);
      if (booking.custodyScope !== BookingCustodyScope.SHARED && booking.requester.id !== userId) return blocked("wrong_requester", `This return requires ${booking.requester.name}.`, item, booking);
      return actionable("return", item, booking);
    }
    if (booking?.kind === BookingKind.RESERVATION && booking.status === BookingStatus.BOOKED && booking.endsAt >= now) {
      if (!userId) return pending("booked_reservation", item, booking);
      if (booking.requester.id !== userId) return blocked("wrong_requester", `This pickup requires ${booking.requester.name}.`, item, booking);
      return actionable("pickup", item, booking);
    }
    if (booking) {
      return blocked("stale_custody", `${item.name} is attached to a booking that must be refreshed before continuing.`, item, booking);
    }
    if (!asset.availableForCheckout) return blocked("checkout_disabled", `${item.name} is not available for checkout.`, item);
    return userId ? actionable("checkout", item) : pending("available", item);
  }

  const numbered = unit!;
  const item = {
    id: numbered.id,
    name: numbered.name,
    tagName: numbered.tagName,
    type: numbered.type,
    bulkSkuId: numbered.bulkSkuId,
    unitNumber: numbered.unitNumber,
  };
  if (["LOST", "RETIRED"].includes(numbered.status)) {
    return blocked("item_unavailable", `${numbered.name} cannot be used while marked ${numbered.status.toLowerCase()}.`, item);
  }

  const activeUnitAllocation = await db.bookingBulkUnitAllocation.findFirst({
    where: { bulkSkuUnitId: numbered.id, checkedOutAt: { not: null }, checkedInAt: null },
    orderBy: { checkedOutAt: "desc" },
    select: { bookingBulkItem: { select: { booking: { select: bookingSelect } } } },
  });
  const activeBooking = activeUnitAllocation?.bookingBulkItem.booking as BookingCandidate | undefined;
  if (activeBooking?.status === BookingStatus.OPEN) {
    if (!userId) return pending("active_custody", item, activeBooking);
    if (activeBooking.custodyScope !== BookingCustodyScope.SHARED && activeBooking.requester.id !== userId) return blocked("wrong_requester", `This return requires ${activeBooking.requester.name}.`, item, activeBooking);
    return actionable("return", item, activeBooking);
  }
  if (numbered.status === "CHECKED_OUT") {
    return blocked("stale_custody", `${numbered.name} is marked checked out but its active checkout could not be resolved.`, item, activeBooking);
  }

  const reservations = await db.booking.findMany({
    where: {
      kind: BookingKind.RESERVATION,
      status: BookingStatus.BOOKED,
      endsAt: { gte: now },
      ...(userId ? { requesterUserId: userId } : {}),
      bulkItems: { some: { bulkSkuId: numbered.bulkSkuId } },
    },
    orderBy: { startsAt: "asc" },
    select: bookingSelect,
    take: 3,
  }) as BookingCandidate[];
  if (reservations.length > 1) {
    return ok({ kind: "ambiguous", message: "This item matches more than one active reservation.", item });
  }
  const reservation = reservations[0];
  if (reservation) {
    if (!userId) return pending("booked_reservation", item, reservation);
    return actionable("pickup", item, reservation);
  }
  return userId ? actionable("checkout", item) : pending("available", item);
});
