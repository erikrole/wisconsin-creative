import { Prisma } from "@prisma/client";
import { loadAppStoreVersion } from "@/lib/apps-live-versions";
import { readCompanionPresence, type CompanionPresence } from "@/lib/companion-store";
import { db } from "@/lib/db";
import { getCrashCountsByVersion as getGroupedCrashCounts } from "@/lib/services/app-diagnostics";
import { env } from "@/lib/env";

type InstallationRecord = {
  platform: string;
  appVersion: string | null;
  appBuild: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  releaseChannel: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastOpenedAt: Date | null;
};

type BuildStatus = "latest" | "stale" | "ahead" | "development" | "unknown";

/**
 * The iPhone build everyone should be on. An explicit IOS_LATEST_APP_BUILD wins.
 * Otherwise the App Store listing names the live version, and the newest build
 * any client reports for that version is its build. As a last resort, the newest
 * App Store build seen. Each source is labeled so the page never presents a
 * guess as configuration.
 */
export type LatestIosBuild = {
  version: string | null;
  build: string;
  source: "configured" | "app_store" | "observed";
};

const APP_ACTIVITY_PERIODS = [7, 30, 90] as const;
const ACTIVE_WINDOW_MS = 7 * 86_400_000;
// A phone not heard from in this long was most likely replaced or had the app
// deleted; it stays visible but stops counting toward version stats.
const DORMANT_AFTER_MS = 60 * 86_400_000;
const ACTIVITY_PLATFORMS = ["web", "ios", "macos", "kiosk"] as const;
type ActivityPlatform = (typeof ACTIVITY_PLATFORMS)[number];

export function parseAppActivityPeriod(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return APP_ACTIVITY_PERIODS.includes(parsed as (typeof APP_ACTIVITY_PERIODS)[number]) ? parsed : 30;
}

function numericBuild(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function configuredLatestIosBuild(): LatestIosBuild | null {
  const build = process.env.IOS_LATEST_APP_BUILD?.trim();
  if (!build) return null;
  return {
    version: process.env.IOS_LATEST_APP_VERSION?.trim() || null,
    build,
    source: "configured",
  };
}

async function resolveLatestIosBuild(clients: InstallationRecord[]): Promise<LatestIosBuild | null> {
  const configured = configuredLatestIosBuild();
  if (configured) return configured;

  const shipped = clients.filter((client) => client.platform === "ios" && client.releaseChannel !== "development");
  const newest = (rows: InstallationRecord[]) =>
    rows.reduce<InstallationRecord | null>((best, row) => {
      const build = numericBuild(row.appBuild);
      if (build === null) return best;
      return !best || build > (numericBuild(best.appBuild) ?? -1) ? row : best;
    }, null);

  const store = await loadAppStoreVersion();
  if (store) {
    const match = newest(shipped.filter((client) => client.appVersion === store.version));
    if (match?.appBuild) return { version: store.version, build: match.appBuild, source: "app_store" };
  }

  const observed = newest(shipped.filter((client) => client.releaseChannel === "app_store"));
  return observed?.appBuild ? { version: observed.appVersion, build: observed.appBuild, source: "observed" } : null;
}

function iosBuildStatus(client: InstallationRecord, latest: LatestIosBuild | null): BuildStatus | null {
  if (client.platform !== "ios") return null;
  // Local Xcode builds are never "behind"; they are whatever is on the desk.
  if (client.releaseChannel === "development") return "development";
  if (!latest || !client.appBuild) return "unknown";
  if (client.appBuild === latest.build) return "latest";

  // Build numbers only ever go up across versions, so the build alone orders them.
  const current = numericBuild(client.appBuild);
  const expected = numericBuild(latest.build);
  if (current !== null && expected !== null) return current < expected ? "stale" : "ahead";
  return "unknown";
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function latestDate(values: Array<Date | null>): Date | null {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value > latest) return value;
    return latest;
  }, null);
}

function isActivityPlatform(value: string): value is ActivityPlatform {
  return (ACTIVITY_PLATFORMS as readonly string[]).includes(value);
}

type DailyRow = { day: string; platform: string; people: number };
type VersionDayRow = { day: string; version: string; people: number };

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
type PlatformRow = { platform: string; people: number; events: number };

/**
 * Pseudonymous usage over time from product_events. People are counted by the
 * yearly-rotated actor hash, so a window that crosses New Year can count someone
 * twice; nothing here links back to a named user.
 */
async function activitySection(days: number, timeZone: string) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [daily, platforms, overall, surfaces, versionDays] = await Promise.all([
    db.$queryRaw<DailyRow[]>(Prisma.sql`
      SELECT to_char((occurred_at AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS day,
             platform,
             COUNT(DISTINCT actor_hash)::int AS people
      FROM product_events
      WHERE occurred_at >= ${since}
      GROUP BY 1, 2
    `),
    db.$queryRaw<PlatformRow[]>(Prisma.sql`
      SELECT platform,
             COUNT(DISTINCT actor_hash)::int AS people,
             COUNT(*)::int AS events
      FROM product_events
      WHERE occurred_at >= ${since}
      GROUP BY platform
    `),
    db.$queryRaw<Array<{ people: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT actor_hash)::int AS people
      FROM product_events
      WHERE occurred_at >= ${since}
    `),
    db.productEvent.groupBy({
      by: ["platform", "surface"],
      where: { occurredAt: { gte: since }, eventName: "surface_viewed" },
      _count: { _all: true },
    }),
    // iPhone people per app version per day, for the release adoption curve.
    db.$queryRaw<VersionDayRow[]>(Prisma.sql`
      SELECT to_char((occurred_at AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS day,
             app_version AS version,
             COUNT(DISTINCT actor_hash)::int AS people
      FROM product_events
      WHERE occurred_at >= ${since} AND platform = 'ios' AND app_version IS NOT NULL
      GROUP BY 1, 2
    `),
  ]);

  const dayKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
  const series = new Map<string, Record<ActivityPlatform, number>>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    series.set(dayKey(new Date(Date.now() - offset * 86_400_000)), { web: 0, ios: 0, macos: 0, kiosk: 0 });
  }
  for (const row of daily) {
    const bucket = series.get(row.day);
    if (bucket && isActivityPlatform(row.platform)) bucket[row.platform] = Number(row.people);
  }

  const surfaceTotals = new Map<string, { surface: string; web: number; ios: number; total: number }>();
  for (const row of surfaces) {
    const entry = surfaceTotals.get(row.surface) ?? { surface: row.surface, web: 0, ios: 0, total: 0 };
    if (row.platform === "web") entry.web += row._count._all;
    if (row.platform === "ios") entry.ios += row._count._all;
    entry.total += row._count._all;
    surfaceTotals.set(row.surface, entry);
  }

  // Newest three versions by name; everything older folds into "Older".
  const versionNames = [...new Set((versionDays ?? []).map((row) => row.version))].sort((a, b) => compareVersions(b, a));
  const named = versionNames.slice(0, 3);
  const adoptionDays = [...series.keys()].map((date) => ({ date, counts: {} as Record<string, number> }));
  const adoptionIndex = new Map(adoptionDays.map((day, index) => [day.date, index]));
  for (const row of versionDays ?? []) {
    const position = adoptionIndex.get(row.day);
    if (position === undefined) continue;
    const key = named.includes(row.version) ? row.version : "Older";
    const counts = adoptionDays[position]!.counts;
    counts[key] = (counts[key] ?? 0) + Number(row.people);
  }
  const adoptionVersions = versionNames.length > named.length ? [...named, "Older"] : named;

  return {
    days,
    people: Number(overall[0]?.people ?? 0),
    adoption: { versions: adoptionVersions, daily: adoptionDays },
    daily: [...series.entries()].map(([date, counts]) => ({ date, ...counts })),
    platforms: ACTIVITY_PLATFORMS.map((platform) => {
      const row = platforms.find((candidate) => candidate.platform === platform);
      return { platform, people: Number(row?.people ?? 0), events: Number(row?.events ?? 0) };
    }),
    surfaces: [...surfaceTotals.values()].sort((a, b) => b.total - a.total).slice(0, 8),
  };
}

export type CrashCount = {
  platform: string;
  appVersion: string | null;
  appBuild: string | null;
  kind: string;
  count: number;
};

/** Crash and hang counts per app version and build, from the grouped error reports. */
async function getCrashCountsByVersion(days: number): Promise<CrashCount[]> {
  const rows = await getGroupedCrashCounts(days);
  return rows.filter((row) => row.kind === "crash" || row.kind === "hang");
}

const FIRST_OPEN_WEEKS = 12;
const WEEK_MS = 7 * 86_400_000;

/**
 * How many people first opened any app each week, and how many recently added
 * people still haven't. A hiring day should show up as a spike, then a catch-up.
 */
function firstOpensByWeek(
  users: Array<{ role: string; addedAt: string; firstSeenAt: string | null; active: boolean }>,
  now: number,
) {
  const weeks = Array.from({ length: FIRST_OPEN_WEEKS }, (_, index) => ({
    weekStart: new Date(now - (FIRST_OPEN_WEEKS - index) * WEEK_MS).toISOString(),
    students: 0,
    others: 0,
  }));
  for (const user of users) {
    if (!user.firstSeenAt) continue;
    const age = now - new Date(user.firstSeenAt).getTime();
    const index = FIRST_OPEN_WEEKS - 1 - Math.floor(age / WEEK_MS);
    const week = weeks[index];
    if (!week) continue;
    if (user.role === "STUDENT") week.students += 1;
    else week.others += 1;
  }
  const recent = users.filter((user) => user.active && now - new Date(user.addedAt).getTime() <= 30 * 86_400_000);
  return {
    weeks,
    addedLast30Days: recent.length,
    openedOfAdded: recent.filter((user) => user.firstSeenAt).length,
  };
}

function menuBarClient(record: CompanionPresence): InstallationRecord {
  return {
    platform: "macos",
    appVersion: record.appVersion,
    appBuild: null,
    osVersion: record.osVersion,
    deviceModel: null,
    releaseChannel: null,
    firstSeenAt: new Date(record.firstSeenAt),
    lastSeenAt: new Date(record.lastSeenAt),
    lastOpenedAt: new Date(record.lastSeenAt),
  };
}

/** Menu bar days come from Redis presence; "events" for it means days of use. */
function withMenuBar(
  activity: Awaited<ReturnType<typeof activitySection>> | null,
  presence: Map<string, CompanionPresence>,
  days: number,
) {
  if (!activity || presence.size === 0) return activity;
  const window = new Set(activity.daily.map((day) => day.date));
  let people = 0;
  let personDays = 0;
  const daily = activity.daily.map((day) => ({ ...day, macos: 0 }));
  const index = new Map(daily.map((day, position) => [day.date, position]));
  for (const record of presence.values()) {
    const used = record.days.filter((day) => window.has(day));
    if (used.length > 0) people += 1;
    personDays += used.length;
    for (const day of used) {
      const position = index.get(day);
      if (position !== undefined) daily[position]!.macos += 1;
    }
  }
  return {
    ...activity,
    days,
    daily,
    platforms: activity.platforms.map((row) =>
      row.platform === "macos" ? { ...row, people, events: personDays } : row,
    ),
  };
}

export async function getAppActivityReport(days = 30) {
  const timeZone = env.appTimezone;
  const usersPromise = db.user.findMany({
    where: { hiddenFromRoster: false },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
      // Push reachability: an iPhone with no live token can't get notifications.
      deviceTokens: { where: { revokedAt: null, platform: "IOS" }, select: { id: true }, take: 1 },
      webPushSubscriptions: { where: { revokedAt: null }, select: { id: true }, take: 1 },
      appInstallations: {
        orderBy: { lastSeenAt: "desc" },
        select: {
          platform: true,
          appVersion: true,
          appBuild: true,
          osVersion: true,
          deviceModel: true,
          releaseChannel: true,
          firstSeenAt: true,
          lastSeenAt: true,
          lastOpenedAt: true,
        },
      },
    },
  });
  // Activity is a nice-to-have; a slow or failing aggregate must not hide who is on which build.
  const activityPromise = activitySection(days, timeZone).catch((error) => {
    console.error("Failed to build app activity trend", error);
    return null;
  });

  // The menu bar companion lives in Redis so it never wakes Neon; merge it in here.
  const presencePromise = readCompanionPresence().catch((error) => {
    console.error("Failed to read menu bar presence", error);
    return new Map<string, CompanionPresence>();
  });

  const kiosksPromise = db.kioskDevice.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { name: true, appVersion: true, appBuild: true, osVersion: true, lastSeenAt: true },
  }).catch((error) => {
    console.error("Failed to read kiosk builds", error);
    return [];
  });
  const crashesPromise = getCrashCountsByVersion(days).catch((error) => {
    console.error("Failed to read crash counts", error);
    return null;
  });

  const [users, presence, kiosks, crashes] = await Promise.all([usersPromise, presencePromise, kiosksPromise, crashesPromise]);
  const latestIosBuild = await resolveLatestIosBuild(users.flatMap((user) => user.appInstallations as InstallationRecord[]));
  const now = Date.now();

  const reportUsers = users.map((user) => {
    const menuBar = presence.get(user.id);
    const clients = [
      ...(user.appInstallations as InstallationRecord[]),
      ...(menuBar ? [menuBarClient(menuBar)] : []),
    ];
    const lastUsedAt = latestDate(clients.map((client) => client.lastOpenedAt));
    const lastSeenAt = latestDate(clients.map((client) => client.lastSeenAt));

    const firstSeenAt = clients.reduce<Date | null>(
      (earliest, client) => (!earliest || client.firstSeenAt < earliest ? client.firstSeenAt : earliest),
      null,
    );

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      addedAt: user.createdAt.toISOString(),
      firstSeenAt: iso(firstSeenAt),
      iosPush: user.deviceTokens.length > 0,
      webPush: user.webPushSubscriptions.length > 0,
      used: Boolean(lastUsedAt),
      lastUsedAt: iso(lastUsedAt),
      lastSeenAt: iso(lastSeenAt),
      clients: clients.map((client) => ({
        platform: client.platform,
        appVersion: client.appVersion,
        appBuild: client.appBuild,
        osVersion: client.osVersion,
        deviceModel: client.deviceModel,
        releaseChannel: client.releaseChannel,
        firstSeenAt: client.firstSeenAt.toISOString(),
        lastSeenAt: client.lastSeenAt.toISOString(),
        lastOpenedAt: iso(client.lastOpenedAt),
        buildStatus: iosBuildStatus(client, latestIosBuild),
        dormant: now - client.lastSeenAt.getTime() > DORMANT_AFTER_MS,
      })),
    };
  });

  const clients = reportUsers.flatMap((user) => user.clients);
  const allIosClients = clients.filter((client) => client.platform === "ios");
  const iosClients = allIosClients.filter((client) => !client.dormant);
  const hasLiveIos = (user: (typeof reportUsers)[number]) =>
    user.clients.some((client) => client.platform === "ios" && !client.dormant);
  const usersWith = (predicate: (user: (typeof reportUsers)[number]) => boolean) =>
    reportUsers.filter(predicate).length;
  const seenSince = (client: (typeof clients)[number], windowMs: number) =>
    now - new Date(client.lastSeenAt).getTime() <= windowMs;

  const versionMap = new Map<string, {
    version: string | null;
    build: string | null;
    channel: string | null;
    status: BuildStatus | null;
    installs: number;
  }>();
  for (const client of iosClients) {
    const key = `${client.appVersion}:${client.appBuild}:${client.releaseChannel}`;
    const entry = versionMap.get(key) ?? {
      version: client.appVersion,
      build: client.appBuild,
      channel: client.releaseChannel,
      status: client.buildStatus,
      installs: 0,
    };
    entry.installs += 1;
    versionMap.set(key, entry);
  }

  const osMap = new Map<string, number>();
  for (const client of iosClients) {
    const major = client.osVersion?.split(".")[0];
    const label = major ? `iOS ${major}` : "Unknown";
    osMap.set(label, (osMap.get(label) ?? 0) + 1);
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalUsers: reportUsers.length,
      usedUsers: usersWith((user) => user.used),
      neverUsedUsers: usersWith((user) => !user.used),
      activeUsers: usersWith((user) => user.clients.some((client) => seenSince(client, ACTIVE_WINDOW_MS))),
      iosUsers: usersWith(hasLiveIos),
      webUsers: usersWith((user) => user.clients.some((client) => client.platform === "web")),
      macosUsers: usersWith((user) => user.clients.some((client) => client.platform === "macos")),
      iosInstallations: iosClients.length,
      latestIosInstallations: iosClients.filter((client) => client.buildStatus === "latest").length,
      staleIosInstallations: iosClients.filter((client) => client.buildStatus === "stale").length,
      developmentIosInstallations: iosClients.filter((client) => client.buildStatus === "development").length,
      oldTestflightInstallations: iosClients.filter(
        (client) => client.releaseChannel === "testflight" && client.buildStatus === "stale",
      ).length,
      // Someone with the iPhone app but no live push token can't be reached by a shift alert.
      iosPushOffUsers: usersWith((user) => !user.iosPush && hasLiveIos(user)),
      dormantIosInstallations: allIosClients.length - iosClients.length,
      unclassifiedIosInstallations: iosClients.filter((client) => client.buildStatus === "unknown").length,
      testflightInstallations: iosClients.filter((client) => client.releaseChannel === "testflight").length,
      appStoreInstallations: iosClients.filter((client) => client.releaseChannel === "app_store").length,
      webInstallations: clients.filter((client) => client.platform === "web").length,
    },
    latestIosBuild,
    versions: [...versionMap.values()].sort(
      (a, b) => (numericBuild(b.build) ?? -1) - (numericBuild(a.build) ?? -1) || b.installs - a.installs,
    ),
    osVersions: [...osMap.entries()]
      .map(([label, installs]) => ({ label, installs }))
      .sort((a, b) => b.installs - a.installs),
    activity: withMenuBar(await activityPromise, presence, days),
    firstOpens: firstOpensByWeek(reportUsers, now),
    crashes,
    kiosks: kiosks.map((kiosk) => ({
      name: kiosk.name,
      appVersion: kiosk.appVersion,
      appBuild: kiosk.appBuild,
      osVersion: kiosk.osVersion,
      lastSeenAt: iso(kiosk.lastSeenAt),
    })),
    users: reportUsers,
  };
}
