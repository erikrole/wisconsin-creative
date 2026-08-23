"use client";

import { Clock3, RefreshCw, ShieldCheck, Smartphone, Store, Users } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFetch } from "@/hooks/use-fetch";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { SettingsPageShell } from "../SettingsPageShell";

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
  buildStatus: "latest" | "stale" | "ahead" | "unknown" | null;
};

type AppActivityUser = {
  name: string;
  email: string;
  role: string;
  active: boolean;
  used: boolean;
  lastUsedAt: string | null;
  clients: AppClient[];
};

type AppActivityReport = {
  generatedAt: string;
  summary: {
    totalUsers: number;
    usedUsers: number;
    neverUsedUsers: number;
    iosUsers: number;
    iosInstallations: number;
    latestIosInstallations: number;
    staleIosInstallations: number;
    unclassifiedIosInstallations: number;
    testflightInstallations: number;
    appStoreInstallations: number;
    webInstallations: number;
  };
  latestIosBuild: { version: string | null; build: string } | null;
  users: AppActivityUser[];
};

const channelLabels: Record<string, string> = {
  app_store: "App Store",
  testflight: "TestFlight",
  development: "Development",
  unknown: "Unknown channel",
  web: "Web",
};

function channelLabel(channel: string | null) {
  return channel ? channelLabels[channel] ?? channel : "Channel unknown";
}

function channelVariant(channel: string | null): "blue" | "purple" | "orange" | "gray" {
  if (channel === "app_store") return "blue";
  if (channel === "testflight") return "purple";
  if (channel === "development") return "orange";
  return "gray";
}

function platformLabel(platform: string) {
  return platform === "ios" ? "iOS" : platform === "web" ? "Web" : platform;
}

function buildStatusLabel(status: AppClient["buildStatus"]) {
  if (status === "latest") return "Latest";
  if (status === "stale") return "Stale";
  if (status === "ahead") return "Newer";
  return "Compare unavailable";
}

function buildStatusVariant(status: AppClient["buildStatus"]): "green" | "orange" | "blue" | "gray" {
  if (status === "latest") return "green";
  if (status === "stale") return "orange";
  if (status === "ahead") return "blue";
  return "gray";
}

function latestClient(clients: AppClient[]) {
  return [...clients].sort(
    (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
  )[0] ?? null;
}

export default function AppActivityPage() {
  const {
    data,
    loading,
    refreshing,
    error,
    reload,
  } = useFetch<AppActivityReport>({
    url: "/api/settings/app-activity",
    returnTo: "/settings/app-activity",
    keepPreviousData: true,
  });

  if (loading && !data) {
    return <AppActivityLoading />;
  }

  if (error && !data) {
    return (
      <SettingsPageShell
        title="App activity"
        description="Owner-only adoption and client identity for the signed-in app."
      >
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-5">
            <p className="font-medium">Could not load app activity</p>
            <p className="text-sm text-muted-foreground">
              Check the connection or confirm the report migration is deployed, then try again.
            </p>
            <Button className="h-10" type="button" variant="outline" onClick={reload}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </SettingsPageShell>
    );
  }

  if (!data) return null;

  const { summary, users } = data;
  const now = new Date();

  return (
    <SettingsPageShell
      title="App activity"
      description="Owner-only adoption, device, iOS, build, and release-channel visibility. App use means the client reported an app-open event."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            <span>Coarse client metadata only — no UDID, serial number, or advertising ID.</span>
          </div>
          <div className="flex items-center gap-2">
            {refreshing && <span className="text-xs text-muted-foreground">Refreshing…</span>}
            <Button className="h-10" type="button" variant="outline" onClick={reload} disabled={refreshing}>
              <RefreshCw className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <SummaryCard icon={Users} label="Roster users" value={summary.totalUsers} detail={`${summary.usedUsers} have opened the app`} />
          <SummaryCard icon={Clock3} label="Used app" value={summary.usedUsers} detail={`${summary.neverUsedUsers} have never opened it`} tone="green" />
          <SummaryCard icon={Smartphone} label="iOS clients" value={summary.iosInstallations} detail={`${summary.iosUsers} users with an iOS client`} tone="blue" />
          <SummaryCard icon={Store} label="Stale builds" value={summary.staleIosInstallations} detail={data.latestIosBuild ? `${summary.latestIosInstallations} on build ${data.latestIosBuild.build}` : "Configure the latest build to compare"} tone="orange" />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3 text-sm shadow-xs">
          <div>
            <span className="font-medium">Latest iOS target: </span>
            <span className="text-muted-foreground">
              {data.latestIosBuild
                ? `${data.latestIosBuild.version ? `v${data.latestIosBuild.version} · ` : ""}build ${data.latestIosBuild.build}`
                : "not configured yet"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {summary.testflightInstallations} TestFlight · {summary.appStoreInstallations} App Store · {summary.webInstallations} web · {summary.unclassifiedIosInstallations} compare unavailable
          </div>
        </div>

        {users.length === 0 ? (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                icon="users"
                title="No roster users found"
                description="The report excludes users hidden from the roster."
                compact
              />
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/20 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <CardTitle className="text-base">User adoption and clients</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Last refreshed {formatRelativeTime(data.generatedAt, now)} · client timestamps are local to your browser.
                  </p>
                </div>
                <Badge variant="gray" size="sm">{users.length} users</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>App use</TableHead>
                    <TableHead>Clients and device</TableHead>
                    <TableHead>Build / channel</TableHead>
                    <TableHead>Last seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <UserActivityRow key={user.email} user={user} now={now} />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </SettingsPageShell>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "gray",
}: {
  icon: typeof Users;
  label: string;
  value: number;
  detail: string;
  tone?: "gray" | "green" | "blue" | "purple" | "orange";
}) {
  return (
    <Card>
      <CardContent className="flex min-h-28 flex-col justify-between gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{value}</span>
            <Badge variant={tone} size="sm">{tone === "gray" ? "Current" : tone === "green" ? "Adoption" : tone === "blue" ? "iPhone / iPad" : tone === "orange" ? "Needs update" : "Distribution"}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function UserActivityRow({ user, now }: { user: AppActivityUser; now: Date }) {
  const clients = user.clients;
  const latest = latestClient(clients);
  const iosClients = clients.filter((client) => client.platform === "ios");

  return (
    <TableRow>
      <TableCell className="min-w-52">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{user.name}</span>
            {!user.active && <Badge variant="gray" size="sm">Inactive</Badge>}
          </div>
          <span className="text-xs text-muted-foreground">{user.email} · {user.role.toLowerCase()}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <Badge variant={user.used ? "green" : "gray"} size="sm">
            {user.used ? "Used" : "Never opened"}
          </Badge>
          {user.lastUsedAt ? (
            <span className="text-xs text-muted-foreground" title={formatDateTime(user.lastUsedAt)}>
              {formatRelativeTime(user.lastUsedAt, now)}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="min-w-64">
        {clients.length === 0 ? (
          <span className="text-sm text-muted-foreground">No client reported</span>
        ) : (
          <div className="flex flex-col gap-2">
            {clients.map((client) => (
              <div key={`${client.platform}:${client.firstSeenAt}`} className="flex min-w-56 items-start gap-2">
                <Badge variant={client.platform === "ios" ? "blue" : "gray"} size="sm">{platformLabel(client.platform)}</Badge>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{client.deviceModel ?? "Browser"}</div>
                  <div className="text-xs text-muted-foreground">
                    {client.osVersion ? `iOS ${client.osVersion}` : "Browser client"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="min-w-52">
        {iosClients.length === 0 ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-col gap-2">
            {iosClients.map((client) => (
              <div key={`${client.platform}:build:${client.firstSeenAt}`} className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium">{client.appVersion ? `v${client.appVersion}` : "Version unknown"}</span>
                <span className="text-xs text-muted-foreground">build {client.appBuild ?? "—"}</span>
                <Badge variant={buildStatusVariant(client.buildStatus)} size="sm">{buildStatusLabel(client.buildStatus)}</Badge>
                <Badge variant={channelVariant(client.releaseChannel)} size="sm">{channelLabel(client.releaseChannel)}</Badge>
              </div>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell>
        {latest ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm">{formatRelativeTime(latest.lastSeenAt, now)}</span>
            <span className="text-xs text-muted-foreground" title={formatDateTime(latest.lastSeenAt)}>
              {latest.osVersion ? `iOS ${latest.osVersion}` : platformLabel(latest.platform)}
            </span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function AppActivityLoading() {
  return (
    <SettingsPageShell
      title="App activity"
      description="Owner-only adoption and client identity for the signed-in app."
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-lg" />)}
        </div>
        <Skeleton className="h-[420px] w-full rounded-lg" />
      </div>
    </SettingsPageShell>
  );
}
