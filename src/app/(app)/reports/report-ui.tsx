"use client";

import Link from "next/link";
import { useRef, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertCircle, Download, RefreshCw } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { OperationalActiveFilterChips, type OperationalActiveFilter } from "@/components/OperationalToolbar";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";
import {
  buildReportCsv,
  formatReportExportSuccess,
  reportExportFilename,
  reportLabelFromFilenameBase,
  type CsvValue,
} from "./report-export";

/** Radix Select forbids an empty item value, so "no filter" needs a sentinel. */
const REPORT_SELECT_ALL_VALUE = "__all__";

export const REPORT_CHART_COLORS = [
  "var(--report-chart-1)",
  "var(--report-chart-2)",
  "var(--report-chart-3)",
  "var(--report-chart-4)",
  "var(--report-chart-5)",
  "var(--report-chart-6)",
  "var(--report-chart-7)",
  "var(--report-chart-8)",
] as const;

export const REPORT_SEMANTIC_CHART_COLORS = {
  active: "var(--chart-1)",
  available: "var(--chart-2)",
  reserved: "var(--chart-3)",
  waiting: "var(--chart-4)",
  problem: "var(--chart-5)",
  neutral: "var(--text-muted)",
  activeSoft: "var(--report-chart-active-soft)",
} as const;

export const REPORT_OVERDUE_CHART_COLORS = [
  "var(--report-overdue-1)",
  "var(--report-overdue-2)",
  "var(--report-overdue-3)",
  "var(--report-overdue-4)",
  "var(--report-overdue-5)",
  "var(--report-overdue-6)",
  "var(--report-overdue-7)",
  "var(--report-overdue-8)",
  "var(--report-overdue-9)",
  "var(--report-overdue-10)",
] as const;

export function downloadReportCsv(
  filenameBase: string,
  rows: CsvValue[][],
  options?: { reportLabel?: string; rowCount?: number; scopeLabel?: string },
) {
  const blob = new Blob([buildReportCsv(rows)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = reportExportFilename(filenameBase);
  link.click();
  URL.revokeObjectURL(url);
  toast.success(formatReportExportSuccess({
    reportLabel: options?.reportLabel ?? reportLabelFromFilenameBase(filenameBase),
    rowCount: options?.rowCount ?? Math.max(0, rows.length - 1),
    scopeLabel: options?.scopeLabel,
  }));
}

export function ReportExportButton({
  ariaLabel,
  disabled,
  label = "Export visible rows",
  onClick,
}: {
  ariaLabel?: string;
  disabled?: boolean;
  label?: string;
  onClick: () => Promise<void> | void;
}) {
  const busyRef = useRef(false);
  const [exporting, setExporting] = useState(false);

  async function handleClick() {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    setExporting(true);
    try {
      await onClick();
    } finally {
      window.setTimeout(() => {
        busyRef.current = false;
        setExporting(false);
      }, 750);
    }
  }

  return (
    <Button className="h-10"
      variant="outline"
      disabled={disabled || exporting}
      onClick={handleClick}
      aria-label={ariaLabel ?? label}
    >
      <Download data-icon="inline-start" />
      {exporting ? "Exporting..." : label}
    </Button>
  );
}

export function ReportToolbar({
  activeFilters = [],
  children,
  className,
  exportAction,
  lastRefreshed,
  loading,
  now,
  onRefresh,
}: {
  activeFilters?: OperationalActiveFilter[];
  children?: ReactNode;
  className?: string;
  exportAction?: ReactNode;
  lastRefreshed?: Date | null;
  loading?: boolean;
  now: Date;
  onRefresh: () => void;
}) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-col gap-3 rounded-lg border bg-card/60 p-3 shadow-xs",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
        <div className="flex shrink-0 items-center gap-2 print:hidden">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onRefresh} aria-label="Refresh report">
                <RefreshCw className={cn(loading && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {lastRefreshed ? `Updated ${formatRelativeTime(lastRefreshed.toISOString(), now)}` : "Refresh"}
            </TooltipContent>
          </Tooltip>
          {exportAction}
        </div>
      </div>
      <OperationalActiveFilterChips filters={activeFilters} />
    </div>
  );
}

export function ReportToolbarGroup({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function ReportSegmentedControl<TValue extends string | number>({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  onChange: (value: TValue) => void;
  options: Array<{ label: string; value: TValue }>;
  value: TValue;
}) {
  return (
    <ToggleGroup
      type="single"
      value={String(value)}
      onValueChange={(nextValue) => {
        if (!nextValue) return;
        const next = options.find((option) => String(option.value) === nextValue);
        if (next) onChange(next.value);
      }}
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <ToggleGroupItem key={String(option.value)} value={String(option.value)}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Toolbar filter for option sets too long for a segmented control. */
export function ReportSelectControl({
  allLabel = "All",
  ariaLabel,
  onChange,
  options,
  value,
}: {
  allLabel?: string;
  ariaLabel: string;
  onChange: (value: string | null) => void;
  options: Array<{ id: string; name: string }>;
  value: string | null;
}) {
  return (
    <Select
      value={value ?? REPORT_SELECT_ALL_VALUE}
      onValueChange={(next) => onChange(next === REPORT_SELECT_ALL_VALUE ? null : next)}
    >
      <SelectTrigger size="sm" className="min-w-40" aria-label={ariaLabel}>
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={REPORT_SELECT_ALL_VALUE}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ReportMetricGrid({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
      {children}
    </div>
  );
}

/**
 * Wraps report body content so a background refresh reads as stale rather than
 * silently current. The toolbar spinner alone is easy to miss when the numbers
 * below it look settled.
 */
export function ReportDataRegion({
  children,
  refreshing,
}: {
  children: ReactNode;
  refreshing?: boolean;
}) {
  return (
    <div
      aria-busy={refreshing || undefined}
      className={cn(
        "transition-opacity duration-200 motion-reduce:transition-none",
        refreshing && "opacity-60",
      )}
    >
      {children}
    </div>
  );
}

/**
 * Compresses a daily series into a handful of points. A 90-day series drawn
 * across 64px is noise; averaged buckets keep the shape readable.
 */
export function toSparklinePoints(values: number[], buckets = 12) {
  if (values.length <= buckets) return values;

  const size = values.length / buckets;
  const points: number[] = [];
  for (let i = 0; i < buckets; i += 1) {
    const slice = values.slice(Math.floor(i * size), Math.floor((i + 1) * size));
    if (slice.length === 0) continue;
    points.push(slice.reduce((sum, value) => sum + value, 0) / slice.length);
  }
  return points;
}

export type ReportBreakdownRow = {
  count: number;
  /** Drill-down target. Rows without one render as plain text. */
  href?: string;
  label: string;
};

/**
 * Ranked breakdown with share-of-total context. Replaces the older
 * chart-plus-identical-table pairing: one row carries the label, the count, its
 * percentage, and a proportional bar, so it is both readable and comparable.
 */
export function ReportBreakdownTable({
  emptyDescription,
  emptyTitle = "Nothing to break down yet",
  initialLimit = 8,
  labelHeading,
  rows,
  total,
  valueHeading = "Count",
}: {
  emptyDescription?: string;
  emptyTitle?: string;
  initialLimit?: number;
  labelHeading: string;
  rows: ReportBreakdownRow[];
  /** Denominator for the share column. Defaults to the sum of the rows. */
  total?: number;
  valueHeading?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (rows.length === 0) {
    return <ReportEmptyState compact icon="chart" title={emptyTitle} description={emptyDescription} />;
  }

  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const denominator = total ?? sorted.reduce((sum, row) => sum + row.count, 0);
  const largest = sorted[0]?.count ?? 0;
  const visible = expanded ? sorted : sorted.slice(0, initialLimit);
  const hiddenCount = sorted.length - visible.length;

  return (
    <div>
      <div className="flex items-center justify-between gap-4 border-b px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>{labelHeading}</span>
        <span>{valueHeading}</span>
      </div>
      <ul className="list-none p-0">
        {visible.map((row) => {
          const share = denominator > 0 ? row.count / denominator : 0;
          // Bars are scaled to the largest row so small values stay visible.
          const barWidth = largest > 0 ? (row.count / largest) * 100 : 0;

          const content = (
            <>
              {/* Neutral magnitude track — deliberately not a categorical
                  palette color, since these bars encode size, not identity. */}
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 rounded-r-sm bg-muted-foreground/15"
                style={{ width: `${barWidth}%` }}
              />
              <span className="relative min-w-0 flex-1 truncate">{row.label}</span>
              <span className="relative shrink-0 tabular-nums">{row.count.toLocaleString()}</span>
              <span className="relative w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {(share * 100).toFixed(share < 0.1 ? 1 : 0)}%
              </span>
            </>
          );

          const rowClassName =
            "relative flex min-h-11 items-center gap-3 border-b px-4 py-2.5 text-sm last:border-b-0";

          return (
            <li key={row.label}>
              {row.href ? (
                <Link
                  href={row.href}
                  className={cn(
                    rowClassName,
                    "no-underline transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  )}
                >
                  {content}
                </Link>
              ) : (
                <div className={rowClassName}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 || expanded ? (
        <div className="border-t px-4 py-2 print:hidden">
          <Button
            variant="ghost"
            className="h-10 px-2 text-xs"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Show top rows" : `Show all ${sorted.length}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ReportSectionCard({
  children,
  className,
  contentClassName,
  description,
  title,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  description?: ReactNode;
  title: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="text-base text-balance">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className={cn("pt-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

export function ReportChartCard({
  children,
  className,
  contentClassName,
  description,
  title,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  description?: ReactNode;
  title: string;
}) {
  return (
    <ReportSectionCard
      title={title}
      description={description}
      className={className}
      contentClassName={cn("pt-1", contentClassName)}
    >
      {children}
    </ReportSectionCard>
  );
}

export function ReportChartLoading({
  heightClassName = "h-[200px]",
  variant = "bar",
}: {
  heightClassName?: string;
  variant?: "bar" | "donut";
}) {
  return (
    <Card className="p-4">
      <div className={cn("flex w-full items-center justify-center", heightClassName)}>
        <Skeleton
          className={cn(
            variant === "donut" ? "size-[250px] rounded-full" : "h-full w-full",
          )}
        />
      </div>
    </Card>
  );
}

export function ReportLoadingState({
  metricCount = 2,
  rows = 5,
}: {
  metricCount?: number;
  rows?: number;
}) {
  return (
    <>
      <ReportMetricGrid>
        {Array.from({ length: metricCount }, (_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="mb-3 h-7 w-16" />
            <Skeleton className="h-4 w-24" />
          </Card>
        ))}
      </ReportMetricGrid>
      <Card className="p-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex gap-4 py-2.5">
            <Skeleton className="h-4" style={{ width: `${65 - (i % 5) * 8}%` }} />
            <Skeleton className="ml-auto h-4 w-12" />
          </div>
        ))}
      </Card>
    </>
  );
}

export function ReportErrorState({
  error,
  onRetry,
  title,
}: {
  error?: string | null;
  onRetry: () => void;
  title: string;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span>
          {error === "network"
            ? "You appear to be offline. Check your connection and try again."
            : "Unable to load this report. Please try again."}
        </span>
        <Button variant="outline" onClick={onRetry} className="h-10 w-fit">
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function ReportEmptyState({
  compact = false,
  description,
  icon = "chart",
  title,
}: {
  compact?: boolean;
  description?: string;
  icon?: "search" | "calendar" | "box" | "clipboard" | "bell" | "users" | "folder" | "chart" | "wifi-off" | "check";
  title: string;
}) {
  return (
    <EmptyState
      compact={compact}
      description={description}
      icon={icon}
      title={title}
    />
  );
}

export function ReportPaginationFooter({
  onNext,
  onPrevious,
  page,
  totalPages,
}: {
  onNext: () => void;
  onPrevious: () => void;
  page: number;
  totalPages: number;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
      <span className="text-sm text-muted-foreground tabular-nums">
        Page {page + 1} of {totalPages}
      </span>
      <div className="flex gap-2">
        <Button className="h-10" variant="outline" disabled={page === 0} onClick={onPrevious}>
          Previous
        </Button>
        <Button className="h-10" variant="outline" disabled={page >= totalPages - 1} onClick={onNext}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function ReportTableLink({
  children,
  className,
  href,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  href: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function ReportMobileCard({
  children,
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-h-12 flex-col gap-2 border-b px-4 py-3 text-sm last:border-b-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function ReportMobileCardLink({
  children,
  className,
  href,
}: {
  children: ReactNode;
  className?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-12 flex-col gap-2 border-b px-4 py-3 text-sm no-underline transition-colors last:border-b-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function ReportListRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-12 items-center justify-between gap-4 border-b px-4 py-3 text-sm last:border-b-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ReportMetaLine({
  className,
  items,
}: {
  className?: string;
  items: Array<ReactNode | null | undefined | false>;
}) {
  const visibleItems = items.filter(Boolean);

  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground", className)}>
      {visibleItems.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-2">
          {index > 0 ? <span aria-hidden="true" className="text-muted-foreground/50">/</span> : null}
          <span>{item}</span>
        </span>
      ))}
    </div>
  );
}
