"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import MetricCard from "../MetricCard";
import { Button } from "@/components/ui/button";
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
import { TruncatedText } from "@/components/ui/truncated-text";
import { useFetch } from "@/hooks/use-fetch";
import {
  ReportDataRegion,
  ReportEmptyState,
  ReportErrorState,
  ReportExportButton,
  ReportListRow,
  ReportLoadingState,
  ReportMetricGrid,
  ReportSectionCard,
  ReportSelectControl,
  ReportToolbar,
  ReportToolbarGroup,
} from "../report-ui";
import { useSearchParams } from "next/navigation";
import { syncUrl } from "@/lib/url-sync";
import { handleAuthRedirect, isAbortError } from "@/lib/errors";
import {
  getReportExportCompletionToast,
  getReportExportFilename,
  readReportExportFailureMessage,
} from "../report-export";

type SkuLoss = {
  skuName: string;
  bulkSkuId: string;
  count: number;
};

type UserLoss = {
  name: string;
  count: number;
};

type RecentLoss = {
  id: string;
  bookingId: string;
  lostUnits: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
};

type BatteryAudit = {
  totals: {
    skuCount: number;
    totalUnits: number;
    available: number;
    checkedOut: number;
    lost: number;
    retired: number;
    lossRate: number;
    repeatPatternCount: number;
  };
  bySku: {
    bulkSkuId: string;
    skuName: string;
    category: string;
    location: string;
    total: number;
    available: number;
    checkedOut: number;
    lost: number;
    retired: number;
    lossRate: number;
    missingUnitNumbers: number[];
    lastMissingAt: string | null;
  }[];
  missingUnits: {
    id: string;
    bulkSkuId: string;
    skuName: string;
    unitNumber: number;
    notes: string | null;
    markedMissingAt: string;
    lastCheckoutAt: string | null;
    lastRequesterId: string | null;
    lastRequesterName: string | null;
    lastBookingId: string | null;
    lastBookingRef: string | null;
    lastBookingTitle: string | null;
  }[];
  checkoutHistory: {
    id: string;
    bulkSkuUnitId: string;
    bulkSkuId: string;
    skuName: string;
    unitNumber: number;
    status: string;
    checkedOutAt: string;
    checkedInAt: string | null;
    durationDays: number | null;
    bookingId: string;
    bookingRef: string;
    bookingTitle: string;
    requesterId: string;
    requesterName: string;
  }[];
  repeatPatterns: {
    type: "sku" | "requester";
    label: string;
    count: number;
    detail: string;
  }[];
};

type BulkLossFilterOption = { id: string; name: string };

type ReportData = {
  totalLost: number;
  filterOptions?: {
    categories: BulkLossFilterOption[];
    locations: BulkLossFilterOption[];
  };
  bySku: SkuLoss[];
  byUser: UserLoss[];
  recentLosses: RecentLoss[];
  batteryAudit: BatteryAudit;
};

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

async function downloadMissingUnitsCsv(query: string) {
  try {
    const res = await fetch(`/api/reports/bulk-losses?format=csv${query}`);
    if (handleAuthRedirect(res, "/reports/bulk-losses")) return;

    if (!res.ok) {
      toast.error(await readReportExportFailureMessage(res, "Missing Units report"));
      return;
    }

    const blob = await res.blob();
    const filename = getReportExportFilename(
      res.headers.get("Content-Disposition"),
      "missing-units-report.csv",
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
      reportLabel: "Missing Units report",
      rowCount: Number.isFinite(exportedCount) ? exportedCount : 0,
      scopeLabel: "matching missing-unit evidence rows",
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
    toast.error("Missing Units report CSV export failed. Check your connection and try again.");
  }
}

export default function BulkLossesReportPage() {
  const searchParams = useSearchParams();
  const [now, setNow] = useState(() => new Date());
  const [locationId, setLocationId] = useState<string | null>(
    () => searchParams.get("location") || null,
  );
  const [categoryId, setCategoryId] = useState<string | null>(
    () => searchParams.get("category") || null,
  );

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const filterQuery = [
    locationId ? `&location=${encodeURIComponent(locationId)}` : "",
    categoryId ? `&category=${encodeURIComponent(categoryId)}` : "",
  ].join("");

  const { data, loading, refreshing, error, lastRefreshed, reload } = useFetch<ReportData>({
    url: `/api/reports/bulk-losses${filterQuery.replace(/^&/, "?")}`,
    keepPreviousData: true,
  });

  if (loading && !data) return <ReportLoadingState metricCount={3} rows={6} />;

  if (error && !data) {
    return (
      <ReportErrorState
        error={error}
        onRetry={reload}
        title="Failed to load missing units report"
      />
    );
  }

  if (!data) return null;

  const hasExportableEvidence = data.bySku.length > 0
    || data.byUser.length > 0
    || data.recentLosses.length > 0
    || data.batteryAudit.bySku.length > 0
    || data.batteryAudit.missingUnits.length > 0
    || data.batteryAudit.checkoutHistory.length > 0
    || data.batteryAudit.repeatPatterns.length > 0;

  const locationOptions = data.filterOptions?.locations ?? [];
  const categoryOptions = data.filterOptions?.categories ?? [];
  const activeFilters = [
    ...(locationId
      ? [{
          key: "location",
          label: `Location: ${locationOptions.find((o) => o.id === locationId)?.name ?? "Selected"}`,
          onRemove: () => {
            setLocationId(null);
            syncUrl({ location: "" });
          },
        }]
      : []),
    ...(categoryId
      ? [{
          key: "category",
          label: `Category: ${categoryOptions.find((o) => o.id === categoryId)?.name ?? "Selected"}`,
          onRemove: () => {
            setCategoryId(null);
            syncUrl({ category: "" });
          },
        }]
      : []),
  ];

  return (
    <FadeUp>
    <div className="flex flex-col gap-4">
      <ReportToolbar
        activeFilters={activeFilters}
        lastRefreshed={lastRefreshed}
        loading={loading || refreshing}
        now={now}
        onRefresh={reload}
        exportAction={hasExportableEvidence ? (
          <ReportExportButton
            ariaLabel="Export matching missing-unit evidence CSV"
            label="Export matching rows"
            onClick={() => downloadMissingUnitsCsv(filterQuery)}
          />
        ) : null}
      >
        {locationOptions.length > 1 ? (
          <ReportToolbarGroup label="Location">
            <ReportSelectControl
              ariaLabel="Missing units location"
              allLabel="All locations"
              options={locationOptions}
              value={locationId}
              onChange={(next) => {
                setLocationId(next);
                syncUrl({ location: next ?? "" });
              }}
            />
          </ReportToolbarGroup>
        ) : null}
        {categoryOptions.length > 1 ? (
          <ReportToolbarGroup label="Category">
            <ReportSelectControl
              ariaLabel="Missing units category"
              allLabel="All categories"
              options={categoryOptions}
              value={categoryId}
              onChange={(next) => {
                setCategoryId(next);
                syncUrl({ category: next ?? "" });
              }}
            />
          </ReportToolbarGroup>
        ) : null}
      </ReportToolbar>

      <ReportDataRegion refreshing={refreshing}>
      {/* Metrics row */}
      <ReportMetricGrid>
        <MetricCard label="Missing units" value={data.totalLost} />
        <MetricCard label="Families affected" value={data.bySku.length} />
        <MetricCard label="Users involved" value={data.byUser.length} />
      </ReportMetricGrid>

      <ReportSectionCard
        title="Battery missing units"
        description="Battery unit exceptions, current missing units, repeated missing patterns, and recent custody history."
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {data.batteryAudit.totals.skuCount} battery families using Units tracked
          </div>
          <Button className="h-10" asChild variant="outline">
            <Link href="/bulk-inventory/batteries">Open Battery Ops</Link>
          </Button>
        </div>

        <ReportMetricGrid>
          <MetricCard label="Battery units" value={data.batteryAudit.totals.totalUnits} />
          <MetricCard label="Missing batteries" value={data.batteryAudit.totals.lost} />
          <MetricCard label="Missing rate" value={formatPercent(data.batteryAudit.totals.lossRate)} />
          <MetricCard label="Repeat patterns" value={data.batteryAudit.totals.repeatPatternCount} />
        </ReportMetricGrid>

        {data.batteryAudit.bySku.length === 0 ? (
          <ReportEmptyState
            compact
            icon="check"
            title="No battery families using Units found"
            description="Battery audit rows appear when active battery families use Units."
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Battery family</TableHead>
                    <TableHead className="text-right">Missing</TableHead>
                    <TableHead className="text-right">Missing rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.batteryAudit.bySku.map((sku) => (
                    <TableRow key={sku.bulkSkuId}>
                      <TableCell>
                        <div className="font-medium">{sku.skuName}</div>
                        <div className="text-xs text-muted-foreground">
                          {sku.location} / {sku.available} available / {sku.checkedOut} out
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={sku.lost > 0 ? "red" : "secondary"} size="sm" className="tabular-nums">
                          {sku.lost}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatPercent(sku.lossRate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Missing unit</TableHead>
                    <TableHead>Last Holder</TableHead>
                    <TableHead className="text-right">Detected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.batteryAudit.missingUnits.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="h-24 text-center text-sm text-muted-foreground">
                        No missing battery units.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.batteryAudit.missingUnits.map((unit) => (
                      <TableRow key={unit.id}>
                        <TableCell>
                          <div className="font-medium">{unit.skuName} #{unit.unitNumber}</div>
                          {unit.notes ? (
                            <TruncatedText className="text-xs text-muted-foreground" text={unit.notes} />
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div>{unit.lastRequesterName ?? "Unknown"}</div>
                          {unit.lastBookingId ? (
                            <Link
                              href={`/checkouts/${unit.lastBookingId}`}
                              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                            >
                              {unit.lastBookingRef ?? unit.lastBookingTitle ?? "Booking"}
                            </Link>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {new Date(unit.markedMissingAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </ReportSectionCard>

      {data.batteryAudit.repeatPatterns.length > 0 && (
        <ReportSectionCard title="Battery repeat missing patterns">
          <div className="flex flex-col gap-2">
            {data.batteryAudit.repeatPatterns.map((pattern) => (
              <ReportListRow key={`${pattern.type}-${pattern.label}`} className="px-0 py-2">
                <div>
                  <span className="font-medium">{pattern.label}</span>
                  <span className="ml-1.5 text-muted-foreground">{pattern.detail}</span>
                </div>
                <Badge variant="red" size="sm" className="tabular-nums">{pattern.count}</Badge>
              </ReportListRow>
            ))}
          </div>
        </ReportSectionCard>
      )}

      {data.batteryAudit.checkoutHistory.length > 0 && (
        <ReportSectionCard
          title="Battery checkout history"
          description="Most recent battery unit custody records from active battery families."
          contentClassName="p-0"
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead>Requester</TableHead>
                  <TableHead>Booking</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Returned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.batteryAudit.checkoutHistory.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{entry.skuName} #{entry.unitNumber}</TableCell>
                    <TableCell>{entry.requesterName}</TableCell>
                    <TableCell>
                      <Link
                        href={`/checkouts/${entry.bookingId}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {entry.bookingRef ?? entry.bookingTitle}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{entry.durationDays ?? "-"}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {entry.checkedInAt ? new Date(entry.checkedInAt).toLocaleDateString() : "Still out"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ReportSectionCard>
      )}

      {/* Loss by item family */}
      <ReportSectionCard title="Missing units by family" contentClassName="p-0">
          {data.bySku.length === 0 ? (
            <ReportEmptyState
              compact
              icon="check"
              title="No missing units recorded"
              description="Missing unit rows appear after check-in records a unit as missing."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item family</TableHead>
                  <TableHead className="text-right">Missing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.bySku.map((sku) => (
                  <TableRow key={sku.bulkSkuId}>
                    <TableCell className="font-medium">{sku.skuName}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="red" size="sm" className="tabular-nums">{sku.count}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </ReportSectionCard>

      {/* Loss by user leaderboard */}
      <ReportSectionCard title="Missing units by requester" contentClassName="p-0">
          {data.byUser.length === 0 ? (
            <ReportEmptyState
              compact
              icon="users"
              title="No requester-attributed missing units found"
              description="Requester rankings appear once missing-unit events can be tied back to a booking."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Requester</TableHead>
                  <TableHead className="text-right">Missing units</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byUser.map((user, i) => (
                  <TableRow key={user.name}>
                    <TableCell className="font-medium">
                      {i === 0 && data.byUser.length > 1 && (
                        <Badge variant="red" size="sm" className="mr-2">Highest</Badge>
                      )}
                      {user.name}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={i === 0 && data.byUser.length > 1 ? "red" : "secondary"} size="sm" className="tabular-nums">
                        {user.count}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </ReportSectionCard>

      {/* Recent missing-unit events */}
      {data.recentLosses.length > 0 && (
        <ReportSectionCard
          title="Recent missing-unit events"
          description={
            locationId || categoryId
              ? "Check-in event feed across all families -- not narrowed by the filters above."
              : undefined
          }
        >
            <div className="flex flex-col gap-2">
              {data.recentLosses.map((event) => (
                <ReportListRow key={event.id} className="px-0 py-2">
                  <div>
                    <span className="font-medium">
                      {event.actor?.name ?? "System"}
                    </span>
                    <span className="text-muted-foreground ml-1.5">
                      completed check-in with missing units
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(event.createdAt).toLocaleDateString()}
                  </span>
                </ReportListRow>
              ))}
            </div>
        </ReportSectionCard>
      )}
      </ReportDataRegion>
    </div>
    </FadeUp>
  );
}
