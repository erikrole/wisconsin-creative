import { db } from "@/lib/db";

const USAGE_ANALYTICS_PERIODS = [7, 30, 90] as const;

export function parseUsageAnalyticsPeriod(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return USAGE_ANALYTICS_PERIODS.includes(parsed as (typeof USAGE_ANALYTICS_PERIODS)[number]) ? parsed : 30;
}

type CountRow = { name: string; count: number };

function tally(values: string[]): CountRow[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

function tag(properties: unknown, key: "source" | "mode" | "reason"): string {
  const value = properties && typeof properties === "object" ? (properties as Record<string, unknown>)[key] : null;
  return typeof value === "string" ? value : "unknown";
}

/**
 * Notification health for the same period: what happened to each push, whether
 * installs can receive them, what people mute, and how they respond.
 */
async function notificationSection(since: Date) {
  const [deliveries, events] = await Promise.all([
    db.notificationDelivery.groupBy({
      by: ["channel", "outcome", "reason"],
      where: { occurredAt: { gte: since } },
      _count: { _all: true },
    }),
    db.productEvent.findMany({
      where: {
        occurredAt: { gte: since },
        eventName: { in: ["push_status", "notification_pref_changed", "notification_opened", "notification_action"] },
      },
      select: { eventName: true, properties: true },
      orderBy: { occurredAt: "desc" },
      take: 20_000,
    }),
  ]);
  const of = (name: string) => events.filter((event) => event.eventName === name);
  const responses = [...of("notification_opened"), ...of("notification_action")];

  return {
    deliveries: deliveries
      .map((row) => ({
        name: [row.channel, row.outcome, row.reason].filter(Boolean).join(" · "),
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    pushReadiness: tally(of("push_status").map((event) => `${tag(event.properties, "mode")} · ${tag(event.properties, "reason")}`)),
    preferenceChanges: tally(of("notification_pref_changed").map((event) => `${tag(event.properties, "source")} · ${tag(event.properties, "mode")}`)),
    responses: tally(responses.map((event) => `${tag(event.properties, "mode")} · ${tag(event.properties, "source")}`)),
    timeToAct: tally(responses.map((event) => tag(event.properties, "reason"))),
  };
}

/** Background jobs and app crashes/hangs for the same period. */
async function healthSection(since: Date) {
  const [jobs, diagnostics] = await Promise.all([
    db.jobRun.groupBy({
      by: ["job", "outcome", "latenessBucket"],
      where: { occurredAt: { gte: since } },
      _count: { _all: true },
    }),
    db.appDiagnostic.groupBy({
      by: ["kind", "signature", "appVersion"],
      where: { receivedAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);
  const sorted = (rows: CountRow[]) => rows.sort((a, b) => b.count - a.count);
  return {
    jobs: sorted(jobs.map((row) => ({
      name: [row.job, row.outcome, row.latenessBucket].filter(Boolean).join(" · "),
      count: row._count._all,
    }))),
    diagnostics: sorted(diagnostics.map((row) => ({
      name: [row.kind, row.signature, row.appVersion].filter(Boolean).join(" · "),
      count: row._count._all,
    }))).slice(0, 20),
  };
}

export async function getUsageAnalyticsReport(days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const where = { occurredAt: { gte: since } };
  const [activeUsers, platforms, surfaces, events, versions, notifications, health] = await Promise.all([
    db.productEvent.groupBy({ by: ["actorHash"], where }),
    db.productEvent.groupBy({ by: ["platform"], where, _count: { _all: true }, orderBy: { _count: { platform: "desc" } } }),
    db.productEvent.groupBy({ by: ["surface"], where, _count: { _all: true }, orderBy: { _count: { surface: "desc" } } }),
    db.productEvent.groupBy({ by: ["eventName"], where, _count: { _all: true }, orderBy: { _count: { eventName: "desc" } } }),
    db.productEvent.groupBy({ by: ["platform", "appVersion"], where: { ...where, appVersion: { not: null } }, _count: { _all: true } }),
    notificationSection(since),
    healthSection(since),
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
    notifications,
    health,
  };
}
