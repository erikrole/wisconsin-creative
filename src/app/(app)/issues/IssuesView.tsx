"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { ChevronRightIcon, MailIcon, SearchIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime, pluralize } from "@/lib/format";
import type { Breadcrumb } from "@/lib/error-reporting/grouping";
import { parseErrorMessage, readApiData } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  ActionTimeline,
  KIND_LABELS,
  PLATFORM_META,
  PlatformBadge,
  Sparkline,
  StatusPill,
  versionText,
} from "./issue-ui";

type IssueRow = {
  id: string;
  platform: string;
  kind: string;
  title: string;
  culprit: string | null;
  status: string;
  eventCount: number;
  userCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  firstVersion: string | null;
  lastVersion: string | null;
  regressedAt: string | null;
  daily: number[];
};
type IssueList = { counts: Partial<Record<string, number>>; issues: IssueRow[] };

type ReportRow = {
  id: string;
  message: string;
  status: string;
  platform: string;
  appVersion: string | null;
  appBuild: string | null;
  releaseChannel: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  role: string | null;
  screen: string | null;
  breadcrumbs: Breadcrumb[];
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
  relatedIssues: Array<{ id: string; title: string; platform: string; status: string }>;
};
type ReportList = { counts: Partial<Record<string, number>>; reports: ReportRow[] };

type Tab = "issues" | "reports";

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string; count?: number }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-lg bg-muted p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-bold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              selected && "bg-card text-foreground shadow-xs",
            )}
          >
            {option.label}
            {option.count !== undefined ? <span className="tabular-nums font-normal text-muted-foreground">{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function IssuesView({ initialTab, focusReportId }: { initialTab: Tab; focusReportId: string | null }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);

  function switchTab(next: Tab) {
    setTab(next);
    router.replace(next === "reports" ? "/issues?tab=reports" : "/issues", { scroll: false });
  }

  return (
    <>
      <PageHeader title="Issues" description="Crashes, errors, and problem reports from the web, iPhone, kiosk, and Mac apps." />
      <div className="mb-5">
        <Segmented<Tab>
          label="View"
          value={tab}
          onChange={switchTab}
          options={[
            { value: "issues", label: "Crashes and errors" },
            { value: "reports", label: "Problem reports" },
          ]}
        />
      </div>
      {tab === "issues" ? <IssueList /> : <ReportsList focusReportId={focusReportId} />}
    </>
  );
}

function IssueList() {
  const [status, setStatus] = useState<"open" | "resolved" | "ignored">("open");
  const [platform, setPlatform] = useState("");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const list = useQuery<IssueList>({
    queryKey: ["issues", "list", status, platform, debounced],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ status });
      if (platform) params.set("platform", platform);
      if (debounced) params.set("q", debounced);
      return readApiData(await fetch(`/api/issues?${params}`, { signal }), "Couldn't load issues");
    },
  });
  const now = useMemo(() => new Date(), [list.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "open", label: "Open", count: list.data?.counts.open ?? 0 },
            { value: "resolved", label: "Fixed", count: list.data?.counts.resolved ?? 0 },
            { value: "ignored", label: "Ignored", count: list.data?.counts.ignored ?? 0 },
          ]}
        />
        <NativeSelect aria-label="Platform" className="w-auto min-w-36" value={platform} onChange={(event) => setPlatform(event.target.value)}>
          <option value="">All apps</option>
          {Object.entries(PLATFORM_META).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </NativeSelect>
        <div className="relative ml-auto w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input aria-label="Search issues" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-8" />
        </div>
      </div>

      {list.isLoading ? (
        <Skeleton className="h-72 w-full rounded-2xl" />
      ) : list.isError ? (
        <EmptyState icon="wifi-off" title="Couldn't load issues" description={list.error.message} actionLabel="Try again" onAction={() => void list.refetch()} />
      ) : list.data && list.data.issues.length > 0 ? (
        <ul className="m-0 list-none divide-y overflow-hidden rounded-2xl border bg-card p-0">
          {list.data.issues.map((issue) => (
            <li key={issue.id}>
              <Link
                href={`/issues/${issue.id}`}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3.5 text-foreground no-underline outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 sm:grid-cols-[auto_1fr_auto_auto_auto] sm:gap-5 sm:px-5"
              >
                <PlatformBadge platform={issue.platform} />
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap">
                    <p className="m-0 min-w-0 break-words text-[14px] font-bold sm:truncate">{issue.title}</p>
                    {issue.regressedAt && issue.status === "open" ? <StatusPill status="regressed" /> : null}
                  </div>
                  <p className="m-0 mt-0.5 truncate text-[12.5px] text-muted-foreground">
                    {[KIND_LABELS[issue.kind] ?? issue.kind, issue.culprit, issue.lastVersion].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Sparkline values={issue.daily} className="hidden sm:flex" />
                <div className="hidden w-24 text-right sm:block">
                  <p className="m-0 text-[14px] font-bold tabular-nums">{issue.eventCount.toLocaleString()}</p>
                  <p className="m-0 text-[12px] text-muted-foreground">{issue.userCount > 0 ? pluralize(issue.userCount, "person", "people") : "times"}</p>
                </div>
                <div className="w-20 text-right">
                  <p className="m-0 text-[12.5px] tabular-nums text-muted-foreground">{formatRelativeTime(issue.lastSeenAt, now)}</p>
                  <p className="m-0 text-[12px] tabular-nums text-muted-foreground sm:hidden">{issue.eventCount}×</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon="check"
          title={status === "open" ? "Nothing to fix" : status === "resolved" ? "No fixed issues yet" : "Nothing ignored"}
          description={
            status === "open"
              ? "No open crashes or errors. New ones show up here grouped, with who hit them and what they were doing."
              : "Issues you mark here keep their history for 90 days."
          }
        />
      )}
    </div>
  );
}

function ReportsList({ focusReportId }: { focusReportId: string | null }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"open" | "closed">("open");
  const [busy, setBusy] = useState<string | null>(null);
  const focusRef = useRef<HTMLLIElement | null>(null);
  const list = useQuery<ReportList>({
    queryKey: ["issues", "reports", status],
    queryFn: async ({ signal }) => readApiData(await fetch(`/api/support-reports?status=${status}`, { signal }), "Couldn't load problem reports"),
  });
  const now = useMemo(() => new Date(), [list.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (focusReportId && list.data) focusRef.current?.scrollIntoView({ block: "center" });
  }, [focusReportId, list.data]);

  async function setReportStatus(id: string, next: "open" | "closed") {
    setBusy(id);
    try {
      const response = await fetch(`/api/support-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "That report wasn't updated."));
        return;
      }
      toast.success(next === "closed" ? "Report closed." : "Report reopened.");
      await queryClient.invalidateQueries({ queryKey: ["issues", "reports"] });
      await queryClient.invalidateQueries({ queryKey: ["sidebar-counts"] });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Segmented
        label="Status"
        value={status}
        onChange={setStatus}
        options={[
          { value: "open", label: "Open", count: list.data?.counts.open ?? 0 },
          { value: "closed", label: "Closed", count: list.data?.counts.closed ?? 0 },
        ]}
      />
      {list.isLoading ? (
        <Skeleton className="h-72 w-full rounded-2xl" />
      ) : list.isError ? (
        <EmptyState icon="wifi-off" title="Couldn't load problem reports" description={list.error.message} actionLabel="Try again" onAction={() => void list.refetch()} />
      ) : list.data && list.data.reports.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {list.data.reports.map((report) => (
            <li
              key={report.id}
              ref={report.id === focusReportId ? focusRef : undefined}
              className={cn("rounded-2xl border bg-card p-4 sm:p-5", report.id === focusReportId && "ring-2 ring-[#3E63DD]/40")}
            >
              <ReportCard report={report} now={now} busy={busy === report.id} onStatus={(next) => void setReportStatus(report.id, next)} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon="check"
          title={status === "open" ? "No open problem reports" : "No closed reports"}
          description="When someone uses Report a problem, it lands here with their page, app version, and recent actions."
        />
      )}
    </div>
  );
}

function ReportCard({ report, now, busy, onStatus }: { report: ReportRow; now: Date; busy: boolean; onStatus: (next: "open" | "closed") => void }) {
  const [showActions, setShowActions] = useState(false);
  const version = report.platform === "web" ? (report.appBuild ? `Web ${report.appBuild}` : "Web") : versionText(
    report.appVersion && report.appBuild ? `${report.appVersion} (${report.appBuild})` : report.appVersion ?? report.appBuild,
    report.releaseChannel,
  );
  const device = [report.deviceModel, report.osVersion].filter(Boolean).join(" on ");
  const mailto = report.user
    ? `mailto:${report.user.email}?subject=${encodeURIComponent("Your Wisconsin Creative problem report")}&body=${encodeURIComponent(`Hi ${report.user.name.split(" ")[0]},\n\nThanks for reporting this:\n> ${report.message.slice(0, 300)}\n\n`)}`
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <UserAvatar name={report.user?.name ?? "Deleted user"} className="size-8" />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[14px] font-bold">
            {report.user?.name ?? "Deleted user"}
            {report.role ? <span className="ml-2 text-[12px] font-normal text-muted-foreground">{report.role.toLowerCase()}</span> : null}
          </p>
          <p className="m-0 text-[12.5px] text-muted-foreground">
            {formatRelativeTime(report.createdAt, now)} · {PLATFORM_META[report.platform]?.label ?? report.platform}
          </p>
        </div>
        <StatusPill status={report.status} />
      </div>
      <p className="m-0 whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">{report.message}</p>
      <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-3">
        <Meta label="Page" value={report.screen ?? "Unknown"} mono />
        <Meta label="Version" value={version} />
        <Meta label="Device" value={device || "Unknown"} />
      </dl>
      {report.relatedIssues.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">Errors they hit just before</p>
          {report.relatedIssues.map((issue) => (
            <Link key={issue.id} href={`/issues/${issue.id}`} className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[13px] text-foreground no-underline hover:bg-muted">
              <span className="min-w-0 flex-1 truncate font-bold">{issue.title}</span>
              <StatusPill status={issue.status} />
              <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : null}
      {showActions ? (
        <div className="rounded-xl border bg-background px-3 py-2">
          <ActionTimeline crumbs={report.breadcrumbs} endAt={report.createdAt} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {report.breadcrumbs.length > 0 ? (
          <Button type="button" variant="ghost" onClick={() => setShowActions((v) => !v)} aria-expanded={showActions}>
            {showActions ? "Hide recent actions" : `Show ${report.breadcrumbs.length} recent actions`}
          </Button>
        ) : null}
        <div className="ml-auto flex gap-2">
          {mailto ? (
            <Button asChild variant="outline">
              <a href={mailto}>
                <MailIcon data-icon="inline-start" />
                Reply
              </a>
            </Button>
          ) : null}
          <Button type="button" variant={report.status === "open" ? "default" : "outline"} disabled={busy} onClick={() => onStatus(report.status === "open" ? "closed" : "open")}>
            {report.status === "open" ? "Close" : "Reopen"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("m-0 min-w-0 truncate", mono && "font-mono text-[12px]")}>{value}</dd>
    </div>
  );
}
