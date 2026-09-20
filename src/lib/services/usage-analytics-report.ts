import { db } from "@/lib/db";

const USAGE_ANALYTICS_PERIODS = [7, 30, 90] as const;

export function parseUsageAnalyticsPeriod(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return USAGE_ANALYTICS_PERIODS.includes(parsed as (typeof USAGE_ANALYTICS_PERIODS)[number]) ? parsed : 30;
}

export async function getUsageAnalyticsReport(days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const where = { occurredAt: { gte: since } };
  const [activeUsers, platforms, surfaces, events, versions] = await Promise.all([
    db.productEvent.groupBy({ by: ["actorHash"], where }),
    db.productEvent.groupBy({ by: ["platform"], where, _count: { _all: true }, orderBy: { _count: { platform: "desc" } } }),
    db.productEvent.groupBy({ by: ["surface"], where, _count: { _all: true }, orderBy: { _count: { surface: "desc" } } }),
    db.productEvent.groupBy({ by: ["eventName"], where, _count: { _all: true }, orderBy: { _count: { eventName: "desc" } } }),
    db.productEvent.groupBy({ by: ["platform", "appVersion"], where: { ...where, appVersion: { not: null } }, _count: { _all: true } }),
  ]);

  return {
    days,
    totalEvents: platforms.reduce((total, row) => total + row._count._all, 0),
    activeUsers: activeUsers.length,
    platforms: platforms.map((row) => ({ name: row.platform, count: row._count._all })),
    surfaces: surfaces.map((row) => ({ name: row.surface, count: row._count._all })),
    events: events.map((row) => ({ name: row.eventName, count: row._count._all })),
    versions: versions.map((row) => ({ platform: row.platform, version: row.appVersion, count: row._count._all }))
      .sort((a, b) => b.count - a.count).slice(0, 10),
  };
}
