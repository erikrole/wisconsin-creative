"use client";

import { useState } from "react";
import MetricCard from "../MetricCard";
import { useFetch } from "@/hooks/use-fetch";
import {
  ReportDataRegion,
  ReportErrorState,
  ReportLoadingState,
  ReportMetricGrid,
  ReportSectionCard,
  ReportSegmentedControl,
  ReportToolbar,
  ReportToolbarGroup,
} from "../report-ui";

type CountRow = { name: string; count: number };
type UsageReport = {
  days: number;
  totalEvents: number;
  activeUsers: number;
  platforms: CountRow[];
  surfaces: CountRow[];
  events: CountRow[];
  versions: Array<{ platform: string; version: string; count: number }>;
  notifications?: {
    deliveries: CountRow[];
    pushReadiness: CountRow[];
    preferenceChanges: CountRow[];
    responses: CountRow[];
    timeToAct: CountRow[];
  };
  health?: { jobs: CountRow[]; diagnostics: CountRow[] };
};

function CountList({ rows }: { rows: CountRow[] }) {
  return rows.length === 0 ? <p className="text-sm text-muted-foreground">No counted activity in this period.</p> : (
    <div className="divide-y">
      {rows.map((row) => (
        <div key={row.name} className="flex items-center justify-between gap-4 py-3 text-sm">
          <span className="capitalize">{row.name.replaceAll("_", " ")}</span>
          <span className="tabular-nums text-muted-foreground">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

export default function UsageReportPage() {
  const [days, setDays] = useState(30);
  const [now] = useState(() => new Date());
  const { data, loading, refreshing, error, lastRefreshed, reload } = useFetch<UsageReport>({
    url: `/api/reports/usage?days=${days}`,
    keepPreviousData: true,
  });

  if (loading && !data) return <ReportLoadingState metricCount={2} rows={6} />;
  if (error && !data) return <ReportErrorState title="Failed to load private usage counts" error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      <ReportToolbar lastRefreshed={lastRefreshed} loading={loading || refreshing} now={now} onRefresh={reload}>
        <ReportToolbarGroup label="Period">
          <ReportSegmentedControl ariaLabel="Usage report period" value={days} options={[7, 30, 90].map((value) => ({ value, label: `${value}d` }))} onChange={setDays} />
        </ReportToolbarGroup>
      </ReportToolbar>
      <ReportDataRegion refreshing={refreshing}>
        <ReportMetricGrid>
          <MetricCard label="Counted events" value={data.totalEvents} />
          <MetricCard label="Active people" value={data.activeUsers} helper="Pseudonymous yearly identifiers" />
        </ReportMetricGrid>
        <div className="grid gap-4 lg:grid-cols-2">
          <ReportSectionCard title="Platforms" description="Web, iOS, and kiosk activity."><CountList rows={data.platforms} /></ReportSectionCard>
          <ReportSectionCard title="Surfaces" description="Normalized areas only. URLs and record IDs are never stored."><CountList rows={data.surfaces} /></ReportSectionCard>
          <ReportSectionCard title="Events" description="Allowlisted product events only."><CountList rows={data.events} /></ReportSectionCard>
          <ReportSectionCard title="App versions" description="Version adoption by platform.">
            <CountList rows={data.versions.map((row) => ({ name: `${row.platform} ${row.version}`, count: row.count }))} />
          </ReportSectionCard>
        </div>
        {data.notifications ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <ReportSectionCard title="Notification delivery" description="What happened to each push: sent, sent silently, suppressed and why, or rejected.">
              <CountList rows={data.notifications.deliveries} />
            </ReportSectionCard>
            <ReportSectionCard title="Push readiness" description="Daily check-ins from iOS installs: permission, then device registration.">
              <CountList rows={data.notifications.pushReadiness} />
            </ReportSectionCard>
            <ReportSectionCard title="Preference changes" description="Categories people change, and to what level.">
              <CountList rows={data.notifications.preferenceChanges} />
            </ReportSectionCard>
            <ReportSectionCard title="Responses" description="Taps and lock-screen actions by category.">
              <CountList rows={data.notifications.responses} />
            </ReportSectionCard>
            <ReportSectionCard title="Time to respond" description="From delivery to a tap or action.">
              <CountList rows={data.notifications.timeToAct} />
            </ReportSectionCard>
          </div>
        ) : null}
        {data.health ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <ReportSectionCard title="Background jobs" description="Reminder, escalation, and daily maintenance runs: outcome and how late each ran.">
              <CountList rows={data.health.jobs} />
            </ReportSectionCard>
            <ReportSectionCard title="App crashes and hangs" description="Apple MetricKit reports from iOS installs, grouped by kind, signature, and version.">
              <CountList rows={data.health.diagnostics} />
            </ReportSectionCard>
          </div>
        ) : null}
      </ReportDataRegion>
    </div>
  );
}
