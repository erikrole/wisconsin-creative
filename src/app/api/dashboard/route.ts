import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { readDashboardCounts, zeroDashboardCounts } from "@/lib/services/dashboard-counts";
import { startOfDayInAppTz } from "@/lib/app-time";
import { displayBookingTitle } from "@/lib/booking-display-title";
import { hasCollaboratorCapability } from "@/lib/collaborator-access";
import {
  groupShiftGearByEvent,
  sortOverdueFirst,
  toBookingSummary,
  toDashboardEvent,
  toFlaggedItems,
  toLostBulkUnits,
  toMyEventWork,
  toMyShift,
  toOverdueItem,
  type DashboardBookingRow,
  type DashboardEventRow,
  type DashboardMaintenanceRow,
  type DashboardOverdueRow,
  type DashboardReportRow,
  type DashboardShiftRow,
} from "@/lib/dashboard-payload";
import { unique } from "@/lib/utils";
import { settledReader } from "@/lib/settled";

const DASHBOARD_LIMIT = { max: 30, windowMs: 60_000 };

const settledValue = settledReader("dashboard");

export const GET = withAuth(async (req, { user }) => {
  const { allowed } = await checkRateLimit(`dashboard:full:${user.id}`, DASHBOARD_LIMIT);
  if (!allowed) throw new HttpError(429, "Too many requests. Please wait a moment.");

  const scope = new URL(req.url).searchParams.get("scope");
  const isIosHomeScope = scope === "ios-home";
  const isCollaborator = user.role === "COLLABORATOR";
  // The regular web dashboard is team-visible for internal roles. The
  // explicit iOS Home scope remains personal, and collaborators stay within
  // their capability-driven surface.
  const isPersonalOnly = isIosHomeScope || isCollaborator;
  // A collaborator whose affiliation was never granted MY_GEAR_VIEW (a
  // Schedule-only partner) has no gear surface at all. Home must not hand back
  // booking rows that /api/bookings would deny for the same account.
  const gearHidden = isCollaborator && !hasCollaboratorCapability(user, "MY_GEAR_VIEW");
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Day bounds in the institution timezone, not the server's UTC. Drives the
  // "due today" count and the "today's events" lower bound — events stay listed
  // until local midnight (a 7pm game is still shown at 9pm) and all-day events
  // (which start at midnight) don't vanish the instant the day begins.
  const startOfToday = startOfDayInAppTz(now, 0);
  const startOfTomorrow = startOfDayInAppTz(now, 1);

  const bookingInclude = {
    requester: { select: { id: true, name: true, avatarUrl: true } },
    location: { select: { id: true, name: true } },
    events: { select: { eventId: true } },
    shiftAssignment: {
      select: {
        shift: {
          select: {
            shiftGroup: { select: { eventId: true } },
          },
        },
      },
    },
    _count: { select: { serializedItems: true, bulkItems: true } },
    serializedItems: {
      take: 3,
      include: { asset: { select: { id: true, name: true, imageUrl: true, category: { select: { name: true } } } } },
    },
  } as const;

  // Shared bounded count aggregate — same reader the lightweight stats endpoint
  // uses, so transient-lane totals can never drift between the two routes.
  const countsPromise = readDashboardCounts({
    userId: user.id,
    now,
    sevenDaysFromNow,
    startOfToday,
    startOfTomorrow,
  });

  const [
    countsResult,
    // Team: checkouts excluding current user
    teamCheckoutsRawResult,
    // Team: reservations excluding current user
    teamReservationsRawResult,
    // My checkouts (booking-level)
    myCheckoutsRawResult,
    // Upcoming events (next 7 days)
    upcomingEventsResult,
    // Personal: my reservations
    myReservationsResult,
    // Overdue: top items for banner
    topOverdueResult,
    // Drafts: current user's in-progress work
    myDraftsResult,
    // Pending pickups (due reservations plus legacy staged checkouts)
    pendingPickupsRawResult,
    // My shift assignments
    myShiftsRawResult,
    // Flagged items: recent damage/lost reports + maintenance assets
    recentReportsResult,
    maintenanceAssetsResult,
    // Lost bulk units summary (admin only)
    lostBulkUnitsRawResult,
  ] = await Promise.allSettled([
    countsPromise,
    // Team checkouts (excl. me)
    isPersonalOnly
      ? Promise.resolve([])
      : db.booking.findMany({
          where: {
            kind: "CHECKOUT",
            status: "OPEN",
            OR: [{ custodyScope: "SHARED" }, { requesterUserId: { not: user.id } }],
          },
          orderBy: { endsAt: "asc" },
          take: 5,
          include: bookingInclude,
        }),
    // Team reservations (excl. me) — next 7 days only (AC-4)
    isPersonalOnly
      ? Promise.resolve([])
      : db.booking.findMany({
          where: { kind: "RESERVATION", status: "BOOKED", requesterUserId: { not: user.id }, startsAt: { gte: now, lte: sevenDaysFromNow } },
          orderBy: { startsAt: "asc" },
          take: 5,
          include: bookingInclude,
        }),
    // My checkouts (booking-level summaries)
    gearHidden ? Promise.resolve([]) : db.booking.findMany({
      where: { kind: "CHECKOUT", status: "OPEN", custodyScope: "PERSON", requesterUserId: user.id },
      orderBy: { endsAt: "asc" },
      take: 5,
      include: bookingInclude,
    }),
    // Upcoming events (with shift assignment data). Keep any event that occurs
    // today visible until local midnight (endsAt > start of today), so an
    // all-day event doesn't vanish at 12:00am and a 7pm game isn't hidden the
    // moment it ends. Encoding-independent for all-day events.
    isPersonalOnly
      ? Promise.resolve([])
      : db.calendarEvent.findMany({
          where: {
            startsAt: { lte: sevenDaysFromNow },
            endsAt: { gt: startOfToday },
            status: "CONFIRMED",
            isHidden: false,
            // Match Schedule's canonical event filter — archived events are
            // operationally retired and must not resurface on Home.
            archivedAt: null,
          },
          orderBy: { startsAt: "asc" },
          take: 20,
          include: {
            location: { select: { id: true, name: true } },
            shiftGroup: {
              include: {
                shifts: {
                  include: {
                    assignments: {
                      where: { status: { in: ["DIRECT_ASSIGNED", "APPROVED"] } },
                      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
                    },
                  },
                },
              },
            },
          },
        }),
    // My reservations — next 7 days only (AC-4)
    gearHidden ? Promise.resolve([]) : db.booking.findMany({
      where: {
        kind: "RESERVATION",
        status: "BOOKED",
        requesterUserId: user.id,
        startsAt: { gte: now, lte: sevenDaysFromNow },
      },
      orderBy: { startsAt: "asc" },
      take: 5,
      include: bookingInclude,
    }),
    // Top overdue for banner — all roles see all overdue
    isPersonalOnly
      ? Promise.resolve([])
      : db.booking.findMany({
          where: {
            kind: "CHECKOUT",
            status: "OPEN",
            endsAt: { lt: now },
          },
          orderBy: { endsAt: "asc" },
          take: 5,
          include: {
            requester: { select: { id: true, name: true, avatarUrl: true } },
            serializedItems: {
              take: 3,
              include: {
                asset: { select: { id: true, assetTag: true, name: true, imageUrl: true } },
              },
            },
            _count: { select: { serializedItems: true, bulkItems: true } },
          },
        }),
    // Drafts: current user's in-progress work
    isPersonalOnly && (user.role === "STUDENT" || isCollaborator)
      ? Promise.resolve([])
      : db.booking.findMany({
          where: { status: "DRAFT", createdBy: user.id },
          orderBy: { updatedAt: "desc" },
          take: 5,
          include: {
            _count: { select: { serializedItems: true, bulkItems: true } },
          },
        }),
    // Pending pickups are booked reservations whose scheduled pickup time has
    // passed. Legacy staged checkout rows remain visible during migration.
    gearHidden ? Promise.resolve([]) : db.booking.findMany({
      where: {
        OR: [
          { kind: "RESERVATION", status: "BOOKED", startsAt: { lte: now } },
          { kind: "CHECKOUT", status: "PENDING_PICKUP" },
        ],
        ...(isPersonalOnly
          ? {
              AND: [
                { requesterUserId: user.id },
                { custodyScope: "PERSON" },
              ],
            }
          : {}),
      },
      orderBy: { startsAt: "asc" },
      take: 5,
      include: bookingInclude,
    }),
    // My upcoming shift assignments
    isCollaborator ? Promise.resolve([]) : db.shiftAssignment.findMany({
      where: {
        userId: user.id,
        status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },
        shift: {
          shiftGroup: {
            // Keep a shift on today's events listed until local midnight.
            // Archived events are excluded (operationally retired); hidden
            // events stay — a real assignment beats list hygiene.
            event: { endsAt: { gt: startOfToday }, status: "CONFIRMED", archivedAt: null },
          },
        },
      },
      orderBy: { shift: { startsAt: "asc" } },
      take: 5,
      include: {
        shift: {
          include: {
            shiftGroup: {
              include: {
                event: {
                  select: {
                    id: true,
                    summary: true,
                    startsAt: true,
                    endsAt: true,
                    allDay: true,
                    sportCode: true,
                    opponent: true,
                    isHome: true,
                    site: true,
                    locationId: true,
                    location: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    // Open damage/lost cases (staff/admin only)
    user.role === "ADMIN" || user.role === "STAFF"
      ? db.checkinItemReport.findMany({
          // Serialized reports only; lost batteries surface via lostBulkUnits.
          where: {
            assetId: { not: null },
            // Open cases stay until staff close them on the Damage and loss page.
            resolution: null,
            dismissedAt: null,
          },
          orderBy: { lastReportedAt: "desc" },
          take: 10,
          include: {
            asset: { select: { id: true, assetTag: true, name: true, status: true } },
            booking: { select: { title: true } },
            reportedBy: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    // Assets currently in maintenance
    user.role === "ADMIN" || user.role === "STAFF"
      ? db.asset.findMany({
          where: { status: "MAINTENANCE" },
          orderBy: { updatedAt: "desc" },
          take: 10,
          select: { id: true, assetTag: true, name: true, updatedAt: true },
        })
      : Promise.resolve([]),
    // Lost bulk units — admin only
    user.role === "ADMIN"
      ? db.bulkSkuUnit.groupBy({
          by: ["bulkSkuId"],
          where: { status: "LOST" },
          _count: { id: true },
        })
      : Promise.resolve([]),
  ]);
  const partialFailures: string[] = [];
  const bookingRowsFallback: DashboardBookingRow[] = [];
  const counts = settledValue(countsResult, zeroDashboardCounts, "counts", partialFailures);
  const teamCheckoutsRaw = settledValue(teamCheckoutsRawResult, bookingRowsFallback, "teamCheckouts", partialFailures);
  const teamReservationsRaw = settledValue(teamReservationsRawResult, bookingRowsFallback, "teamReservations", partialFailures);
  const myCheckoutsRaw = settledValue(myCheckoutsRawResult, bookingRowsFallback, "myCheckouts", partialFailures);
  const upcomingEvents = settledValue(upcomingEventsResult, [] as DashboardEventRow[], "upcomingEvents", partialFailures);
  const myReservations = settledValue(myReservationsResult, bookingRowsFallback, "myReservations", partialFailures);
  const topOverdue = settledValue(topOverdueResult, [] as DashboardOverdueRow[], "topOverdue", partialFailures);
  const myDrafts = settledValue(myDraftsResult, [] as Array<{
    id: string;
    kind: string;
    title: string;
    updatedAt: Date;
    _count: { serializedItems: number; bulkItems: number };
  }>, "myDrafts", partialFailures);
  const pendingPickupsRaw = settledValue(pendingPickupsRawResult, bookingRowsFallback, "pendingPickups", partialFailures);
  const myShiftsRaw = settledValue(myShiftsRawResult, [] as DashboardShiftRow[], "myShifts", partialFailures);
  const recentReports = settledValue(recentReportsResult, [] as DashboardReportRow[], "recentReports", partialFailures);
  const maintenanceAssets = settledValue(maintenanceAssetsResult, [] as DashboardMaintenanceRow[], "maintenanceAssets", partialFailures);
  const lostBulkUnitsRaw = settledValue(lostBulkUnitsRawResult, [] as Array<{
    bulkSkuId: string;
    _count: { id: number };
  }>, "lostBulkUnits", partialFailures);

  const shiftEventIds = unique(myShiftsRaw.map((a) => a.shift.shiftGroup.event.id));
  const lostSkuIds = lostBulkUnitsRaw.map((r) => r.bulkSkuId);

  // Run the two post-parallel dependent queries concurrently
  const [shiftGearBookingsResult, lostBulkSkuNamesResult, lostBulkUnitNumbersResult] = await Promise.allSettled([
    shiftEventIds.length > 0
      ? db.booking.findMany({
          where: {
            requesterUserId: user.id,
            custodyScope: "PERSON",
            status: { in: ["DRAFT", "BOOKED", "PENDING_PICKUP", "OPEN"] },
            OR: [
              { eventId: { in: shiftEventIds } },
              { events: { some: { eventId: { in: shiftEventIds } } } },
              { shiftAssignmentId: { in: myShiftsRaw.map((a) => a.id) } },
              { shiftAssignment: { shift: { shiftGroup: { eventId: { in: shiftEventIds } } } } },
            ],
          },
          orderBy: [{ startsAt: "asc" }],
          include: bookingInclude,
        })
      : Promise.resolve([]),
    lostSkuIds.length > 0
      ? db.bulkSku.findMany({
          where: { id: { in: lostSkuIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    // Which units, so a lost row can be settled right from the dashboard.
    lostSkuIds.length > 0
      ? db.bulkSkuUnit.findMany({
          where: { bulkSkuId: { in: lostSkuIds }, status: "LOST" },
          select: { bulkSkuId: true, unitNumber: true },
          orderBy: [{ bulkSkuId: "asc" }, { unitNumber: "asc" }],
        })
      : Promise.resolve([]),
  ]);
  const shiftGearBookings = settledValue(shiftGearBookingsResult, bookingRowsFallback, "shiftGearBookings", partialFailures);
  const lostBulkSkuNames = settledValue(lostBulkSkuNamesResult, [] as Array<{
    id: string;
    name: string;
  }>, "lostBulkSkuNames", partialFailures);
  const lostBulkUnitNumbers = settledValue(lostBulkUnitNumbersResult, [] as Array<{
    bulkSkuId: string;
    unitNumber: number;
  }>, "lostBulkUnitNumbers", partialFailures);

  // A personal-scope dashboard reports only the caller's own work. Team totals
  // would otherwise contradict the rows beside them: the row queries above are
  // already filtered to this user, so an org-wide "12 overdue" over an empty
  // list reads as missing data rather than as somebody else's problem.
  const teamCheckoutsTotalCount = isPersonalOnly ? 0 : counts.teamCheckoutsTotal;
  const teamCheckoutsOverdueCount = isPersonalOnly ? 0 : counts.teamCheckoutsOverdue;
  const teamReservationsTotalCount = isPersonalOnly ? 0 : counts.teamReservationsTotal;
  // Without MY_GEAR_VIEW the gear lanes are empty by construction, so their
  // totals report zero rather than describing rows this caller cannot read.
  const myCheckoutsTotalCount = gearHidden ? 0 : counts.myCheckoutsTotal;
  const myOverdueCount = gearHidden ? 0 : counts.myOverdue;
  const totalCheckedOut = gearHidden ? 0 : isPersonalOnly ? counts.myCheckoutsTotal : counts.totalCheckedOut;
  const totalOverdue = gearHidden ? 0 : isPersonalOnly ? counts.myOverdue : counts.totalOverdue;
  const totalReserved = isPersonalOnly ? myReservations.length : counts.totalReserved;
  const dueTodayCount = gearHidden ? 0 : isPersonalOnly ? counts.myDueToday : counts.dueToday;
  const pendingPickupTotalCount = isPersonalOnly ? pendingPickupsRaw.length : counts.pendingPickupTotal;

  const teamCheckouts = teamCheckoutsRaw.map((c) => toBookingSummary(c, now, true));
  teamCheckouts.sort(sortOverdueFirst);

  const teamReservations = teamReservationsRaw.map((r) => toBookingSummary(r, now, false));

  const myCheckouts = myCheckoutsRaw.map((c) => toBookingSummary(c, now, true));
  myCheckouts.sort(sortOverdueFirst);

  const pendingPickups = pendingPickupsRaw.map((p) => ({
    ...toBookingSummary(p, now, false),
    status: "PENDING_PICKUP",
  }));

  const gearByEvent = groupShiftGearByEvent(shiftGearBookings, now);

  return ok({
    data: {
      role: user.role,
      stats: {
        checkedOut: totalCheckedOut,
        overdue: totalOverdue,
        reserved: totalReserved,
        dueToday: dueTodayCount,
      },
      myCheckouts: {
        total: myCheckoutsTotalCount,
        overdue: myOverdueCount,
        items: myCheckouts,
      },
      teamCheckouts: {
        total: teamCheckoutsTotalCount,
        overdue: teamCheckoutsOverdueCount,
        items: teamCheckouts,
      },
      teamReservations: {
        total: teamReservationsTotalCount,
        items: teamReservations,
      },
      pendingPickups: {
        total: pendingPickupTotalCount,
        items: pendingPickups,
      },
      // Retained for older clients; stale reservations now show as Pending Pickup.
      staleReservations: { total: 0, items: [] },
      upcomingEvents: upcomingEvents.map(toDashboardEvent),
      myReservations: myReservations.map((r) => toBookingSummary(r, now, false)),
      overdueCount: totalOverdue,
      overdueItems: topOverdue.map(toOverdueItem),
      drafts: myDrafts.map((d) => ({
        id: d.id,
        kind: d.kind,
        title: displayBookingTitle(d.title),
        itemCount: d._count.serializedItems + d._count.bulkItems,
        updatedAt: d.updatedAt.toISOString(),
      })),
      myShifts: myShiftsRaw.map((a) => toMyShift(a, gearByEvent)),
      myEventWork: toMyEventWork(myShiftsRaw, gearByEvent),
      lostBulkUnits: toLostBulkUnits(lostBulkUnitsRaw, lostBulkSkuNames, lostBulkUnitNumbers),
      flaggedItems: toFlaggedItems(recentReports, maintenanceAssets),
      partialFailures,
    },
  });
});
