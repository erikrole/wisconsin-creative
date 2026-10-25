"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { formatDateFull } from "@/lib/format";
import MetricCard from "../MetricCard";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FadeUp } from "@/components/ui/motion";
import { OperationalPartialResultsAlert } from "@/components/OperationalFeedback";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, isAbortError } from "@/lib/errors";
import { statusBadgeVariant, statusLabel } from "@/components/booking-details/helpers";
import type { BadgeProps } from "@/components/ui/badge";
import {
  ReportChartLoading,
  ReportDataRegion,
  ReportEmptyState,
  ReportErrorState,
  ReportExportButton,
  ReportListRow,
  ReportLoadingState,
  ReportMetaLine,
  ReportMetricGrid,
  ReportMobileCardLink,
  ReportSegmentedControl,
  ReportSectionCard,
  ReportTableLink,
  ReportToolbar,
  ReportToolbarGroup,
  toSparklinePoints,
} from "../report-ui";
import { buildPeriodDelta, useReportPeriod } from "../use-report-period";
import {
  getReportExportCompletionToast,
  getReportExportFilename,
  readReportExportFailureMessage,
} from "../report-export";
import { useSyncedDraft } from "@/hooks/use-synced-draft";

const LazyCheckoutTrendChart = dynamic(
  () => import("./charts").then((m) => ({ default: m.CheckoutTrendChart })),
  { ssr: false, loading: () => <ReportChartLoading /> }
);
const LazyTopRequestersChart = dynamic(
  () => import("./charts").then((m) => ({ default: m.TopRequestersChart })),
  { ssr: false, loading: () => <ReportChartLoading /> }
);
const LazyHeatmap = dynamic(
  () => import("@/components/ui/heatmap"),
  { ssr: false }
);

type CheckoutRow = {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  requester: string;
  location: string;
  itemCount: number;
  isOverdue: boolean;
};

type CheckoutData = {
  days: number;
  focusDate?: string | null;
  partialFailures?: string[];
  totalCheckouts: number;
  previousTotalCheckouts?: number | null;
  overdueCheckouts: number;
  dailyTrend?: { date: string; count: number }[];
  heatmap?: { date: string; value: number }[];
  recentCheckouts: CheckoutRow[];
  topRequesters: { name: string; count: number }[];
};

const VALID_CHECKOUT_PERIODS = [7, 30, 90] as const;
const DEFAULT_CHECKOUT_PERIOD = 30;

function StatusBadge({ status, isOverdue }: { status: string; isOverdue: boolean }) {
  const variant = (isOverdue ? "red" : statusBadgeVariant(status, "CHECKOUT")) as BadgeProps["variant"];
  return <Badge variant={variant}>{isOverdue ? "Overdue" : statusLabel(status, "CHECKOUT")}</Badge>;
}

function CheckoutMobileCard({ c }: { c: CheckoutRow }) {
  return (
    <ReportMobileCardLink href={`/checkouts/${c.id}`}>
      <div className="flex items-center justify-between">
        <span className="text-foreground font-medium">{c.title}</span>
        <StatusBadge status={c.status} isOverdue={c.isOverdue} />
      </div>
      <ReportMetaLine
        className="text-sm"
        items={[
          c.requester,
          `${c.itemCount} item${c.itemCount !== 1 ? "s" : ""}`,
          `Due ${formatDateFull(c.endsAt)}`,
        ]}
      />
    </ReportMobileCardLink>
  );
}

function buildCheckoutReportParams(days: number) {
  const params = new URLSearchParams();
  params.set("days", String(days));
  return params;
}

async function downloadCheckoutCsv(days: number) {
  const params = buildCheckoutReportParams(days);
  params.set("format", "csv");

  try {
    const res = await fetch(`/api/reports/checkouts?${params.toString()}`);
    if (handleAuthRedirect(res, "/reports/checkouts")) return;

    if (!res.ok) {
      toast.error(await readReportExportFailureMessage(res, "Checkouts report"));
      return;
    }

    const blob = await res.blob();
    const filename = getReportExportFilename(
      res.headers.get("Content-Disposition"),
      "checkouts-report.csv",
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    const exportedCount = Number.parseInt(res.headers.get("X-Exported-Count") ?? "", 10);
    const completionToast = getReportExportCompletionToast({
      reportLabel: "Checkouts report",
      rowCount: Number.isFinite(exportedCount) ? exportedCount : 0,
      scopeLabel: "matching checkout rows",
      total: res.headers.get("X-Total-Count"),
      truncated: res.headers.get("X-Truncated") === "true",
    });

    if (completionToast.variant === "warning") {
      toast.warning(completionToast.message);
    } else {
      toast.success(completionToast.message);
    }
  } catch (err) {
    if (isAbortError(err)) return;
    toast.error("Checkouts report CSV export failed. Check your connection and try again.");
  }
}

export default function CheckoutsReportPage() {
  const [now, setNow] = useState(() => new Date());
  const period = useReportPeriod({
    defaultValue: DEFAULT_CHECKOUT_PERIOD,
    paramName: "days",
    values: VALID_CHECKOUT_PERIODS,
  });
  const days = period.days;
  // A day selected inside one window is meaningless in another.
  const [focusDate, setFocusDate] = useSyncedDraft(days, (): string | null => null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { data, loading, refreshing, error, lastRefreshed, reload } = useFetch<CheckoutData>({
    url: `/api/reports/checkouts?days=${days}${focusDate ? `&date=${focusDate}` : ""}`,
    keepPreviousData: true,
  });

  if (loading && !data) return <ReportLoadingState metricCount={2} rows={6} />;

  if (error && !data) {
    return (
      <ReportErrorState
        error={error}
        onRetry={reload}
        title="Failed to load checkout report"
      />
    );
  }

  if (!data) return null;

  const trendCounts = (data.dailyTrend ?? []).map((point) => point.count);
  const activeFilters = [
    ...period.activeFilters,
    ...(focusDate
      ? [{
          key: "date",
          label: `Day: ${formatDateFull(`${focusDate}T00:00:00.000Z`, true)}`,
          onRemove: () => setFocusDate(null),
        }]
      : []),
  ];

  return (
    <FadeUp>
      {/* Period selector */}
      <ReportToolbar
        activeFilters={activeFilters}
        lastRefreshed={lastRefreshed}
        loading={loading || refreshing}
        now={now}
        onRefresh={reload}
        exportAction={(data.recentCheckouts ?? []).length > 0 ? (
          <ReportExportButton
            ariaLabel="Export matching checkout rows CSV"
            label="Export matching rows"
            onClick={() => downloadCheckoutCsv(days)}
          />
        ) : null}
      >
        <ReportToolbarGroup label="Period">
          <ReportSegmentedControl
            ariaLabel="Checkout report period"
            value={days}
            options={[
              { value: 7, label: "7d" },
              { value: 30, label: "30d" },
              { value: 90, label: "90d" },
            ]}
            onChange={period.setDays}
          />
        </ReportToolbarGroup>
      </ReportToolbar>

      <ReportDataRegion refreshing={refreshing}>
        <OperationalPartialResultsAlert
          className="mb-4"
          failureLabel="Unavailable sections"
          failures={data.partialFailures ?? []}
          noun="section"
          recoveryCopy="Refresh before treating zeros or empty sections as final."
          title="Some checkout data did not load"
        />
        {/* Summary metrics */}
        <ReportMetricGrid>
          <MetricCard
            value={data.totalCheckouts}
            label={`Checkouts (${days}d)`}
            tooltip="Checkouts created in the selected period"
            href="/bookings?tab=checkouts"
            delta={buildPeriodDelta({
              current: data.totalCheckouts,
              days,
              previous: data.previousTotalCheckouts,
            })}
            sparkline={trendCounts.length > 1 ? toSparklinePoints(trendCounts) : undefined}
          />
          <MetricCard
            value={data.overdueCheckouts}
            label="Currently overdue"
            color={data.overdueCheckouts > 0 ? "var(--red)" : undefined}
            tooltip="Checkouts currently past their return date"
            href="/checkouts?filter=overdue"
          />
        </ReportMetricGrid>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2 mb-4">
        {(data.dailyTrend ?? []).length > 1 && (
          <LazyCheckoutTrendChart
            dailyTrend={data.dailyTrend!}
            days={days}
            onSelectDate={setFocusDate}
            selectedDate={focusDate}
          />
        )}
        {(data.topRequesters ?? []).length > 0 && (
          <LazyTopRequestersChart topRequesters={data.topRequesters} days={days} />
        )}
      </div>

      {/* Activity heatmap (365 days) */}
      {data.heatmap && data.heatmap.length > 0 && (
        <ReportSectionCard
          title="Checkout activity (past year)"
          description="Select a day to filter the checkout list"
          contentClassName="overflow-x-auto"
        >
            <LazyHeatmap
              data={data.heatmap}
              startDate={new Date(now.getTime() - 365 * 86_400_000)}
              endDate={now}
              colorMode="interpolate"
              cellSize={12}
              gap={2}
              valueDisplayFunction={(v) => `${v} checkout${v === 1 ? "" : "s"}`}
              onSelectDate={(date) => setFocusDate(date === focusDate ? null : date)}
              selectedDate={focusDate}
            />
        </ReportSectionCard>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Recent checkouts */}
        <ReportSectionCard
          title={focusDate ? `Checkouts on ${formatDateFull(`${focusDate}T00:00:00.000Z`, true)}` : "Recent checkouts"}
          contentClassName="p-0"
        >
          {(data.recentCheckouts ?? []).length === 0 ? (
            <ReportEmptyState
              icon="clipboard"
              title={focusDate ? "No checkouts on this day" : "No checkouts in this period"}
              description={
                focusDate
                  ? "Pick another day, or clear the day filter to see recent activity."
                  : "Try a longer period or clear filters to inspect older checkout activity."
              }
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Requester</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentCheckouts.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <ReportTableLink href={`/checkouts/${c.id}`}>{c.title}</ReportTableLink>
                        </TableCell>
                        <TableCell>{c.requester}</TableCell>
                        <TableCell>{formatDateFull(c.endsAt)}</TableCell>
                        <TableCell className="tabular-nums">{c.itemCount}</TableCell>
                        <TableCell><StatusBadge status={c.status} isOverdue={c.isOverdue} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden">
                {data.recentCheckouts.map((c) => (
                  <CheckoutMobileCard key={c.id} c={c} />
                ))}
              </div>
            </>
          )}
        </ReportSectionCard>

        {/* Top requesters */}
        <ReportSectionCard title="Top requesters" contentClassName="p-0">
          {(data.topRequesters ?? []).length === 0 ? (
            <ReportEmptyState
              icon="users"
              title="No requesters in this period"
              description="Requester rankings appear after checkout activity exists for the selected period."
            />
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Checkouts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topRequesters.map((r) => (
                      <TableRow key={r.name}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="md:hidden">
                {data.topRequesters.map((r) => (
                  <ReportListRow key={r.name}>
                    <span>{r.name}</span>
                    <span className="text-muted-foreground tabular-nums">{r.count}</span>
                  </ReportListRow>
                ))}
              </div>
            </>
          )}
        </ReportSectionCard>
      </div>
      </ReportDataRegion>
    </FadeUp>
  );
}
