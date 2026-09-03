import {
  AccountabilityExclusionReason,
  BookingCustodyScope,
  BookingStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { loadCheckoutPolicies } from "@/lib/services/checkout-policies";

const MIN_CHECKOUTS_FOR_RATE = 3;
const HOUR_MS = 3_600_000;

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

export function getAcademicYearWindow(startYear: number | null) {
  if (startYear === null) return null;
  return {
    start: localMidnightUtc(startYear, 7, 1),
    end: localMidnightUtc(startYear + 1, 7, 1),
  };
}

type RankedPerson = {
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
    if (sort === "time") {
      return (
        b.totalLateHours - a.totalLateHours ||
        b.lateEventCount - a.lateEventCount ||
        b.lastIncidentAt.localeCompare(a.lastIncidentAt)
      );
    }
    if (sort === "recent") {
      return (
        b.lastIncidentAt.localeCompare(a.lastIncidentAt) ||
        b.lateEventCount - a.lateEventCount ||
        b.totalLateHours - a.totalLateHours
      );
    }
    return (
      b.lateEventCount - a.lateEventCount ||
      b.totalLateHours - a.totalLateHours ||
      b.lastIncidentAt.localeCompare(a.lastIncidentAt)
    );
  };
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;
}

const accountabilityBookingInclude = {
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
    include: {
      excludedBy: { select: { id: true, name: true } },
      restoredBy: { select: { id: true, name: true } },
    },
  },
  dueDateChanges: {
    orderBy: { changedAt: "asc" as const },
  },
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
} satisfies Prisma.BookingInclude;

type AccountabilityBooking = Prisma.BookingGetPayload<{
  include: typeof accountabilityBookingInclude;
}>;

function itemSummary(booking: AccountabilityBooking) {
  const serialized = booking.serializedItems.map(
    (item) => item.asset.assetTag || item.asset.name || "Unknown item",
  );
  const bulk = booking.bulkItems
    .filter((item) => Math.max(item.checkedOutQuantity, item.plannedQuantity) > 0)
    .map(
      (item) =>
        `${item.bulkSku.name} x${Math.max(item.checkedOutQuantity, item.plannedQuantity)}`,
    );
  return [...serialized, ...bulk].join(", ");
}

export async function getAccountabilityReport(
  filters: AccountabilityFilters,
  now: Date = new Date(),
) {
  const [policies, locations] = await Promise.all([
    loadCheckoutPolicies(),
    db.location.findMany({
      where: { bookings: { some: { kind: "CHECKOUT" } } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const graceMs = policies.gracePeriodHours * HOUR_MS;
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

  const bookings = await db.booking.findMany({
    where,
    include: accountabilityBookingInclude,
    orderBy: [{ endsAt: "desc" }, { id: "desc" }],
  });

  const excluded = bookings
    .filter((booking) => booking.accountabilityExclusion?.restoredAt === null)
    .map((booking) => ({
      bookingId: booking.id,
      bookingTitle: booking.title,
      requester: booking.requester.name,
      dueAt: booking.endsAt.toISOString(),
      reason: booking.accountabilityExclusion!.reason,
      note: booking.accountabilityExclusion!.note,
      excludedAt: booking.accountabilityExclusion!.excludedAt.toISOString(),
      excludedBy: booking.accountabilityExclusion!.excludedBy.name,
    }));

  const included = bookings.filter(
    (booking) => booking.accountabilityExclusion?.restoredAt !== null ||
      !booking.accountabilityExclusion,
  );

  type PersonAccumulator = {
    userId: string;
    name: string;
    avatarUrl: string | null;
    active: boolean;
    primaryArea: string | null;
    checkoutCount: number;
    completedCount: number;
    onTimeCount: number;
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
      checkoutCount: 0,
      completedCount: 0,
      onTimeCount: 0,
      incidents: [],
    };
    person.checkoutCount += 1;

    if (finalDueInWindow) {
      const effectiveDue = booking.endsAt.getTime() + graceMs;
      const comparisonTime =
        booking.status === BookingStatus.COMPLETED
          ? booking.completedAt?.getTime()
          : now.getTime();

      if (booking.status === BookingStatus.COMPLETED && comparisonTime !== undefined) {
        person.completedCount += 1;
        if (comparisonTime <= effectiveDue) person.onTimeCount += 1;
      }

      if (comparisonTime !== undefined && comparisonTime > effectiveDue) {
        const state = booking.status === BookingStatus.OPEN ? "active" : "resolved";
        if (!filters.incidentState || filters.incidentState === "all" || filters.incidentState === state) {
          person.incidents.push({
            incidentId: `${booking.id}:${state}`,
            bookingId: booking.id,
            title: booking.title,
            dueAt: booking.endsAt.toISOString(),
            returnedAt: booking.completedAt?.toISOString() ?? null,
            extendedAt: null,
            extendedTo: null,
            lateHours: Math.max(1, Math.ceil((comparisonTime - effectiveDue) / HOUR_MS)),
            state,
            location: booking.location,
            itemSummary: itemSummary(booking),
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
          title: booking.title,
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
          itemSummary: itemSummary(booking),
        });
      }
    }

    byPerson.set(person.userId, person);
  }

  const leaderboard = Array.from(byPerson.values())
    .filter((person) => person.incidents.length > 0)
    .map((person) => {
      const lateHours = person.incidents.map((incident) => incident.lateHours);
      const lastIncidentAt = person.incidents
        .map((incident) => incident.returnedAt ?? incident.extendedAt ?? incident.dueAt)
        .sort()
        .at(-1)!;
      return {
        userId: person.userId,
        name: person.name,
        avatarUrl: person.avatarUrl,
        active: person.active,
        primaryArea: person.primaryArea,
        checkoutCount: person.checkoutCount,
        completedCount: person.completedCount,
        lateEventCount: person.incidents.length,
        activeOverdueCount: person.incidents.filter((incident) => incident.state === "active").length,
        totalLateHours: lateHours.reduce((sum, hours) => sum + hours, 0),
        medianLateHours: median(lateHours),
        worstLateHours: Math.max(...lateHours),
        onTimeRate:
          person.completedCount >= MIN_CHECKOUTS_FOR_RATE
            ? Math.round((person.onTimeCount / person.completedCount) * 100)
            : null,
        lastIncidentAt,
        incidents: person.incidents.sort((a, b) => b.lateHours - a.lateHours),
      };
    })
    .sort(rankComparator(filters.sort ?? "events"));

  return {
    generatedAt: now.toISOString(),
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

export async function excludeBookingFromAccountability(input: {
  bookingId: string;
  reason: AccountabilityExclusionReason;
  note?: string | null;
  actorId: string;
  actorRole: Role;
}) {
  return db.$transaction(
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
}

export async function restoreBookingToAccountability(input: {
  bookingId: string;
  actorId: string;
  actorRole: Role;
}) {
  return db.$transaction(
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
}
