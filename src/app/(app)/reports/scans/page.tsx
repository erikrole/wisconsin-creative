"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/format";
import MetricCard from "../MetricCard";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FadeUp } from "@/components/ui/motion";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, isAbortError } from "@/lib/errors";
import { syncUrl } from "@/lib/url-sync";
import dynamic from "next/dynamic";

const LazyDailyScanVolumeChart = dynamic(
  () => import("./charts").then((m) => ({ default: m.DailyScanVolumeChart })),
  { ssr: false }
);
import {
  ReportDataRegion,
  ReportEmptyState,
  ReportErrorState,
  ReportExportButton,
  ReportLoadingState,
  ReportMetricGrid,
  ReportMobileCard,
  ReportPaginationFooter,
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

type ScanEntry = {
  id: string;
  actor: string;
  scanType: string;
  scanValue: string;
  success: boolean;
  phase: string;
  item: string;
  bookingId: string;
  bookingTitle: string;
  createdAt: string;
};

type ScanData = {
  data: ScanEntry[];
  total: number;
  previousTotal?: number | null;
  previousSuccessRate?: number | null;
  successCount: number;
  successRate: number;
  dailyScans: { date: string; success: number; fail: number }[];
  limit: number;
  offset: number;
};

const PHASE_ALL = "ALL";
const VALID_PERIODS = [0, 7, 30, 90] as const;
type PhaseFilter = typeof PHASE_ALL | "CHECKOUT" | "CHECKIN";

function parsePageParam(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed - 1 : 0;
}

function parsePhaseParam(value: string | null): PhaseFilter {
  return value === "CHECKOUT" || value === "CHECKIN" ? value : PHASE_ALL;
}

function ScanMobileCard({ s }: { s: ScanEntry }) {
  return (
    <ReportMobileCard>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={s.phase === "CHECKOUT" ? "blue" : "purple"}>
            {s.phase.toLowerCase()}
          </Badge>
          <Badge variant={s.success ? "green" : "red"}>
            {s.success ? "ok" : "fail"}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">{formatDateTime(s.createdAt)}</span>
      </div>
      <div className="text-sm">
        <span className="text-muted-foreground">{s.actor}</span> scanned <span className="font-mono">{s.item}</span>
      </div>
      <ReportTableLink href={`/checkouts/${s.bookingId}`} className="text-sm">
        {s.bookingTitle}
      </ReportTableLink>
    </ReportMobileCard>
  );
}

function periodStartDate(periodDays: number) {
  return periodDays > 0
    ? new Date(Date.now() - periodDays * 86_400_000).toISOString()
    : null;
}

function buildScanReportParams(
  periodDays: number,
  phaseFilter: PhaseFilter,
  paging?: { limit: number; offset: number },
) {
  const params = new URLSearchParams();
  if (paging) {
    params.set("limit", String(paging.limit));
    params.set("offset", String(paging.offset));
  }
  if (phaseFilter !== PHASE_ALL) params.set("phase", phaseFilter);
  const startDate = periodStartDate(periodDays);
  if (startDate) params.set("startDate", startDate);
  return params;
}

async function downloadScanCsv(periodDays: number, phaseFilter: PhaseFilter) {
  const params = buildScanReportParams(periodDays, phaseFilter);
  params.set("format", "csv");

  try {
    const res = await fetch(`/api/reports/scans?${params.toString()}`);
    if (handleAuthRedirect(res, "/reports/scans")) return;

    if (!res.ok) {
      toast.error(await readReportExportFailureMessage(res, "Scan report"));
      return;
    }

    const blob = await res.blob();
    const filename = getReportExportFilename(
      res.headers.get("Content-Disposition"),
      "scan-report.csv",
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
      reportLabel: "Scan report",
      rowCount: Number.isFinite(exportedCount) ? exportedCount : 0,
      scopeLabel: "matching scan events",
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
    toast.error("Scan report CSV export failed. Check your connection and try again.");
  }
}

export default function ScanHistoryPage() {
  const searchParams = useSearchParams();
  const [page, setPage] = useState(() => parsePageParam(searchParams.get("page")));
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>(() => parsePhaseParam(searchParams.get("phase")));
  const period = useReportPeriod({
    defaultValue: 0,
    paramName: "period",
    values: VALID_PERIODS,
  });
  const periodDays = period.days;
  const [now, setNow] = useState(() => new Date());
  const limit = 50;

  // Any filter change invalidates the current offset.
  function changePeriod(nextPeriod: number) {
    period.setDays(nextPeriod);
    setPage(0);
    syncUrl({ page: "" });
  }

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const nextPage = parsePageParam(searchParams.get("page"));
    const nextPhase = parsePhaseParam(searchParams.get("phase"));
    setPage((current) => (current === nextPage ? current : nextPage));
    setPhaseFilter((current) => (current === nextPhase ? current : nextPhase));

    const corrections: Record<string, string | number> = {};
    if (searchParams.get("page") && nextPage === 0) {
      corrections.page = "";
    }
    if (searchParams.get("phase") && nextPhase === PHASE_ALL) {
      corrections.phase = "";
    }
    if (Object.keys(corrections).length > 0) {
      syncUrl(corrections);
    }
  }, [searchParams]);

  const fetchUrl = useMemo(() => {
    const params = buildScanReportParams(periodDays, phaseFilter, {
      limit,
      offset: page * limit,
    });
    return `/api/reports/scans?${params}`;
  }, [page, phaseFilter, periodDays]);

  const { data, loading, refreshing, error, lastRefreshed, reload } = useFetch<ScanData>({
    url: fetchUrl,
    transform: (json) => json as unknown as ScanData,
    keepPreviousData: true,
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  useEffect(() => {
    if (!data || page === 0) return;
    const lastPage = Math.max(0, totalPages - 1);
    if (page > lastPage) {
      setPage(lastPage);
      syncUrl({ page: lastPage > 0 ? lastPage + 1 : "" });
    }
  }, [data, page, totalPages]);

  if (loading && !data) return <ReportLoadingState metricCount={2} rows={8} />;

  if (error && !data) {
    return (
      <ReportErrorState
        error={error}
        onRetry={() => {
          setPage(0);
          reload();
        }}
        title="Failed to load scan report"
      />
    );
  }

  if (!data) return null;

  const entries = data.data ?? [];
  const scanVolumeTrend = (data.dailyScans ?? []).map((day) => day.success + day.fail);
  const activeFilters = [
    ...(periodDays > 0
      ? [{
          key: "period",
          label: `Period: ${periodDays}d`,
          onRemove: () => changePeriod(0),
        }]
      : []),
    ...(phaseFilter !== PHASE_ALL
      ? [{
          key: "phase",
          label: `Phase: ${phaseFilter === "CHECKOUT" ? "Checkout" : "Check-in"}`,
          onRemove: () => {
            setPhaseFilter(PHASE_ALL);
            setPage(0);
            syncUrl({ phase: "", page: "" });
          },
        }]
      : []),
  ];

  return (
    <FadeUp>
      {/* Filters */}
      <ReportToolbar
        activeFilters={activeFilters}
        lastRefreshed={lastRefreshed}
        loading={loading}
        now={now}
        onRefresh={reload}
        exportAction={entries.length > 0 ? (
          <ReportExportButton
            ariaLabel="Export matching scan events CSV"
            label="Export matching rows"
            onClick={() => downloadScanCsv(periodDays, phaseFilter)}
          />
        ) : null}
      >
        <ReportToolbarGroup label="Period">
          <ReportSegmentedControl
            ariaLabel="Scan report period"
            value={periodDays}
            options={[
              { value: 0, label: "All" },
              { value: 7, label: "7d" },
              { value: 30, label: "30d" },
              { value: 90, label: "90d" },
            ]}
            onChange={changePeriod}
          />
        </ReportToolbarGroup>
        <ReportToolbarGroup label="Phase">
          <ReportSegmentedControl
            ariaLabel="Scan report phase"
            value={phaseFilter}
            options={[
              { value: PHASE_ALL, label: "All" },
              { value: "CHECKOUT", label: "Checkout" },
              { value: "CHECKIN", label: "Check-in" },
            ]}
            onChange={(nextPhase) => {
              setPhaseFilter(nextPhase);
              setPage(0);
              syncUrl({ phase: nextPhase === PHASE_ALL ? "" : nextPhase, page: "" });
            }}
          />
        </ReportToolbarGroup>
      </ReportToolbar>

      <ReportDataRegion refreshing={refreshing}>
      <ReportMetricGrid>
        <MetricCard
          value={data.total}
          label="Total scans"
          tooltip="Total scan events in the selected period"
          delta={buildPeriodDelta({
            current: data.total,
            days: periodDays,
            previous: data.previousTotal,
          })}
          sparkline={scanVolumeTrend.length > 1 ? toSparklinePoints(scanVolumeTrend) : undefined}
        />
        <MetricCard
          value={`${data.successRate}%`}
          label="Success rate"
          color={data.successRate < 95 ? "var(--red)" : undefined}
          tooltip="Percentage of scans that matched an asset"
          delta={buildPeriodDelta({
            current: data.successRate,
            days: periodDays,
            mode: "points",
            previous: data.previousSuccessRate,
          })}
        />
      </ReportMetricGrid>

      {data.dailyScans && data.dailyScans.length > 1 && (
        <LazyDailyScanVolumeChart dailyScans={data.dailyScans} />
      )}

      <ReportSectionCard title="Scan history" description={`${data.total} events`} contentClassName="p-0">

        {entries.length === 0 ? (
          <ReportEmptyState
            icon="search"
            title="No scan events recorded"
            description="Try another phase or period to inspect older scan activity."
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Phase</TableHead>
                    <TableHead>Booking</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-sm">{formatDateTime(s.createdAt)}</TableCell>
                      <TableCell>{s.actor}</TableCell>
                      <TableCell className="font-mono text-sm">{s.item}</TableCell>
                      <TableCell>
                        <Badge variant={s.phase === "CHECKOUT" ? "blue" : "purple"}>
                          {s.phase.toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ReportTableLink href={`/checkouts/${s.bookingId}`} className="text-sm">
                          {s.bookingTitle}
                        </ReportTableLink>
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.success ? "green" : "red"}>
                          {s.success ? "ok" : "fail"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden">
              {entries.map((s) => (
                <ScanMobileCard key={s.id} s={s} />
              ))}
            </div>

            {totalPages > 1 && (
              <>
                <Separator />
                <ReportPaginationFooter
                  page={page}
                  totalPages={totalPages}
                  onPrevious={() => {
                    setPage(page - 1);
                    syncUrl({ page: page === 1 ? "" : page });
                  }}
                  onNext={() => {
                    setPage(page + 1);
                    syncUrl({ page: page + 2 });
                  }}
                />
              </>
            )}
          </>
        )}
      </ReportSectionCard>
      </ReportDataRegion>
    </FadeUp>
  );
}
