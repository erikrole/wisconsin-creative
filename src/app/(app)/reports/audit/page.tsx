"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "@/lib/toast";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, isAbortError } from "@/lib/errors";
import { syncUrl } from "@/lib/url-sync";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { NativeSelect } from "@/components/ui/native-select";
import { FadeUp } from "@/components/ui/motion";
import dynamic from "next/dynamic";
import MetricCard from "../MetricCard";
import ActivityTimeline, { TimelineSkeleton, type AuditEntry as TimelineEntry } from "@/components/ActivityTimeline";
import { AUDIT_RETENTION_DAYS } from "@/lib/audit-retention";
import { AUDIT_CATEGORIES, AUDIT_CATEGORY_LABELS } from "@/lib/audit-actions";

const LazyActionBreakdownChart = dynamic(
  () => import("./charts").then((m) => ({ default: m.ActionBreakdownChart })),
  { ssr: false }
);
const LazyEntityTypeBreakdownChart = dynamic(
  () => import("./charts").then((m) => ({ default: m.EntityTypeBreakdownChart })),
  { ssr: false }
);
import {
  ReportDataRegion,
  ReportEmptyState,
  ReportErrorState,
  ReportExportButton,
  ReportMetricGrid,
  ReportPaginationFooter,
  ReportSegmentedControl,
  ReportSectionCard,
  ReportToolbar,
  ReportToolbarGroup,
} from "../report-ui";
import { buildPeriodDelta, useReportPeriod } from "../use-report-period";
import {
  getReportExportCompletionToast,
  getReportExportFilename,
  readReportExportFailureMessage,
} from "../report-export";

type AuditEntry = {
  id: string;
  actor: string;
  actorId?: string | null;
  actorAvatarUrl?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  createdAt: string;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
};

type AuditData = {
  data: AuditEntry[];
  total: number;
  previousTotal?: number | null;
  byAction: { action: string; count: number }[];
  byEntityType: { entityType: string; count: number }[];
  limit: number;
  offset: number;
};

const VALID_PERIODS = [0, 7, 30, 90] as const;

function parsePageParam(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed - 1 : 0;
}

/** Convert the report API shape to the shared AuditEntry shape */
function toTimelineEntries(entries: AuditEntry[]): TimelineEntry[] {
  return entries.map((e) => ({
    id: e.id,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    createdAt: e.createdAt,
    beforeJson: e.beforeJson ?? null,
    afterJson: e.afterJson ?? null,
    actor: {
      id: e.actorId ?? undefined,
      name: e.actor,
      avatarUrl: e.actorAvatarUrl ?? null,
    },
  }));
}

function periodStartDate(periodDays: number) {
  return periodDays > 0
    ? new Date(Date.now() - periodDays * 86_400_000).toISOString()
    : null;
}

type AuditFilters = { entityType: string; action: string; category: string; actor: string };

/** "checkin_completed" -> "Checkin completed", "kioskDevice" -> "Kiosk device". */
function humanize(value: string) {
  const spaced = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function buildAuditReportParams(
  periodDays: number,
  filters: AuditFilters,
  paging?: { limit: number; offset: number },
) {
  const params = new URLSearchParams();
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (filters.action) params.set("action", filters.action);
  if (filters.category) params.set("category", filters.category);
  if (filters.actor) params.set("actor", filters.actor);
  if (paging) {
    params.set("limit", String(paging.limit));
    params.set("offset", String(paging.offset));
  }
  const startDate = periodStartDate(periodDays);
  if (startDate) params.set("startDate", startDate);
  return params;
}

async function downloadAuditCsv(periodDays: number, filters: AuditFilters) {
  const params = buildAuditReportParams(periodDays, filters);
  params.set("format", "csv");

  try {
    const res = await fetch(`/api/reports/audit?${params.toString()}`);
    if (handleAuthRedirect(res, "/reports/audit")) return;

    if (!res.ok) {
      toast.error(await readReportExportFailureMessage(res, "Audit"));
      return;
    }

    const blob = await res.blob();
    const filename = getReportExportFilename(
      res.headers.get("Content-Disposition"),
      "audit-report.csv",
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
      reportLabel: "Audit",
      rowCount: Number.isFinite(exportedCount) ? exportedCount : 0,
      scopeLabel: "matching audit entries",
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
    toast.error("Audit CSV export failed. Check your connection and try again.");
  }
}

export default function AuditReportPage() {
  const searchParams = useSearchParams();
  const [page, setPage] = useState(() => parsePageParam(searchParams.get("page")));
  const period = useReportPeriod({
    defaultValue: 0,
    paramName: "period",
    values: VALID_PERIODS,
  });
  const periodDays = period.days;
  const [now, setNow] = useState(() => new Date());
  const limit = 25;
  const [filters, setFilters] = useState<AuditFilters>(() => ({
    entityType: searchParams.get("entityType") ?? "",
    action: searchParams.get("action") ?? "",
    category: searchParams.get("category") ?? "",
    actor: searchParams.get("actor") ?? "",
  }));

  function changeFilter(key: keyof AuditFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(0);
    syncUrl({ [key]: value, page: "" });
  }

  // Changing the window invalidates the current offset.
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
    setPage((current) => (current === nextPage ? current : nextPage));

    const corrections: Record<string, string | number> = {};
    if (searchParams.get("page") && nextPage === 0) {
      corrections.page = "";
    }
    if (Object.keys(corrections).length > 0) {
      syncUrl(corrections);
    }
  }, [searchParams]);

  const fetchUrl = useMemo(() => {
    const params = buildAuditReportParams(periodDays, filters, {
      limit,
      offset: page * limit,
    });
    return `/api/reports/audit?${params}`;
  }, [filters, page, periodDays]);

  const { data, loading, refreshing, error, lastRefreshed, reload: loadData } = useFetch<AuditData>({
    url: fetchUrl,
    transform: (json) => json as unknown as AuditData,
    keepPreviousData: true,
  });

  const { data: actors } = useFetch<{ id: string; name: string }[]>({
    url: "/api/reports/audit/actors",
    transform: (json) => (json as unknown as { data: { id: string; name: string }[] }).data,
  });

  const auditRows = data?.data;
  const timelineEntries = useMemo(
    () => (auditRows ? toTimelineEntries(auditRows) : []),
    [auditRows],
  );
  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  useEffect(() => {
    if (!data || page === 0) return;
    const lastPage = Math.max(0, totalPages - 1);
    if (page > lastPage) {
      setPage(lastPage);
      syncUrl({ page: lastPage > 0 ? lastPage + 1 : "" });
    }
  }, [data, page, totalPages]);

  if (loading && !data) {
    return (
      <Card className="p-0">
        <TimelineSkeleton />
      </Card>
    );
  }

  if (error && !data) {
    return (
      <ReportErrorState
        error={error}
        onRetry={loadData}
        title="Failed to load audit report"
      />
    );
  }

  if (!data) return null;

  const entries = data.data ?? [];
  const activeFilters = [
    ...(periodDays > 0
      ? [{ key: "period", label: `Period: ${periodDays}d`, onRemove: () => changePeriod(0) }]
      : []),
    ...(filters.category
      ? [{ key: "category", label: AUDIT_CATEGORY_LABELS[filters.category as keyof typeof AUDIT_CATEGORY_LABELS] ?? humanize(filters.category), onRemove: () => changeFilter("category", "") }]
      : []),
    ...(filters.actor
      ? [{ key: "actor", label: actors?.find((a) => a.id === filters.actor)?.name ?? "One person", onRemove: () => changeFilter("actor", "") }]
      : []),
    ...(filters.entityType
      ? [{ key: "entityType", label: humanize(filters.entityType), onRemove: () => changeFilter("entityType", "") }]
      : []),
    ...(filters.action
      ? [{ key: "action", label: humanize(filters.action), onRemove: () => changeFilter("action", "") }]
      : []),
  ];
  return (
    <FadeUp>
      {/* Retention notice */}
      <p className="text-xs text-muted-foreground mb-2">
        Audit logs are retained for {AUDIT_RETENTION_DAYS} days. Older entries are automatically archived weekly.
      </p>

      {/* Filters */}
      <ReportToolbar
        activeFilters={activeFilters}
        lastRefreshed={lastRefreshed}
        loading={loading || refreshing}
        now={now}
        onRefresh={loadData}
        exportAction={entries.length > 0 ? (
          <ReportExportButton
            ariaLabel="Export matching audit entries CSV"
            label="Export matching rows"
            onClick={() => downloadAuditCsv(periodDays, filters)}
          />
        ) : null}
      >
        <ReportToolbarGroup label="Period">
          <ReportSegmentedControl
            ariaLabel="Audit report period"
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
        <ReportToolbarGroup label="Area">
          <NativeSelect
            aria-label="Filter by area"
            value={filters.category}
            onChange={(event) => changeFilter("category", event.target.value)}
            className="w-auto min-w-36 text-sm"
          >
            <option value="">Everything</option>
            {AUDIT_CATEGORIES.map((value) => (
              <option key={value} value={value}>{AUDIT_CATEGORY_LABELS[value]}</option>
            ))}
          </NativeSelect>
        </ReportToolbarGroup>
        <ReportToolbarGroup label="Person">
          <NativeSelect
            aria-label="Filter by person"
            value={filters.actor}
            onChange={(event) => changeFilter("actor", event.target.value)}
            className="w-auto min-w-36 text-sm"
          >
            <option value="">Everyone</option>
            {(actors ?? []).map((person) => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
          </NativeSelect>
        </ReportToolbarGroup>
      </ReportToolbar>

      <ReportDataRegion refreshing={refreshing}>
      <ReportMetricGrid>
        <MetricCard
          value={data.total}
          label="Total events"
          tooltip="Total audit entries in the selected period"
          delta={buildPeriodDelta({
            current: data.total,
            days: periodDays,
            goodDirection: "neutral",
            previous: data.previousTotal,
          })}
        />
      </ReportMetricGrid>

      {(data.byAction?.length > 0 || data.byEntityType?.length > 0) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
          {data.byAction?.length > 0 && <LazyActionBreakdownChart byAction={data.byAction} />}
          {data.byEntityType?.length > 0 && <LazyEntityTypeBreakdownChart byEntityType={data.byEntityType} />}
        </div>
      )}

      <ReportSectionCard title="Audit trail" description={`${data.total} entries`} contentClassName="p-0">

        {entries.length === 0 ? (
          <ReportEmptyState
            icon="clipboard"
            title="No audit log entries"
            description={activeFilters.length > 0 ? "Try clearing a filter or widening the period." : "Try a wider period to inspect older retained activity."}
          />
        ) : (
          <>
            <ActivityTimeline
              entries={timelineEntries}
              context="report"
              loading={loading}
            />

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
