import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { NextResponse } from "next/server";
import type { WindowStats } from "@/app/(app)/items/[id]/types";
import { unique } from "@/lib/utils";

/* ── Helpers ─────────────────────────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: Date, b: Date) {
  return Math.max(0, Math.ceil((b.getTime() - a.getTime()) / DAY_MS));
}

/** Count unique days covered by a set of [start, end] intervals */
function countBookedDays(
  intervals: Array<{ start: Date; end: Date }>,
  windowStart: Date,
  windowEnd: Date
): number {
  const days = new Set<number>();
  for (const { start, end } of intervals) {
    const s = Math.max(start.getTime(), windowStart.getTime());
    const e = Math.min(end.getTime(), windowEnd.getTime());
    if (s >= e) continue;
    // Walk day-by-day (max ~365 iterations for 1yr window)
    let cursor = s;
    while (cursor < e) {
      days.add(Math.floor(cursor / DAY_MS));
      cursor += DAY_MS;
    }
  }
  return days.size;
}

function computeWindow(
  bookings: Array<{
    id: string;
    kind: string;
    status: string;
    startsAt: Date;
    endsAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
    sportCode: string | null;
    requesterName: string;
  }>,
  windowStart: Date,
  windowEnd: Date,
  purchasePrice: number | null,
  purchaseDate: Date | null,
  allBookingsCount: number,
): WindowStats {
  const now = windowEnd;
  const filtered = bookings.filter(
    (b) => b.startsAt < windowEnd && b.endsAt > windowStart
  );

  // --- Utilization rate ---
  const totalDays = daysBetween(windowStart, windowEnd) || 1;
  const intervals = filtered.map((b) => ({ start: b.startsAt, end: b.endsAt }));
  const bookedDays = countBookedDays(intervals, windowStart, windowEnd);
  const utilizationPct = Math.round((bookedDays / totalDays) * 1000) / 10;

  // --- Monthly trend ---
  const monthMap = new Map<string, { checkouts: number; reservations: number }>();
  for (const b of filtered) {
    const key = `${b.startsAt.getFullYear()}-${String(b.startsAt.getMonth() + 1).padStart(2, "0")}`;
    const entry = monthMap.get(key) || { checkouts: 0, reservations: 0 };
    if (b.kind === "CHECKOUT") entry.checkouts++;
    else entry.reservations++;
    monthMap.set(key, entry);
  }
  const monthly = Array.from(monthMap.entries())
    .map(([month, counts]) => ({ month, ...counts }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // --- By sport ---
  const sportMap = new Map<string, number>();
  for (const b of filtered) {
    const sport = b.sportCode || "Untagged";
    const dur = daysBetween(
      new Date(Math.max(b.startsAt.getTime(), windowStart.getTime())),
      new Date(Math.min(b.endsAt.getTime(), windowEnd.getTime()))
    );
    sportMap.set(sport, (sportMap.get(sport) || 0) + dur);
  }
  const bySportAll = Array.from(sportMap.entries())
    .map(([sport, days]) => ({ sport, days }))
    .sort((a, b) => b.days - a.days);
  // Top 6 + "Other"
  const bySport = bySportAll.length <= 7
    ? bySportAll
    : [
        ...bySportAll.slice(0, 6),
        { sport: "Other", days: bySportAll.slice(6).reduce((s, x) => s + x.days, 0) },
      ];

  // --- Top borrowers ---
  const borrowerMap = new Map<string, number>();
  for (const b of filtered) {
    borrowerMap.set(b.requesterName, (borrowerMap.get(b.requesterName) || 0) + 1);
  }
  const topBorrowers = Array.from(borrowerMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // --- By kind ---
  const byKind = { CHECKOUT: 0, RESERVATION: 0 };
  for (const b of filtered) {
    if (b.kind === "CHECKOUT") byKind.CHECKOUT++;
    else byKind.RESERVATION++;
  }

  // --- Day of week ---
  const byDayOfWeek = [0, 0, 0, 0, 0, 0, 0]; // Mon=0..Sun=6
  for (const b of filtered) {
    const jsDay = b.startsAt.getDay(); // 0=Sun
    const idx = jsDay === 0 ? 6 : jsDay - 1; // shift to Mon=0
    byDayOfWeek[idx] = (byDayOfWeek[idx] ?? 0) + 1; // idx is always 0-6, byDayOfWeek has exactly 7 elements
  }

  // --- Punctuality ---
  const checkouts = filtered.filter((b) => b.kind === "CHECKOUT");
  let onTime = 0;
  let late = 0;
  for (const b of checkouts) {
    if (b.status === "COMPLETED") {
      const completionTime = b.completedAt ?? b.updatedAt;
      if (completionTime > b.endsAt) {
        late++;
      } else {
        onTime++;
      }
    } else if (b.status === "OPEN" && b.endsAt < now) {
      late++;
    }
    // OPEN bookings not yet past endsAt are still active — don't count either way
  }

  // --- Duration ---
  const durations = checkouts
    .filter((b) => b.status === "COMPLETED" || b.status === "OPEN")
    .map((b) => (b.endsAt.getTime() - b.startsAt.getTime()) / DAY_MS);
  const avgDurationDays = durations.length
    ? Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10
    : 0;
  const longestDurationDays = durations.length
    ? Math.round(Math.max(...durations) * 10) / 10
    : 0;

  // --- Cost per use ---
  const costPerUse =
    purchasePrice && allBookingsCount > 0
      ? Math.round((purchasePrice / allBookingsCount) * 100) / 100
      : null;

  // --- Idle streak ---
  const sortedByEnd = [...bookings]
    .filter((b) => b.endsAt <= now)
    .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());
  const lastEnd = sortedByEnd[0]?.endsAt;
  const idleStreakDays = lastEnd ? daysBetween(lastEnd, now) : null;

  // --- Age ---
  const ageDays = purchaseDate ? daysBetween(purchaseDate, now) : null;

  return {
    totalBookings: filtered.length,
    utilizationPct,
    monthly,
    bySport,
    topBorrowers,
    byKind,
    byDayOfWeek,
    punctuality: { onTime, late },
    avgDurationDays,
    longestDurationDays,
    costPerUse,
    idleStreakDays,
    ageDays,
  };
}

/* ── Route Handler ───────────────────────────────────────── */

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  // Utilization insights name the people who booked the asset (including a top
  // borrowers list), so this is an internal read even though the asset itself is
  // visible to collaborators holding GEAR_CATALOG_VIEW.
  requirePermission(user.role, "asset", "view");

  const now = new Date();

  // Single lean query: only the fields we need for aggregation
  const [asset, rawBookings] = await Promise.all([
    db.asset.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        purchasePrice: true,
        purchaseDate: true,
      },
    }),
    db.bookingSerializedItem.findMany({
      where: { assetId: params.id },
      select: {
        booking: {
          select: {
            kind: true,
            id: true,
            status: true,
            startsAt: true,
            endsAt: true,
            updatedAt: true,
            sportCode: true,
            requester: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const bookingIds = unique(rawBookings.map((r) => r.booking.id));
  const completionLogs = bookingIds.length > 0
    ? await db.auditLog.findMany({
        where: {
          entityType: "booking",
          entityId: { in: bookingIds },
          action: {
            in: [
              "checkin_completed",
              "auto_completed_by_partial_checkin",
              "auto_completed_by_kiosk_checkin",
              "auto_completed_by_bulk_checkin",
            ],
          },
        },
        select: { entityId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const completedAtByBooking = new Map<string, Date>();
  for (const log of completionLogs) {
    if (!completedAtByBooking.has(log.entityId)) {
      completedAtByBooking.set(log.entityId, log.createdAt);
    }
  }

  // Flatten and exclude DRAFT/CANCELLED
  const bookings = rawBookings
    .map((r) => ({
      id: r.booking.id,
      kind: r.booking.kind,
      status: r.booking.status,
      startsAt: r.booking.startsAt,
      endsAt: r.booking.endsAt,
      updatedAt: r.booking.updatedAt,
      completedAt: completedAtByBooking.get(r.booking.id) ?? null,
      sportCode: r.booking.sportCode,
      requesterName: r.booking.requester.name,
    }))
    .filter((b) => b.status !== "DRAFT" && b.status !== "CANCELLED");

  const purchasePrice = asset.purchasePrice ? Number(asset.purchasePrice) : null;
  const purchaseDate = asset.purchaseDate;

  // Compute all 4 windows in one pass structure
  const windows = {
    "30d": computeWindow(bookings, new Date(now.getTime() - 30 * DAY_MS), now, purchasePrice, purchaseDate, bookings.length),
    "90d": computeWindow(bookings, new Date(now.getTime() - 90 * DAY_MS), now, purchasePrice, purchaseDate, bookings.length),
    "1yr": computeWindow(bookings, new Date(now.getTime() - 365 * DAY_MS), now, purchasePrice, purchaseDate, bookings.length),
    all: computeWindow(
      bookings,
      bookings.length ? new Date(Math.min(...bookings.map((b) => b.startsAt.getTime()))) : now,
      now,
      purchasePrice,
      purchaseDate,
      bookings.length,
    ),
  };

  const response = ok({ data: windows });
  response.headers.set("Cache-Control", "private, max-age=60");
  return response;
});
