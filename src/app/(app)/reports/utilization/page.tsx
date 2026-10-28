"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "@/lib/toast";
import MetricCard from "../MetricCard";
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
import { formatDateFull } from "@/lib/format";
import {
  ReportBreakdownTable,
  ReportChartLoading,
  ReportDataRegion,
  ReportEmptyState,
  ReportErrorState,
  ReportExportButton,
  ReportListRow,
  ReportLoadingState,
  ReportMetricGrid,
  ReportSectionCard,
  ReportSegmentedControl,
  ReportTableLink,
  ReportToolbar,
  ReportToolbarGroup,
  type ReportBreakdownRow,
} from "../report-ui";
import { useReportPeriod } from "../use-report-period";
import { handleAuthRedirect, isAbortError } from "@/lib/errors";
import {
  getReportExportCompletionToast,
  getReportExportFilename,
  readReportExportFailureMessage,
} from "../report-export";

const LazyStatusDonut = dynamic(
  () => import("./charts").then((m) => ({ default: m.StatusDonut })),
  { ssr: false, loading: () => <ReportChartLoading heightClassName="h-[300px]" variant="donut" /> }
);
const LazyTopUsedChart = dynamic(
  () => import("./charts").then((m) => ({ default: m.TopUsedChart })),
  { ssr: false, loading: () => <ReportChartLoading /> }
);

const UTILIZATION_PERIODS = [30, 90, 365] as const;
const DEFAULT_UTILIZATION_PERIOD = 90;

type IdleAsset = {
  assetId: string;
  assetTag: string;
  category: string;
  lastCheckedOutAt: string | null;
  name: string;
  purchasePrice: number | null;
};

type TopUsedAsset = {
  assetId: string;
  assetTag: string;
  checkouts: number;
  custodyDays: number;
  name: string;
  utilizationRate: number;
};

type UtilizationData = {
  activeAssets: number;
  days: number;
  partialFailures?: string[];
  totalAssets: number;
  statusCounts: Record<string, number>;
  byLocation: { location: string; locationId: string; count: number }[];
  byType: { type: string; count: number }[];
  byCategory: { category: string; categoryId: string; count: number }[];
  byDepartment: { department: string; departmentId: string; count: number }[];
  custody: {
    assetsUsed: number;
    checkoutCount: number;
    custodyDays: number;
    idleAssets: IdleAsset[];
    idleCount: number;
    idlePricedCount: number;
    idleValue: number;
    neverCheckedOutCount: number;
    topUsed: TopUsedAsset[];
    utilizationRate: number;
  };
};

function formatPercent(rate: number) {
  const pct = rate * 100;
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatDays(value: number) {
  return value >= 10 ? Math.round(value).toLocaleString() : value.toFixed(1);
}

async function downloadUtilizationCsv(days: number) {
  try {
    const res = await fetch(`/api/reports/utilization?format=csv&days=${days}`);
    if (handleAuthRedirect(res, "/reports/utilization")) return;

    if (!res.ok) {
      toast.error(await readReportExportFailureMessage(res, "Utilization report"));
      return;
    }

    const blob = await res.blob();
    const filename = getReportExportFilename(
      res.headers.get("Content-Disposition"),
      "utilization-report.csv",
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
      reportLabel: "Utilization report",
      rowCount: Number.isFinite(exportedCount) ? exportedCount : 0,
      scopeLabel: "inventory rows",
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
    toast.error("Utilization report CSV export failed. Check your connection and try again.");
  }
}

function IdleGearCard({ assets, days }: { assets: IdleAsset[]; days: number }) {
  return (
    <ReportSectionCard
      title="Idle gear"
      description={`Highest-value assets with no custody in the past ${days} days`}
      contentClassName="p-0"
    >
      {assets.length === 0 ? (
        <ReportEmptyState
          compact
          icon="check"
          title="Everything moved this period"
          description="Every active asset spent at least some time checked out."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Last checked out</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((asset) => (
                  <TableRow key={asset.assetId}>
                    <TableCell>
                      <ReportTableLink href={`/items/${asset.assetId}`}>
                        {asset.assetTag}
                      </ReportTableLink>
                      {asset.name ? (
                        <span className="block text-xs text-muted-foreground">{asset.name}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{asset.category || "--"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {asset.purchasePrice === null ? "--" : formatCurrency(asset.purchasePrice)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {asset.lastCheckedOutAt ? formatDateFull(asset.lastCheckedOutAt) : "Never"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden">
            {assets.map((asset) => (
              <ReportListRow key={asset.assetId}>
                <div className="min-w-0">
                  <ReportTableLink href={`/items/${asset.assetId}`}>{asset.assetTag}</ReportTableLink>
                  <span className="block truncate text-xs text-muted-foreground">
                    {asset.lastCheckedOutAt
                      ? `Last out ${formatDateFull(asset.lastCheckedOutAt)}`
                      : "Never checked out"}
                  </span>
                </div>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {asset.purchasePrice === null ? "--" : formatCurrency(asset.purchasePrice)}
                </span>
              </ReportListRow>
            ))}
          </div>
        </>
      )}
    </ReportSectionCard>
  );
}

export default function UtilizationPage() {
  const [now, setNow] = useState(() => new Date());
  const period = useReportPeriod({
    defaultValue: DEFAULT_UTILIZATION_PERIOD,
    paramName: "days",
    values: UTILIZATION_PERIODS,
  });

  // Update "ago" display every 60s
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { data, loading, refreshing, error, lastRefreshed, reload } = useFetch<UtilizationData>({
    url: `/api/reports/utilization?days=${period.days}`,
    keepPreviousData: true,
  });

  if (loading && !data) {
    return <ReportLoadingState metricCount={5} rows={5} />;
  }

  if (error && !data) {
    return (
      <ReportErrorState
        error={error}
        onRetry={reload}
        title="Failed to load utilization report"
      />
    );
  }

  if (!data) return null;

  const { custody } = data;
  const usedShare = data.activeAssets > 0 ? custody.assetsUsed / data.activeAssets : 0;

  const locationRows: ReportBreakdownRow[] = (data.byLocation ?? []).map((row) => ({
    count: row.count,
    href: `/items?location=${encodeURIComponent(row.locationId)}`,
    label: row.location,
  }));
  const categoryRows: ReportBreakdownRow[] = (data.byCategory ?? []).map((row) => ({
    count: row.count,
    href: `/items?category=${encodeURIComponent(row.categoryId)}`,
    label: row.category,
  }));
  const departmentRows: ReportBreakdownRow[] = (data.byDepartment ?? []).map((row) => ({
    count: row.count,
    href: `/items?department=${encodeURIComponent(row.departmentId)}`,
    label: row.department,
  }));
  // Asset `type` is a free-text column with no matching items filter, so these
  // rows stay informational rather than drillable.
  const typeRows: ReportBreakdownRow[] = (data.byType ?? []).map((row) => ({
    count: row.count,
    label: row.type,
  }));

  return (
    <FadeUp>
      <ReportToolbar
        activeFilters={period.activeFilters}
        lastRefreshed={lastRefreshed}
        loading={loading || refreshing}
        now={now}
        onRefresh={reload}
        exportAction={(
          <ReportExportButton
            ariaLabel="Export utilization inventory rows CSV"
            label="Export inventory rows"
            onClick={() => downloadUtilizationCsv(period.days)}
          />
        )}
      >
        <ReportToolbarGroup label="Period">
          <ReportSegmentedControl
            ariaLabel="Utilization report period"
            value={period.days}
            options={UTILIZATION_PERIODS.map((value) => ({
              value,
              label: value === 365 ? "1y" : `${value}d`,
            }))}
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
          title="Some utilization data did not load"
        />
        <ReportMetricGrid>
          <MetricCard
            value={formatPercent(custody.utilizationRate)}
            label="Utilization"
            tooltip={`Share of available asset-days spent in someone's custody over ${period.days} days`}
            helper={`${data.activeAssets} active assets`}
          />
          <MetricCard
            value={formatDays(custody.custodyDays)}
            label="Days in custody"
            tooltip="Total asset-days checked out during the period"
            helper={`${custody.checkoutCount} checkout${custody.checkoutCount === 1 ? "" : "s"}`}
          />
          <MetricCard
            value={custody.assetsUsed}
            label="Gear used"
            tooltip="Distinct assets checked out at least once in the period"
            helper={`${formatPercent(usedShare)} of active gear`}
          />
          <MetricCard
            value={custody.idleCount}
            label="Idle this period"
            color={custody.idleCount > 0 ? "var(--orange)" : undefined}
            tooltip="Active assets with no custody during the period"
            href="/items"
            helper={
              custody.idlePricedCount > 0
                ? `${formatCurrency(custody.idleValue)} across ${custody.idlePricedCount} priced`
                : undefined
            }
          />
          <MetricCard
            value={custody.neverCheckedOutCount}
            label="Never checked out"
            color={custody.neverCheckedOutCount > 0 ? "var(--red)" : undefined}
            tooltip="Active assets with no checkout history at all"
            href="/items"
          />
        </ReportMetricGrid>

        <div className="mb-4 grid gap-4 md:grid-cols-2">
          <LazyTopUsedChart assets={custody.topUsed} days={period.days} />
          <LazyStatusDonut statusCounts={data.statusCounts} />
        </div>

        <div className="mb-4">
          <IdleGearCard assets={custody.idleAssets} days={period.days} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ReportSectionCard title="By location" contentClassName="p-0">
            <ReportBreakdownTable
              labelHeading="Location"
              valueHeading="Assets"
              rows={locationRows}
              total={data.totalAssets}
            />
          </ReportSectionCard>
          <ReportSectionCard title="By category" contentClassName="p-0">
            <ReportBreakdownTable
              labelHeading="Category"
              valueHeading="Assets"
              rows={categoryRows}
              total={data.totalAssets}
              emptyTitle="No categories assigned"
              emptyDescription="Assign categories to items to see this breakdown."
            />
          </ReportSectionCard>
          <ReportSectionCard title="By type" contentClassName="p-0">
            <ReportBreakdownTable
              labelHeading="Type"
              valueHeading="Assets"
              rows={typeRows}
              total={data.totalAssets}
            />
          </ReportSectionCard>
          {departmentRows.length > 0 ? (
            <ReportSectionCard title="By department" contentClassName="p-0">
              <ReportBreakdownTable
                labelHeading="Department"
                valueHeading="Assets"
                rows={departmentRows}
                total={data.totalAssets}
              />
            </ReportSectionCard>
          ) : null}
        </div>
      </ReportDataRegion>
    </FadeUp>
  );
}
