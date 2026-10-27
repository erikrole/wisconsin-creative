"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, SearchIcon, RotateCcw, SlidersHorizontalIcon } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  ReportDataRegion,
  ReportEmptyState,
  ReportErrorState,
  ReportExportButton,
  ReportLoadingState,
  ReportMetaLine,
  ReportMobileCard,
  ReportSectionCard,
  ReportTableLink,
} from "../reports/report-ui";
import {
  getReportExportCompletionToast,
  getReportExportFilename,
  readReportExportFailureMessage,
} from "../reports/report-export";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeUp } from "@/components/ui/motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCurrentUser } from "@/hooks/use-current-user";
import { handleAuthRedirect, isAbortError, parseJsonSafely } from "@/lib/errors";
import { formatRelativeTime, pluralize } from "@/lib/format";
import { syncUrl } from "@/lib/url-sync";
import { cn } from "@/lib/utils";
import { useFetch } from "@/hooks/use-fetch";

type Incident = {
  incidentId: string;
  bookingId: string;
  title: string;
  dueAt: string;
  returnedAt: string | null;
  extendedAt: string | null;
  extendedTo: string | null;
  lateHours: number;
  state: "active" | "resolved" | "extended";
  location: { id: string; name: string };
  itemSummary: string;
};

type Person = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  active: boolean;
  primaryArea: string | null;
  checkoutCount: number;
  completedCount: number;
  lateEventCount: number;
  activeOverdueCount: number;
  totalLateHours: number;
  medianLateHours: number;
  worstLateHours: number;
  onTimeRate: number | null;
  lastIncidentAt: string;
  incidents: Incident[];
};

type SortKey = "events" | "time" | "recent";

type AccountabilityReport = {
  generatedAt: string;
  truncated?: boolean;
  scanLimit?: number;
  academicYear: { startYear: number; label: string; start: string; end: string } | null;
  methodology: {
    gracePeriodHours: number;
    minimumCheckoutsForRate: number;
    sort: SortKey;
    ranking: string;
  };
  metrics: {
    peopleNeedingAttention: number;
    lateEvents: number;
    activeOverdue: number;
    totalLateHours: number;
    excludedRecords?: number;
  };
  capabilities: {
    canExport: boolean;
    canManageExclusions: boolean;
  };
  locations: Array<{ id: string; name: string }>;
  leaderboard: Person[];
  excluded?: Array<{
    bookingId: string;
    bookingTitle: string;
    requester: string;
    dueAt: string;
    reason: string;
    note: string | null;
    excludedAt: string;
    excludedBy: string;
  }>;
};

const REASONS = [
  ["TEST_DATA", "Test data"],
  ["IMPORTED_BAD_DATA", "Imported bad data"],
  ["INCORRECT_TIMESTAMPS", "Incorrect timestamps"],
  ["DUPLICATE_RECORD", "Duplicate record"],
  ["OTHER", "Other"],
] as const;

const REASON_LABELS = Object.fromEntries(REASONS) as Record<string, string>;

const INCIDENT_STATES = new Set(["all", "active", "resolved", "extended"]);
const USER_STATES = new Set(["all", "active", "inactive"]);
const SORTS = new Set(["events", "time", "recent"]);

function formatHours(hours: number) {
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return remainder ? `${days}d ${remainder}h` : `${days}d`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function areaLabel(area: string | null) {
  return area ? area.replaceAll("_", " ") : "No area";
}

function allowedValue(value: string | null, allowed: Set<string>, fallback: string) {
  return value && allowed.has(value) ? value : fallback;
}

function academicYearValue(value: string | null, currentStartYear: number) {
  if (value === "all") return "all";
  if (value && /^\d{4}$/.test(value)) {
    const year = Number(value);
    if (year >= 2000 && year <= 2100) return String(year);
  }
  return String(currentStartYear);
}

async function downloadAccountabilityCsv(queryUrl: string) {
  try {
    const separator = queryUrl.includes("?") ? "&" : "?";
    const res = await fetch(`${queryUrl}${separator}format=csv`);
    if (handleAuthRedirect(res, "/accountability")) return;
    if (!res.ok) {
      toast.error(await readReportExportFailureMessage(res, "Accountability ranking"));
      return;
    }

    const blob = await res.blob();
    const filename = getReportExportFilename(
      res.headers.get("Content-Disposition"),
      "accountability.csv",
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
      reportLabel: "Accountability ranking",
      rowCount: Number.isFinite(exportedCount) ? exportedCount : 0,
      scopeLabel: "ranked people",
      total: res.headers.get("X-Total-Count"),
      truncated: res.headers.get("X-Truncated") === "true",
    });
    if (completionToast.variant === "warning") toast.warning(completionToast.message);
    else toast.success(completionToast.message);
  } catch (err) {
    if (isAbortError(err)) return;
    toast.error("Accountability CSV export failed. Check your connection and try again.");
  }
}

function OnTimeRate({ person }: { person: Person }) {
  if (person.onTimeRate === null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default text-xs text-muted-foreground">Not rated</span>
        </TooltipTrigger>
        <TooltipContent>
          Needs 3 completed checkouts or currently overdue checkouts before an on-time rate is meaningful
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span
      className={cn(
        "text-base tabular-nums",
        person.onTimeRate < 60 && "font-semibold text-[var(--red-text)]",
      )}
    >
      {person.onTimeRate}%
    </span>
  );
}

function IncidentStateBadge({ incident }: { incident: Incident }) {
  if (incident.state === "active") return <Badge variant="red">Currently overdue</Badge>;
  if (incident.state === "extended") return <Badge variant="orange">Extended after overdue</Badge>;
  return <Badge variant="secondary">Returned</Badge>;
}

export default function AccountabilityClient({
  currentStartYear,
}: {
  currentStartYear: number;
}) {
  const searchParams = useSearchParams();
  const { data: currentUser } = useCurrentUser();
  const [clock, setClock] = useState(() => new Date());
  const [year, setYear] = useState(() => academicYearValue(searchParams.get("year"), currentStartYear));
  const [locationId, setLocationId] = useState(() => searchParams.get("locationId") || "all");
  const [incidentState, setIncidentState] = useState(() =>
    allowedValue(searchParams.get("state"), INCIDENT_STATES, "all"),
  );
  const [userState, setUserState] = useState(() =>
    allowedValue(searchParams.get("users"), USER_STATES, "all"),
  );
  const [sort, setSort] = useState<SortKey>(
    () => allowedValue(searchParams.get("sort"), SORTS, "events") as SortKey,
  );
  const [query, setQuery] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [excludeTarget, setExcludeTarget] = useState<Incident | null>(null);
  const [reason, setReason] = useState("TEST_DATA");
  const [note, setNote] = useState("");
  const mutationGuard = useRef(false);
  const [mutating, setMutating] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    syncUrl({
      year,
      locationId: locationId === "all" ? "" : locationId,
      state: incidentState === "all" ? "" : incidentState,
      users: userState === "all" ? "" : userState,
      sort: sort === "events" ? "" : sort,
    });
  }, [incidentState, locationId, sort, userState, year]);

  function changeYear(next: string) {
    setYear(next);
    setExpanded(new Set());
  }
  function changeLocation(next: string | null) {
    setLocationId(next ?? "all");
  }
  function changeIncidentState(next: string) {
    setIncidentState(next);
    setExpanded(new Set());
  }
  function changeUserState(next: string) {
    setUserState(next);
  }
  function changeSort(next: SortKey) {
    setSort(next);
  }

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams({ year, state: incidentState, users: userState, sort });
    if (locationId !== "all") params.set("locationId", locationId);
    return `/api/accountability?${params}`;
  }, [incidentState, locationId, sort, userState, year]);

  const { data, loading, refreshing, error, reload } = useFetch<AccountabilityReport>({
    url: queryUrl,
    transform: (json) => json as unknown as AccountabilityReport,
    keepPreviousData: true,
  });

  useEffect(() => {
    if (!data) return;
    const exists = locationId === "all" || data.locations.some((location) => location.id === locationId);
    if (!exists) setLocationId("all");
  }, [data, locationId]);

  const years = Array.from({ length: 5 }, (_, index) => currentStartYear - index);

  function toggle(userId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function mutate(url: string, method: "POST" | "DELETE", body?: object) {
    if (mutationGuard.current) return false;
    mutationGuard.current = true;
    setMutating(true);
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (handleAuthRedirect(response, "/accountability")) return false;
      if (!response.ok) {
        const payload = await parseJsonSafely<{ error?: string }>(response);
        toast.error(payload?.error ?? "Accountability update failed.");
        return false;
      }
      reload();
      return true;
    } catch {
      toast.error("Accountability update failed. Check your connection and try again.");
      return false;
    } finally {
      mutationGuard.current = false;
      setMutating(false);
    }
  }

  async function submitExclusion() {
    if (!excludeTarget) return;
    const success = await mutate("/api/accountability/exclusions", "POST", {
      bookingId: excludeTarget.bookingId,
      reason,
      note: note.trim() || null,
    });
    if (success) {
      toast.success(`${excludeTarget.title} excluded from accountability.`);
      setExcludeTarget(null);
      setReason("TEST_DATA");
      setNote("");
    }
  }

  async function restore(bookingId: string, title: string) {
    const success = await mutate(`/api/accountability/exclusions/${bookingId}`, "DELETE");
    if (success) toast.success(`${title} restored to accountability.`);
  }

  function exportCsv() {
    void downloadAccountabilityCsv(queryUrl);
  }

  function revealYou(userId: string) {
    setQuery("");
    window.setTimeout(() => {
      const targets = document.querySelectorAll<HTMLElement>(`[data-accountability-person="${userId}"]`);
      const visible = [...targets].find((node) => node.getClientRects().length > 0) ?? targets[0];
      visible?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }

  if (loading && !data) return <ReportLoadingState metricCount={4} rows={6} />;

  if (error && !data) {
    return (
      <ReportErrorState
        error={error}
        onRetry={reload}
        title="Couldn’t load accountability"
      />
    );
  }
  if (!data) return null;

  const leaderboard = data.leaderboard;
  const scopeLabel = data.academicYear?.label ?? "All time";
  const canManageExclusions = data.capabilities.canManageExclusions;
  const excluded = data.excluded ?? [];
  const currentUserId = currentUser?.id ?? null;
  const normalizedQuery = query.trim().toLowerCase();
  const hasScopeFilters =
    year !== String(currentStartYear) ||
    locationId !== "all" ||
    incidentState !== "all" ||
    userState !== "all";
  const moreFilterCount =
    (locationId !== "all" ? 1 : 0) +
    (incidentState !== "all" ? 1 : 0) +
    (userState !== "all" ? 1 : 0) +
    (sort !== "events" ? 1 : 0);
  const locationOptions = data.locations;
  const you = currentUserId ? leaderboard.find((person) => person.userId === currentUserId) : undefined;
  const overdueNow = leaderboard
    .flatMap((person) =>
      person.incidents.filter((incident) => incident.state === "active").map((incident) => ({ person, incident })),
    )
    .sort((a, b) => b.incident.lateHours - a.incident.lateHours);
  const repeatPeople = leaderboard.filter((person) => person.lateEventCount >= 2);
  const listBase = showAll || repeatPeople.length === 0 ? leaderboard : repeatPeople;
  const listPeople = normalizedQuery
    ? leaderboard.filter((person) => person.name.toLowerCase().includes(normalizedQuery))
    : listBase;
  const hiddenCount = leaderboard.length - listBase.length;

  return (
    <FadeUp>
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" role="status">
            <span className="font-semibold text-foreground">{scopeLabel}</span>
            {" · "}
            {data.metrics.lateEvents === 0
              ? "No late returns"
              : `${pluralize(data.metrics.lateEvents, "late return")} from ${pluralize(data.metrics.peopleNeedingAttention, "person", "people")}`}
            {data.metrics.activeOverdue > 0 ? (
              <>
                {" · "}
                <Link href="/checkouts?filter=overdue" className="font-medium text-[var(--red-text)] hover:underline">
                  {data.metrics.activeOverdue} still out
                </Link>
              </>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={year} onValueChange={changeYear}>
              <SelectTrigger size="sm" className="w-[132px]" aria-label="Academic year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((start) => (
                  <SelectItem key={start} value={String(start)}>
                    {start}-{String(start + 1).slice(-2)}
                  </SelectItem>
                ))}
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative w-[200px] shrink-0">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a person"
                aria-label="Find a person on the list"
                className="h-9 pl-9"
              />
            </div>
            <Button
              variant="ghost"
              className="h-10"
              onClick={() => setShowMore((open) => !open)}
              aria-expanded={showMore}
            >
              <SlidersHorizontalIcon data-icon="inline-start" />
              More filters{moreFilterCount > 0 ? ` (${moreFilterCount})` : ""}
            </Button>
            {data.capabilities.canExport ? (
              <ReportExportButton
                ariaLabel="Export the ranked accountability rows as CSV"
                label="Export"
                disabled={leaderboard.length === 0}
                onClick={exportCsv}
              />
            ) : null}
          </div>
        </div>
        {showMore ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/60 p-3">
            <Select value={sort} onValueChange={(next) => changeSort(next as SortKey)}>
              <SelectTrigger size="sm" className="w-[190px]" aria-label="Rank by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="events">Rank by times late</SelectItem>
                <SelectItem value="time">Rank by time late</SelectItem>
                <SelectItem value="recent">Rank by most recent</SelectItem>
              </SelectContent>
            </Select>
            <Select value={locationId} onValueChange={(next) => changeLocation(next === "all" ? null : next)}>
              <SelectTrigger size="sm" className="w-[170px]" aria-label="Location">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {locationOptions.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={incidentState} onValueChange={changeIncidentState}>
              <SelectTrigger size="sm" className="w-[190px]" aria-label="Late return type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All late returns</SelectItem>
                <SelectItem value="active">Still overdue</SelectItem>
                <SelectItem value="resolved">Returned late</SelectItem>
                <SelectItem value="extended">Extended after overdue</SelectItem>
              </SelectContent>
            </Select>
            <Select value={userState} onValueChange={changeUserState}>
              <SelectTrigger size="sm" className="w-[175px]" aria-label="User status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Active and inactive</SelectItem>
                <SelectItem value="active">Active users</SelectItem>
                <SelectItem value="inactive">Inactive users</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <ReportDataRegion refreshing={refreshing}>
      {overdueNow.length > 0 ? (
        <ReportSectionCard
          title="Overdue now"
          description="Still out past the due time."
          className="mb-4"
        >
          <div className="divide-y">
            {overdueNow.slice(0, 5).map(({ person, incident }) => (
              <div
                key={incident.incidentId}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="sm" className="shrink-0" />
                  <div className="min-w-0">
                    <Link href={`/staff/${person.userId}`} className="brand-identity block truncate font-semibold hover:underline">
                      {person.name}
                    </Link>
                    <ReportTableLink href={`/checkouts/${incident.bookingId}`}>{incident.title}</ReportTableLink>
                  </div>
                </div>
                <span className="shrink-0 text-sm font-semibold text-[var(--red-text)] tabular-nums">
                  {formatHours(incident.lateHours)} overdue
                </span>
              </div>
            ))}
          </div>
          {overdueNow.length > 5 ? (
            <Link href="/checkouts?filter=overdue" className="mt-3 inline-block text-sm text-muted-foreground hover:underline">
              See all {overdueNow.length} overdue checkouts
            </Link>
          ) : null}
        </ReportSectionCard>
      ) : null}

      {you ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
          <p className="text-sm">
            <span className="font-semibold">Your record</span>
            <span className="text-muted-foreground">
              {" · "}
              {pluralize(you.lateEventCount, "late return")}
              {you.onTimeRate !== null ? `, ${you.onTimeRate}% on time` : ""}
            </span>
          </p>
          <Button variant="ghost" className="h-10" onClick={() => revealYou(you.userId)}>
            Show me in the list
          </Button>
        </div>
      ) : null}

      {data.truncated ? (
        <ReportMetaLine
          className="mb-4 text-xs"
          items={[
            `Showing the ${(data.scanLimit ?? 0).toLocaleString()} most recent checkouts. Older history is left out of the incident lists; checkout and return totals still cover everything.`,
          ]}
        />
      ) : null}

      <ReportSectionCard
        title={showAll || repeatPeople.length === 0 ? "Everyone with a late return" : "Repeat late returns"}
        description={
          showAll || repeatPeople.length === 0
            ? "Open a row to see each late checkout."
            : "People late 2 or more times. Open a row to see each late checkout."
        }
        className="mb-4"
        contentClassName="p-0"
      >
        {leaderboard.length === 0 ? (
          <div className="p-4">
            <ReportEmptyState
              icon={hasScopeFilters ? "search" : "check"}
              title={hasScopeFilters ? "No one matches these filters" : "No late returns"}
              description={
                hasScopeFilters
                  ? "Broaden the year or filters to look through more history."
                  : "Everything in this period came back on time."
              }
            />
          </div>
        ) : listPeople.length === 0 ? (
          <div className="p-4">
            <ReportEmptyState
              icon="search"
              title={`No one named “${query.trim()}”`}
              description="Clear the search to see the full list."
            />
          </div>
        ) : (
          <>
            <div className="hidden xl:block">
              <Table className="table-fixed">
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="w-[50%]">Person</TableHead>
                    <TableHead className="w-[20%] text-right">Times late</TableHead>
                    <TableHead className="w-[18%] text-right">On time</TableHead>
                    <TableHead className="w-[12%] text-right"><span className="sr-only">Checkouts</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listPeople.map((person) => (
                    <PersonRows
                      key={person.userId}
                      person={person}
                      now={clock}
                      isYou={person.userId === currentUserId}
                      expanded={expanded.has(person.userId)}
                      onToggle={() => toggle(person.userId)}
                      onExclude={canManageExclusions ? setExcludeTarget : undefined}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="xl:hidden">
              {listPeople.map((person) => (
                <PersonMobileCard
                  key={person.userId}
                  person={person}
                  now={clock}
                  isYou={person.userId === currentUserId}
                  expanded={expanded.has(person.userId)}
                  onToggle={() => toggle(person.userId)}
                  onExclude={canManageExclusions ? setExcludeTarget : undefined}
                />
              ))}
            </div>
            {!normalizedQuery && repeatPeople.length > 0 && hiddenCount > 0 ? (
              <div className="border-t p-3">
                <Button variant="ghost" className="h-10" onClick={() => setShowAll(true)}>
                  Show {pluralize(hiddenCount, "person", "people")} late once
                </Button>
              </div>
            ) : null}
            {!normalizedQuery && showAll && repeatPeople.length > 0 ? (
              <div className="border-t p-3">
                <Button variant="ghost" className="h-10" onClick={() => setShowAll(false)}>
                  Show repeat late returns only
                </Button>
              </div>
            ) : null}
          </>
        )}
      </ReportSectionCard>

      {canManageExclusions ? (
        <ReportSectionCard
          title="Excluded records"
          description="Reversible data-quality exceptions for this filtered period."
          className="mb-4"
        >
          {excluded.length === 0 ? (
            <p className="text-sm text-muted-foreground">No records are excluded in this view.</p>
          ) : (
            <div className="divide-y">
              {excluded.map((entry) => (
                <div
                  key={entry.bookingId}
                  className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <ReportTableLink href={`/checkouts/${entry.bookingId}`}>
                      {entry.bookingTitle || "Untitled checkout"}
                    </ReportTableLink>
                    <ReportMetaLine
                      className="text-sm"
                      items={[
                        entry.requester,
                        REASON_LABELS[entry.reason] ?? entry.reason.replaceAll("_", " ").toLowerCase(),
                        `excluded by ${entry.excludedBy}`,
                      ]}
                    />
                    {entry.note && <p className="mt-1 text-sm">{entry.note}</p>}
                  </div>
                  <Button
                    variant="outline"
                    className="h-10 shrink-0"
                    onClick={() => restore(entry.bookingId, entry.bookingTitle)}
                    disabled={mutating}
                  >
                    <RotateCcw data-icon="inline-start" /> Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ReportSectionCard>
      ) : null}

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="h-10 text-muted-foreground">
            How this is calculated
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 rounded-lg border bg-card/60 p-4 text-sm text-muted-foreground">
            <p>
              {data.methodology.ranking}. A checkout becomes late after its due time plus the
              configured {data.methodology.gracePeriodHours}-hour grace period.
            </p>
            <p className="mt-2">
              Extending an already-late checkout records a separate late event against the prior due
              time. On-time rate appears after {data.methodology.minimumCheckoutsForRate} completed
              checkouts or currently overdue checkouts, and currently overdue gear counts as not on
              time. Admin-reviewed data-quality exclusions affect this page only and never remove
              custody history.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {canManageExclusions ? (
        <Dialog
          open={excludeTarget !== null}
          onOpenChange={(open) => {
            if (!open && !mutating) setExcludeTarget(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <div>
                <DialogTitle>Exclude checkout from this ranking</DialogTitle>
                <DialogDescription>
                  {excludeTarget
                    ? `${excludeTarget.title} stays in custody history. This only removes it from the leaderboard.`
                    : "This keeps the checkout and all custody evidence intact."}
                </DialogDescription>
              </div>
            </DialogHeader>
            <DialogBody className="space-y-4 py-5">
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REASONS.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="accountability-note">
                  Explanation {reason === "OTHER" ? "(required)" : "(optional)"}
                </Label>
                <Textarea
                  id="accountability-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={500}
                />
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setExcludeTarget(null)} disabled={mutating}>
                Cancel
              </Button>
              <Button
                onClick={submitExclusion}
                loading={mutating}
                disabled={reason === "OTHER" && !note.trim()}
              >
                Exclude record
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      </ReportDataRegion>
    </FadeUp>
  );
}

function PersonSubline({ person, now }: { person: Person; now: Date }) {
  return (
    <ReportMetaLine
      className="text-xs"
      items={[
        areaLabel(person.primaryArea),
        `Last late ${formatRelativeTime(person.lastIncidentAt, now)}`,
        !person.active && "Inactive",
      ]}
    />
  );
}

function TimesLate({ person }: { person: Person }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-base font-semibold tabular-nums">{person.lateEventCount}</span>
      {person.activeOverdueCount > 0 ? (
        <span className="text-xs font-medium text-[var(--red-text)]">{person.activeOverdueCount} still out</span>
      ) : null}
    </div>
  );
}

function IncidentActions({
  incident,
  onExclude,
}: {
  incident: Incident;
  onExclude: (incident: Incident) => void;
}) {
  return (
    <Button
      variant="outline"
      className="h-10"
      onClick={() => onExclude(incident)}
      aria-label={`Exclude ${incident.title} from accountability`}
    >
      Exclude
    </Button>
  );
}

function IncidentHistory({
  person,
  historyId,
  onExclude,
}: {
  person: Person;
  historyId: string;
  onExclude?: (incident: Incident) => void;
}) {
  return (
    <div
      id={historyId}
      role="region"
      aria-label={`Late checkouts for ${person.name}`}
      className="overflow-hidden rounded-md border bg-background"
    >
      <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2">
        <span className="text-xs font-medium text-foreground">Late checkouts</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatHours(person.totalLateHours)} late in total
        </span>
      </div>
      <div className="divide-y">
        {person.incidents.map((incident) => (
          <div
            key={incident.incidentId}
            className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div className="min-w-0">
              <ReportTableLink href={`/checkouts/${incident.bookingId}`}>
                {incident.title}
              </ReportTableLink>
              <ReportMetaLine
                className="mt-1 text-xs"
                items={[
                  incident.location.name,
                  `Due ${formatDate(incident.dueAt)}`,
                  incident.state === "extended" && incident.extendedAt && incident.extendedTo
                    ? `Extended ${formatDate(incident.extendedAt)} to ${formatDate(incident.extendedTo)}`
                    : incident.returnedAt
                      ? `Returned ${formatDate(incident.returnedAt)}`
                      : null,
                  incident.itemSummary || null,
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <span className="text-sm font-semibold text-[var(--red-text)] tabular-nums">
                {formatHours(incident.lateHours)} late
              </span>
              <IncidentStateBadge incident={incident} />
              {onExclude ? <IncidentActions incident={incident} onExclude={onExclude} /> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PersonRows({
  person,
  now,
  isYou,
  expanded,
  onToggle,
  onExclude,
}: {
  person: Person;
  now: Date;
  isYou: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExclude?: (incident: Incident) => void;
}) {
  const ChevronIcon = expanded ? ChevronUp : ChevronDown;
  const historyId = `accountability-history-${person.userId}`;

  return (
    <>
      <TableRow
        id={`accountability-person-${person.userId}`}
        data-accountability-person={person.userId}
        className={cn(isYou && "bg-muted/40")}
      >
        <TableCell className="py-3">
          <div className="flex items-center gap-3">
            <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="sm" className="shrink-0" />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Link
                  href={`/staff/${person.userId}`}
                  className="brand-identity truncate font-semibold hover:underline"
                >
                  {person.name}
                </Link>
                {isYou ? <Badge variant="secondary" size="sm">You</Badge> : null}
              </div>
              <PersonSubline person={person} now={now} />
            </div>
          </div>
        </TableCell>
        <TableCell className="py-3">
          <TimesLate person={person} />
        </TableCell>
        <TableCell className="py-3 text-right">
          <OnTimeRate person={person} />
        </TableCell>
        <TableCell className="py-2 pr-2">
          <Button
            variant="ghost"
            className="ml-auto h-10 w-full justify-end px-2 text-muted-foreground"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={historyId}
            aria-label={`${expanded ? "Hide" : "Show"} ${pluralize(person.incidents.length, "late checkout")} for ${person.name}`}
          >
            <ChevronIcon className="size-4" aria-hidden="true" />
          </Button>
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={4} className="p-0">
            <div className="px-4 py-3">
              <IncidentHistory person={person} historyId={historyId} onExclude={onExclude} />
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function PersonMobileCard({
  person,
  now,
  isYou,
  expanded,
  onToggle,
  onExclude,
}: {
  person: Person;
  now: Date;
  isYou: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExclude?: (incident: Incident) => void;
}) {
  const ChevronIcon = expanded ? ChevronUp : ChevronDown;
  const historyId = `accountability-history-mobile-${person.userId}`;

  return (
    <ReportMobileCard
      id={`accountability-person-mobile-${person.userId}`}
      data-accountability-person={person.userId}
      className={cn("gap-3 py-4", isYou && "bg-muted/40")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="sm" className="shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={`/staff/${person.userId}`}
                className="brand-identity truncate font-semibold hover:underline"
              >
                {person.name}
              </Link>
              {isYou ? <Badge variant="secondary" size="sm">You</Badge> : null}
            </div>
            <PersonSubline person={person} now={now} />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <TimesLate person={person} />
          <div className="mt-0.5 text-xs text-muted-foreground">
            {person.onTimeRate !== null ? `${person.onTimeRate}% on time` : "Not rated"}
          </div>
        </div>
      </div>
      <Button
        variant="ghost"
        className="h-10 w-full justify-between bg-muted/30 px-3 text-muted-foreground"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={historyId}
        aria-label={`${expanded ? "Hide" : "Show"} ${pluralize(person.incidents.length, "late checkout")} for ${person.name}`}
      >
        <span>{expanded ? "Hide" : "Show"} {pluralize(person.incidents.length, "late checkout")}</span>
        <ChevronIcon className="size-4" aria-hidden="true" />
      </Button>
      {expanded ? (
        <IncidentHistory person={person} historyId={historyId} onExclude={onExclude} />
      ) : null}
    </ReportMobileCard>
  );
}
