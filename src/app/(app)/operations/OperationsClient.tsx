"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  BatteryCharging,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { OperationalMetricCard, OperationalPartialResultsAlert } from "@/components/OperationalFeedback";
import { OperationalStatusRail, type OperationalStatusRailItem } from "@/components/OperationalStatusRail";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import StatusIndicator from "@/components/ui/status-indicator";
import { useFetch } from "@/hooks/use-fetch";
import type { AdminFixTodayQueue } from "@/lib/admin-fix-today";
import {
  normalizeFixTodayQueue,
  normalizeHygieneQueue,
  sortOpsChecks,
  summarizeOpsChecks,
  type HygieneQueuePayload,
  type OpsCheck,
  type OpsCheckSeverity,
} from "@/lib/ops-checks";
import type { OperationalHealthState } from "@/lib/operational-health";
import { cn } from "@/lib/utils";
import { pluralize } from "@/lib/format";

type BatteryTotals = {
  total: number;
  available: number;
  checkedOut: number;
  lost: number;
  retired: number;
  lowSkus: number;
  agingCheckedOut: number;
};

const SEVERITY_META: Record<OpsCheckSeverity, {
  label: string;
  state: OperationalHealthState;
  iconTone: string;
  cardTone: string;
}> = {
  critical: {
    label: "Critical",
    state: "down",
    iconTone: "bg-[var(--red-bg)] text-[var(--red-text)]",
    cardTone: "border-[var(--red-text)]/25 bg-[var(--red-bg)]/20",
  },
  warning: {
    label: "Needs work",
    state: "fixing",
    iconTone: "bg-[var(--orange-bg)] text-[var(--orange-text)]",
    cardTone: "border-[var(--orange-text)]/25 bg-[var(--orange-bg)]/20",
  },
  info: {
    label: "Watch",
    state: "idle",
    iconTone: "bg-[var(--blue-bg)] text-[var(--blue-text)]",
    cardTone: "border-border bg-card",
  },
};

function formatGeneratedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function OperationsClient({ isAdmin }: { isAdmin: boolean }) {
  const fixToday = useFetch<AdminFixTodayQueue>({
    url: "/api/admin/fix-today",
    returnTo: "/operations",
    refetchOnFocus: false,
    enabled: isAdmin,
  });
  const hygiene = useFetch<HygieneQueuePayload>({
    url: "/api/inventory-hygiene",
    returnTo: "/operations",
    refetchOnFocus: false,
  });
  const batteries = useFetch<BatteryTotals>({
    url: "/api/bulk-skus/batteries",
    returnTo: "/operations",
    refetchOnFocus: false,
    transform: (json) => (json.data as { totals: BatteryTotals }).totals,
  });

  const loading = (isAdmin && fixToday.loading) || hygiene.loading || batteries.loading;
  const refreshing = fixToday.refreshing || hygiene.refreshing || batteries.refreshing;

  function reloadAll() {
    if (isAdmin) fixToday.reload();
    hygiene.reload();
    batteries.reload();
  }

  if (loading) {
    return <OperationsSkeleton />;
  }

  const operationsChecks = sortOpsChecks(fixToday.data ? normalizeFixTodayQueue(fixToday.data) : []);
  const hygieneChecks = sortOpsChecks(hygiene.data ? normalizeHygieneQueue(hygiene.data) : []);
  const allChecks = [...operationsChecks, ...hygieneChecks];
  const totals = summarizeOpsChecks(allChecks);
  const partialFailures = [
    ...(fixToday.data?.partialFailures ?? []),
    ...(hygiene.data?.partialFailures ?? []),
  ];
  const feedErrors = [
    ...(isAdmin && fixToday.error && !fixToday.data ? ["the admin daily queue"] : []),
    ...(hygiene.error && !hygiene.data ? ["inventory hygiene"] : []),
    ...(batteries.error && !batteries.data ? ["battery totals"] : []),
  ];
  const latestGeneratedAt = [fixToday.data?.generatedAt, hygiene.data?.generatedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .pop();

  const railItems: OperationalStatusRailItem[] = [
    ...(totals.criticalChecks > 0 ? [{
      id: "critical-checks",
      label: "Critical checks",
      value: totals.criticalChecks,
      detail: "Checks that need immediate operator attention.",
      icon: AlertTriangle,
      tone: "critical" as const,
    }] : []),
    ...(totals.checksNeedingWork > 0 ? [{
      id: "checks-needing-work",
      label: "Needs work",
      value: totals.checksNeedingWork,
      detail: "Checks with one or more open records.",
      icon: Clock3,
      tone: "warning" as const,
    }] : []),
    ...(totals.openItems > 0 ? [{
      id: "open-items",
      label: "Open records",
      value: totals.openItems,
      detail: "Individual records waiting for review or repair.",
      icon: Wrench,
      tone: "warning" as const,
    }] : []),
    ...(batteries.data && batteries.data.lowSkus > 0 ? [{
      id: "low-battery-families",
      label: "Low battery families",
      value: batteries.data.lowSkus,
      detail: "Battery families below their configured threshold.",
      icon: BatteryCharging,
      tone: "warning" as const,
      href: "/bulk-inventory/batteries",
    }] : []),
    ...(partialFailures.length > 0 ? [{
      id: "partial-data",
      label: "Partial data",
      value: partialFailures.length,
      detail: "Some checks did not finish. Refresh before treating this page as complete.",
      icon: AlertTriangle,
      tone: "warning" as const,
    }] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Operations">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {latestGeneratedAt && (
            <span className="text-xs text-muted-foreground">
              Updated {formatGeneratedAt(latestGeneratedAt)}
            </span>
          )}
          <Button variant="outline" size="sm" className="h-10" onClick={reloadAll} disabled={refreshing}>
            <RefreshCw data-icon="inline-start" className={cn(refreshing && "animate-spin")} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </PageHeader>

      <OperationalStatusRail
        orientation={{
          label: "Checks running",
          value: `${totals.activeChecks}`,
          icon: ShieldCheck,
        }}
        items={railItems}
        allClearLabel={railItems.length === 0 && feedErrors.length === 0 ? "Operations are clear" : undefined}
        details={(
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <OperationalMetricCard label="Open records" value={totals.openItems} tone={totals.openItems ? "orange" : "muted"} />
            <OperationalMetricCard label="Critical checks" value={totals.criticalChecks} tone={totals.criticalChecks ? "red" : "muted"} />
            <OperationalMetricCard label="Checks needing work" value={totals.checksNeedingWork} tone={totals.checksNeedingWork ? "orange" : "muted"} />
            <OperationalMetricCard label="Checks running" value={totals.activeChecks} tone="muted" />
          </div>
        )}
      />

      {feedErrors.length > 0 && (
        <Card className="border-[var(--orange-text)]/25 bg-[var(--orange-bg)]/20 shadow-none">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0 text-[var(--orange-text)]" />
              <span>Could not load {feedErrors.join(", ")}. The rest of this page is still live.</span>
            </div>
            <Button variant="outline" size="sm" className="h-10" onClick={reloadAll}>
              <RefreshCw data-icon="inline-start" />
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      <OperationalPartialResultsAlert failures={partialFailures} />

      {batteries.data && <BatterySummaryCard totals={batteries.data} />}

      {isAdmin && fixToday.data && (
        <CheckLane
          title="Run the day"
          description="Custody, kiosk, calendar, and license exceptions that block today's handoffs."
          badge="Admin only"
          checks={operationsChecks}
        />
      )}

      {hygiene.data && (
        <CheckLane
          title="Keep data clean"
          description="Catalog, scan identity, kit, and attachment cleanup that keeps scan-first workflows reliable."
          checks={hygieneChecks}
        />
      )}
    </div>
  );
}

function BatterySummaryCard({ totals }: { totals: BatteryTotals }) {
  const healthy = totals.lowSkus === 0;

  return (
    <Card className="border-border/40 shadow-none">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-md",
            healthy ? "bg-muted text-muted-foreground" : "bg-[var(--orange-bg)] text-[var(--orange-text)]",
          )}>
            <BatteryCharging />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Batteries</span>
              <StatusIndicator
                state={healthy ? "active" : "fixing"}
                label={healthy ? "Stocked" : pluralize(totals.lowSkus, "low family", "low families")}
                size="sm"
                title={healthy ? "All battery families are at or above threshold." : "Battery families below their configured threshold."}
              />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {totals.available} available / {totals.checkedOut} checked out / {totals.lost} missing
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="min-h-10">
          <Link href="/bulk-inventory/batteries">
            Open Battery Ops
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function CheckLane({
  badge,
  checks,
  description,
  title,
}: {
  badge?: string;
  checks: OpsCheck[];
  description: string;
  title: string;
}) {
  const openChecks = checks.filter((check) => check.count > 0);
  const cleanChecks = checks.filter((check) => check.count === 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {badge && (
          <Badge variant="outline">
            <ShieldCheck aria-hidden="true" />
            {badge}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>

      {openChecks.length === 0 ? (
        <Card className="border-border/40 bg-muted/20 shadow-none">
          <CardContent className="flex min-h-14 items-center gap-2 py-3 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-[var(--green-text)]" />
            Nothing needs attention right now.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {openChecks.map((check) => (
            <CheckCard key={check.key} check={check} />
          ))}
        </div>
      )}

      {cleanChecks.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-10 w-fit gap-2 text-muted-foreground">
              <CheckCircle2 className="size-4 text-[var(--green-text)]" />
              {pluralize(cleanChecks.length, "check")} clean
              <ChevronDown className="size-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 flex flex-col gap-1 rounded-md border border-border/40 bg-muted/20 p-3">
              {cleanChecks.map((check) => (
                <div key={check.key} className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
                  <ClipboardCheck className="size-4 shrink-0" />
                  <span className="font-medium text-foreground/80">{check.title}</span>
                  <span className="hidden truncate sm:inline">{check.description}</span>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}

function CheckCard({ check }: { check: OpsCheck }) {
  const meta = SEVERITY_META[check.severity];

  return (
    <Card className={cn("min-w-0 overflow-hidden", meta.cardTone)}>
      <CardHeader className="p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-md", meta.iconTone)}>
            <AlertTriangle />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base leading-tight text-balance">{check.title}</CardTitle>
              <StatusIndicator
                state={meta.state}
                label={meta.label}
                size="sm"
                title={check.description}
              />
            </div>
            <p className="mt-1 text-sm text-muted-foreground text-pretty">{check.description}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums">{check.count}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">open</div>
          </div>
        </div>
      </CardHeader>
      <Separator />

      <CardContent className="p-0">
        {check.samples.length > 0 ? (
          <div className="divide-y">
            {check.samples.map((sample) => (
              <Link
                key={sample.id}
                href={sample.href}
                className="group flex min-h-16 items-center gap-3 px-4 py-3 no-underline transition-[background-color,scale] hover:bg-background/70 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">{sample.label}</div>
                  <div className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{sample.detail}</div>
                </div>
                <ArrowUpRight className="shrink-0 text-muted-foreground opacity-60 transition-[color,opacity,translate] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex min-h-20 items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
            <Clock3 className="size-4" />
            No samples returned for this check.
          </div>
        )}
      </CardContent>
      <Separator />
      <CardFooter className="bg-muted/30 px-4 py-3">
        <Button asChild variant="outline" size="sm" className="min-h-10">
          <Link href={check.href}>
            {check.ctaLabel}
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function OperationsSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Operations" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-64 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
