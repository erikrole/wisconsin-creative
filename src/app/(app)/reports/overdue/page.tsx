"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
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
import { useFetch } from "@/hooks/use-fetch";
import { BarChart, Bar, Cell, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  ReportDataRegion,
  ReportEmptyState,
  ReportErrorState,
  ReportExportButton,
  ReportLoadingState,
  ReportMetaLine,
  ReportMetricGrid,
  ReportMobileCard,
  REPORT_OVERDUE_CHART_COLORS,
  REPORT_SEMANTIC_CHART_COLORS,
  ReportSectionCard,
  ReportSelectControl,
  ReportTableLink,
  ReportToolbar,
  ReportToolbarGroup,
} from "../report-ui";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { syncUrl } from "@/lib/url-sync";
import { useCurrentUser } from "@/hooks/use-current-user";
import { handleAuthRedirect, isAbortError } from "@/lib/errors";
import {
  getReportExportCompletionToast,
  getReportExportFilename,
  readReportExportFailureMessage,
} from "../report-export";

type OverdueBooking = {
  id: string;
  title: string;
  endsAt: string;
  overdueHours: number;
  location: string;
  itemCount: number;
  items: string[];
};

type LeaderboardEntry = {
  userId: string;
  name: string;
  overdueCount: number;
  totalOverdueHours: number;
  bookings: OverdueBooking[];
};

type OverdueLocationOption = { id: string; name: string };

type OverdueData = {
  totalOverdueBookings: number;
  leaderboard: LeaderboardEntry[];
  locationId?: string | null;
  locationOptions?: OverdueLocationOption[];
};

function formatOverdue(hours: number): string {
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
}

function LeaderboardMobileCard({
  entry,
  rank,
  expanded,
  onToggle,
}: {
  entry: LeaderboardEntry;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const ChevronIcon = expanded ? ChevronUp : ChevronDown;

  return (
    <ReportMobileCard
      className="cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
      onClick={onToggle}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.name}`}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">#{rank}</span>
          <span className="brand-identity font-semibold">{entry.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="red">{entry.overdueCount}</Badge>
          <ChevronIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </div>
      <div className="text-sm font-semibold text-[var(--red-text)]">
        {formatOverdue(entry.totalOverdueHours)} total
      </div>
      {expanded && (
        <div className="pt-1">
          {(entry.bookings ?? []).map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div>
                <ReportTableLink
                  href={`/checkouts/${b.id}`}
                  className="text-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  {b.title}
                </ReportTableLink>
                <ReportMetaLine
                  className="text-xs"
                  items={[
                    b.location,
                    `${b.itemCount} item${b.itemCount !== 1 ? "s" : ""}`,
                    b.items.length > 0 ? b.items.join(", ") : null,
                  ]}
                />
              </div>
              <span className="text-xs text-[var(--red-text)]">
                {formatOverdue(b.overdueHours)}
              </span>
            </div>
          ))}
        </div>
      )}
    </ReportMobileCard>
  );
}

async function downloadOverdueCsv(locationId: string | null) {
  try {
    const res = await fetch(
      `/api/reports/overdue?format=csv${locationId ? `&location=${encodeURIComponent(locationId)}` : ""}`,
    );
    if (handleAuthRedirect(res, "/reports/overdue")) return;

    if (!res.ok) {
      toast.error(await readReportExportFailureMessage(res, "Overdue report"));
      return;
    }

    const blob = await res.blob();
    const filename = getReportExportFilename(
      res.headers.get("Content-Disposition"),
      "overdue-report.csv",
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
      reportLabel: "Overdue report",
      rowCount: Number.isFinite(exportedCount) ? exportedCount : 0,
      scopeLabel: "matching overdue booking rows",
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
    toast.error("Overdue report CSV export failed. Check your connection and try again.");
  }
}

export default function OverdueLeaderboardPage() {
  const { data: currentUser } = useCurrentUser();
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [locationId, setLocationId] = useState<string | null>(
    () => searchParams.get("location") || null,
  );
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  function changeLocation(nextLocationId: string | null) {
    setLocationId(nextLocationId);
    syncUrl({ location: nextLocationId ?? "" });
  }

  const { data, loading, refreshing, error, lastRefreshed, reload } = useFetch<OverdueData>({
    url: `/api/reports/overdue${locationId ? `?location=${encodeURIComponent(locationId)}` : ""}`,
    transform: (json) => json as unknown as OverdueData,
    keepPreviousData: true,
  });

  function toggleExpand(userId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  if (loading && !data) return <ReportLoadingState metricCount={2} rows={5} />;

  if (error && !data) {
    return (
      <ReportErrorState
        error={error}
        onRetry={reload}
        title="Failed to load overdue report"
      />
    );
  }

  if (!data) return null;

  const leaderboard = data.leaderboard ?? [];
  const locationOptions = data.locationOptions ?? [];
  const selectedLocationName = locationOptions.find((option) => option.id === locationId)?.name;
  const activeFilters = locationId
    ? [{
        key: "location",
        label: `Location: ${selectedLocationName ?? "Selected"}`,
        onRemove: () => changeLocation(null),
      }]
    : [];

  return (
    <FadeUp>
      <ReportToolbar
        activeFilters={activeFilters}
        lastRefreshed={lastRefreshed}
        loading={loading || refreshing}
        now={now}
        onRefresh={reload}
        exportAction={leaderboard.length > 0 ? (
          <ReportExportButton
            ariaLabel="Export matching overdue booking rows CSV"
            label="Export matching rows"
            onClick={() => downloadOverdueCsv(locationId)}
          />
        ) : null}
      >
        {locationOptions.length > 1 ? (
          <ReportToolbarGroup label="Location">
            <ReportSelectControl
              ariaLabel="Overdue report location"
              allLabel="All locations"
              options={locationOptions}
              value={locationId}
              onChange={changeLocation}
            />
          </ReportToolbarGroup>
        ) : null}
      </ReportToolbar>

      <ReportDataRegion refreshing={refreshing}>
      <ReportMetricGrid>
        <MetricCard
          value={data.totalOverdueBookings}
          label="Overdue checkouts"
          color={data.totalOverdueBookings > 0 ? "var(--red)" : undefined}
          tooltip="Checkouts currently past their return date"
          href="/checkouts?filter=overdue"
        />
        <MetricCard value={leaderboard.length} label="People with overdue gear" tooltip="Number of people with at least one overdue checkout" href="/users" />
      </ReportMetricGrid>

      {/* Overdue hours bar chart */}
      {leaderboard.length > 0 && (
        <ReportSectionCard title="Overdue hours by person" className="mb-4">
          <ChartContainer config={{ hours: { label: "Overdue hours", color: REPORT_SEMANTIC_CHART_COLORS.problem } }} className="w-full" style={{ height: Math.max(150, leaderboard.length * 36) }}>
            <BarChart data={leaderboard.slice(0, 10).map((e) => ({ name: e.name, hours: e.totalOverdueHours }))} layout="vertical" margin={{ left: 0, right: 12 }}>
              <YAxis dataKey="name" type="category" width={100} tickLine={false} axisLine={false} className="text-xs" />
              <XAxis type="number" hide />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="hours" name="Overdue hours" radius={[0, 4, 4, 0]}>
                {leaderboard.slice(0, 10).map((_, i) => (
                  <Cell key={i} fill={REPORT_OVERDUE_CHART_COLORS[i]} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </ReportSectionCard>
      )}

      {leaderboard.length === 0 ? (
        <ReportSectionCard title="Overdue by person">
          <ReportEmptyState
            icon="check"
            title="No overdue checkouts right now"
            description="This report will populate when a checked-out booking passes its due time."
          />
        </ReportSectionCard>
      ) : (
        <ReportSectionCard
          title="Overdue by person"
          description={
            currentUser?.role === "ADMIN" ? (
              <>
                Sorted by total overdue time. For repeat patterns over time, see{" "}
                <Link
                  href="/accountability"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Accountability
                </Link>
                .
              </>
            ) : (
              "Sorted by total overdue time"
            )
          }
          contentClassName="p-0"
        >
          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead className="text-right">Overdue checkouts</TableHead>
                  <TableHead className="text-right">Total overdue</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaderboard.map((entry, i) => (
                  <OverdueTableRows
                    key={entry.userId}
                    entry={entry}
                    rank={i + 1}
                    expanded={expanded.has(entry.userId)}
                    onToggle={() => toggleExpand(entry.userId)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden">
            {leaderboard.map((entry, i) => (
              <LeaderboardMobileCard
                key={entry.userId}
                entry={entry}
                rank={i + 1}
                expanded={expanded.has(entry.userId)}
                onToggle={() => toggleExpand(entry.userId)}
              />
            ))}
          </div>
        </ReportSectionCard>
      )}
      </ReportDataRegion>
    </FadeUp>
  );
}

function OverdueTableRows({
  entry,
  rank,
  expanded,
  onToggle,
}: {
  entry: LeaderboardEntry;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const ChevronIcon = expanded ? ChevronUp : ChevronDown;

  return (
    <>
      <TableRow
        className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
        onClick={onToggle}
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.name}`}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      >
        <TableCell className="text-muted-foreground">{rank}</TableCell>
        <TableCell className="brand-identity font-semibold">{entry.name}</TableCell>
        <TableCell className="text-right">
          <Badge variant="red">{entry.overdueCount}</Badge>
        </TableCell>
        <TableCell className="text-right font-semibold text-[var(--red-text)]">
          {formatOverdue(entry.totalOverdueHours)}
        </TableCell>
        <TableCell className="text-center text-muted-foreground">
          <ChevronIcon className="mx-auto size-4" aria-hidden="true" />
        </TableCell>
      </TableRow>
      {expanded &&
        (entry.bookings ?? []).map((b) => (
          <TableRow key={b.id} className="bg-muted/30">
            <TableCell></TableCell>
            <TableCell colSpan={2} className="pl-6">
              <ReportTableLink href={`/checkouts/${b.id}`}>{b.title}</ReportTableLink>
              <ReportMetaLine
                className="text-sm"
                items={[
                  b.location,
                  `${b.itemCount} item${b.itemCount !== 1 ? "s" : ""}`,
                  b.items.length > 0 ? b.items.join(", ") : null,
                ]}
              />
            </TableCell>
            <TableCell className="text-right text-sm text-[var(--red-text)]">
              {formatOverdue(b.overdueHours)} overdue
            </TableCell>
            <TableCell></TableCell>
          </TableRow>
        ))}
    </>
  );
}
