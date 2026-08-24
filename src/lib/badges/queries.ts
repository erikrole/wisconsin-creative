import { BadgeCategory, BadgeKind, BadgeStreakType, BookingKind, BookingStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { AuthUser } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { normalizePrefs } from "@/lib/services/notification-prefs";
import { ON_TIME_GRACE_MS } from "./types";
import { getBadgeRarity } from "./display";
import {
  automaticCheckoutRuleKeys,
  automaticMeasuredRuleKeys,
  automaticReturnRuleKeys,
  automaticTradeRuleKeys,
  checkoutAutomaticRuleCounts,
  returnAutomaticRuleCounts,
  shiftAutomaticRuleCounts,
  tradeAutomaticRuleCounts,
} from "./automatic-rules";
import { loadWorkedShiftEvidence } from "./worked-evidence";

type CustomBadgeDefinitionInput = {
  name: string;
  description: string;
  icon?: string;
};

type ManualAwardArgs = {
  userId: string;
  definitionId?: string;
  customDefinition?: CustomBadgeDefinitionInput;
  awardedById: string;
  note?: string;
};

type BadgeDefinitionForProgress = {
  key: string;
  category: string;
  kind: string;
  trigger: string;
  threshold: number | null;
  ruleKey: string | null;
};

type BadgeProgress = {
  current: number;
  target: number;
  /**
   * When the evidence says this goal was actually met, for a goal already past
   * its threshold. Used only to date a self-healed award; a live award is dated
   * by the evaluator at the moment of the event.
   */
  metAt: Date | null;
};

export type EarnedBadge = {
  id: string;
  definitionId: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  rarity: ReturnType<typeof getBadgeRarity>;
  awardedAt: string;
};

export async function listActiveBadgeDefinitions(where?: { trigger?: string }) {
  return db.badgeDefinition.findMany({
    where: { active: true, ...where },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function countEarnedBadges(userId: string) {
  return db.studentBadge.count({
    where: { userId },
  });
}

export async function listEarnedBadgesSince(args: {
  userId: string;
  after: Date;
  through: Date;
}): Promise<EarnedBadge[]> {
  const awards = await db.studentBadge.findMany({
    where: {
      userId: args.userId,
      awardedAt: { gt: args.after, lte: args.through },
    },
    orderBy: [{ awardedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      awardedAt: true,
      definition: {
        select: {
          id: true,
          key: true,
          name: true,
          description: true,
          icon: true,
          category: true,
          kind: true,
          trigger: true,
          threshold: true,
          createdAt: true,
        },
      },
    },
  });

  if (awards.length === 0) return [];

  const definitionIds = awards.map((award) => award.definition.id);
  const [holderCounts, eligibleUsers] = await Promise.all([
    db.studentBadge.groupBy({
      by: ["definitionId"],
      where: { definitionId: { in: definitionIds } },
      _count: { userId: true },
    }),
    db.user.count({ where: { active: true } }),
  ]);
  const holdersByDefinition = new Map(
    holderCounts.map((row) => [row.definitionId, row._count.userId]),
  );

  return awards.map((award) => ({
    id: award.id,
    definitionId: award.definition.id,
    key: award.definition.key,
    name: award.definition.name,
    description: award.definition.description,
    icon: award.definition.icon,
    category: award.definition.category,
    rarity: getBadgeRarity({
      key: award.definition.key,
      category: award.definition.category,
      kind: award.definition.kind,
      trigger: award.definition.trigger,
      threshold: award.definition.threshold,
      holders: holdersByDefinition.get(award.definition.id) ?? 0,
      eligible: eligibleUsers,
      createdAt: award.definition.createdAt,
    }),
    awardedAt: award.awardedAt.toISOString(),
  }));
}

function slugifyBadgeName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

async function resolveManualAwardDefinition(
  tx: Prisma.TransactionClient,
  args: Pick<ManualAwardArgs, "definitionId" | "customDefinition">,
) {
  if (args.definitionId) {
    return tx.badgeDefinition.findUnique({
      where: { id: args.definitionId },
      select: {
        id: true,
        key: true,
        name: true,
        active: true,
      },
    });
  }

  if (!args.customDefinition) return null;

  const name = args.customDefinition.name.trim();
  const description = args.customDefinition.description.trim();
  const slug = slugifyBadgeName(name);
  if (!slug) {
    throw new HttpError(400, "Custom badge name is required");
  }

  const key = `custom_${slug}`;
  const existing = await tx.badgeDefinition.findUnique({
    where: { key },
    select: {
      id: true,
      key: true,
      name: true,
      active: true,
    },
  });

  if (existing) return existing;

  return tx.badgeDefinition.create({
    data: {
      key,
      name,
      description,
      icon: args.customDefinition.icon?.trim() || "Trophy",
      category: BadgeCategory.MILESTONE,
      kind: BadgeKind.RULE,
      trigger: "manual",
      threshold: null,
      ruleKey: key,
      active: true,
      sortOrder: 790,
    },
    select: {
      id: true,
      key: true,
      name: true,
      active: true,
    },
  });
}

export async function getBadgePeerVisibility() {
  const config = await db.systemConfig.findUnique({
    where: { key: "badges.peerVisible" },
    select: { value: true },
  });
  return config?.value !== false;
}

async function getProgressByBadgeKey(userId: string, definitions: BadgeDefinitionForProgress[]) {
  const thresholdDefinitions = definitions.filter((definition) => definition.threshold !== null);
  const progressByKey = new Map<string, BadgeProgress>();
  if (thresholdDefinitions.length === 0) return progressByKey;

  const needsCheckoutOpened = thresholdDefinitions.some((definition) => definition.trigger === "checkout:opened");
  const needsOnTimeReturns = thresholdDefinitions.some((definition) => definition.ruleKey === "on_time_return");
  const needsTrades = thresholdDefinitions.some((definition) => definition.trigger === "trade:completed");
  const needsCheckoutRuleEvidence = thresholdDefinitions.some((definition) => (
    definition.ruleKey === "category_collector"
    || (definition.ruleKey !== null && automaticCheckoutRuleKeys.includes(
      definition.ruleKey as typeof automaticCheckoutRuleKeys[number],
    ))
  ));
  const needsDamageFree = thresholdDefinitions.some((definition) => definition.ruleKey === "damage_free_return");
  const needsReturnRuleEvidence = thresholdDefinitions.some((definition) => (
    definition.ruleKey !== null && automaticReturnRuleKeys.includes(
      definition.ruleKey as typeof automaticReturnRuleKeys[number],
    )
  ));
  const needsShifts = thresholdDefinitions.some((definition) => definition.trigger === "shift:completed");
  const needsTradeRuleEvidence = thresholdDefinitions.some((definition) => (
    definition.ruleKey !== null && automaticTradeRuleKeys.includes(
      definition.ruleKey as typeof automaticTradeRuleKeys[number],
    )
  ));
  const streakTypes = new Set<BadgeStreakType>();

  for (const definition of thresholdDefinitions) {
    if (definition.ruleKey === "on_time_return_streak") streakTypes.add(BadgeStreakType.ON_TIME_RETURN);
  }

  const [
    checkoutOpenedReceipts,
    completedCheckouts,
    completedTrades,
    streaks,
    _unusedDamageFreeSlot,
    workedAssignments,
  ] = await Promise.all([
    needsCheckoutOpened || needsCheckoutRuleEvidence
      ? db.badgeEventReceipt.findMany({
          where: {
            userId,
            eventType: "checkout_opened",
          },
          select: { sourceKey: true, receivedAt: true },
        })
      : Promise.resolve([]),
    needsOnTimeReturns || needsReturnRuleEvidence || needsDamageFree
      ? db.booking.findMany({
          where: {
            requesterUserId: userId,
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
        })
      : Promise.resolve([]),
    needsTrades || needsTradeRuleEvidence
      ? db.shiftTrade.findMany({
          where: {
            status: "COMPLETED",
            OR: [
              { postedByUserId: userId },
              { claimedByUserId: userId },
            ],
          },
          select: {
            postedByUserId: true,
            claimedByUserId: true,
            claimedAt: true,
            shiftAssignment: { select: { shift: { select: { startsAt: true } } } },
          },
        })
      : Promise.resolve([]),
    streakTypes.size > 0
      ? db.badgeStreak.findMany({
          where: {
            userId,
            streakType: { in: Array.from(streakTypes) },
          },
          select: { streakType: true, current: true, longest: true },
        })
      : Promise.resolve([]),
    // Damage-free used to be its own `count()` with the same filter as the rows
    // above plus "no check-in report" -- and those rows already select
    // `checkinReports`. Deriving it here drops a query and, unlike a count,
    // leaves the timestamps needed to date a repaired award.
    Promise.resolve(0),
    needsShifts
      ? loadWorkedShiftEvidence(db, userId)
      : Promise.resolve([]),
  ]);

  const checkoutOpenedCount = checkoutOpenedReceipts.length;
  const openedBookingIds = checkoutOpenedReceipts.map((receipt) => receipt.sourceKey);
  const creditedCheckoutRows = needsCheckoutRuleEvidence && openedBookingIds.length > 0
    ? await db.booking.findMany({
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
      })
    : [];
  const measuredRuleCounts = new Map([
    ...checkoutAutomaticRuleCounts(creditedCheckoutRows, env.appTimezone),
    ...returnAutomaticRuleCounts(completedCheckouts, env.appTimezone),
    ...shiftAutomaticRuleCounts(workedAssignments, env.appTimezone),
    ...tradeAutomaticRuleCounts(completedTrades, userId),
  ]);

  void _unusedDamageFreeSlot;

  // Evidence timelines, ascending. The Nth entry is the moment a count-based
  // goal of threshold N was actually met -- which is what dates a repaired
  // award honestly instead of stamping it with whenever someone happened to
  // open the profile.
  // Nullable and legacy rows are dropped rather than substituted. A missing
  // timestamp means "cannot date this one", and a placeholder would quietly
  // become the Nth entry and date the award to the epoch.
  const ascending = (dates: Array<Date | null | undefined>): Date[] =>
    dates.filter((date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
  const returnedAt = (booking: { completedAt: Date | null; updatedAt: Date }) =>
    booking.completedAt ?? booking.updatedAt;

  const onTimeReturnDates = ascending(
    completedCheckouts
      .filter((booking) => returnedAt(booking).getTime() <= booking.endsAt.getTime() + ON_TIME_GRACE_MS)
      .map(returnedAt),
  );
  const damageFreeDates = ascending(
    completedCheckouts.filter((booking) => booking.checkinReports.length === 0).map(returnedAt),
  );
  const checkoutOpenedDates = ascending(checkoutOpenedReceipts.map((receipt) => receipt.receivedAt));
  const tradeDates = ascending(
    completedTrades.map((trade) => trade.claimedAt ?? trade.shiftAssignment?.shift?.startsAt),
  );
  const shiftDates = ascending(
    workedAssignments.map((assignment) => assignment.callEndsAt ?? assignment.shift.callEndsAt ?? assignment.shift.endsAt),
  );

  const onTimeReturnCount = onTimeReturnDates.length;
  const damageFreeCount = damageFreeDates.length;

  /** The moment a count of `target` was reached, if it ever was. */
  const nthDate = (dates: Date[], target: number): Date | null =>
    target > 0 && dates.length >= target ? dates[target - 1] ?? null : null;

  /**
   * The fallback for goals whose progress is a distinct-count or a streak
   * rather than a running tally of events -- there is no "Nth event" to point
   * at. The latest piece of evidence the user has is not when they crossed the
   * line, but it is a true upper bound and always in the past, which is the
   * property that matters: a repaired award must never look freshly earned.
   */
  const latestEvidence = ascending([
    ...checkoutOpenedDates,
    ...completedCheckouts.map(returnedAt),
    ...tradeDates,
    ...shiftDates,
  ]).at(-1) ?? null;

  const streakMap = new Map(streaks.map((streak) => [streak.streakType, streak]));

  for (const definition of thresholdDefinitions) {
    const target = definition.threshold;
    if (target === null) continue;

    // Rule key first. `category_collector` and the damage-free badges ride on
    // triggers that already mean something else, so testing the trigger first
    // would report a checkout total as category breadth.
    let current: number | null = null;
    // A count-based goal can point at the exact event that met it. A
    // distinct-count or streak goal cannot, and falls back to the latest
    // evidence -- see `latestEvidence`.
    let timeline: Date[] | null = null;
    if (definition.ruleKey === "category_collector") current = measuredRuleCounts.get("category_collector") ?? 0;
    else if (definition.ruleKey !== null && automaticMeasuredRuleKeys.has(definition.ruleKey)) {
      current = measuredRuleCounts.get(definition.ruleKey) ?? 0;
    }
    else if (definition.ruleKey === "damage_free_return") { current = damageFreeCount; timeline = damageFreeDates; }
    else if (definition.ruleKey === "on_time_return") { current = onTimeReturnCount; timeline = onTimeReturnDates; }
    else if (definition.trigger === "shift:completed") { current = workedAssignments.length; timeline = shiftDates; }
    else if (definition.trigger === "checkout:opened") { current = checkoutOpenedCount; timeline = checkoutOpenedDates; }
    else if (definition.ruleKey === "on_time_return_streak") current = streakMap.get(BadgeStreakType.ON_TIME_RETURN)?.current ?? 0;
    else if (definition.trigger === "trade:completed") { current = completedTrades.length; timeline = tradeDates; }

    if (current !== null) {
      progressByKey.set(definition.key, {
        current: Math.min(current, target),
        target,
        metAt: current >= target
          ? (timeline ? nthDate(timeline, target) ?? latestEvidence : latestEvidence)
          : null,
      });
    }
  }

  return progressByKey;
}

export async function getUserBadgeProfile(viewer: AuthUser, userId: string) {
  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, active: true },
  });

  if (!target) {
    throw new HttpError(404, "User not found");
  }

  const peerVisible = await getBadgePeerVisibility();
  const canView =
    viewer.id === userId ||
    viewer.role === "ADMIN" ||
    viewer.role === "STAFF" ||
    peerVisible;

  if (!canView) {
    throw new HttpError(403, "Badge visibility is disabled for peers");
  }

  const loadDefinitions = () => db.badgeDefinition.findMany({
    where: {
      OR: [
        { active: true },
        { awards: { some: { userId } } },
      ],
    },
    include: {
      awards: {
        where: { userId },
        orderBy: { awardedAt: "desc" },
        take: 1,
        select: {
          id: true,
          awardedAt: true,
          source: true,
          note: true,
          awardedBy: { select: { name: true } },
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  let definitions = await loadDefinitions();

  // Rarity is now a fact about how many people hold a badge, so it needs the
  // holder counts and the eligible population alongside the definitions. Both
  // are cheap aggregates and neither depends on the viewer.
  const [progressByKey, eligibleUsers, streakRows] = await Promise.all([
    getProgressByBadgeKey(userId, definitions),
    db.user.count({ where: { active: true } }),
    db.badgeStreak.findMany({
      where: { userId },
      select: { streakType: true, current: true, longest: true, lastEventAt: true },
    }),
  ]);

  // An evaluator failure, a newly activated definition, or a nightly shift
  // delay must never render a completed goal as locked. Repair any automatic
  // threshold award whose same server-derived progress has reached its target,
  // then reload the award rows before building the response.
  //
  // The award is dated from the evidence, not from this request. Stamping
  // `now()` made a goal completed in March read "Earned Aug 19" on the shelf
  // forever, and -- because `/api/badges/recent` selects by `awardedAt` -- it
  // also fired a celebration on the user's phone for months-old work, triggered
  // by whoever happened to open their profile. A backdated row is both honest
  // on the shelf and naturally behind every device cursor, so it cannot
  // masquerade as newly earned.
  //
  // Repairs deliberately do not notify. The evaluator notifies when a badge is
  // actually earned; a reconciliation of eight historical awards must not
  // arrive as eight inbox entries.
  const completedUnawarded = definitions
    .filter((definition) => {
      if (!definition.active || definition.awards.length > 0 || definition.trigger === "manual") return false;
      const progress = progressByKey.get(definition.key);
      return Boolean(progress && progress.current >= progress.target);
    })
    .map((definition) => ({
      definitionId: definition.id,
      metAt: progressByKey.get(definition.key)?.metAt ?? null,
    }));

  if (completedUnawarded.length > 0) {
    const now = new Date();
    await db.studentBadge.createMany({
      data: completedUnawarded.map(({ definitionId, metAt }) => ({
        userId,
        definitionId,
        // A future or absent timestamp would defeat the point; clamp to now.
        awardedAt: metAt && metAt.getTime() <= now.getTime() ? metAt : now,
      })),
      skipDuplicates: true,
    });
    definitions = await loadDefinitions();
  }

  const holderCounts = await db.studentBadge.groupBy({
    by: ["definitionId"],
    _count: { userId: true },
  });
  const holdersByDefinition = new Map(holderCounts.map((row) => [row.definitionId, row._count.userId]));

  const badges = definitions.map((definition) => {
    const award = definition.awards[0] ?? null;
    const progress = progressByKey.get(definition.key) ?? null;
    return {
      id: definition.id,
      key: definition.key,
      name: definition.name,
      description: definition.description,
      icon: definition.icon,
      category: definition.category,
      kind: definition.kind,
      trigger: definition.trigger,
      threshold: definition.threshold,
      ruleKey: definition.ruleKey,
      active: definition.active,
      sortOrder: definition.sortOrder,
      earned: Boolean(award),
      awardedAt: award?.awardedAt.toISOString() ?? null,
      source: award?.source ?? null,
      note: award?.note ?? null,
      awardedByName: award?.awardedBy?.name ?? null,
      progressCurrent: progress?.current ?? null,
      progressTarget: progress?.target ?? null,
      // Served, not derived on each client. Web and iOS had their own copies of
      // a hardcoded rarity table, which is how they were free to disagree.
      holders: holdersByDefinition.get(definition.id) ?? 0,
      rarity: getBadgeRarity({
        key: definition.key,
        category: definition.category,
        kind: definition.kind,
        trigger: definition.trigger,
        threshold: definition.threshold,
        holders: holdersByDefinition.get(definition.id) ?? 0,
        eligible: eligibleUsers,
        createdAt: definition.createdAt,
      }),
    };
  });

  return {
    userId,
    peerVisible,
    earnedCount: badges.filter((badge) => badge.earned).length,
    totalCount: badges.filter((badge) => badge.active).length,
    badges,
    // The most engaging thing in the system was already being tracked and shown
    // to nobody: `BadgeStreak` has held current and longest per user since the
    // beginning, read only to fill a progress bar.
    streaks: streakRows
      .filter((row) => row.streakType !== "SCAN_SUCCESS_COUNT" && row.streakType !== "SCAN_CLEAN")
      .map((row) => ({
        type: row.streakType,
        current: row.current,
        longest: row.longest,
        lastEventAt: row.lastEventAt?.toISOString() ?? null,
      })),
  };
}

export async function awardBadgeManually(args: ManualAwardArgs) {
  const note = args.note?.trim() || null;

  const result = await db.$transaction(async (tx) => {
    const [target, definition] = await Promise.all([
      tx.user.findUnique({
        where: { id: args.userId },
        select: {
          id: true,
          name: true,
          role: true,
          active: true,
          notificationPrefs: true,
        },
      }),
      resolveManualAwardDefinition(tx, args),
    ]);

    if (!target || target.active === false) {
      throw new HttpError(404, "Active user not found");
    }
    if (!definition || !definition.active) {
      throw new HttpError(404, "Active badge definition not found");
    }

    const existing = await tx.studentBadge.findUnique({
      where: {
        userId_definitionId: {
          userId: args.userId,
          definitionId: definition.id,
        },
      },
      select: { id: true },
    });

    if (existing) {
      throw new HttpError(409, "Badge already awarded");
    }

    let award;
    try {
      award = await tx.studentBadge.create({
        data: {
          userId: args.userId,
          definitionId: definition.id,
          source: "MANUAL",
          awardedById: args.awardedById,
          note,
        },
        include: {
          definition: {
            select: {
              id: true,
              key: true,
              name: true,
              description: true,
              icon: true,
              category: true,
              kind: true,
              trigger: true,
              threshold: true,
              ruleKey: true,
              active: true,
              sortOrder: true,
            },
          },
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new HttpError(409, "Badge already awarded");
      }
      throw err;
    }

    const prefs = normalizePrefs(target.notificationPrefs);
    if (prefs.badges !== false) {
      await tx.notification.create({
        data: {
          userId: args.userId,
          type: "badge_awarded",
          title: "Badge awarded",
          body: `You earned ${definition.name}.`,
          payload: {
            userId: args.userId,
            badgeDefinitionId: definition.id,
            studentBadgeId: award.id,
            href: `/users/${args.userId}?tab=badges`,
          },
          channel: "IN_APP",
          sentAt: new Date(),
          dedupeKey: `badge_awarded_${award.id}`,
        },
      });
    }

    return award;
  });

  return result;
}

export async function revokeStudentBadge(args: { studentBadgeId: string; revokedById: string }) {
  const badge = await db.studentBadge.findUnique({
    where: { id: args.studentBadgeId },
    select: { id: true, source: true, userId: true, definitionId: true },
  });

  if (!badge) throw new HttpError(404, "Badge award not found");
  if (badge.source !== "MANUAL") throw new HttpError(409, "Only manually awarded badges can be revoked");

  await db.$transaction([
    db.studentBadge.delete({ where: { id: args.studentBadgeId } }),
    db.notification.deleteMany({ where: { dedupeKey: `badge_awarded_${args.studentBadgeId}` } }),
  ]);

  return badge;
}
