import { BookingKind, BookingStatus, PrismaClient, type Prisma } from "@prisma/client";
import {
  TURNAROUND_WARNING_WINDOW_MINUTES,
  addSerializedTurnaroundBuffer,
  subtractSerializedTurnaroundBuffer,
  turnaroundSeverity,
} from "@/lib/booking-availability-window";

export type BulkRequest = {
  bulkSkuId: string;
  quantity: number;
};

export type AvailabilityResult = {
  conflicts: Array<{
    assetId: string;
    conflictingBookingId: string;
    conflictingBookingTitle?: string;
    conflictingBookingRequesterName?: string;
    conflictingBookingKind?: BookingKind;
    conflictingBookingStatus?: BookingStatus;
    startsAt: Date;
    endsAt: Date;
  }>;
  shortages: Array<{
    bulkSkuId: string;
    requested: number;
    available: number;
  }>;
  unavailableAssets: Array<{
    assetId: string;
    status: string;
  }>;
  upcomingCommitments: Array<{
    assetId: string;
    bookingId: string;
    bookingTitle?: string;
    startsAt: Date;
    endsAt: Date;
    status: BookingStatus;
    nextLocationId?: string | null;
    nextLocationName?: string | null;
  }>;
  turnaroundRisks: Array<{
    assetId: string;
    code: "SHORT_TURNAROUND" | "LOCATION_TRANSFER" | "RECENT_CHECKIN_REPORT";
    severity: "warning" | "critical";
    message: string;
    bookingId?: string;
    bookingTitle?: string;
    startsAt?: Date;
    gapMinutes?: number;
    nextLocationName?: string | null;
    reportType?: "DAMAGED" | "LOST";
    reportCreatedAt?: Date;
  }>;
  bulkTurnaroundRisks: Array<{
    bulkSkuId: string;
    code: "BULK_SHORT_TURNAROUND";
    severity: "warning" | "critical";
    message: string;
    bookingId: string;
    bookingTitle?: string;
    startsAt: Date;
    gapMinutes: number;
    plannedQuantity: number;
  }>;
};

const serializedBlockingStatuses = [
  BookingStatus.BOOKED,
  BookingStatus.PENDING_PICKUP,
  BookingStatus.OPEN,
];
const bulkReservationCommitmentStatuses = [BookingStatus.BOOKED];
const turnaroundWarningWindowMs = TURNAROUND_WARNING_WINDOW_MINUTES * 60_000;
const recentCheckinReportWindowMs = 30 * 24 * 60 * 60 * 1000;

function remainingReservationQuantity(item: { plannedQuantity: number; checkedOutQuantity?: number | null }) {
  return Math.max(0, item.plannedQuantity - (item.checkedOutQuantity ?? 0));
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export async function checkSerializedConflicts(
  tx: Prisma.TransactionClient | PrismaClient,
  args: {
    serializedAssetIds: string[];
    startsAt: Date;
    endsAt: Date;
    excludeBookingId?: string;
    enforceTurnaroundBuffer?: boolean;
  }
): Promise<AvailabilityResult["conflicts"]> {
  if (args.serializedAssetIds.length === 0) {
    return [];
  }

  const enforceTurnaroundBuffer = args.enforceTurnaroundBuffer !== false;
  const conflictStartsAt = enforceTurnaroundBuffer
    ? subtractSerializedTurnaroundBuffer(args.startsAt)
    : args.startsAt;
  const conflictEndsAt = enforceTurnaroundBuffer
    ? addSerializedTurnaroundBuffer(args.endsAt)
    : args.endsAt;

  const conflicts = await tx.assetAllocation.findMany({
    where: {
      assetId: { in: args.serializedAssetIds },
      active: true,
      booking: {
        status: { in: serializedBlockingStatuses }
      },
      // Creation and reservation edits keep the turnaround buffer in both
      // directions. Active-checkout extensions can opt into overlap-only
      // checks so later demand informs the due time without categorically
      // preventing an extension that still ends before that demand starts.
      startsAt: { lt: conflictEndsAt },
      endsAt: { gt: conflictStartsAt },
      ...(args.excludeBookingId ? { bookingId: { not: args.excludeBookingId } } : {})
    },
    select: {
      assetId: true,
      bookingId: true,
      startsAt: true,
      endsAt: true,
      booking: {
        select: {
          title: true,
          kind: true,
          status: true,
          requester: { select: { name: true } },
        },
      }
    }
  });

  return conflicts.map((item) => ({
    assetId: item.assetId,
    conflictingBookingId: item.bookingId,
    conflictingBookingTitle: item.booking.title,
    ...(item.booking.requester?.name ? { conflictingBookingRequesterName: item.booking.requester.name } : {}),
    ...(item.booking.kind ? { conflictingBookingKind: item.booking.kind } : {}),
    ...(item.booking.status ? { conflictingBookingStatus: item.booking.status } : {}),
    startsAt: item.startsAt,
    endsAt: item.endsAt
  }));
}

export async function checkAssetStatuses(
  tx: Prisma.TransactionClient | PrismaClient,
  args: {
    serializedAssetIds: string[];
    bookingKind?: BookingKind;
  }
): Promise<AvailabilityResult["unavailableAssets"]> {
  if (args.serializedAssetIds.length === 0) {
    return [];
  }

  const assets = await tx.asset.findMany({
    where: { id: { in: args.serializedAssetIds } },
    select: {
      id: true,
      status: true,
      availableForCheckout: true,
      availableForReservation: true,
    }
  });

  const foundIds = new Set(assets.map((a) => a.id));
  const missingIds = args.serializedAssetIds.filter((id) => !foundIds.has(id));

  const unavailable: AvailabilityResult["unavailableAssets"] = [];

  for (const a of assets) {
    if (a.status !== "AVAILABLE") {
      unavailable.push({ assetId: a.id, status: a.status as string });
    } else if (args.bookingKind === BookingKind.CHECKOUT && !a.availableForCheckout) {
      unavailable.push({ assetId: a.id, status: "NOT_AVAILABLE_FOR_CHECKOUT" });
    } else if (args.bookingKind === BookingKind.RESERVATION && !a.availableForReservation) {
      unavailable.push({ assetId: a.id, status: "NOT_AVAILABLE_FOR_RESERVATION" });
    }
  }

  const unavailableFromMissing = missingIds.map((id) => ({
    assetId: id,
    status: "NOT_FOUND"
  }));

  return [...unavailable, ...unavailableFromMissing];
}

export async function checkUpcomingSerializedCommitments(
  tx: Prisma.TransactionClient | PrismaClient,
  args: {
    serializedAssetIds: string[];
    endsAt: Date;
    excludeBookingId?: string;
  }
): Promise<AvailabilityResult["upcomingCommitments"]> {
  if (args.serializedAssetIds.length === 0) {
    return [];
  }

  const commitments = await tx.assetAllocation.findMany({
    where: {
      assetId: { in: args.serializedAssetIds },
      active: true,
      startsAt: { gte: args.endsAt },
      booking: {
        status: { in: serializedBlockingStatuses },
      },
      ...(args.excludeBookingId ? { bookingId: { not: args.excludeBookingId } } : {}),
    },
    orderBy: [
      { assetId: "asc" },
      { startsAt: "asc" },
    ],
    select: {
      assetId: true,
      bookingId: true,
      startsAt: true,
      endsAt: true,
      booking: {
        select: {
          title: true,
          status: true,
          location: { select: { id: true, name: true } },
        },
      },
    },
  });

  const nextByAsset = new Map<string, AvailabilityResult["upcomingCommitments"][number]>();
  for (const item of commitments) {
    if (nextByAsset.has(item.assetId)) continue;
    nextByAsset.set(item.assetId, {
      assetId: item.assetId,
      bookingId: item.bookingId,
      bookingTitle: item.booking.title,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      status: item.booking.status,
      nextLocationId: item.booking.location?.id ?? null,
      nextLocationName: item.booking.location?.name ?? null,
    });
  }

  return Array.from(nextByAsset.values());
}

export async function checkSerializedTurnaroundRisks(
  tx: Prisma.TransactionClient | PrismaClient,
  args: {
    serializedAssetIds: string[];
    locationId: string;
    endsAt: Date;
    upcomingCommitments: AvailabilityResult["upcomingCommitments"];
    now?: Date;
  }
): Promise<AvailabilityResult["turnaroundRisks"]> {
  if (args.serializedAssetIds.length === 0) {
    return [];
  }

  const now = args.now ?? new Date();
  const recentReports = await tx.checkinItemReport.findMany({
    where: {
      assetId: { in: args.serializedAssetIds },
      createdAt: { gte: new Date(now.getTime() - recentCheckinReportWindowMs) },
    },
    orderBy: { createdAt: "desc" },
    select: {
      assetId: true,
      type: true,
      createdAt: true,
      booking: { select: { id: true, title: true } },
    },
  });

  const latestReportByAsset = new Map<string, (typeof recentReports)[number]>();
  for (const report of recentReports) {
    if (!latestReportByAsset.has(report.assetId)) {
      latestReportByAsset.set(report.assetId, report);
    }
  }

  const risks: AvailabilityResult["turnaroundRisks"] = [];
  for (const commitment of args.upcomingCommitments) {
    const gapMs = commitment.startsAt.getTime() - args.endsAt.getTime();
    if (gapMs >= 0 && gapMs <= turnaroundWarningWindowMs) {
      const gapMinutes = Math.max(0, Math.round(gapMs / 60_000));
      risks.push({
        assetId: commitment.assetId,
        code: "SHORT_TURNAROUND",
        severity: turnaroundSeverity(gapMinutes),
        message: gapMinutes === 0
          ? "Needed next now"
          : `Needed next in ${formatDuration(gapMinutes)}`,
        bookingId: commitment.bookingId,
        bookingTitle: commitment.bookingTitle,
        startsAt: commitment.startsAt,
        gapMinutes,
      });
    }

    if (
      commitment.nextLocationId
      && commitment.nextLocationId !== args.locationId
      && gapMs >= 0
      && gapMs <= turnaroundWarningWindowMs
    ) {
      risks.push({
        assetId: commitment.assetId,
        code: "LOCATION_TRANSFER",
        severity: "warning",
        message: commitment.nextLocationName
          ? `Needed next at ${commitment.nextLocationName}; confirm transfer time`
          : "Needed next at another location; confirm transfer time",
        bookingId: commitment.bookingId,
        bookingTitle: commitment.bookingTitle,
        startsAt: commitment.startsAt,
        nextLocationName: commitment.nextLocationName,
      });
    }
  }

  for (const [assetId, report] of latestReportByAsset) {
    risks.push({
      assetId,
      code: "RECENT_CHECKIN_REPORT",
      severity: report.type === "LOST" ? "critical" : "warning",
      message: report.type === "LOST"
        ? "Recent lost report on this item"
        : "Recent damage report on this item",
      bookingId: report.booking.id,
      bookingTitle: report.booking.title,
      reportType: report.type,
      reportCreatedAt: report.createdAt,
    });
  }

  return risks.sort((a, b) => {
    const severityRank = (risk: AvailabilityResult["turnaroundRisks"][number]) => risk.severity === "critical" ? 0 : 1;
    return severityRank(a) - severityRank(b) || a.assetId.localeCompare(b.assetId) || a.code.localeCompare(b.code);
  });
}

export async function checkBulkTurnaroundRisks(
  tx: Prisma.TransactionClient | PrismaClient,
  args: {
    locationId: string;
    bulkItems: BulkRequest[];
    endsAt: Date;
    excludeBookingId?: string;
  }
): Promise<AvailabilityResult["bulkTurnaroundRisks"]> {
  if (args.bulkItems.length === 0) {
    return [];
  }

  const futureRows = await tx.bookingBulkItem.findMany({
    where: {
      bulkSkuId: { in: args.bulkItems.map((item) => item.bulkSkuId) },
      booking: {
        status: { in: bulkReservationCommitmentStatuses },
        startsAt: { gte: args.endsAt },
        ...(args.excludeBookingId ? { id: { not: args.excludeBookingId } } : {}),
      },
    },
    orderBy: [
      { bulkSkuId: "asc" },
      { booking: { startsAt: "asc" } },
    ],
    select: {
      bulkSkuId: true,
      plannedQuantity: true,
      checkedOutQuantity: true,
      bookingId: true,
      booking: {
        select: {
          title: true,
          startsAt: true,
          locationId: true,
        },
      },
    },
  });

  // A next booking is only a turnaround risk when this checkout would consume
  // stock that the next booking needs. The old check warned for every future
  // booking in the twelve-hour window, even when the family had plenty of
  // units; that made kiosk scans noisy and trained staff to ignore the notice.
  // Missing balances are already represented by `checkBulkShortages`, so do
  // not manufacture a second advisory for an unknown inventory row.
  const balanceRows = await tx.bulkStockBalance.findMany({
    where: {
      locationId: args.locationId,
      bulkSkuId: { in: args.bulkItems.map((item) => item.bulkSkuId) },
    },
    select: {
      bulkSkuId: true,
      onHandQuantity: true,
    },
  });
  const onHandBySku = new Map((balanceRows ?? []).map((row) => [row.bulkSkuId, row.onHandQuantity]));
  const requestedBySku = new Map(args.bulkItems.map((item) => [item.bulkSkuId, item.quantity]));

  const nextBySku = new Map<string, (typeof futureRows)[number]>();
  for (const row of futureRows) {
    if (row.booking.locationId !== args.locationId) continue;
    if (!nextBySku.has(row.bulkSkuId)) nextBySku.set(row.bulkSkuId, row);
  }

  const risks: AvailabilityResult["bulkTurnaroundRisks"] = [];
  for (const row of nextBySku.values()) {
    const onHand = onHandBySku.get(row.bulkSkuId);
    const requested = requestedBySku.get(row.bulkSkuId) ?? 0;
    const remainingQuantity = remainingReservationQuantity(row);
    if (onHand === undefined || remainingQuantity <= 0 || requested + remainingQuantity <= onHand) continue;
    const gapMs = row.booking.startsAt.getTime() - args.endsAt.getTime();
    if (gapMs < 0 || gapMs > turnaroundWarningWindowMs) continue;
    const gapMinutes = Math.max(0, Math.round(gapMs / 60_000));
    risks.push({
      bulkSkuId: row.bulkSkuId,
      code: "BULK_SHORT_TURNAROUND",
      severity: turnaroundSeverity(gapMinutes),
      message: gapMinutes === 0
        ? `Next bulk booking needs ${remainingQuantity} now`
        : `Next bulk booking needs ${remainingQuantity} in ${formatDuration(gapMinutes)}`,
      bookingId: row.bookingId,
      bookingTitle: row.booking.title,
      startsAt: row.booking.startsAt,
      gapMinutes,
      plannedQuantity: remainingQuantity,
    });
  }

  return risks;
}

export async function checkBulkShortages(
  tx: Prisma.TransactionClient | PrismaClient,
  args: {
    locationId: string;
    bulkItems: BulkRequest[];
    startsAt: Date;
    endsAt: Date;
    excludeBookingId?: string;
  }
): Promise<AvailabilityResult["shortages"]> {
  if (args.bulkItems.length === 0) {
    return [];
  }

  const balanceRows = await tx.bulkStockBalance.findMany({
    where: {
      locationId: args.locationId,
      bulkSkuId: { in: args.bulkItems.map((item) => item.bulkSkuId) }
    },
    select: {
      bulkSkuId: true,
      onHandQuantity: true
    }
  });

  const balanceMap = new Map(balanceRows.map((row) => [row.bulkSkuId, row.onHandQuantity]));
  const committedRows = await tx.bookingBulkItem.findMany({
    where: {
      bulkSkuId: { in: args.bulkItems.map((item) => item.bulkSkuId) },
      booking: {
        status: { in: bulkReservationCommitmentStatuses },
        locationId: args.locationId,
        startsAt: { lt: args.endsAt },
        endsAt: { gt: args.startsAt },
        ...(args.excludeBookingId ? { id: { not: args.excludeBookingId } } : {}),
      },
    },
    select: { bulkSkuId: true, plannedQuantity: true, checkedOutQuantity: true },
  });
  const committedMap = new Map<string, number>();
  for (const row of committedRows) {
    committedMap.set(
      row.bulkSkuId,
      (committedMap.get(row.bulkSkuId) ?? 0) + remainingReservationQuantity(row),
    );
  }

  return args.bulkItems
    .map((item) => {
      const onHand = balanceMap.get(item.bulkSkuId) ?? 0;
      const committed = committedMap.get(item.bulkSkuId) ?? 0;
      const available = Math.max(0, onHand - committed);
      return {
        bulkSkuId: item.bulkSkuId,
        requested: item.quantity,
        available
      };
    })
    .filter((item) => item.available < item.requested);
}

export type BulkAvailabilityEntry = {
  onHand: number;
  committed: number;
  available: number;
};

/**
 * For each bulk SKU at a location, compute how many units are committed
 * to overlapping booked reservations in the given date window. Checkout demand
 * is already represented by on-hand stock movements.
 */
export async function getBulkAvailability(
  tx: Prisma.TransactionClient | PrismaClient,
  args: {
    locationId: string;
    startsAt: Date;
    endsAt: Date;
    excludeBookingId?: string;
  }
): Promise<Record<string, BulkAvailabilityEntry>> {
  // Get on-hand balances for all SKUs at this location
  const balances = await tx.bulkStockBalance.findMany({
    where: { locationId: args.locationId },
    select: { bulkSkuId: true, onHandQuantity: true },
  });

  if (balances.length === 0) return {};

  const skuIds = balances.map((b) => b.bulkSkuId);

  // Sum planned quantities from overlapping active bookings
  const committedRows = await tx.bookingBulkItem.findMany({
    where: {
      bulkSkuId: { in: skuIds },
      booking: {
        status: { in: bulkReservationCommitmentStatuses },
        locationId: args.locationId,
        startsAt: { lt: args.endsAt },
        endsAt: { gt: args.startsAt },
        ...(args.excludeBookingId ? { id: { not: args.excludeBookingId } } : {}),
      },
    },
    select: { bulkSkuId: true, plannedQuantity: true, checkedOutQuantity: true },
  });

  const committedMap = new Map<string, number>();
  for (const row of committedRows) {
    committedMap.set(
      row.bulkSkuId,
      (committedMap.get(row.bulkSkuId) ?? 0) + remainingReservationQuantity(row),
    );
  }

  const result: Record<string, BulkAvailabilityEntry> = {};
  for (const b of balances) {
    const committed = committedMap.get(b.bulkSkuId) ?? 0;
    result[b.bulkSkuId] = {
      onHand: b.onHandQuantity,
      committed,
      available: Math.max(0, b.onHandQuantity - committed),
    };
  }

  return result;
}

export async function checkAvailability(
  tx: Prisma.TransactionClient | PrismaClient,
  args: {
    locationId: string;
    startsAt: Date;
    endsAt: Date;
    serializedAssetIds: string[];
    bulkItems: BulkRequest[];
    excludeBookingId?: string;
    bookingKind?: BookingKind;
    includeBulkTurnaroundRisks?: boolean;
    enforceSerializedTurnaroundBuffer?: boolean;
  }
): Promise<AvailabilityResult> {
  const [conflicts, shortages, unavailableAssets, upcomingCommitments, bulkTurnaroundRisks] = await Promise.all([
    checkSerializedConflicts(tx, {
      serializedAssetIds: args.serializedAssetIds,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      excludeBookingId: args.excludeBookingId,
      enforceTurnaroundBuffer: args.enforceSerializedTurnaroundBuffer,
    }),
    checkBulkShortages(tx, {
      locationId: args.locationId,
      bulkItems: args.bulkItems,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      excludeBookingId: args.excludeBookingId,
    }),
    checkAssetStatuses(tx, {
      serializedAssetIds: args.serializedAssetIds,
      bookingKind: args.bookingKind,
    }),
    checkUpcomingSerializedCommitments(tx, {
      serializedAssetIds: args.serializedAssetIds,
      endsAt: args.endsAt,
      excludeBookingId: args.excludeBookingId,
    }),
    args.includeBulkTurnaroundRisks === false
      ? Promise.resolve([])
      : checkBulkTurnaroundRisks(tx, {
          locationId: args.locationId,
          bulkItems: args.bulkItems,
          endsAt: args.endsAt,
          excludeBookingId: args.excludeBookingId,
        }),
  ]);
  const turnaroundRisks = await checkSerializedTurnaroundRisks(tx, {
    serializedAssetIds: args.serializedAssetIds,
    locationId: args.locationId,
    endsAt: args.endsAt,
    upcomingCommitments,
  });

  return { conflicts, shortages, unavailableAssets, upcomingCommitments, turnaroundRisks, bulkTurnaroundRisks };
}
