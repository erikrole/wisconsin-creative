import { Prisma } from "@prisma/client";
import { appTzDateKey, appTzDayRange, startOfDayInAppTz } from "@/lib/app-time";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { displayBookingTitle } from "@/lib/booking-display-title";
import {
  CHECKOUT_REPORT_EXPORT_LIMIT,
  OVERDUE_REPORT_EXPORT_LIMIT,
  CHECKOUT_CUSTODY_REPORT_STATUSES,
  settledReportValue,
} from "./report-shared";

/** `YYYY-MM-DD`, interpreted as a UTC day to match the daily aggregates. */
export function parseCheckoutFocusDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

function checkoutFocusDateRange(focusDate: string) {
  // The clicked heatmap cell is an app-timezone calendar day, so its row list
  // must span Central midnight to Central midnight. A UTC window instead starts
  // the day at 7pm the evening before.
  return appTzDayRange(focusDate);
}

export async function getCheckoutReport(days: number, focusDate?: string | null) {
  const partialFailures: string[] = [];
  const since = checkoutReportSince(days);
  const now = new Date();
  const heatmapSince = new Date(Date.now() - 365 * 86_400_000);
  const checkoutActivityWhere = buildCheckoutReportWhere(days);
  // A focused day narrows only the row list; metrics and charts stay on the
  // selected period so the day keeps its context.
  const recentWhere = focusDate
    ? {
        kind: "CHECKOUT" as const,
        status: { in: [...CHECKOUT_CUSTODY_REPORT_STATUSES] },
        createdAt: checkoutFocusDateRange(focusDate),
      }
    : checkoutActivityWhere;

  const checkoutResults = await Promise.allSettled([
    db.booking.count({
      where: checkoutActivityWhere
    }),
    db.booking.count({
      where: {
        kind: "CHECKOUT",
        status: "OPEN",
        endsAt: { lt: now }
      }
    }),
    db.booking.findMany({
      where: recentWhere,
      orderBy: { createdAt: "desc" },
      take: focusDate ? 50 : 20,
      include: checkoutReportInclude,
    }),
    db.booking.groupBy({
      by: ["requesterUserId"],
      where: checkoutActivityWhere,
      _count: true,
      orderBy: { _count: { requesterUserId: "desc" } },
      take: 10
    }),
    // Single 365-day daily aggregation (period series is sliced in JS).
    // Using date_trunc keeps the work in Postgres regardless of row count.
    db.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT to_char(date_trunc('day', "created_at" AT TIME ZONE 'UTC' AT TIME ZONE ${env.appTimezone}::text), 'YYYY-MM-DD') AS date,
             COUNT(*)::bigint AS count
      FROM bookings
      WHERE kind = 'CHECKOUT'
        AND "status" IN ('OPEN', 'COMPLETED')
        AND "created_at" >= ${heatmapSince}
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  const totalCheckouts = settledReportValue(checkoutResults[0], 0, "checkout total", partialFailures);
  const overdueCheckouts = settledReportValue(checkoutResults[1], 0, "overdue total", partialFailures);
  const recentCheckouts = settledReportValue(checkoutResults[2], [], "recent checkouts", partialFailures);
  const topRequesters = settledReportValue(checkoutResults[3], [], "top requesters", partialFailures);
  const heatmapRaw = settledReportValue(checkoutResults[4], [], "checkout activity", partialFailures);

  const requesterIds = topRequesters.map((r) => r.requesterUserId);
  const userResults = await Promise.allSettled([
    requesterIds.length > 0
      ? db.user.findMany({
          where: { id: { in: requesterIds } },
          select: { id: true, name: true }
        })
      : Promise.resolve([]),
  ]);
  const users = settledReportValue(userResults[0], [], "requester names", partialFailures);
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

  // Build day → count map from the 365-day aggregate, then derive both series.
  const dayMap = new Map<string, number>();
  for (const row of heatmapRaw) dayMap.set(row.date, Number(row.count));

  // Day keys are app-timezone calendar days on both sides -- the SQL buckets
  // and this cursor must agree, or the trend line reads one day off the cells.
  // Step Chicago midnights. A UTC or local setDate(+1) keeps the clock time of
  // `since`, so spring-forward skips a Madison day and fall-back repeats one.
  const sinceKey = appTzDateKey(since);
  const todayKey = appTzDateKey(now);
  const dailyTrend: { date: string; count: number }[] = [];
  let cursor = startOfDayInAppTz(since);
  while (appTzDateKey(cursor) <= todayKey) {
    const key = appTzDateKey(cursor);
    if (key >= sinceKey) {
      dailyTrend.push({ date: key, count: dayMap.get(key) ?? 0 });
    }
    const next = startOfDayInAppTz(cursor, 1);
    if (next.getTime() <= cursor.getTime()) break;
    cursor = next;
  }

  const heatmap = Array.from(dayMap.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // The 365-day aggregate already covers the window before this one, so the
  // comparison costs no extra query for any supported period.
  const previousSince = checkoutReportSince(days * 2);
  const previousSinceKey = appTzDateKey(previousSince);
  let previousTotalCheckouts = 0;
  for (const [date, count] of dayMap) {
    if (date >= previousSinceKey && date < sinceKey) previousTotalCheckouts += count;
  }

  return {
    days,
    focusDate: focusDate ?? null,
    totalCheckouts,
    previousTotalCheckouts,
    overdueCheckouts,
    partialFailures,
    dailyTrend,
    heatmap,
    recentCheckouts: recentCheckouts.map((checkout) => mapCheckoutReportEntry(checkout, now)),
    topRequesters: topRequesters.map((r) => ({
      name: userMap[r.requesterUserId] || "Unknown",
      count: r._count
    }))
  };
}

function checkoutReportSince(days: number) {
  return new Date(Date.now() - days * 86_400_000);
}

function buildCheckoutReportWhere(days: number): Prisma.BookingWhereInput {
  return {
    kind: "CHECKOUT",
    status: { in: [...CHECKOUT_CUSTODY_REPORT_STATUSES] },
    createdAt: { gte: checkoutReportSince(days) },
  };
}

const checkoutReportInclude = {
  requester: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  _count: { select: { serializedItems: true, bulkItems: true } },
} satisfies Prisma.BookingInclude;

function mapCheckoutReportEntry(checkout: Prisma.BookingGetPayload<{
  include: typeof checkoutReportInclude;
}>, now: Date) {
  return {
    id: checkout.id,
    title: displayBookingTitle(checkout.title),
    status: checkout.status,
    startsAt: checkout.startsAt,
    endsAt: checkout.endsAt,
    createdAt: checkout.createdAt,
    requester: checkout.requester.name,
    location: checkout.location.name,
    itemCount: checkout._count.serializedItems + checkout._count.bulkItems,
    isOverdue: checkout.status === "OPEN" && checkout.endsAt < now,
  };
}

export async function getCheckoutReportExport(days: number) {
  const where = buildCheckoutReportWhere(days);
  const now = new Date();
  const [data, total] = await Promise.all([
    db.booking.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: CHECKOUT_REPORT_EXPORT_LIMIT,
      include: checkoutReportInclude,
    }),
    db.booking.count({ where }),
  ]);

  return {
    data: data.map((checkout) => mapCheckoutReportEntry(checkout, now)),
    total,
    truncated: total > CHECKOUT_REPORT_EXPORT_LIMIT,
    limit: CHECKOUT_REPORT_EXPORT_LIMIT,
  };
}

export async function getOverdueReport(locationId?: string | null) {
  const now = new Date();

  const [overdueBookings, locations] = await Promise.all([
    db.booking.findMany({
      where: buildOverdueReportWhere(now, locationId),
      include: overdueReportInclude,
      orderBy: { endsAt: "asc" },
    }),
    // Options come from bookings that are actually overdue, so the filter
    // never offers a choice that yields an empty report.
    db.booking.findMany({
      where: buildOverdueReportWhere(now),
      distinct: ["locationId"],
      select: { location: { select: { id: true, name: true } } },
      orderBy: { locationId: "asc" },
    }),
  ]);

  const byRequester = new Map<
    string,
    {
      userId: string;
      name: string;
      overdueCount: number;
      totalOverdueHours: number;
      bookings: {
        id: string;
        title: string;
        endsAt: string;
        overdueHours: number;
        location: string;
        itemCount: number;
        items: string[];
      }[];
    }
  >();

  for (const b of overdueBookings) {
    const existing = byRequester.get(b.requester.id);
    const booking = mapOverdueReportBooking(b, now, 5);

    if (existing) {
      existing.overdueCount++;
      existing.totalOverdueHours += booking.overdueHours;
      existing.bookings.push(booking);
    } else {
      byRequester.set(b.requester.id, {
        userId: b.requester.id,
        name: b.requester.name,
        overdueCount: 1,
        totalOverdueHours: booking.overdueHours,
        bookings: [booking],
      });
    }
  }

  const leaderboard = Array.from(byRequester.values()).sort(
    (a, b) => b.totalOverdueHours - a.totalOverdueHours
  );

  return {
    totalOverdueBookings: overdueBookings.length,
    leaderboard,
    locationId: locationId ?? null,
    locationOptions: locations
      .map((row) => ({ id: row.location.id, name: row.location.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function buildOverdueReportWhere(now: Date, locationId?: string | null): Prisma.BookingWhereInput {
  return {
    kind: "CHECKOUT",
    status: "OPEN",
    endsAt: { lt: now },
    ...(locationId ? { locationId } : {}),
  };
}

const overdueReportInclude = {
  requester: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  serializedItems: {
    where: { allocationStatus: "active" },
    include: { asset: { select: { id: true, assetTag: true, name: true } } },
  },
  bulkItems: {
    include: { bulkSku: { select: { id: true, name: true } } },
  },
} satisfies Prisma.BookingInclude;

type OverdueReportBooking = Prisma.BookingGetPayload<{
  include: typeof overdueReportInclude;
}>;

function getOverdueOutstandingItems(booking: OverdueReportBooking) {
  const items: string[] = [];
  for (const si of booking.serializedItems) {
    items.push(si.asset.assetTag || si.asset.name || "Unknown item");
  }

  let itemCount = booking.serializedItems.length;
  for (const bi of booking.bulkItems) {
    const checkedOutQuantity = bi.checkedOutQuantity > 0
      ? bi.checkedOutQuantity
      : bi.plannedQuantity;
    const outstandingQuantity = Math.max(0, checkedOutQuantity - bi.checkedInQuantity);
    if (outstandingQuantity > 0) {
      itemCount += outstandingQuantity;
      items.push(`${bi.bulkSku.name} x${outstandingQuantity}`);
    }
  }

  return { itemCount, items };
}

function mapOverdueReportBooking(
  booking: OverdueReportBooking,
  now: Date,
  itemLimit?: number,
) {
  const hours = Math.round((now.getTime() - booking.endsAt.getTime()) / 3_600_000);
  const outstanding = getOverdueOutstandingItems(booking);

  return {
    id: booking.id,
    title: displayBookingTitle(booking.title),
    endsAt: booking.endsAt.toISOString(),
    overdueHours: hours,
    location: booking.location.name,
    itemCount: outstanding.itemCount,
    items: typeof itemLimit === "number" ? outstanding.items.slice(0, itemLimit) : outstanding.items,
  };
}

export async function getOverdueReportExport(locationId?: string | null) {
  const now = new Date();
  const where = buildOverdueReportWhere(now, locationId);
  const [bookings, total] = await Promise.all([
    db.booking.findMany({
      where,
      include: overdueReportInclude,
      orderBy: { endsAt: "asc" },
      take: OVERDUE_REPORT_EXPORT_LIMIT,
    }),
    db.booking.count({ where }),
  ]);

  return {
    data: bookings.map((booking) => {
      const row = mapOverdueReportBooking(booking, now);
      return {
        bookingId: booking.id,
        requester: booking.requester.name,
        title: row.title,
        endsAt: row.endsAt,
        overdueHours: row.overdueHours,
        location: row.location,
        itemCount: row.itemCount,
        itemSummary: row.items.join("; "),
      };
    }),
    total,
    truncated: total > OVERDUE_REPORT_EXPORT_LIMIT,
    limit: OVERDUE_REPORT_EXPORT_LIMIT,
  };
}
