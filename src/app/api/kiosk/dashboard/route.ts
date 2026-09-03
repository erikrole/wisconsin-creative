import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { ok } from "@/lib/http";
import { getInitials } from "@/lib/avatar";
import { env } from "@/lib/env";
import { normalizeTeamAbbreviations } from "@/lib/title-normalization";
import { BookingKind, BookingStatus, ShiftAssignmentStatus } from "@prisma/client";

function settledValue<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
  label: string,
  partialFailures: string[],
): T {
  if (result.status === "fulfilled") return result.value;
  console.error(`[kiosk/dashboard] ${label} failed`, result.reason);
  partialFailures.push(label);
  return fallback;
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  timeZone: string,
) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return new Date(utcGuess.getTime() - timeZoneOffsetMs(utcGuess, timeZone));
}

function dayWindowInTimeZone(now: Date, days: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const start = zonedDateTimeToUtc(value("year"), value("month"), value("day"), 0, 0, 0, 0, timeZone);
  const endLocal = new Date(Date.UTC(value("year"), value("month") - 1, value("day") + days, 0, 0, 0, 0));
  const end = zonedDateTimeToUtc(
    endLocal.getUTCFullYear(),
    endLocal.getUTCMonth() + 1,
    endLocal.getUTCDate(),
    0,
    0,
    0,
    0,
    timeZone,
  );
  return { start, end };
}

function localDateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function isAllDaySpan(startsAt: Date, endsAt: Date | null, timeZone: string) {
  if (!endsAt || endsAt <= startsAt) return false;
  const start = localDateTimeParts(startsAt, timeZone);
  const end = localDateTimeParts(endsAt, timeZone);
  const startsAtMidnight = start.hour === 0 && start.minute === 0 && start.second === 0;
  const endsAtMidnight = end.hour === 0 && end.minute === 0 && end.second === 0;
  const crossesDay = start.year !== end.year || start.month !== end.month || start.day !== end.day;
  return startsAtMidnight && endsAtMidnight && crossesDay;
}

function activeBulkQuantity(item: { checkedOutQuantity: number; checkedInQuantity: number }) {
  return Math.max(0, item.checkedOutQuantity - item.checkedInQuantity);
}

function missingAllocatedBulkQuantity(item: {
  checkedOutQuantity: number;
  checkedInQuantity: number;
  unitAllocations: unknown[];
}) {
  return Math.max(0, activeBulkQuantity(item) - item.unitAllocations.length);
}

function quantityLabel(name: string, quantity: number) {
  return quantity === 1 ? name : `${name} x${quantity}`;
}

/** Kiosk idle screen data: stats, nearby events, active items, and active checkouts. */
export const GET = withKiosk(async () => {
  const now = new Date();
  const nearPast = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const nearFuture = new Date(now.getTime() + 90 * 60 * 1000);
  const eventsWindow = dayWindowInTimeZone(now, 2, env.appTimezone);
  const localNow = localDateTimeParts(now, env.appTimezone);
  const nightHours = localNow.hour >= 22 || localNow.hour < 6;

  const [
    statsResult,
    eventsResult,
    activeItemsResult,
    activeBulkUnitsResult,
    checkoutsResult,
    operationalWindowsResult,
  ] = await Promise.allSettled([
    // Stats: every active checkout is operationally visible from every kiosk.
    db.$queryRaw<
      Array<{ checkouts: bigint; items_out: bigint; overdue: bigint }>
    >`
      SELECT
        (
          SELECT COUNT(*)
          FROM bookings b
          WHERE b.status = 'OPEN'
            AND b.kind = 'CHECKOUT'
        ) as checkouts,
        (
          SELECT COUNT(*)
          FROM booking_serialized_items bsi
          JOIN bookings b ON b.id = bsi.booking_id
          WHERE b.status = 'OPEN'
            AND b.kind = 'CHECKOUT'
            AND bsi.allocation_status = 'active'
        ) + (
          SELECT COUNT(*)
          FROM booking_bulk_unit_allocations bua
          JOIN booking_bulk_items bbi ON bbi.id = bua.booking_bulk_item_id
          JOIN bookings b ON b.id = bbi.booking_id
          WHERE b.status = 'OPEN'
            AND b.kind = 'CHECKOUT'
            AND bua.checked_out_at IS NOT NULL
            AND bua.checked_in_at IS NULL
        ) as items_out,
        (
          SELECT COUNT(*)
          FROM bookings b
          WHERE b.status = 'OPEN'
            AND b.kind = 'CHECKOUT'
            AND b.ends_at < ${now}
        ) as overdue
    `,

    // Today and tomorrow in the institution timezone for the counter display.
    db.calendarEvent.findMany({
      where: {
        startsAt: { lt: eventsWindow.end },
        endsAt: { gte: eventsWindow.start },
        isHidden: false,
      },
      orderBy: { startsAt: "asc" },
      take: 8,
      select: {
        id: true,
        summary: true,
        sportCode: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        shiftGroup: {
          select: {
            shifts: {
              select: {
                area: true,
                callStartsAt: true,
                callEndsAt: true,
                startsAt: true,
                endsAt: true,
                assignments: {
                  where: {
                    status: {
                      in: [
                        ShiftAssignmentStatus.DIRECT_ASSIGNED,
                        ShiftAssignmentStatus.APPROVED,
                        ShiftAssignmentStatus.REQUESTED,
                      ],
                    },
                  },
                  select: {
                    user: { select: { id: true, name: true, avatarUrl: true } },
                  },
                },
              },
            },
            _count: {
              select: { shifts: true },
            },
          },
        },
      },
    }),

    // Active serialized items for the Items Out card.
    db.bookingSerializedItem.findMany({
      where: {
        allocationStatus: "active",
        booking: {
          kind: BookingKind.CHECKOUT,
          status: BookingStatus.OPEN,
        },
      },
      orderBy: { booking: { endsAt: "asc" } },
      select: {
        asset: {
          select: {
            id: true,
            assetTag: true,
            name: true,
            imageUrl: true,
          },
        },
        booking: {
          select: {
            id: true,
            title: true,
            endsAt: true,
            custodyScope: true,
            requester: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
    }),

    // Active numbered bulk units for the Items Out card.
    db.bookingBulkUnitAllocation.findMany({
      where: {
        checkedOutAt: { not: null },
        checkedInAt: null,
        bookingBulkItem: {
          booking: {
            kind: BookingKind.CHECKOUT,
            status: BookingStatus.OPEN,
          },
        },
      },
      orderBy: { checkedOutAt: "asc" },
      select: {
        bulkSkuUnit: {
          select: {
            id: true,
            unitNumber: true,
            bulkSku: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
              },
            },
          },
        },
        bookingBulkItem: {
          select: {
            booking: {
              select: {
                id: true,
                title: true,
                endsAt: true,
                custodyScope: true,
                requester: { select: { id: true, name: true, avatarUrl: true } },
              },
            },
          },
        },
      },
    }),

    // Active checkouts, most overdue first.
    db.booking.findMany({
      where: {
        kind: "CHECKOUT",
        status: "OPEN",
      },
      orderBy: [{ endsAt: "asc" }],
      select: {
        id: true,
        title: true,
        endsAt: true,
        custodyScope: true,
        requester: {
          select: { id: true, name: true, avatarUrl: true },
        },
        serializedItems: {
          where: { allocationStatus: "active" },
          take: 3,
          select: {
            asset: {
              select: { assetTag: true, name: true },
            },
          },
        },
        bulkItems: {
          select: {
            id: true,
            checkedOutQuantity: true,
            checkedInQuantity: true,
            bulkSku: {
              select: { id: true, name: true, imageUrl: true },
            },
            unitAllocations: {
              where: {
                checkedOutAt: { not: null },
                checkedInAt: null,
              },
              take: 3,
              orderBy: { checkedOutAt: "asc" },
              select: {
                bulkSkuUnit: {
                  select: { unitNumber: true },
                },
              },
            },
          },
        },
        _count: {
          select: { serializedItems: { where: { allocationStatus: "active" } } },
        },
      },
    }),

    Promise.all([
      db.calendarEvent.count({
        where: {
          startsAt: { lte: nearFuture },
          endsAt: { gte: nearPast },
          isHidden: false,
        },
      }),
      db.booking.count({
        where: {
          kind: BookingKind.CHECKOUT,
          status: { in: [BookingStatus.BOOKED, BookingStatus.PENDING_PICKUP] },
          startsAt: { lte: nearFuture },
          endsAt: { gte: nearPast },
        },
      }),
    ]),
  ]);

  const partialFailures: string[] = [];
  const statsRows = settledValue(
    statsResult,
    [] as Array<{ checkouts: bigint; items_out: bigint; overdue: bigint }>,
    "stats",
    partialFailures,
  );
  const events = settledValue(
    eventsResult,
    [] as Array<{
      id: string;
      summary: string;
      sportCode: string | null;
      startsAt: Date;
      endsAt: Date;
      allDay: boolean;
      shiftGroup: {
        shifts: Array<{
          area: string;
          callStartsAt: Date | null;
          callEndsAt: Date | null;
          startsAt: Date;
          endsAt: Date;
          assignments: Array<{
            user: { id: string; name: string; avatarUrl: string | null };
          }>;
        }>;
        _count: { shifts: number };
      } | null;
    }>,
    "events",
    partialFailures,
  );
  const checkouts = settledValue(
    checkoutsResult,
    [] as Array<{
      id: string;
      title: string;
      endsAt: Date;
      custodyScope: "PERSON" | "SHARED";
      requester: { id: string; name: string; avatarUrl: string | null };
      serializedItems: Array<{ asset: { assetTag: string; name: string | null } }>;
      bulkItems: Array<{
        id: string;
        checkedOutQuantity: number;
        checkedInQuantity: number;
        bulkSku: { id: string; name: string; imageUrl: string | null };
        unitAllocations: Array<{ bulkSkuUnit: { unitNumber: number } }>;
      }>;
      _count: { serializedItems: number };
    }>,
    "checkouts",
    partialFailures,
  );
  const activeItems = settledValue(
    activeItemsResult,
    [] as Array<{
      asset: { id: string; assetTag: string; name: string | null; imageUrl: string | null };
      booking: {
        id: string;
        title: string;
        endsAt: Date;
        custodyScope: "PERSON" | "SHARED";
        requester: { id: string; name: string; avatarUrl: string | null };
      };
    }>,
    "active items",
    partialFailures,
  );
  const activeBulkUnits = settledValue(
    activeBulkUnitsResult,
    [] as Array<{
      bulkSkuUnit: {
        id: string;
        unitNumber: number;
        bulkSku: { id: string; name: string; imageUrl: string | null };
      };
      bookingBulkItem: {
        booking: {
          id: string;
          title: string;
          endsAt: Date;
          custodyScope: "PERSON" | "SHARED";
          requester: { id: string; name: string; avatarUrl: string | null };
        };
      };
    }>,
    "active bulk units",
    partialFailures,
  );
  const [nearbyEventCount, nearbyBookingWindowCount] = settledValue(
    operationalWindowsResult,
    [0, 0] as [number, number],
    "operational windows",
    partialFailures,
  );

  const stats = {
    itemsOut: Number(statsRows[0]?.items_out ?? 0),
    checkouts: Number(statsRows[0]?.checkouts ?? 0),
    overdue: Number(statsRows[0]?.overdue ?? 0),
  };
  const noActiveWork =
    stats.checkouts === 0 &&
    stats.itemsOut === 0 &&
    nearbyEventCount === 0 &&
    nearbyBookingWindowCount === 0;
  const sleepMode = nightHours || noActiveWork;

  return ok({
    stats,
    capabilities: {
      eventWorkerDetails: true,
      eventCallTimes: true,
    },
    standby: {
      sleepMode,
      reason: nightHours ? "night_hours" : noActiveWork ? "idle_window" : "active_window",
      nightHours,
      nearbyEventCount,
      nearbyBookingWindowCount,
    },
    events: events.map((e) => {
      const seenUserIds = new Set<string>();
      const shifts = e.shiftGroup?.shifts ?? [];
      const allDay = e.allDay || isAllDaySpan(e.startsAt, e.endsAt, env.appTimezone);
      const callStartsAt = shifts.reduce<Date | null>((earliest, shift) => {
        const value = shift.callStartsAt ?? shift.startsAt;
        if (!earliest || value < earliest) return value;
        return earliest;
      }, null);
      const callEndsAt = shifts.reduce<Date | null>((latest, shift) => {
        const value = shift.callEndsAt ?? shift.endsAt;
        if (!latest || value > latest) return value;
        return latest;
      }, null);
      const assignedUsers: Array<{
        id: string;
        name: string;
        initials: string;
        avatarUrl: string | null;
        area: string | null;
        callStartsAt: Date | null;
        callEndsAt: Date | null;
      }> = [];
      for (const shift of shifts) {
        for (const assignment of shift.assignments) {
          if (seenUserIds.has(assignment.user.id)) continue;
          seenUserIds.add(assignment.user.id);
          assignedUsers.push({
            id: assignment.user.id,
            name: assignment.user.name,
            initials: getInitials(assignment.user.name),
            avatarUrl: assignment.user.avatarUrl,
            area: shift.area,
            callStartsAt: allDay ? null : (shift.callStartsAt ?? shift.startsAt),
            callEndsAt: allDay ? null : (shift.callEndsAt ?? shift.endsAt),
          });
        }
      }
      return {
        id: e.id,
        title: normalizeTeamAbbreviations(e.summary),
        sportCode: e.sportCode,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        allDay,
        callStartsAt: allDay ? null : callStartsAt,
        callEndsAt: allDay ? null : callEndsAt,
        shiftCount: e.shiftGroup?._count.shifts ?? 0,
        assignedUsers,
        assignedUserCount: assignedUsers.length,
      };
    }),
    activeItems: [
      ...activeItems.map((entry) => ({
        id: entry.asset.id,
        name: entry.asset.name || entry.asset.assetTag,
        tagName: entry.asset.assetTag,
        imageUrl: entry.asset.imageUrl,
        bulkSkuId: null,
        unitNumber: null,
        checkoutId: entry.booking.id,
        checkoutTitle: normalizeTeamAbbreviations(entry.booking.title),
        custodyScope: entry.booking.custodyScope,
        requesterId: entry.booking.custodyScope === "SHARED" ? null : entry.booking.requester.id,
        requesterName: entry.booking.custodyScope === "SHARED" ? "Shared checkout" : entry.booking.requester.name,
        requesterAvatarUrl: entry.booking.custodyScope === "SHARED" ? null : entry.booking.requester.avatarUrl,
        requesterInitials: entry.booking.custodyScope === "SHARED" ? "SC" : getInitials(entry.booking.requester.name),
        endsAt: entry.booking.endsAt,
        isOverdue: entry.booking.endsAt < now,
      })),
      ...activeBulkUnits.map((entry) => ({
        id: entry.bulkSkuUnit.id,
        name: `${entry.bulkSkuUnit.bulkSku.name} #${entry.bulkSkuUnit.unitNumber}`,
        tagName: `#${entry.bulkSkuUnit.unitNumber}`,
        imageUrl: entry.bulkSkuUnit.bulkSku.imageUrl,
        bulkSkuId: entry.bulkSkuUnit.bulkSku.id,
        unitNumber: entry.bulkSkuUnit.unitNumber,
        checkoutId: entry.bookingBulkItem.booking.id,
        checkoutTitle: normalizeTeamAbbreviations(entry.bookingBulkItem.booking.title),
        custodyScope: entry.bookingBulkItem.booking.custodyScope,
        requesterId: entry.bookingBulkItem.booking.custodyScope === "SHARED" ? null : entry.bookingBulkItem.booking.requester.id,
        requesterName: entry.bookingBulkItem.booking.custodyScope === "SHARED" ? "Shared checkout" : entry.bookingBulkItem.booking.requester.name,
        requesterAvatarUrl: entry.bookingBulkItem.booking.custodyScope === "SHARED" ? null : entry.bookingBulkItem.booking.requester.avatarUrl,
        requesterInitials: entry.bookingBulkItem.booking.custodyScope === "SHARED" ? "SC" : getInitials(entry.bookingBulkItem.booking.requester.name),
        endsAt: entry.bookingBulkItem.booking.endsAt,
        isOverdue: entry.bookingBulkItem.booking.endsAt < now,
      })),
      ...checkouts.flatMap((checkout) =>
        checkout.bulkItems.flatMap((item) => {
          const missingQuantity = missingAllocatedBulkQuantity(item);
          if (missingQuantity <= 0) return [];
          return [{
            id: `${checkout.id}:${item.id}:bulk-quantity`,
            name: quantityLabel(item.bulkSku.name, missingQuantity),
            tagName: `x${missingQuantity}`,
            imageUrl: item.bulkSku.imageUrl,
            bulkSkuId: item.bulkSku.id,
            unitNumber: null,
            checkoutId: checkout.id,
            checkoutTitle: normalizeTeamAbbreviations(checkout.title),
            custodyScope: checkout.custodyScope,
            requesterId: checkout.custodyScope === "SHARED" ? null : checkout.requester.id,
            requesterName: checkout.custodyScope === "SHARED" ? "Shared checkout" : checkout.requester.name,
            requesterAvatarUrl: checkout.custodyScope === "SHARED" ? null : checkout.requester.avatarUrl,
            requesterInitials: checkout.custodyScope === "SHARED" ? "SC" : getInitials(checkout.requester.name),
            endsAt: checkout.endsAt,
            isOverdue: checkout.endsAt < now,
          }];
        })
      ),
    ],
    checkouts: checkouts.map((c) => {
      const bulkPreviewItems = c.bulkItems.flatMap((bi) => {
        const allocatedItems = bi.unitAllocations.map((allocation) => ({
          name: `${bi.bulkSku.name} #${allocation.bulkSkuUnit.unitNumber}`,
        }));
        const missingQuantity = missingAllocatedBulkQuantity(bi);
        return missingQuantity > 0
          ? allocatedItems.concat({ name: quantityLabel(bi.bulkSku.name, missingQuantity) })
          : allocatedItems;
      });
      const bulkItemCount = c.bulkItems.reduce((sum, bi) => {
        return sum + Math.max(bi.unitAllocations.length, activeBulkQuantity(bi));
      }, 0);

      return {
        id: c.id,
        title: normalizeTeamAbbreviations(c.title),
        custodyScope: c.custodyScope,
        requesterName: c.custodyScope === "SHARED" ? "Shared checkout" : c.requester.name,
        requesterId: c.custodyScope === "SHARED" ? null : c.requester.id,
        requesterAvatarUrl: c.custodyScope === "SHARED" ? null : c.requester.avatarUrl,
        requesterInitials: c.custodyScope === "SHARED" ? "SC" : getInitials(c.requester.name),
        items: c.serializedItems.map((si) => ({
          name: si.asset.name || si.asset.assetTag,
        })).concat(bulkPreviewItems).slice(0, 3),
        itemCount: c._count.serializedItems + bulkItemCount,
        endsAt: c.endsAt,
        isOverdue: c.endsAt < now,
      };
    }),
    partialFailures,
  });
});
