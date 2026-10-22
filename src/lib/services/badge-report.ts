import { db } from "@/lib/db";

const BADGE_REPORT_PERIODS = [30, 90, 365] as const;

const BADGE_REPORT_DEFAULT_PERIOD = 30;

export function parseBadgeReportPeriod(value: string | null | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return BADGE_REPORT_PERIODS.includes(parsed as (typeof BADGE_REPORT_PERIODS)[number])
    ? parsed
    : BADGE_REPORT_DEFAULT_PERIOD;
}

export async function getBadgeReport(days: number = BADGE_REPORT_DEFAULT_PERIOD) {
  const since = new Date(Date.now() - days * 86_400_000);
  const previousSince = new Date(Date.now() - days * 2 * 86_400_000);

  const [
    totalAwards,
    manualAwards,
    recentAwardCount,
    previousRecentAwardCount,
    activeDefinitions,
    leaderboard,
    distribution,
    recentAwards,
  ] = await Promise.all([
    db.studentBadge.count(),
    db.studentBadge.count({ where: { source: "MANUAL" } }),
    db.studentBadge.count({ where: { awardedAt: { gte: since } } }),
    db.studentBadge.count({ where: { awardedAt: { gte: previousSince, lt: since } } }),
    db.badgeDefinition.findMany({
      where: { active: true },
      select: { id: true, key: true, name: true, category: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.studentBadge.groupBy({
      by: ["userId"],
      _count: true,
      orderBy: { _count: { userId: "desc" } },
      take: 10,
    }),
    db.studentBadge.groupBy({
      by: ["definitionId"],
      _count: true,
      orderBy: { _count: { definitionId: "desc" } },
      take: 12,
    }),
    db.studentBadge.findMany({
      orderBy: { awardedAt: "desc" },
      take: 20,
      include: {
        user: { select: { id: true, name: true, email: true } },
        definition: {
          select: {
            id: true,
            key: true,
            name: true,
            category: true,
            icon: true,
            active: true,
          },
        },
        awardedBy: { select: { id: true, name: true } },
      },
    }),
  ]);

  const userIds = leaderboard.map((row) => row.userId);
  const definitionIds = distribution.map((row) => row.definitionId);
  const [users, definitions] = await Promise.all([
    userIds.length > 0
      ? db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [],
    definitionIds.length > 0
      ? db.badgeDefinition.findMany({
          where: { id: { in: definitionIds } },
          select: { id: true, key: true, name: true, category: true, active: true },
        })
      : [],
  ]);
  const userMap = Object.fromEntries(users.map((user) => [user.id, user]));
  const definitionMap = Object.fromEntries(definitions.map((definition) => [definition.id, definition]));
  const distributionCountMap = new Map(distribution.map((row) => [row.definitionId, row._count]));
  const underusedDefinitions = activeDefinitions
    .map((definition) => ({
      definitionId: definition.id,
      key: definition.key,
      name: definition.name,
      category: definition.category,
      count: distributionCountMap.get(definition.id) ?? 0,
    }))
    .sort((a, b) => a.count - b.count || a.name.localeCompare(b.name))
    .slice(0, 8);

  return {
    totalAwards,
    manualAwards,
    automaticAwards: totalAwards - manualAwards,
    manualAwardRate: totalAwards > 0 ? manualAwards / totalAwards : 0,
    days,
    recentAwardCount,
    previousRecentAwardCount,
    activeDefinitionCount: activeDefinitions.length,
    leaderboard: leaderboard.map((row) => {
      const user = userMap[row.userId];
      return {
        userId: row.userId,
        name: user?.name ?? "Unknown user",
        email: user?.email ?? null,
        count: row._count,
      };
    }),
    distribution: distribution.map((row) => {
      const definition = definitionMap[row.definitionId];
      return {
        definitionId: row.definitionId,
        key: definition?.key ?? "unknown",
        name: definition?.name ?? "Unknown badge",
        category: definition?.category ?? "MILESTONE",
        active: definition?.active ?? false,
        count: row._count,
      };
    }),
    recentAwards: recentAwards.map((award) => ({
      id: award.id,
      awardedAt: award.awardedAt.toISOString(),
      source: award.source,
      note: award.note,
      user: award.user,
      definition: award.definition,
      awardedBy: award.awardedBy,
    })),
    underusedDefinitions,
  };
}
