import {
  BadgeCategory,
  BadgeStreakType,
  BookingKind,
  BookingStatus,
  Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { normalizePrefs } from "@/lib/services/notification-prefs";

import { isSerializationConflict } from "@/lib/serialization";
import {
  checkoutAutomaticRuleCounts,
  returnAutomaticRuleCounts,
  shiftAutomaticRuleCounts,
  tradeAutomaticRuleCounts,
} from "./automatic-rules";
import { loadWorkedShiftEvidence } from "./worked-evidence";
import {
  ON_TIME_GRACE_MS,
  type AppOpenedBadgeEvent,
  type CheckoutOpenedBadgeEvent,
  type CheckoutReturnedBadgeEvent,
  type ShiftsWorkedBadgeEvent,
  type TradeCompletedBadgeEvent,
} from "./types";

type TxClient = Prisma.TransactionClient;
const MAX_TRANSACTION_ATTEMPTS = 2;

async function runBadgeTransaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      // Matches the raw 40001 driver code as well as Prisma's P2034; the
      // Neon adapter can surface either for the same serialization abort.
      const canRetry = isSerializationConflict(error) && attempt < MAX_TRANSACTION_ATTEMPTS;

      if (!canRetry) throw error;
    }
  }

  throw new Error("Badge transaction retry exhausted");
}

/**
 * Write the award rows an event earned, and tell the person.
 *
 * Automatic awards used to be silent. `awardBadgeManually` wrote a
 * `badge_awarded` notification, and the three evaluator paths wrote none, so
 * recognition ran backwards: a staff pat on the back left a durable inbox
 * entry while `checkout_25` -- twenty-five checkouts of work -- left nothing
 * but a popup that required being in the app when the poll landed. The nightly
 * `onShiftsWorked` pass and any return completed at a shared kiosk are exactly
 * the cases where nobody is holding their phone.
 *
 * `createManyAndReturn` is what makes this idempotent rather than noisy: it
 * returns only the rows this call actually inserted, so a duplicate event that
 * re-runs the evaluator awards nothing and therefore notifies nothing. The
 * per-award `dedupeKey` is the second guard.
 */
async function grantBadges(tx: TxClient, args: {
  userId: string;
  definitions: Array<{ id: string; name: string }>;
  /**
   * Whether earning this badge is worth telling the person about. False only
   * for a badge an admin-recorded Scoreboard credit pushed them over: the
   * credit is deliberately silent (D-057), and a "badge earned" ping is the one
   * way it could announce itself. The award itself is written either way.
   */
  notify?: boolean;
}) {
  if (args.definitions.length === 0) return;

  const created = await tx.studentBadge.createManyAndReturn({
    data: args.definitions.map((definition) => ({
      userId: args.userId,
      definitionId: definition.id,
    })),
    skipDuplicates: true,
    select: { id: true, definitionId: true },
  });

  if (created.length === 0) return;
  if (args.notify === false) return;

  // Only read prefs once something was actually earned.
  const target = await tx.user.findUnique({
    where: { id: args.userId },
    select: { notificationPrefs: true },
  });
  if (normalizePrefs(target?.notificationPrefs).badges === false) return;

  const nameByDefinitionId = new Map(args.definitions.map((d) => [d.id, d.name]));
  const sentAt = new Date();

  await tx.notification.createMany({
    data: created.map((award) => ({
      userId: args.userId,
      type: "badge_awarded",
      // "Earned", not "awarded": nobody handed this one over.
      title: "Badge earned",
      body: `You earned ${nameByDefinitionId.get(award.definitionId) ?? "a new badge"}.`,
      payload: {
        userId: args.userId,
        badgeDefinitionId: award.definitionId,
        studentBadgeId: award.id,
        href: `/users/${args.userId}?tab=badges`,
      },
      channel: "IN_APP" as const,
      sentAt,
      dedupeKey: `badge_awarded_${award.id}`,
    })),
    skipDuplicates: true,
  });
}

async function awardThresholdBadges(tx: TxClient, args: {
  userId: string;
  category: BadgeCategory;
  trigger: string;
  count: number;
  ruleKey?: string;
  /**
   * The count reached without admin-recorded credits. Badges at or below it were
   * earned on the schedule's own record and notify; anything above it exists
   * only because of a credit and is granted silently. Defaults to `count`, so a
   * caller with no credits behaves exactly as before.
   */
  notifiableCount?: number;
}) {
  const definitions = await tx.badgeDefinition.findMany({
    where: {
      active: true,
      category: args.category,
      trigger: args.trigger,
      threshold: { not: null, lte: args.count },
      ...(args.ruleKey ? { ruleKey: args.ruleKey } : {}),
    },
    select: { id: true, name: true, threshold: true },
  });

  const notifiable = args.notifiableCount ?? args.count;
  await grantBadges(tx, {
    userId: args.userId,
    definitions: definitions.filter((definition) => (definition.threshold ?? 0) <= notifiable),
  });
  await grantBadges(tx, {
    userId: args.userId,
    definitions: definitions.filter((definition) => (definition.threshold ?? 0) > notifiable),
    notify: false,
  });
}

async function awardRuleBadges(tx: TxClient, args: {
  userId: string;
  trigger: string;
  ruleKey: string;
}) {
  const definitions = await tx.badgeDefinition.findMany({
    where: {
      active: true,
      trigger: args.trigger,
      ruleKey: args.ruleKey,
    },
    select: { id: true, name: true },
  });

  await grantBadges(tx, { userId: args.userId, definitions });
}

async function awardMeasuredRuleBadges(tx: TxClient, args: {
  userId: string;
  trigger: string;
  counts: Map<string, number>;
  /** Per-rule counts without admin-recorded credits. See `notifiableCount`. */
  notifiableCounts?: Map<string, number>;
}) {
  const ruleKeys = [...args.counts.keys()];
  if (ruleKeys.length === 0) return;

  const definitions = await tx.badgeDefinition.findMany({
    where: {
      active: true,
      category: BadgeCategory.MILESTONE,
      trigger: args.trigger,
      threshold: { not: null },
      ruleKey: { in: ruleKeys },
    },
    select: { id: true, name: true, ruleKey: true, threshold: true },
  });
  const earnedDefinitions = definitions.filter((definition) => (
    definition.ruleKey !== null
    && definition.threshold !== null
    && (args.counts.get(definition.ruleKey) ?? 0) >= definition.threshold
  ));

  const earnedWithoutCredits = args.notifiableCounts
    ? new Set(earnedDefinitions.filter((definition) => (
      definition.ruleKey !== null
      && definition.threshold !== null
      && (args.notifiableCounts!.get(definition.ruleKey) ?? 0) >= definition.threshold
    )))
    : new Set(earnedDefinitions);

  await grantBadges(tx, {
    userId: args.userId,
    definitions: earnedDefinitions.filter((definition) => earnedWithoutCredits.has(definition)),
  });
  await grantBadges(tx, {
    userId: args.userId,
    definitions: earnedDefinitions.filter((definition) => !earnedWithoutCredits.has(definition)),
    notify: false,
  });
}

async function claimEventReceipt(tx: TxClient, args: {
  userId: string;
  eventType: string;
  sourceKey: string;
}) {
  const receipt = await tx.badgeEventReceipt.createMany({
    data: [args],
    skipDuplicates: true,
  });

  return receipt.count === 1;
}

async function incrementStreak(tx: TxClient, args: {
  userId: string;
  streakType: BadgeStreakType;
  sourceKey: string;
  eventAt: Date;
}) {
  const current = await tx.badgeStreak.findUnique({
    where: {
      userId_streakType: {
        userId: args.userId,
        streakType: args.streakType,
      },
    },
  });

  if (current?.lastSourceKey === args.sourceKey) return null;

  const nextCurrent = (current?.current ?? 0) + 1;
  const nextLongest = Math.max(current?.longest ?? 0, nextCurrent);

  await tx.badgeStreak.upsert({
    where: {
      userId_streakType: {
        userId: args.userId,
        streakType: args.streakType,
      },
    },
    create: {
      userId: args.userId,
      streakType: args.streakType,
      current: nextCurrent,
      longest: nextLongest,
      lastEventAt: args.eventAt,
      lastSourceKey: args.sourceKey,
    },
    update: {
      current: nextCurrent,
      longest: nextLongest,
      lastEventAt: args.eventAt,
      lastSourceKey: args.sourceKey,
    },
  });

  return nextCurrent;
}

async function resetStreak(tx: TxClient, args: {
  userId: string;
  streakType: BadgeStreakType;
  sourceKey: string;
  eventAt: Date;
}) {
  const current = await tx.badgeStreak.findUnique({
    where: {
      userId_streakType: {
        userId: args.userId,
        streakType: args.streakType,
      },
    },
  });

  if (current?.lastSourceKey === args.sourceKey) return;

  await tx.badgeStreak.upsert({
    where: {
      userId_streakType: {
        userId: args.userId,
        streakType: args.streakType,
      },
    },
    create: {
      userId: args.userId,
      streakType: args.streakType,
      current: 0,
      longest: 0,
      lastEventAt: args.eventAt,
      lastSourceKey: args.sourceKey,
    },
    update: {
      current: 0,
      lastEventAt: args.eventAt,
      lastSourceKey: args.sourceKey,
    },
  });
}

export async function onCheckoutOpened(event: CheckoutOpenedBadgeEvent): Promise<void> {
  await runBadgeTransaction(async (tx) => {
    const isNewEvent = await claimEventReceipt(tx, {
      userId: event.userId,
      eventType: "checkout_opened",
      // The booking is the immutable earning event. Caller-provided keys used
      // to vary between direct checkout and reservation pickup, which made
      // ownership-safe history impossible to join back to the checkout.
      sourceKey: event.bookingId,
    });
    if (!isNewEvent) return;

    const openedReceipts = await tx.badgeEventReceipt.findMany({
      where: {
        userId: event.userId,
        eventType: "checkout_opened",
      },
      select: { sourceKey: true },
    });
    const openedBookingIds = openedReceipts.map((receipt) => receipt.sourceKey);

    await awardThresholdBadges(tx, {
      userId: event.userId,
      category: BadgeCategory.CHECKOUT,
      trigger: "checkout:opened",
      count: openedBookingIds.length,
    });

    // The receipt freezes credit to the person who actually opened the
    // checkout. Derive every gear challenge from those same immutable rows so
    // a later ownership transfer neither steals nor duplicates an award.
    const creditedCheckouts = await tx.booking.findMany({
      where: {
        id: { in: openedBookingIds },
        kind: BookingKind.CHECKOUT,
        status: { in: [BookingStatus.OPEN, BookingStatus.COMPLETED] },
      },
      select: {
        startsAt: true,
        kitId: true,
        eventId: true,
        sourceReservationId: true,
        shiftAssignmentId: true,
        events: { select: { eventId: true } },
        serializedItems: {
          select: {
            assetId: true,
            asset: {
              select: {
                category: { select: { id: true, name: true, parent: { select: { name: true } } } },
              },
            },
          },
        },
        bulkItems: {
          select: {
            checkedOutQuantity: true,
            bulkSku: {
              select: {
                categoryRel: { select: { id: true, name: true, parent: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });

    await awardMeasuredRuleBadges(tx, {
      userId: event.userId,
      trigger: "checkout:opened",
      counts: checkoutAutomaticRuleCounts(creditedCheckouts, env.appTimezone),
    });
  });
}

export async function onCheckoutReturned(event: CheckoutReturnedBadgeEvent): Promise<void> {
  await runBadgeTransaction(async (tx) => {
    const isNewEvent = await claimEventReceipt(tx, {
      userId: event.userId,
      eventType: "checkout_returned",
      sourceKey: event.bookingId,
    });
    if (!isNewEvent) return;

    // A clean return remains clean even when it is late. Award this independent
    // lane before the on-time streak early return below.
    const damageFreeCount = await tx.booking.count({
      where: {
        requesterUserId: event.userId,
        kind: BookingKind.CHECKOUT,
        status: BookingStatus.COMPLETED,
        checkinReports: { none: {} },
      },
    });

    await awardThresholdBadges(tx, {
      userId: event.userId,
      category: BadgeCategory.ON_TIME,
      trigger: "checkout:returned",
      count: damageFreeCount,
      ruleKey: "damage_free_return",
    });

    // Read once, above the on-time early return. A long custody and a same-day
    // turnaround are facts about the return whether or not it was on time, so
    // gating them behind `wasOnTime` would silently drop half their evidence.
    const completedCheckouts = await tx.booking.findMany({
      where: {
        requesterUserId: event.userId,
        kind: BookingKind.CHECKOUT,
        status: BookingStatus.COMPLETED,
      },
      select: {
        startsAt: true,
        endsAt: true,
        updatedAt: true,
        completedAt: true,
        checkinReports: { select: { id: true, type: true } },
        dueDateChanges: { select: { id: true }, take: 1 },
      },
    });

    await awardMeasuredRuleBadges(tx, {
      userId: event.userId,
      trigger: "checkout:returned",
      counts: returnAutomaticRuleCounts(completedCheckouts, env.appTimezone),
    });

    if (!event.wasOnTime) {
      await resetStreak(tx, {
        userId: event.userId,
        streakType: BadgeStreakType.ON_TIME_RETURN,
        sourceKey: event.bookingId,
        eventAt: event.completedAt,
      });
      return;
    }

    const onTimeCount = completedCheckouts.filter(
      (booking) => (booking.completedAt ?? booking.updatedAt).getTime() <= booking.endsAt.getTime() + ON_TIME_GRACE_MS,
    ).length;

    await awardThresholdBadges(tx, {
      userId: event.userId,
      category: BadgeCategory.ON_TIME,
      trigger: "checkout:returned",
      count: onTimeCount,
      ruleKey: "on_time_return",
    });

    const streakCount = await incrementStreak(tx, {
      userId: event.userId,
      streakType: BadgeStreakType.ON_TIME_RETURN,
      sourceKey: event.bookingId,
      eventAt: event.completedAt,
    });

    if (streakCount !== null) {
      await awardThresholdBadges(tx, {
        userId: event.userId,
        category: BadgeCategory.STREAK,
        trigger: "checkout:returned",
        count: streakCount,
        ruleKey: "on_time_return_streak",
      });
    }
  });
}

type AppOpenMoment = {
  /** YYYY-MM-DD in the institution timezone. */
  date: string;
  hour: number;
  month: number;
  day: number;
  /** 0 = Sunday, matching `Date.prototype.getUTCDay`. */
  weekday: number;
};

function appOpenMoment(occurredAt: Date): AppOpenMoment {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.appTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(occurredAt);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const year = Number(value("year"));
  const month = Number(value("month"));
  const day = Number(value("day"));

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    month,
    day,
    // Read back from the local calendar date, so the weekday is the one the
    // user is living in rather than the UTC instant's.
    weekday: new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay(),
  };
}

/**
 * The app-open easter eggs, each owning the receipt key that makes it award at
 * most once per local day.
 *
 * `local_hour_2` keeps its original `local-hour-2:` prefix. Renaming it to
 * match the rule key would orphan every receipt already written and let a
 * previously claimed day be claimed again.
 */
const APP_OPEN_RULES: Array<{
  ruleKey: string;
  receiptPrefix: string;
  matches: (moment: AppOpenMoment) => boolean;
}> = [
  {
    ruleKey: "local_hour_2",
    receiptPrefix: "local-hour-2",
    matches: (moment) => moment.hour === 2,
  },
  {
    ruleKey: "local_friday_13",
    receiptPrefix: "local-friday-13",
    matches: (moment) => moment.day === 13 && moment.weekday === 5,
  },
  {
    ruleKey: "local_holiday",
    receiptPrefix: "local-holiday",
    matches: (moment) => (
      (moment.month === 12 && moment.day === 25)
      || (moment.month === 1 && moment.day === 1)
    ),
  },
  {
    ruleKey: "local_hour_0",
    receiptPrefix: "local-hour-0",
    matches: (moment) => moment.hour === 0,
  },
  {
    ruleKey: "local_weekend",
    receiptPrefix: "local-weekend",
    matches: (moment) => moment.weekday === 0 || moment.weekday === 6,
  },
  {
    ruleKey: "local_leap_day",
    receiptPrefix: "local-leap-day",
    matches: (moment) => moment.month === 2 && moment.day === 29,
  },
];

/**
 * Server-authoritative app-open easter eggs. The client only reports that the
 * signed-in app became active; the server's institution timezone decides
 * whether a rule matches, so changing a device clock cannot mint an award.
 *
 * More than one rule can match a single open -- 2 a.m. on Friday the 13th is
 * both -- so every match is evaluated rather than the first.
 */
export async function onAppOpened(event: AppOpenedBadgeEvent): Promise<void> {
  const moment = appOpenMoment(event.occurredAt);
  const matched = APP_OPEN_RULES.filter((rule) => rule.matches(moment));
  if (matched.length === 0) return;

  await runBadgeTransaction(async (tx) => {
    for (const rule of matched) {
      const isNewEvent = await claimEventReceipt(tx, {
        userId: event.userId,
        eventType: "app_opened",
        sourceKey: `${rule.receiptPrefix}:${moment.date}`,
      });
      if (!isNewEvent) continue;

      await awardRuleBadges(tx, {
        userId: event.userId,
        trigger: "app:opened",
        ruleKey: rule.ruleKey,
      });
    }
  });
}

/**
 * Recognition for shift work, counted from assignments -- and admin-recorded
 * Scoreboard credits (D-057) -- on events that have already happened.
 *
 * These badges were retired in 2026-05 because attendance is not tracked, and
 * that reasoning conflated two things: nobody records whether a person showed
 * up, but the schedule does durably record who was committed to be there. That
 * commitment is what the crew is recognised for, and until now the entire
 * Schedule half of the product earned nothing at all.
 *
 * Counting from the database rather than incrementing a streak is what makes
 * this safe to re-run nightly: `awardThresholdBadges` writes with
 * `skipDuplicates`, so a second pass over the same shifts changes nothing.
 *
 * A credit counts as one worked event and never stacks with an assignment on
 * the same event; `loadWorkedShiftEvidence` owns that deduplication so the
 * progress bar on a profile and the award written here cannot disagree.
 *
 * A badge the person had already earned on their own assignments notifies as
 * usual. One that only a credit pushed them over is granted silently, because a
 * credit is not supposed to announce itself and "badge earned" is the only
 * message it could otherwise produce. Silence is durable rather than deferred:
 * the award row exists after the silent grant, so no later pass re-inserts it
 * and none can notify late.
 *
 * Archived events still count. `morning-refresh` stamps `archivedAt` on events
 * older than four months purely as list hygiene -- "nothing is deleted" -- so
 * excluding them would make a person's worked-shift total fall over time and
 * strand them below a threshold they had already passed.
 */
export async function onShiftsWorked(event: ShiftsWorkedBadgeEvent): Promise<void> {
  await runBadgeTransaction(async (tx) => {
    const worked = await loadWorkedShiftEvidence(tx, event.userId);
    const scheduled = worked.filter((evidence) => evidence.source === "ASSIGNMENT");
    // Recomputing the schedule-only totals is only worth it when a credit is
    // actually in play; without one the two answers are the same object.
    const hasCredits = scheduled.length !== worked.length;

    await awardThresholdBadges(tx, {
      userId: event.userId,
      category: BadgeCategory.SHIFT,
      trigger: "shift:completed",
      count: worked.length,
      notifiableCount: hasCredits ? scheduled.length : undefined,
    });
    await awardMeasuredRuleBadges(tx, {
      userId: event.userId,
      trigger: "shift:completed",
      counts: shiftAutomaticRuleCounts(worked, env.appTimezone),
      notifiableCounts: hasCredits
        ? shiftAutomaticRuleCounts(scheduled, env.appTimezone)
        : undefined,
    });
  });
}

export async function onTradeCompleted(event: TradeCompletedBadgeEvent): Promise<void> {
  await runBadgeTransaction(async (tx) => {
    const isNewEvent = await claimEventReceipt(tx, {
      userId: event.userId,
      eventType: "trade_completed",
      sourceKey: event.tradeId,
    });
    if (!isNewEvent) return;

    // Read the rows rather than counting them. The ladder still only needs the
    // total, but short-notice cover needs to know when each one was claimed.
    const completedTrades = await tx.shiftTrade.findMany({
      where: {
        status: "COMPLETED",
        OR: [
          { postedByUserId: event.userId },
          { claimedByUserId: event.userId },
        ],
      },
      select: {
        postedByUserId: true,
        claimedByUserId: true,
        claimedAt: true,
        shiftAssignment: { select: { shift: { select: { startsAt: true } } } },
      },
    });

    await awardThresholdBadges(tx, {
      userId: event.userId,
      category: BadgeCategory.TRADE,
      trigger: "trade:completed",
      count: completedTrades.length,
    });

    await awardMeasuredRuleBadges(tx, {
      userId: event.userId,
      trigger: "trade:completed",
      counts: tradeAutomaticRuleCounts(completedTrades, event.userId),
    });
  });
}
