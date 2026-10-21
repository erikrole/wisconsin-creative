"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BellOff, Globe, Hammer, Laptop, Monitor, RefreshCw, Search, ShieldCheck, Smartphone } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFetch } from "@/hooks/use-fetch";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SettingsPageShell } from "../SettingsPageShell";
import {
  PLATFORM_LABELS,
  SURFACE_LABELS,
  buildStatusLabel,
  buildStatusTone,
  channelLabel,
  deviceName,
  distinctWebClients,
  groupIosClients,
  initials,
  shortDay,
  versionLabel,
  type BuildStatus,
  type ClientPlatform,
} from "./format";

type AppClient = {
  platform: string;
  appVersion: string | null;
  appBuild: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  releaseChannel: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastOpenedAt: string | null;
  buildStatus: BuildStatus;
  /** Not heard from in 60 days: shown, but left out of version stats. */
  dormant: boolean;
};

type AppActivityUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  addedAt: string;
  firstSeenAt: string | null;
  iosPush: boolean;
  webPush: boolean;
  used: boolean;
  lastUsedAt: string | null;
  lastSeenAt: string | null;
  clients: AppClient[];
};

type DailyActivity = { date: string } & Record<ClientPlatform, number>;

type AppActivityReport = {
  generatedAt: string;
  summary: {
    totalUsers: number;
    usedUsers: number;
    neverUsedUsers: number;
    activeUsers: number;
    iosUsers: number;
    webUsers: number;
    macosUsers: number;
    iosInstallations: number;
    latestIosInstallations: number;
    staleIosInstallations: number;
    developmentIosInstallations: number;
    oldTestflightInstallations: number;
    dormantIosInstallations: number;
    iosPushOffUsers: number;
    unclassifiedIosInstallations: number;
    testflightInstallations: number;
    appStoreInstallations: number;
    webInstallations: number;
  };
  latestIosBuild: { version: string | null; build: string | null; source: "configured" | "app_store" | "observed" } | null;
  versions: Array<{
    version: string | null;
    build: string | null;
    channel: string | null;
    status: BuildStatus;
    installs: number;
  }>;
  osVersions: Array<{ label: string; installs: number }>;
  activity: {
    days: number;
    people: number;
    daily: DailyActivity[];
    platforms: Array<{ platform: ClientPlatform; people: number; events: number }>;
    surfaces: Array<{ surface: string; web: number; ios: number; total: number }>;
    adoption: { versions: string[]; daily: Array<{ date: string; counts: Record<string, number> }> };
  } | null;
  firstOpens: {
    weeks: Array<{ weekStart: string; students: number; others: number }>;
    addedLast30Days: number;
    openedOfAdded: number;
  };
  crashes: Array<{ platform: string; appVersion: string | null; appBuild: string | null; kind: string; count: number }> | null;
  kiosks: Array<{ name: string; appVersion: string | null; appBuild: string | null; osVersion: string | null; lastSeenAt: string | null }>;
  users: AppActivityUser[];
};

const PERIODS = [7, 30, 90] as const;
const PLATFORM_ORDER: ClientPlatform[] = ["web", "ios", "macos", "kiosk"];
const PLATFORM_FILL: Record<ClientPlatform, string> = {
  web: "var(--aa-web)",
  ios: "var(--aa-ios)",
  macos: "var(--aa-macos)",
  kiosk: "var(--aa-kiosk)",
};

const card = "rounded-2xl border bg-card p-5";
const eyebrow = "text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground";
// Platform hues from format.ts as theme-aware custom properties.
const paletteVars =
  "[--aa-web:#3E63DD] [--aa-ios:#12A594] [--aa-macos:#8E4EC6] [--aa-kiosk:#F76B15] " +
  "dark:[--aa-web:#5F7FE6] dark:[--aa-ios:#139E85] dark:[--aa-macos:#9D6BD6] dark:[--aa-kiosk:#D66A22] " +
  // Sequential teal for versions, newest darkest; "Older" is neutral.
  "[--aa-v0:#0B6E62] [--aa-v1:#12A594] [--aa-v2:#7FD3C6] [--aa-older:#C4C6CE] " +
  "dark:[--aa-v0:#3FD0B8] dark:[--aa-v1:#18917F] dark:[--aa-v2:#13574E] dark:[--aa-older:#45474D]";
const VERSION_FILLS = ["var(--aa-v0)", "var(--aa-v1)", "var(--aa-v2)"];

const DESCRIPTION = "Which versions people run and how they use the site, the iPhone app, and the menu bar.";

type PeopleFilter = "all" | "behind" | "oldbeta" | "pushoff" | "ios" | "web" | "macos" | "never";
const PEOPLE_FILTERS: PeopleFilter[] = ["all", "behind", "oldbeta", "pushoff", "ios", "web", "macos", "never"];

export default function AppActivityPage() {
  const [days, setDays] = useState<number>(30);
  const { data, loading, refreshing, error, reload } = useFetch<AppActivityReport>({
    url: `/api/settings/app-activity?days=${days}`,
    returnTo: "/settings/app-activity",
    keepPreviousData: true,
  });

  const actions = (
    <>
      <ToggleGroup
        type="single"
        value={String(days)}
        onValueChange={(next) => next && setDays(Number(next))}
        aria-label="Activity period"
      >
        {PERIODS.map((period) => (
          <ToggleGroupItem key={period} value={String(period)} aria-label={`Last ${period} days`}>
            {period}d
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Button className="h-10" type="button" variant="outline" onClick={reload} disabled={refreshing} aria-label="Refresh">
        <RefreshCw className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} />
      </Button>
    </>
  );

  if (loading && !data) return <AppActivityLoading />;

  if (error && !data) {
    return (
      <SettingsPageShell href="/settings/app-activity" description={DESCRIPTION}>
        <section className={cn(card, "flex flex-col items-start gap-3")}>
          <p className="font-bold">Could not load app activity</p>
          <p className="text-sm text-muted-foreground">
            Check the connection or confirm the report migration is deployed, then try again.
          </p>
          <Button className="h-10" type="button" variant="outline" onClick={reload}>
            Try again
          </Button>
        </section>
      </SettingsPageShell>
    );
  }

  if (!data) return null;

  return (
    <SettingsPageShell href="/settings/app-activity" description={DESCRIPTION} actions={actions}>
      <AppActivityBody data={data} days={days} />
    </SettingsPageShell>
  );
}

function AppActivityBody({ data, days }: { data: AppActivityReport; days: number }) {
  const { summary, latestIosBuild } = data;
  const now = new Date(data.generatedAt);
  const currentLabel = latestIosBuild ? versionLabel(latestIosBuild.version, latestIosBuild.build) : null;
  const shippedIos = summary.iosInstallations - summary.developmentIosInstallations;
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const showPeople = (next: PeopleFilter) => {
    setFilter(next);
    document.getElementById("app-activity-people")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className={cn("flex flex-col gap-4", paletteVars)}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Active this week"
          value={summary.activeUsers}
          of={summary.totalUsers}
          detail="People seen on any app in the last 7 days"
        />
        <StatTile
          label="On the current build"
          value={summary.latestIosInstallations}
          of={shippedIos}
          detail={currentLabel ? `iPhones on ${currentLabel}` : "No App Store build seen yet"}
          tone="green"
        />
        <StatTile
          label="Behind"
          value={summary.staleIosInstallations}
          detail={summary.staleIosInstallations === 1 ? "iPhone needs an update" : "iPhones need an update"}
          tone={summary.staleIosInstallations > 0 ? "orange" : undefined}
        />
        <StatTile
          label="Never opened"
          value={summary.neverUsedUsers}
          detail={summary.neverUsedUsers === 1 ? "Person on the roster" : "People on the roster"}
        />
      </div>

      <AttentionCard data={data} days={days} onShow={showPeople} />

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <DailyActivityCard activity={data.activity} days={days} />
        <PlatformsCard activity={data.activity} days={days} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <VersionsCard data={data} />
        <SurfacesCard activity={data.activity} days={days} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <AdoptionCard activity={data.activity} days={days} />
        <CrashesCard crashes={data.crashes} days={days} />
      </div>

      <div className={cn("grid gap-4", data.kiosks.length > 0 && "lg:grid-cols-[1.6fr_1fr]")}>
        <FirstOpensCard firstOpens={data.firstOpens} />
        {data.kiosks.length > 0 && <KiosksCard kiosks={data.kiosks} now={now} />}
      </div>

      <PeopleCard users={data.users} now={now} filter={filter} onFilter={setFilter} />

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0" />
        Coarse client details only (no device IDs or ad IDs). Trends are counted by a pseudonymous key; the people list
        comes from each signed-in app. Updated {formatRelativeTime(data.generatedAt, new Date())}.
      </p>
    </div>
  );
}

function StatTile({
  label,
  value,
  of,
  detail,
  tone,
}: {
  label: string;
  value: number;
  of?: number;
  detail: string;
  tone?: "green" | "orange";
}) {
  const pct = of && of > 0 ? Math.round((value / of) * 100) : null;
  return (
    <section className={cn(card, "flex min-h-[124px] flex-col justify-between gap-3 p-4 sm:p-5")} aria-label={label}>
      <div className={eyebrow}>{label}</div>
      <div>
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              "text-[30px] font-black leading-none tracking-[-0.04em] tabular-nums",
              tone === "orange" && "text-[var(--orange-text)]",
            )}
          >
            {value}
          </span>
          {of !== undefined && <span className="text-sm text-muted-foreground tabular-nums">of {of}</span>}
        </div>
        {pct !== null && (
          <div className="mt-2.5 h-1.5 rounded-full bg-muted" aria-hidden="true">
            <div
              className={cn("h-1.5 rounded-full", tone === "green" ? "bg-[var(--green-text)]" : "bg-[var(--accent)]")}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        <p className="mt-2 text-xs leading-snug text-muted-foreground">{detail}</p>
      </div>
    </section>
  );
}

function Legend({ platforms }: { platforms: ClientPlatform[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {platforms.map((platform) => (
        <span key={platform} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: PLATFORM_FILL[platform] }} aria-hidden="true" />
          {PLATFORM_LABELS[platform]}
        </span>
      ))}
    </div>
  );
}

function shownPlatforms(activity: NonNullable<AppActivityReport["activity"]>): ClientPlatform[] {
  // Web and iPhone always show; the menu bar and kiosk appear once they report.
  return PLATFORM_ORDER.filter(
    (platform) => platform === "web" || platform === "ios" || activity.platforms.some((row) => row.platform === platform && row.events > 0),
  );
}

function DailyActivityCard({ activity, days }: { activity: AppActivityReport["activity"]; days: number }) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (!activity) {
    return (
      <section className={card} aria-label="Daily active people">
        <div className={eyebrow}>Daily active people</div>
        <p className="mt-3 text-sm text-muted-foreground">The activity trend could not be loaded. The rest of the report is current.</p>
      </section>
    );
  }

  const platforms = shownPlatforms(activity);
  const totals = activity.daily.map((day) => platforms.reduce((sum, platform) => sum + day[platform], 0));
  const peak = Math.max(...totals, 1);
  const average = totals.length ? totals.reduce((sum, value) => sum + value, 0) / totals.length : 0;
  const focus = hovered ?? activity.daily.length - 1;
  const focusDay = activity.daily[focus];
  const height = 160;
  const labelEvery = days <= 7 ? 1 : days <= 30 ? 7 : 21;

  return (
    <section className={card} aria-label="Daily active people">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={eyebrow}>Daily active people</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-[26px] font-black leading-none tracking-[-0.03em] tabular-nums">{average.toFixed(1)}</span>
            <span className="text-sm text-muted-foreground">a day on average · {activity.people} people in {days} days</span>
          </div>
        </div>
        <Legend platforms={platforms} />
      </div>

      <div className="mt-4 min-h-[38px] text-xs" aria-live="polite">
        {focusDay && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-bold text-foreground">{shortDay(focusDay.date)}</span>
            {platforms.map((platform) => (
              <span key={platform} className="flex items-center gap-1 text-muted-foreground">
                <span className="size-1.5 rounded-full" style={{ background: PLATFORM_FILL[platform] }} aria-hidden="true" />
                {PLATFORM_LABELS[platform]} <span className="font-bold tabular-nums text-foreground">{focusDay[platform]}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div
        className="relative mt-1 flex items-end gap-[2px]"
        style={{ height }}
        role="img"
        aria-label={`Daily active people by platform over the last ${days} days. Peak ${peak} in a day.`}
        onMouseLeave={() => setHovered(null)}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border" aria-hidden="true" />
        <span className="pointer-events-none absolute right-0 top-0 -translate-y-full pb-0.5 text-[10px] tabular-nums text-muted-foreground">
          {peak}
        </span>
        {activity.daily.map((day, index) => (
          <div
            key={day.date}
            className="flex h-full min-w-0 flex-1 cursor-default flex-col justify-end"
            onMouseEnter={() => setHovered(index)}
            title={`${shortDay(day.date)}: ${platforms.map((platform) => `${PLATFORM_LABELS[platform]} ${day[platform]}`).join(", ")}`}
          >
            <div className={cn("flex flex-col-reverse gap-[2px] transition-opacity", hovered !== null && hovered !== index && "opacity-45")}>
              {totals[index] === 0 ? (
                <div className="h-[2px] rounded-full bg-muted" />
              ) : (
                platforms.map((platform, layer) => {
                  if (day[platform] === 0) return null;
                  const topmost = platforms.slice(layer + 1).every((next) => day[next] === 0);
                  return (
                    <div
                      key={platform}
                      className={cn(topmost && "rounded-t-[4px]")}
                      style={{ height: Math.max(3, (day[platform] / peak) * (height - 8)), background: PLATFORM_FILL[platform] }}
                    />
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-[2px] border-t pt-1.5" aria-hidden="true">
        {activity.daily.map((day, index) => {
          const fromEnd = activity.daily.length - 1 - index;
          return (
            <div key={day.date} className="relative min-w-0 flex-1">
              {fromEnd % labelEvery === 0 && index >= 3 && (
                <span className="absolute right-0 whitespace-nowrap text-[10px] text-muted-foreground">{shortDay(day.date)}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="h-3" />
    </section>
  );
}

function PlatformsCard({ activity, days }: { activity: AppActivityReport["activity"]; days: number }) {
  const rows = activity ? shownPlatforms(activity).map((platform) => activity.platforms.find((row) => row.platform === platform)!) : [];
  const peak = Math.max(...rows.map((row) => row.people), 1);
  return (
    <section className={card} aria-label="Where people use it">
      <div className="flex items-baseline justify-between gap-2">
        <div className={eyebrow}>Where people use it</div>
        <span className="text-xs text-muted-foreground">Last {days} days</span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No activity recorded yet.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {rows.map((row) => (
            <div key={row.platform}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 font-bold">
                  <PlatformIcon platform={row.platform} className="size-3.5 text-muted-foreground" />
                  {PLATFORM_LABELS[row.platform]}
                </span>
                <span className="text-[13px] tabular-nums">
                  {row.people} {row.people === 1 ? "person" : "people"}
                  <span className="text-muted-foreground">
                    {" · "}
                    {row.platform === "macos"
                      ? `${row.events} ${row.events === 1 ? "day" : "days"} of use`
                      : `${row.events.toLocaleString()} actions`}
                  </span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted" aria-hidden="true">
                <div
                  className="h-2 rounded-full"
                  style={{ width: `${Math.max(row.people ? 3 : 0, (row.people / peak) * 100)}%`, background: PLATFORM_FILL[row.platform] }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs leading-snug text-muted-foreground">
        Someone who uses both the site and the app counts in each row. The menu bar appears once it next refreshes.
      </p>
    </section>
  );
}

function VersionsCard({ data }: { data: AppActivityReport }) {
  const { versions, latestIosBuild, osVersions, summary } = data;
  const peak = Math.max(...versions.map((row) => row.installs), 1);
  const sourceNote = latestIosBuild
    ? latestIosBuild.source === "configured"
      ? "set in the app settings"
      : latestIosBuild.source === "app_store"
        ? "live on the App Store"
        : "newest App Store build seen"
    : null;

  return (
    <section className={card} aria-label="iPhone versions">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className={eyebrow}>iPhone versions</div>
        {latestIosBuild && (
          <span className="text-xs text-muted-foreground">
            Current is <span className="font-bold text-foreground">{versionLabel(latestIosBuild.version, latestIosBuild.build)}</span>, {sourceNote}
          </span>
        )}
      </div>
      {versions.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No iPhone has reported in yet.</p>
      ) : (
        <div className="mt-3 flex flex-col">
          {versions.map((row) => {
            const tone = buildStatusTone(row.status);
            return (
              <div
                key={`${row.version}:${row.build}:${row.channel}`}
                className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 border-b py-2.5 last:border-b-0 sm:grid-cols-[8rem_6rem_minmax(0,1fr)_5.5rem]"
              >
                <span className="text-sm font-bold tabular-nums">{versionLabel(row.version, row.build)}</span>
                <span className="hidden text-xs text-muted-foreground sm:block">{channelLabel(row.channel)}</span>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="h-2 min-w-0 flex-1 rounded-full bg-muted" aria-hidden="true">
                    <div className="h-2 rounded-full bg-[var(--aa-ios)]" style={{ width: `${(row.installs / peak) * 100}%` }} />
                  </div>
                  <span className="w-6 text-right text-[13px] tabular-nums">{row.installs}</span>
                </div>
                <span className={cn("flex items-center justify-end gap-1.5 text-xs font-bold", tone.text)}>
                  <span className={cn("size-1.5 rounded-full", tone.dot)} aria-hidden="true" />
                  {row.channel === "testflight" && row.status === "stale" ? "Old TestFlight" : buildStatusLabel(row.status)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{summary.appStoreInstallations} App Store</span>
        <span>{summary.testflightInstallations} TestFlight</span>
        <span>{summary.developmentIosInstallations} Xcode</span>
        {summary.dormantIosInstallations > 0 && (
          <span title="Phones not seen in 60 days are left out of these counts">
            {summary.dormantIosInstallations} not seen in 60 days
          </span>
        )}
        {osVersions.length > 0 && (
          <span className="ml-auto">
            {osVersions.map((row) => `${row.label}: ${row.installs}`).join(" · ")}
          </span>
        )}
      </div>
    </section>
  );
}

function SurfacesCard({ activity, days }: { activity: AppActivityReport["activity"]; days: number }) {
  const rows = activity?.surfaces ?? [];
  const peak = Math.max(...rows.map((row) => row.total), 1);
  return (
    <section className={card} aria-label="Most used screens">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className={eyebrow}>Most used screens</div>
        <Legend platforms={["web", "ios"]} />
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No screen views in the last {days} days.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {rows.map((row) => (
            <div key={row.surface} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3rem] items-center gap-3">
              <span className="truncate text-sm">{SURFACE_LABELS[row.surface] ?? row.surface}</span>
              <div
                className="flex h-2 gap-[2px]"
                style={{ width: `${(row.total / peak) * 100}%` }}
                title={`Web ${row.web.toLocaleString()} · iPhone ${row.ios.toLocaleString()}`}
              >
                {row.web > 0 && <div className="h-2 rounded-l-full last:rounded-r-full" style={{ flex: row.web, background: PLATFORM_FILL.web }} />}
                {row.ios > 0 && <div className="h-2 rounded-r-full first:rounded-l-full" style={{ flex: row.ios, background: PLATFORM_FILL.ios }} />}
              </div>
              <span className="text-right text-[13px] tabular-nums text-muted-foreground">{row.total.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">Screen views in the last {days} days.</p>
    </section>
  );
}

type AttentionItem = { key: string; tone: string; text: string; filter?: PeopleFilter; action?: string };

function namesOf(users: AppActivityUser[], limit = 3): string {
  const names = users.slice(0, limit).map((user) => user.name);
  const extra = users.length - names.length;
  return extra > 0 ? `${names.join(", ")} and ${extra} more` : names.join(", ");
}

/** Everything on the page that asks something of the admin, in one list. */
function AttentionCard({
  data,
  days,
  onShow,
}: {
  data: AppActivityReport;
  days: number;
  onShow: (filter: PeopleFilter) => void;
}) {
  const people = data.users.filter((user) => user.active);
  const oldBeta = people.filter((user) => user.clients.some(isOldTestflight));
  const behindStore = people.filter((user) =>
    user.clients.some((client) => !client.dormant && client.buildStatus === "stale" && client.releaseChannel !== "testflight"),
  );
  const pushOff = people.filter((user) => !user.iosPush && hasLiveIos(user));
  const quietKiosks = data.kiosks.filter((kiosk) => isQuietKiosk(kiosk, new Date(data.generatedAt)));
  const neverOpened = data.users.filter((user) => user.active && !user.used);
  const crashTotals = new Map<string, number>();
  for (const row of data.crashes ?? []) {
    if (row.kind !== "crash") continue;
    const key = versionLabel(row.appVersion, row.appBuild);
    crashTotals.set(key, (crashTotals.get(key) ?? 0) + row.count);
  }
  const worstCrash = [...crashTotals.entries()].sort((a, b) => b[1] - a[1])[0];

  const items = [
    oldBeta.length > 0 && {
      key: "oldbeta",
      tone: "var(--orange-text)",
      text: `${oldBeta.length} on an old TestFlight build (${namesOf(oldBeta)}). Ask them to install from the App Store.`,
      filter: "oldbeta",
    },
    behindStore.length > 0 && {
      key: "behind",
      tone: "var(--orange-text)",
      text: `${behindStore.length} behind on the App Store build (${namesOf(behindStore)}).`,
      filter: "behind",
    },
    pushOff.length > 0 && {
      key: "pushoff",
      tone: "var(--orange-text)",
      text: `${pushOff.length} with the iPhone app can't get notifications (${namesOf(pushOff)}).`,
      filter: "pushoff",
    },
    quietKiosks.length > 0 && {
      key: "kiosk",
      tone: "var(--orange-text)",
      text: `${quietKiosks.map((kiosk) => kiosk.name).join(", ")} ${quietKiosks.length === 1 ? "hasn't" : "haven't"} checked in for over an hour.`,
    },
    worstCrash && {
      key: "crash",
      tone: "#E5484D",
      text: `${worstCrash[0]} crashed ${worstCrash[1]} ${worstCrash[1] === 1 ? "time" : "times"} in the last ${days} days.`,
    },
    neverOpened.length > 0 && {
      key: "never",
      tone: "var(--muted-foreground)",
      text: `${neverOpened.length} active ${neverOpened.length === 1 ? "person has" : "people have"} never opened the site or app.`,
      filter: "never",
    },
  ].filter(Boolean) as AttentionItem[];

  return (
    <section className={card} aria-label="Needs attention">
      <div className={eyebrow}>Needs attention</div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing needs you. Everyone is current and reachable.</p>
      ) : (
        <ul className="mt-1">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-3 border-b py-2.5 text-sm last:border-b-0">
              <span className="size-2 shrink-0 rounded-full" style={{ background: item.tone }} aria-hidden="true" />
              <span className="min-w-0 flex-1">{item.text}</span>
              {item.filter && (
                <button
                  type="button"
                  className="-my-2 shrink-0 px-2 py-3 text-xs font-bold text-[var(--accent)] hover:underline"
                  onClick={() => onShow(item.filter!)}
                >
                  Show
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FirstOpensCard({ firstOpens }: { firstOpens: AppActivityReport["firstOpens"] }) {
  const peak = Math.max(...firstOpens.weeks.map((week) => week.students + week.others), 1);
  const height = 120;
  const pending = firstOpens.addedLast30Days - firstOpens.openedOfAdded;
  return (
    <section className={card} aria-label="First opens">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={eyebrow}>First opens by week</div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {firstOpens.addedLast30Days === 0
              ? "Nobody was added in the last 30 days."
              : `${firstOpens.openedOfAdded} of ${firstOpens.addedLast30Days} people added in the last 30 days have opened it${pending > 0 ? `; ${pending} haven't yet` : ""}.`}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[var(--accent)]" aria-hidden="true" />Students</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground/40" aria-hidden="true" />Staff and others</span>
        </div>
      </div>
      <div className="mt-4 flex items-end gap-1.5" style={{ height }} role="img" aria-label="People opening the site or app for the first time, by week, last 12 weeks">
        {firstOpens.weeks.map((week) => {
          const total = week.students + week.others;
          const label = `Week of ${new Date(week.weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })}: ${week.students} students, ${week.others} others`;
          return (
            <div key={week.weekStart} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={label}>
              {total > 0 && <span className="mb-1 text-center text-[10px] tabular-nums text-muted-foreground">{total}</span>}
              <div className="flex flex-col-reverse gap-[2px]">
                {total === 0 && <div className="h-[2px] rounded-full bg-muted" />}
                {week.students > 0 && (
                  <div className={cn(week.others === 0 && "rounded-t-[4px]")} style={{ height: Math.max(3, (week.students / peak) * (height - 20)), background: "var(--accent)" }} />
                )}
                {week.others > 0 && (
                  <div className="rounded-t-[4px]" style={{ height: Math.max(3, (week.others / peak) * (height - 20)), background: "color-mix(in oklab, var(--muted-foreground) 40%, transparent)" }} />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between border-t pt-1.5 text-[10px] text-muted-foreground" aria-hidden="true">
        <span>12 weeks ago</span>
        <span>This week</span>
      </div>
    </section>
  );
}

function CrashesCard({ crashes, days }: { crashes: AppActivityReport["crashes"]; days: number }) {
  const byVersion = new Map<string, { label: string; build: number; crash: number; hang: number }>();
  for (const row of crashes ?? []) {
    const label = versionLabel(row.appVersion, row.appBuild);
    const entry = byVersion.get(label) ?? { label, build: Number(row.appBuild ?? row.appVersion ?? 0), crash: 0, hang: 0 };
    if (row.kind === "crash") entry.crash += row.count;
    if (row.kind === "hang") entry.hang += row.count;
    byVersion.set(label, entry);
  }
  const rows = [...byVersion.values()].sort((a, b) => b.crash + b.hang - (a.crash + a.hang)).slice(0, 6);
  const peak = Math.max(...rows.map((row) => row.crash + row.hang), 1);
  return (
    <section className={card} aria-label="Crashes and hangs by version">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className={eyebrow}>Crashes and hangs</div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#E5484D]" aria-hidden="true" />Crashes</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[var(--orange-text)]" aria-hidden="true" />Hangs</span>
        </div>
      </div>
      {crashes === null ? (
        <p className="mt-3 text-sm text-muted-foreground">Crash reports could not be loaded.</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No crashes or hangs reported in the last {days} days.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-3">
              <span className="text-sm font-bold tabular-nums">{row.label}</span>
              <div className="flex h-2 gap-[2px]" style={{ width: `${((row.crash + row.hang) / peak) * 100}%` }}>
                {row.crash > 0 && <div className="h-2 rounded-l-full last:rounded-r-full" style={{ flex: row.crash, background: "#E5484D" }} />}
                {row.hang > 0 && <div className="h-2 rounded-r-full first:rounded-l-full bg-[var(--orange-text)]" style={{ flex: row.hang }} />}
              </div>
              <span className="text-right text-[13px] tabular-nums text-muted-foreground">{row.crash} · {row.hang}</span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">From the iPhone app&apos;s crash reports. Apple sends them a day or so late.</p>
    </section>
  );
}

function versionFill(version: string, index: number): string {
  return version === "Older" ? "var(--aa-older)" : VERSION_FILLS[index] ?? "var(--aa-older)";
}

/** Share of daily iPhone users on each version: how fast a release takes over. */
function AdoptionCard({ activity, days }: { activity: AppActivityReport["activity"]; days: number }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const adoption = activity?.adoption;
  const totals = adoption?.daily.map((day) => Object.values(day.counts).reduce((sum, value) => sum + value, 0)) ?? [];
  const hasData = totals.some((total) => total > 0);
  const lastWithData = totals.reduce((last, total, index) => (total > 0 ? index : last), -1);
  const focus = hovered ?? lastWithData;
  const focusDay = adoption && focus >= 0 ? adoption.daily[focus] : undefined;
  const focusTotal = focus >= 0 ? totals[focus] ?? 0 : 0;
  const height = 120;

  return (
    <section className={card} aria-label="Release adoption">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className={eyebrow}>Release adoption</div>
        {adoption && adoption.versions.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {adoption.versions.map((version, index) => (
              <span key={version} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-2 rounded-full" style={{ background: versionFill(version, index) }} aria-hidden="true" />
                {version}
              </span>
            ))}
          </div>
        )}
      </div>
      {!adoption || !hasData ? (
        <p className="mt-3 text-sm text-muted-foreground">No iPhone activity in the last {days} days.</p>
      ) : (
        <>
          <div className="mt-3 min-h-[20px] text-xs" aria-live="polite">
            {focusDay && focusTotal > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-bold text-foreground">{shortDay(focusDay.date)}</span>
                {adoption.versions.map((version, index) => {
                  const count = focusDay.counts[version] ?? 0;
                  return (
                    <span key={version} className="flex items-center gap-1 text-muted-foreground">
                      <span className="size-1.5 rounded-full" style={{ background: versionFill(version, index) }} aria-hidden="true" />
                      {version} <span className="font-bold tabular-nums text-foreground">{Math.round((count / focusTotal) * 100)}%</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div
            className="mt-2 flex items-end gap-[2px]"
            style={{ height }}
            role="img"
            aria-label={`Share of daily iPhone users on each app version over the last ${days} days`}
            onMouseLeave={() => setHovered(null)}
          >
            {adoption.daily.map((day, index) => {
              const total = totals[index] ?? 0;
              return (
                <div
                  key={day.date}
                  className={cn(
                    "flex h-full min-w-0 flex-1 flex-col-reverse justify-start gap-[2px] overflow-hidden rounded-[3px] transition-opacity",
                    hovered !== null && hovered !== index && "opacity-45",
                  )}
                  onMouseEnter={() => setHovered(index)}
                >
                  {total === 0 ? (
                    <div className="h-[2px] rounded-full bg-muted" />
                  ) : (
                    adoption.versions.map((version, layer) => {
                      const count = day.counts[version] ?? 0;
                      if (count === 0) return null;
                      return (
                        <div key={version} style={{ flex: count, background: versionFill(version, layer) }} />
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between border-t pt-1.5 text-[10px] text-muted-foreground" aria-hidden="true">
            <span>{shortDay(adoption.daily[0]!.date)}</span>
            <span>Today</span>
          </div>
        </>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Each day&apos;s iPhone users split by the app version they opened.</p>
    </section>
  );
}

function KiosksCard({ kiosks, now }: { kiosks: AppActivityReport["kiosks"]; now: Date }) {
  return (
    <section className={card} aria-label="Kiosks">
      <div className={eyebrow}>Kiosks</div>
      <div className="mt-3 flex flex-col">
        {kiosks.map((kiosk) => {
          const quiet = isQuietKiosk(kiosk, now);
          return (
            <div key={kiosk.name} className="flex items-center gap-2 border-b py-2.5 text-sm last:border-b-0">
              <Monitor className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{kiosk.name}</span>
              <span className="font-bold tabular-nums">{versionLabel(kiosk.appVersion, kiosk.appBuild)}</span>
              <span
                className={cn("flex w-24 items-center justify-end gap-1.5 text-xs", quiet ? "font-bold text-[var(--orange-text)]" : "text-muted-foreground")}
                title={kiosk.lastSeenAt ? formatDateTime(kiosk.lastSeenAt) : undefined}
              >
                {quiet && <span className="size-1.5 rounded-full bg-[var(--orange-text)]" aria-hidden="true" />}
                {kiosk.lastSeenAt ? formatRelativeTime(kiosk.lastSeenAt, now) : "Never"}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">A kiosk turns amber when it hasn&apos;t checked in for an hour.</p>
    </section>
  );
}

function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  if (platform === "ios") return <Smartphone className={className} aria-hidden="true" />;
  if (platform === "macos") return <Laptop className={className} aria-hidden="true" />;
  return <Globe className={className} aria-hidden="true" />;
}

function matchesFilter(user: AppActivityUser, filter: PeopleFilter): boolean {
  const has = (platform: string) => user.clients.some((client) => client.platform === platform);
  switch (filter) {
    case "behind": return user.clients.some((client) => !client.dormant && client.buildStatus === "stale");
    case "oldbeta": return user.clients.some(isOldTestflight);
    case "pushoff": return hasLiveIos(user) && !user.iosPush;
    case "ios": return has("ios");
    case "web": return has("web") && !has("ios");
    case "macos": return has("macos");
    case "never": return !user.used;
    default: return true;
  }
}

function isOldTestflight(client: AppClient): boolean {
  return !client.dormant && client.releaseChannel === "testflight" && client.buildStatus === "stale";
}

function hasLiveIos(user: AppActivityUser): boolean {
  return user.clients.some((client) => client.platform === "ios" && !client.dormant);
}

const KIOSK_QUIET_MS = 60 * 60_000;

function isQuietKiosk(kiosk: AppActivityReport["kiosks"][number], now: Date): boolean {
  return !kiosk.lastSeenAt || now.getTime() - new Date(kiosk.lastSeenAt).getTime() > KIOSK_QUIET_MS;
}

type PeopleSort = "recent" | "version" | "name";

function newestBuild(user: AppActivityUser): number {
  return Math.max(-1, ...user.clients.filter((client) => client.platform === "ios" && !client.dormant).map((client) => Number(client.appBuild ?? -1)));
}

function PeopleCard({
  users,
  now,
  filter,
  onFilter: setFilter,
}: {
  users: AppActivityUser[];
  now: Date;
  filter: PeopleFilter;
  onFilter: (filter: PeopleFilter) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PeopleSort>("recent");
  const [showInactive, setShowInactive] = useState(false);
  const inactiveCount = users.filter((user) => !user.active).length;
  const pool = useMemo(() => (showInactive ? users : users.filter((user) => user.active)), [users, showInactive]);

  const sorted = useMemo(() => {
    const seen = (user: AppActivityUser) => (user.lastSeenAt ? new Date(user.lastSeenAt).getTime() : 0);
    return [...pool].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      // Oldest build first, so whoever needs an update is at the top.
      if (sort === "version") {
        const ab = newestBuild(a);
        const bb = newestBuild(b);
        if ((ab < 0) !== (bb < 0)) return ab < 0 ? 1 : -1;
        return ab - bb || a.name.localeCompare(b.name);
      }
      return seen(b) - seen(a) || a.name.localeCompare(b.name);
    });
  }, [pool, sort]);
  const counts = useMemo(() => {
    const result = {} as Record<PeopleFilter, number>;
    for (const key of PEOPLE_FILTERS) {
      result[key] = pool.filter((user) => matchesFilter(user, key)).length;
    }
    return result;
  }, [pool]);

  const needle = query.trim().toLowerCase();
  const visible = sorted.filter(
    (user) => matchesFilter(user, filter) && (!needle || user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle)),
  );

  const tabs: Array<{ value: PeopleFilter; label: string }> = [
    { value: "all", label: "Everyone" },
    { value: "behind", label: "Behind" },
    ...(counts.oldbeta > 0 ? [{ value: "oldbeta" as const, label: "Old TestFlight" }] : []),
    { value: "pushoff", label: "Notifications off" },
    { value: "ios", label: "iPhone" },
    { value: "web", label: "Web only" },
    ...(counts.macos > 0 ? [{ value: "macos" as const, label: "Menu bar" }] : []),
    { value: "never", label: "Never opened" },
  ];

  return (
    <section id="app-activity-people" className="scroll-mt-24 rounded-2xl border bg-card" aria-label="People">
      <div className="flex flex-col gap-3 border-b p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className={eyebrow}>People</div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {inactiveCount > 0 && (
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--accent)]"
                  checked={showInactive}
                  onChange={(event) => setShowInactive(event.target.checked)}
                />
                Show {inactiveCount} inactive
              </label>
            )}
            <label className="flex items-center gap-1.5">
              Sort
              <select
                className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"
                value={sort}
                onChange={(event) => setSort(event.target.value as PeopleSort)}
                aria-label="Sort people"
              >
                <option value="recent">Last active</option>
                <option value="version">Oldest version first</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="-mx-1 overflow-x-auto px-1">
            <ToggleGroup
              type="single"
              value={filter}
              onValueChange={(next) => next && setFilter(next as PeopleFilter)}
              aria-label="Filter people"
              className="min-w-max"
            >
              {tabs.map((tab) => (
                <ToggleGroupItem key={tab.value} value={tab.value} aria-label={tab.label}>
                  {tab.label}
                  <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{counts[tab.value]}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="relative md:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people"
              aria-label="Search people"
              className="h-9 pl-8"
            />
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="users"
          title={users.length === 0 ? "No roster users found" : "Nobody matches"}
          description={users.length === 0 ? "The report excludes users hidden from the roster." : "Try another filter or search."}
          compact
        />
      ) : (
        <ul className="divide-y">
          {visible.map((user) => (
            <PersonRow key={user.email} user={user} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PersonRow({ user, now }: { user: AppActivityUser; now: Date }) {
  const clients = [...user.clients].sort((a, b) => {
    const order = (platform: string) => ["ios", "macos", "web", "kiosk"].indexOf(platform);
    return order(a.platform) - order(b.platform) || new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
  });
  const { phones, testBuilds } = groupIosClients(clients.filter((client) => client.platform === "ios"));
  const webClients = clients.filter((client) => client.platform === "web");
  const macClients = clients.filter((client) => client.platform === "macos");
  const latestWeb = webClients[0];
  const browsers = distinctWebClients(webClients);
  const lastActive = user.lastSeenAt ? (
    <span title={formatDateTime(user.lastSeenAt)} className="font-medium text-foreground">
      {formatRelativeTime(user.lastSeenAt, now)}
    </span>
  ) : (
    <span>Never</span>
  );

  return (
    <li className="grid gap-x-4 gap-y-2 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_7rem] md:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground"
          aria-hidden="true"
        >
          {initials(user.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link href={`/staff/${user.id}`} className="min-w-0 truncate hover:underline">
              <span className="brand-identity font-medium text-foreground">{user.name}</span>
            </Link>
            {!user.active && <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Inactive</span>}
            <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground md:hidden">{lastActive}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{user.email} · {user.role.toLowerCase()}</div>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap gap-1.5 pl-11 md:pl-0">
        {clients.length === 0 && <span className="text-sm text-muted-foreground">Hasn&apos;t opened the site or app</span>}
        {phones.map((client, index) => (
          <IosChip key={`ios:${client.firstSeenAt}:${index}`} client={client} />
        ))}
        {testBuilds.length > 0 && <TestBuildsChip builds={testBuilds} />}
        {macClients.map((client, index) => (
          <ClientChip key={`mac:${client.firstSeenAt}:${index}`} platform="macos" title={client.osVersion ? `macOS ${client.osVersion}` : undefined}>
            Menu bar{client.appVersion ? ` ${client.appVersion}` : ""}
          </ClientChip>
        ))}
        {hasLiveIos(user) && !user.iosPush && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground"
            title="This iPhone has no push token, so shift and booking alerts can't reach it"
          >
            <BellOff className="size-3 shrink-0" aria-hidden="true" />
            Notifications off
          </span>
        )}
        {latestWeb && (
          <ClientChip
            platform="web"
            title={[
              `Last on the web ${formatDateTime(latestWeb.lastSeenAt)}`,
              browsers.length > 1 ? `Also: ${browsers.slice(1).join(", ")}` : null,
            ].filter(Boolean).join("\n")}
          >
            {latestWeb.deviceModel ?? "Web"}
            {browsers.length > 1 && <span className="text-muted-foreground"> +{browsers.length - 1}</span>}
          </ClientChip>
        )}
      </div>

      <div className="hidden text-right text-xs text-muted-foreground md:block">{lastActive}</div>
    </li>
  );
}

function ClientChip({
  platform,
  title,
  children,
}: {
  platform: ClientPlatform;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs"
      title={title}
    >
      <PlatformIcon platform={platform} className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Every Xcode and simulator build one person has run, folded into one quiet chip. */
function TestBuildsChip({ builds }: { builds: AppClient[] }) {
  const newest = builds[0]!;
  const list = builds
    .map((build) => `${versionLabel(build.appVersion, build.appBuild)} · ${deviceName(build.deviceModel) ?? "iPhone"} · last seen ${formatDateTime(build.lastSeenAt)}`)
    .join("\n");
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground"
      title={`Xcode and simulator builds, left out of version stats:\n${list}`}
    >
      <Hammer className="size-3 shrink-0" aria-hidden="true" />
      <span className="tabular-nums">{versionLabel(newest.appVersion, newest.appBuild)}</span>
      <span>· {builds.length === 1 ? "Test build" : `${builds.length} test builds`}</span>
    </span>
  );
}

function IosChip({ client }: { client: AppClient }) {
  if (client.dormant) {
    return (
      <span
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground"
        title={`${deviceName(client.deviceModel) ?? "iPhone"} not seen in 60 days, so it's left out of version stats`}
      >
        <Smartphone className="size-3 shrink-0" aria-hidden="true" />
        <span className="tabular-nums">{versionLabel(client.appVersion, client.appBuild)}</span>
        <span>· Not seen since {new Date(client.lastSeenAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
      </span>
    );
  }
  const tone = buildStatusTone(client.buildStatus);
  const device = deviceName(client.deviceModel);
  const detail = [device, client.osVersion ? `iOS ${client.osVersion}` : null, channelLabel(client.releaseChannel)]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs"
      title={`${detail}${client.deviceModel ? ` (${client.deviceModel})` : ""} · last seen ${formatDateTime(client.lastSeenAt)}`}
    >
      <Smartphone className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="font-bold tabular-nums">{versionLabel(client.appVersion, client.appBuild)}</span>
      <span className={cn("flex items-center gap-1", tone.text)}>
        <span className={cn("size-1.5 rounded-full", tone.dot)} aria-hidden="true" />
        {isOldTestflight(client) ? "Old TestFlight" : buildStatusLabel(client.buildStatus)}
      </span>
      {device && <span className="hidden truncate text-muted-foreground sm:inline">· {device}</span>}
    </span>
  );
}

function AppActivityLoading() {
  return (
    <SettingsPageShell href="/settings/app-activity" description={DESCRIPTION}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[124px] rounded-2xl" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Skeleton className="h-[300px] rounded-2xl" />
          <Skeleton className="h-[300px] rounded-2xl" />
        </div>
        <Skeleton className="h-[420px] w-full rounded-2xl" />
      </div>
    </SettingsPageShell>
  );
}
