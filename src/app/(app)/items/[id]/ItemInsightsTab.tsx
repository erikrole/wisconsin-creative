"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/EmptyState";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import type { InsightsData, WindowKey, WindowStats } from "./types";

const windowLabels: Record<WindowKey, string> = {
  "30d": "30d",
  "90d": "90d",
  "1yr": "1yr",
  all: "All",
};

function formatMonthLabel(value: string) {
  const [year, month] = value.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString("en-US", { month: "short" });
}

function formatAge(days: number | null) {
  if (days == null) return "--";
  if (days < 90) return `${days}d`;
  if (days < 730) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)} years`;
}

function StatTile({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="rounded-md border border-border/40 bg-card px-4 py-3 shadow-none">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums" style={{ fontFamily: "var(--font-heading)" }}>{value}</div>
      {helper && <div className="mt-0.5 text-xs text-muted-foreground">{helper}</div>}
    </div>
  );
}

function MonthlyBars({ stats }: { stats: WindowStats }) {
  const months = stats.monthly.slice(-6);
  const max = Math.max(1, ...months.map((m) => m.checkouts + m.reservations));

  if (months.length === 0) {
    return (
      <EmptyState
        inline
        icon="chart"
        title="No monthly pattern yet"
        description="Booking totals will appear here after this item has activity in the selected window."
      />
    );
  }

  return (
    <div className="flex h-36 items-end gap-2">
      {months.map((month) => {
        const total = month.checkouts + month.reservations;
        const height = Math.max(8, Math.round((total / max) * 100));
        return (
          <div key={month.month} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <div className="flex h-24 w-full items-end rounded-sm bg-muted/50 px-1">
              <div
                className="w-full rounded-sm bg-primary/70"
                style={{ height: `${height}%` }}
                aria-label={`${total} bookings in ${formatMonthLabel(month.month)}`}
              />
            </div>
            <div className="text-[10px] text-muted-foreground">{formatMonthLabel(month.month)}</div>
          </div>
        );
      })}
    </div>
  );
}

function RankedList({
  title,
  description,
  empty,
  items,
  valueLabel,
}: {
  title: string;
  description: string;
  empty: string;
  items: Array<{ name: string; value: number }>;
  valueLabel: string;
}) {
  return (
    <Card className="border-border/40 shadow-none">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-0 py-1">
        {items.length === 0 ? (
          <EmptyState
            inline
            icon="chart"
            title={empty}
            description="Try a longer time window if this item has older activity."
          />
        ) : (
          items.slice(0, 5).map((item, index) => (
            <div key={`${item.name}-${index}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 [&+&]:border-t [&+&]:border-border/30">
              <div className="min-w-0 truncate text-sm font-medium">{item.name}</div>
              <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {item.value} {valueLabel}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default function ItemInsightsTab({ assetId }: { assetId: string }) {
  const [window, setWindow] = useState<WindowKey>("90d");
  const insights = useQuery({
    queryKey: ["item-insights", assetId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/assets/${assetId}/insights`, { signal });
      if (handleAuthRedirect(res)) throw new DOMException("Auth redirect", "AbortError");
      if (!res.ok) throw new Error("Could not load insights");
      const json = await parseJsonSafely<{ data?: InsightsData }>(res);
      if (!json?.data) throw new Error("Could not load insights");
      return json.data;
    },
  });
  const data = insights.data ?? null;
  const loading = insights.isPending && insights.isFetching;
  const error = insights.isError && !data;

  if (loading) {
    return <div className="flex items-center justify-center py-10"><Spinner className="size-8" /></div>;
  }

  if (error || !data) {
    return (
      <div className="mt-3.5">
        <EmptyState
          inline
          icon="wifi-off"
          title="Could not load insights"
          description="Retry to refresh demand, borrower, and lifecycle signals for this item."
          actionLabel="Retry"
          onAction={() => void insights.refetch()}
        />
      </div>
    );
  }

  const stats = data[window];
  const allHasData = data.all.totalBookings > 0;

  if (!allHasData) {
    return (
      <div className="mt-3.5">
        <EmptyState
          inline
          icon="chart"
          title="No booking history yet"
          description="Insights will appear after this item is checked out or reserved."
        />
      </div>
    );
  }

  const onTimeTotal = stats.punctuality.onTime + stats.punctuality.late;
  const onTimeRate = onTimeTotal > 0 ? Math.round((stats.punctuality.onTime / onTimeTotal) * 100) : null;

  return (
    <div className="mt-3.5 flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Usage Insights</h2>
          <p className="text-sm text-muted-foreground">Lightweight signals for demand, borrower patterns, and lifecycle decisions.</p>
        </div>
        <ToggleGroup
          type="single"
          value={window}
          onValueChange={(value) => value && setWindow(value as WindowKey)}
          className="w-fit rounded-md border bg-background p-0.5"
        >
          {(Object.keys(windowLabels) as WindowKey[]).map((key) => (
            <ToggleGroupItem key={key} value={key} className="h-8 px-3 text-xs">
              {windowLabels[key]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {stats.totalBookings === 0 ? (
        <EmptyState
          inline
          icon="chart"
          title="No bookings in this window"
          description="Try a longer period or switch to All."
        />
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Bookings"
              value={String(stats.totalBookings)}
              helper={`${stats.byKind.CHECKOUT} checkouts / ${stats.byKind.RESERVATION} reservations`}
            />
            <StatTile label="Utilization" value={`${stats.utilizationPct}%`} helper="Days in use during window" />
            <StatTile
              label="Avg Duration"
              value={stats.avgDurationDays > 0 ? `${stats.avgDurationDays}d` : "--"}
              helper={stats.longestDurationDays > 0 ? `Longest ${stats.longestDurationDays}d` : "No completed duration"}
            />
            <StatTile
              label="Cost / Use"
              value={stats.costPerUse != null ? `$${stats.costPerUse.toFixed(2)}` : "--"}
              helper={stats.costPerUse != null ? `${data.all.totalBookings} total uses` : "Add purchase price"}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="border-border/40 shadow-none">
              <CardHeader>
                <div>
                  <CardTitle>Recent Demand</CardTitle>
                  <CardDescription>Last six monthly booking totals in the selected window.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <MonthlyBars stats={stats} />
              </CardContent>
            </Card>

            <Card className="border-border/40 shadow-none">
              <CardHeader>
                <div>
                  <CardTitle>Operational Read</CardTitle>
                  <CardDescription>Signals worth checking before buying, retiring, or restricting this item.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                  <span className="text-sm text-muted-foreground">Idle streak</span>
                  <span className="text-sm font-medium tabular-nums">{stats.idleStreakDays != null ? `${stats.idleStreakDays}d` : "--"}</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                  <span className="text-sm text-muted-foreground">Return timing</span>
                  <span className="text-sm font-medium tabular-nums">{onTimeRate != null ? `${onTimeRate}%` : "--"}</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                  <span className="text-sm text-muted-foreground">Item age</span>
                  <span className="text-sm font-medium tabular-nums">{formatAge(stats.ageDays)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Return timing uses recorded completion activity when available, then falls back to booking update time.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {stats.byKind.CHECKOUT > 0 && <Badge variant="blue" size="sm">{stats.byKind.CHECKOUT} checkout</Badge>}
                  {stats.byKind.RESERVATION > 0 && <Badge variant="purple" size="sm">{stats.byKind.RESERVATION} reservation</Badge>}
                  {stats.punctuality.late > 0 && <Badge variant="orange" size="sm">{stats.punctuality.late} late</Badge>}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <RankedList
              title="Top Borrowers"
              description="People who used this item most often."
              empty="No borrower pattern yet."
              items={stats.topBorrowers.map((borrower) => ({ name: borrower.name, value: borrower.count }))}
              valueLabel="uses"
            />
            <RankedList
              title="Sports"
              description="Where this item is spending the most days."
              empty="No sport pattern yet."
              items={stats.bySport.map((sport) => ({ name: sport.sport, value: sport.days }))}
              valueLabel="days"
            />
          </div>
        </>
      )}
    </div>
  );
}
