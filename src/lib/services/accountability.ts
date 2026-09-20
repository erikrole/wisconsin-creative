import {
  AccountabilityExclusionReason,
  BookingCustodyScope,
  BookingStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { revalidateTag, unstable_cache } from "next/cache";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { loadCheckoutPolicies } from "@/lib/services/checkout-policies";
import { unique } from "@/lib/utils";

const MIN_CHECKOUTS_FOR_RATE = 3;
const HOUR_MS = 3_600_000;

/** Cache tag for every filter variant of the accountability report. */
export const ACCOUNTABILITY_REPORT_TAG = "accountability-report";
/** Short enough that a checkout or return shows up on the next look. */
const ACCOUNTABILITY_REPORT_TTL_SECONDS = 60;

/**
 * Hard ceiling on booking rows pulled into memory for one report.
 *
 * A full academic year at current volume is a few thousand person checkouts, so
 * this only bites on the unbounded "all time" scope. Per-person checkout and
 * completed totals come from Postgres aggregates rather than these rows, so a
 * truncated read shortens incident history without skewing the return record.
 */
const BOOKING_SCAN_LIMIT = 5000;

export type AccountabilityIncidentState = "all" | "active" | "resolved" | "extended";
export type AccountabilityUserState = "all" | "active" | "inactive";
export type AccountabilitySort = "events" | "time" | "recent";

export type AccountabilityFilters = {
  startYear: number | null;
  locationId?: string;
  incidentState?: AccountabilityIncidentState;
  userState?: AccountabilityUserState;
  sort?: AccountabilitySort;
};

export const ACCOUNTABILITY_RANKING_DESCRIPTIONS: Record<AccountabilitySort, string> = {
  events: "Late events, then total late time, then most recent incident",
  time: "Total late time, then late events, then most recent incident",
  recent: "Most recent incident, then late events, then total late time",
};

function localYearMonth(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: env.appTimezone,
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month") };
}

function localMidnightUtc(year: number, month: number, day: number) {
  const guess = new Date(Date.UTC(year, month - 1, day));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: env.appTimezone,
    timeZoneName: "longOffset",
  }).formatToParts(guess);
  const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = offset.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetMinutes = match
    ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : 0;
  return new Date(guess.getTime() - offsetMinutes * 60_000);
}

export function getCurrentAcademicYearStart(now: Date = new Date()) {
  const { year, month } = localYearMonth(now);
  return month >= 7 ? year : year - 1;
}

function getAcademicYearWindow(startYear: number | null) {
  if (startYear === null) return null;
  return {
    start: localMidnightUtc(startYear, 7, 1),
    end: localMidnightUtc(startYear + 1, 7, 1),
  };
}

type RankedPerson = {
  userId: string;
  name: string;
  lateEventCount: number;
  totalLateHours: number;
  lastIncidentAt: string;
};

/**
 * Ranking is intentionally selectable: volume (late events) and duration (total
 * late time) tell different stories, and one person can lead on either.
 */
function rankComparator(sort: AccountabilitySort) {
  return (a: RankedPerson, b: RankedPerson) => {
    const tied =
      sort === "time"
        ? b.totalLateHours - a.totalLateHours ||
          b.lateEventCount - a.lateEventCount ||
          b.lastIncidentAt.localeCompare(a.lastIncidentAt)
        : sort === "recent"
          ? b.lastIncidentAt.localeCompare(a.lastIncidentAt) ||
            b.lateEventCount - a.lateEventCount ||
            b.totalLateHours - a.totalLateHours
          : b.lateEventCount - a.lateEventCount ||
            b.totalLateHours - a.totalLateHours ||
            b.lastIncidentAt.localeCompare(a.lastIncidentAt);
    return tied || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId);
  };
}

const INCIDENT_STATE_RANK = {
  active: 0,
  extended: 1,
  resolved: 2,
} as const;

function incidentOccurredAt(incident: {
  returnedAt: string | null;
  extendedAt: string | null;
  dueAt: string;
}) {
  return incident.returnedAt ?? incident.extendedAt ?? incident.dueAt;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;
}

/**
 * Exactly the columns the leaderboard/spotlight math reads. Item names are not
 * here on purpose: they are only needed for incidents that survive ranking, and
 * `loadIncidentItemSummaries` fetches those in one narrow second pass.
 */
const accountabilityBookingSelect = {
  id: true,
  title: true,
  status: true,
  custodyScope: true,
  endsAt: true,
  completedAt: true,
  requester: {
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      active: true,
      primaryArea: true,
    },
  },
  location: { select: { id: true, name: true } },
  accountabilityExclusion: {
    select: {
      reason: true,
      note: true,
      excludedAt: true,
      restoredAt: true,
      excludedBy: { select: { name: true } },
    },
  },
  dueDateChanges: {
    select: { id: true, changedAt: true, previousEndsAt: true, nextEndsAt: true },
    orderBy: { changedAt: "asc" as const },
  },
} satisfies Prisma.BookingSelect;

const incidentItemSelect = {
  id: true,
  serializedItems: {
    select: { asset: { select: { assetTag: true, name: true } } },
  },
  bulkItems: {
    select: {
      plannedQuantity: true,
      checkedOutQuantity: true,
      bulkSku: { select: { name: true } },
    },
  },
} satisfies Prisma.BookingSelect;

type IncidentItemBooking = Prisma.BookingGetPayload<{
  select: typeof incidentItemSelect;
}>;

function itemSummary(booking: {
  serializedItems?: IncidentItemBooking["serializedItems"] | null;
  bulkItems?: IncidentItemBooking["bulkItems"] | null;
}) {
  const serialized = (booking.serializedItems ?? []).map(
    (item) => item.asset.assetTag || item.asset.name || "Unknown item",
  );
  const bulk = (booking.bulkItems ?? [])
    .filter((item) => Math.max(item.checkedOutQuantity, item.plannedQuantity) > 0)
    .map(
      (item) =>
        `${item.bulkSku.name} x${Math.max(item.checkedOutQuantity, item.plannedQuantity)}`,
    );
  return [...serialized, ...bulk].join(", ");
}

async function loadIncidentItemSummaries(bookingIds: string[]) {
  const uniqueIds = unique(bookingIds);
  if (uniqueIds.length === 0) return new Map<string, string>();

  const rows = await db.booking.findMany({
    where: { id: { in: uniqueIds } },
    select: incidentItemSelect,
  });
  return new Map(rows.map((row) => [row.id, itemSummary(row)]));
}

export async function getAccountabilityReport(
  filters: AccountabilityFilters,
  now: Date = new Date(),
) {
  const window = getAcademicYearWindow(filters.startYear);
  const where: Prisma.BookingWhereInput = {
    kind: "CHECKOUT",
    custodyScope: BookingCustodyScope.PERSON,
    status: { in: [BookingStatus.OPEN, BookingStatus.COMPLETED] },
    ...(window
      ? {
          OR: [
            { endsAt: { gte: window.start, lt: window.end } },
            { dueDateChanges: { some: { changedAt: { gte: window.start, lt: window.end } } } },
          ],
        }
      : {}),
    ...(filters.locationId ? { locationId: filters.locationId } : {}),
    ...(filters.userState === "active"
      ? { requester: { active: true } }
      : filters.userState === "inactive"
        ? { requester: { active: false } }
        : {}),
  };

  // Active exclusions never count toward a person's totals, so the Postgres
  // aggregates below share this narrowing with the in-memory pass.
  const includedWhere: Prisma.BookingWhereInput = {
    AND: [
      where,
      {
        OR: [
          { accountabilityExclusion: { is: null } },
          { accountabilityExclusion: { restoredAt: { not: null } } },
        ],
      },
    ],
  };
  const completedInWindowWhere: Prisma.BookingWhereInput = {
    AND: [
      includedWhere,
      {
        status: BookingStatus.COMPLETED,
        completedAt: { not: null },
        ...(window ? { endsAt: { gte: window.start, lt: window.end } } : {}),
      },
    ],
  };

  const [policies, locationRows, scanned, checkoutCounts, completedCounts] = await Promise.all([
    loadCheckoutPolicies(),
    // DISTINCT ON (location_id) in Postgres -- `distinct` matching the orderBy
    // prefix is pushed down, unlike the old `location.bookings.some` subquery.
    db.booking.findMany({
      where: { kind: "CHECKOUT" },
      distinct: ["locationId"],
      orderBy: { locationId: "asc" },
      select: { location: { select: { id: true, name: true } } },
    }),
    db.booking.findMany({
      where,
      select: accountabilityBookingSelect,
      orderBy: [{ endsAt: "desc" }, { id: "desc" }],
      // One over the ceiling so truncation is detectable without a count query.
      take: BOOKING_SCAN_LIMIT + 1,
    }),
    db.booking.groupBy({
      by: ["requesterUserId"],
      where: includedWhere,
      _count: { _all: true },
    }),
    db.booking.groupBy({
      by: ["requesterUserId"],
      where: completedInWindowWhere,
      _count: { _all: true },
    }),
  ]);

  const truncated = scanned.length > BOOKING_SCAN_LIMIT;
  const bookings = truncated ? scanned.slice(0, BOOKING_SCAN_LIMIT) : scanned;
  const locations = Array.from(
    new Map(locationRows.map((row) => [row.location.id, row.location])).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const checkoutCountByUser = new Map(
    checkoutCounts.map((row) => [row.requesterUserId, row._count._all]),
  );
  const completedCountByUser = new Map(
    completedCounts.map((row) => [row.requesterUserId, row._count._all]),
  );
  const graceMs = policies.gracePeriodHours * HOUR_MS;

  const excluded = bookings
    .filter((booking) => booking.accountabilityExclusion?.restoredAt === null)
    .map((booking) => ({
      bookingId: booking.id,
      bookingTitle: booking.title.trim() || "Untitled checkout",
      requester: booking.requester.name,
      dueAt: booking.endsAt.toISOString(),
      reason: booking.accountabilityExclusion!.reason,
      note: booking.accountabilityExclusion!.note,
      excludedAt: booking.accountabilityExclusion!.excludedAt.toISOString(),
      excludedBy: booking.accountabilityExclusion!.excludedBy.name,
    }));

  const included = bookings.filter(
    (booking) =>
      booking.custodyScope !== BookingCustodyScope.SHARED &&
      (booking.accountabilityExclusion?.restoredAt !== null || !booking.accountabilityExclusion),
  );

  type PersonAccumulator = {
    userId: string;
    name: string;
    avatarUrl: string | null;
    active: boolean;
    primaryArea: string | null;
    /** Completed-but-late checkouts, counted regardless of the incident filter. */
    lateCompletedCount: number;
    activeLateCheckoutCount: number;
    incidents: Array<{
      incidentId: string;
      bookingId: string;
      title: string;
      dueAt: string;
      returnedAt: string | null;
      extendedAt: string | null;
      extendedTo: string | null;
      lateHours: number;
      state: "active" | "resolved" | "extended";
      location: { id: string; name: string };
      itemSummary: string;
    }>;
  };

  const byPerson = new Map<string, PersonAccumulator>();

  for (const booking of included) {
    const finalDueInWindow =
      !window || (booking.endsAt >= window.start && booking.endsAt < window.end);
    const dueDateChanges = booking.dueDateChanges.filter(
      (change) =>
        !window || (change.changedAt >= window.start && change.changedAt < window.end),
    );
    const person = byPerson.get(booking.requester.id) ?? {
      userId: booking.requester.id,
      name: booking.requester.name,
      avatarUrl: booking.requester.avatarUrl,
      active: booking.requester.active,
      primaryArea: booking.requester.primaryArea,
      lateCompletedCount: 0,
      activeLateCheckoutCount: 0,
      incidents: [],
    };

    if (finalDueInWindow) {
      const effectiveDue = booking.endsAt.getTime() + graceMs;
      const comparisonTime =
        booking.status === BookingStatus.COMPLETED
          ? booking.completedAt?.getTime()
          : now.getTime();

      if (comparisonTime !== undefined && comparisonTime > effectiveDue) {
        const state = booking.status === BookingStatus.OPEN ? "active" : "resolved";
        if (state === "active") person.activeLateCheckoutCount += 1;
        else person.lateCompletedCount += 1;
        if (!filters.incidentState || filters.incidentState === "all" || filters.incidentState === state) {
          person.incidents.push({
            incidentId: `${booking.id}:${state}`,
            bookingId: booking.id,
            title: booking.title.trim() || "Untitled checkout",
            dueAt: booking.endsAt.toISOString(),
            returnedAt: booking.completedAt?.toISOString() ?? null,
            extendedAt: null,
            extendedTo: null,
            lateHours: Math.max(1, Math.ceil((comparisonTime - effectiveDue) / HOUR_MS)),
            state,
            location: booking.location,
            itemSummary: "",
          });
        }
      }
    }

    if (!filters.incidentState || filters.incidentState === "all" || filters.incidentState === "extended") {
      for (const change of dueDateChanges) {
        const effectivePreviousDue = change.previousEndsAt.getTime() + graceMs;
        if (change.changedAt.getTime() <= effectivePreviousDue) continue;
        person.incidents.push({
          incidentId: change.id,
          bookingId: booking.id,
          title: booking.title.trim() || "Untitled checkout",
          dueAt: change.previousEndsAt.toISOString(),
          returnedAt: null,
          extendedAt: change.changedAt.toISOString(),
          extendedTo: change.nextEndsAt.toISOString(),
          lateHours: Math.max(
            1,
            Math.ceil((change.changedAt.getTime() - effectivePreviousDue) / HOUR_MS),
          ),
          state: "extended",
          location: booking.location,
          itemSummary: "",
        });
      }
    }

    byPerson.set(person.userId, person);
  }

  const ranked = Array.from(byPerson.values())
    .filter((person) => person.incidents.length > 0)
    .map((person) => {
      const lateHours = person.incidents.map((incident) => incident.lateHours);
      const lastIncidentAt = person.incidents
        .map((incident) => incidentOccurredAt(incident))
        .sort()
        .at(-1)!;
      // Totals come from Postgres so they stay exact even when the row scan is
      // capped. On-time returns are completed minus completed-but-late, which
      // avoids a column-to-column comparison Prisma cannot express in a where.
      const completedCount = completedCountByUser.get(person.userId) ?? 0;
      const onTimeCount = Math.max(0, completedCount - person.lateCompletedCount);
      const rateCount = completedCount + person.activeLateCheckoutCount;
      return {
        userId: person.userId,
        name: person.name,
        avatarUrl: person.avatarUrl,
        active: person.active,
        primaryArea: person.primaryArea,
        checkoutCount: checkoutCountByUser.get(person.userId) ?? 0,
        completedCount,
        lateEventCount: person.incidents.length,
        activeOverdueCount: person.incidents.filter((incident) => incident.state === "active").length,
        totalLateHours: lateHours.reduce((sum, hours) => sum + hours, 0),
        medianLateHours: median(lateHours),
        worstLateHours: Math.max(...lateHours),
        onTimeRate:
          rateCount >= MIN_CHECKOUTS_FOR_RATE
            ? Math.round((onTimeCount / rateCount) * 100)
            : null,
        lastIncidentAt,
        incidents: person.incidents.sort((a, b) =>
          INCIDENT_STATE_RANK[a.state] - INCIDENT_STATE_RANK[b.state] ||
          incidentOccurredAt(b).localeCompare(incidentOccurredAt(a)) ||
          b.lateHours - a.lateHours ||
          a.incidentId.localeCompare(b.incidentId),
        ),
      };
    })
    .sort(rankComparator(filters.sort ?? "events"));

  const itemSummaries = await loadIncidentItemSummaries(
    ranked.flatMap((person) => person.incidents.map((incident) => incident.bookingId)),
  );
  const leaderboard = ranked.map((person) => ({
    ...person,
    incidents: person.incidents.map((incident) => ({
      ...incident,
      itemSummary: itemSummaries.get(incident.bookingId) ?? "",
    })),
  }));

  return {
    generatedAt: now.toISOString(),
    /** True when the booking scan hit BOOKING_SCAN_LIMIT and older history was dropped. */
    truncated,
    scanLimit: BOOKING_SCAN_LIMIT,
    academicYear:
      filters.startYear === null
        ? null
        : {
            startYear: filters.startYear,
            label: `${filters.startYear}-${String(filters.startYear + 1).slice(-2)}`,
            start: window!.start.toISOString(),
            end: window!.end.toISOString(),
          },
    methodology: {
      gracePeriodHours: policies.gracePeriodHours,
      minimumCheckoutsForRate: MIN_CHECKOUTS_FOR_RATE,
      sort: filters.sort ?? "events",
      ranking: ACCOUNTABILITY_RANKING_DESCRIPTIONS[filters.sort ?? "events"],
    },
    metrics: {
      peopleNeedingAttention: leaderboard.length,
      lateEvents: leaderboard.reduce((sum, person) => sum + person.lateEventCount, 0),
      activeOverdue: leaderboard.reduce((sum, person) => sum + person.activeOverdueCount, 0),
      totalLateHours: leaderboard.reduce((sum, person) => sum + person.totalLateHours, 0),
      excludedRecords: excluded.length,
    },
    locations,
    leaderboard,
    excluded,
  };
}

/**
 * Request-path entry point. The report is a pure read over a whole academic
 * year, and the page refetches it on every filter change, so it is cached per
 * filter set for a minute and tagged for explicit busting.
 *
 * Exclusion changes revalidate the tag directly. Ordinary booking churn
 * (checkout, return, due-date change) has no single mutation path worth wiring
 * up, so those changes land via the 60 s TTL instead.
 */
export function getCachedAccountabilityReport(filters: AccountabilityFilters) {
  const cacheKey = [
    ACCOUNTABILITY_REPORT_TAG,
    String(filters.startYear ?? "all"),
    filters.locationId ?? "any-location",
    filters.incidentState ?? "all",
    filters.userState ?? "all",
    filters.sort ?? "events",
  ];
  return unstable_cache(() => getAccountabilityReport(filters), cacheKey, {
    revalidate: ACCOUNTABILITY_REPORT_TTL_SECONDS,
    tags: [ACCOUNTABILITY_REPORT_TAG],
  })();
}

export async function excludeBookingFromAccountability(input: {
  bookingId: string;
  reason: AccountabilityExclusionReason;
  note?: string | null;
  actorId: string;
  actorRole: Role;
}) {
  const exclusion = await db.$transaction(
    async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: input.bookingId },
        select: {
          id: true,
          kind: true,
          title: true,
          accountabilityExclusion: true,
        },
      });
      if (!booking || booking.kind !== "CHECKOUT") {
        throw new HttpError(404, "Checkout not found");
      }
      if (booking.accountabilityExclusion?.restoredAt === null) {
        throw new HttpError(409, "This checkout is already excluded");
      }

      const exclusion = await tx.bookingAccountabilityExclusion.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
          reason: input.reason,
          note: input.note ?? null,
          excludedByUserId: input.actorId,
        },
        update: {
          reason: input.reason,
          note: input.note ?? null,
          excludedByUserId: input.actorId,
          excludedAt: new Date(),
          restoredByUserId: null,
          restoredAt: null,
        },
      });

      await createAuditEntryTx(tx, {
        actorId: input.actorId,
        actorRole: input.actorRole,
        entityType: "booking_accountability",
        entityId: booking.id,
        action: "accountability_excluded",
        before: { excluded: false },
        after: {
          excluded: true,
          reason: exclusion.reason,
          note: exclusion.note,
          bookingTitle: booking.title,
        },
      });
      return exclusion;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  // Exclusions are the one mutation path that changes the report's inputs
  // through a single owned route pair, so bust the tag instead of waiting.
  revalidateTag(ACCOUNTABILITY_REPORT_TAG);
  return exclusion;
}

export async function restoreBookingToAccountability(input: {
  bookingId: string;
  actorId: string;
  actorRole: Role;
}) {
  const restored = await db.$transaction(
    async (tx) => {
      const existing = await tx.bookingAccountabilityExclusion.findUnique({
        where: { bookingId: input.bookingId },
        include: { booking: { select: { title: true } } },
      });
      if (!existing || existing.restoredAt !== null) {
        throw new HttpError(409, "This checkout is not currently excluded");
      }

      const restored = await tx.bookingAccountabilityExclusion.update({
        where: { bookingId: input.bookingId },
        data: {
          restoredByUserId: input.actorId,
          restoredAt: new Date(),
        },
      });
      await createAuditEntryTx(tx, {
        actorId: input.actorId,
        actorRole: input.actorRole,
        entityType: "booking_accountability",
        entityId: input.bookingId,
        action: "accountability_restored",
        before: {
          excluded: true,
          reason: existing.reason,
          note: existing.note,
        },
        after: {
          excluded: false,
          bookingTitle: existing.booking.title,
        },
      });
      return restored;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  revalidateTag(ACCOUNTABILITY_REPORT_TAG);
  return restored;
}
