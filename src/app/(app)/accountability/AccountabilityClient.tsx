"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, MoreHorizontal, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import MetricCard from "../reports/MetricCard";
import {
  REPORT_OVERDUE_CHART_COLORS,
  ReportChartCard,
  ReportEmptyState,
  ReportErrorState,
  ReportExportButton,
  ReportLoadingState,
  ReportMetaLine,
  ReportMetricGrid,
  ReportMobileCard,
  ReportSectionCard,
  ReportSegmentedControl,
  ReportTableLink,
  ReportToolbar,
  ReportToolbarGroup,
} from "../reports/report-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { formatRelativeTime } from "@/lib/format";
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
    excludedRecords: number;
  };
  locations: Array<{ id: string; name: string }>;
  leaderboard: Person[];
  excluded: Array<{
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

const INCIDENT_STATE_LABELS: Record<string, string> = {
  active: "Active overdue",
  resolved: "Resolved late returns",
  extended: "Extended after overdue",
};

const USER_STATE_LABELS: Record<string, string> = {
  active: "Active users",
  inactive: "Inactive users",
};

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

function OnTimeRate({ person }: { person: Person }) {
  if (person.onTimeRate === null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default text-muted-foreground">—</span>
        </TooltipTrigger>
        <TooltipContent>
          Needs more completed checkouts before an on-time rate is meaningful
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span
      className={cn(
        "tabular-nums",
        person.onTimeRate < 60
          ? "font-semibold text-[var(--red-text)]"
          : person.onTimeRate < 85
            ? "text-[var(--orange-text)]"
            : "text-muted-foreground",
      )}
    >
      {person.onTimeRate}%
    </span>
  );
}

function IncidentStateBadge({ incident }: { incident: Incident }) {
  if (incident.state === "active") return <Badge variant="red">Currently overdue</Badge>;
  if (incident.state === "extended") {
    return (
      <Badge variant="orange">
        Extended {formatDate(incident.extendedAt!)} to {formatDate(incident.extendedTo!)}
      </Badge>
    );
  }
  return <Badge variant="secondary">Returned {formatDate(incident.returnedAt!)}</Badge>;
}

export default function AccountabilityClient() {
  const now = new Date();
  const currentStartYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const [clock, setClock] = useState(() => new Date());
  const [year, setYear] = useState(String(currentStartYear));
  const [locationId, setLocationId] = useState("all");
  const [incidentState, setIncidentState] = useState("all");
  const [userState, setUserState] = useState("all");
  const [sort, setSort] = useState<SortKey>("events");
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

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams({ year, state: incidentState, users: userState, sort });
    if (locationId !== "all") params.set("locationId", locationId);
    return `/api/accountability?${params}`;
  }, [incidentState, locationId, sort, userState, year]);

  const { data, loading, error, lastRefreshed, reload } = useFetch<AccountabilityReport>({
    url: queryUrl,
    transform: (json) => json as unknown as AccountabilityReport,
    keepPreviousData: true,
  });

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
    const separator = queryUrl.includes("?") ? "&" : "?";
    window.location.assign(`${queryUrl}${separator}format=csv`);
  }

  if (loading && !data) return <ReportLoadingState metricCount={4} rows={6} />;

  if (error && !data) {
    return (
      <ReportErrorState
        error={error}
        onRetry={reload}
        title="Failed to load accountability report"
      />
    );
  }
  if (!data) return null;

  const leaderboard = data.leaderboard;
  const scopeLabel = data.academicYear?.label ?? "All time";
  const rankByTime = sort === "time";
  const chartByEvents = sort === "events";
  const chartRows = leaderboard.slice(0, 10).map((person) => ({
    name: person.name,
    value: chartByEvents ? person.lateEventCount : person.totalLateHours,
  }));

  const activeFilters = [
    ...(locationId !== "all"
      ? [{
          key: "location",
          label: `Location: ${data.locations.find((entry) => entry.id === locationId)?.name ?? locationId}`,
          onRemove: () => setLocationId("all"),
        }]
      : []),
    ...(incidentState !== "all"
      ? [{
          key: "state",
          label: `Incidents: ${INCIDENT_STATE_LABELS[incidentState]}`,
          onRemove: () => setIncidentState("all"),
        }]
      : []),
    ...(userState !== "all"
      ? [{
          key: "users",
          label: `Users: ${USER_STATE_LABELS[userState]}`,
          onRemove: () => setUserState("all"),
        }]
      : []),
  ];

  return (
    <FadeUp>
      <ReportToolbar
        activeFilters={activeFilters}
        lastRefreshed={lastRefreshed}
        loading={loading}
        now={clock}
        onRefresh={reload}
        exportAction={
          <ReportExportButton
            ariaLabel="Export the ranked accountability rows as CSV"
            label="Export ranking"
            disabled={leaderboard.length === 0}
            onClick={exportCsv}
          />
        }
      >
        <ReportToolbarGroup label="Rank by">
          <ReportSegmentedControl
            ariaLabel="Accountability ranking"
            value={sort}
            options={[
              { value: "events", label: "Volume" },
              { value: "time", label: "Time" },
              { value: "recent", label: "Recent" },
            ]}
            onChange={(next) => setSort(next as SortKey)}
          />
        </ReportToolbarGroup>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger size="sm" className="w-[150px]" aria-label="Academic year">
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
        <Select value={locationId} onValueChange={setLocationId}>
          <SelectTrigger size="sm" className="w-[170px]" aria-label="Location">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {data.locations.map((location) => (
              <SelectItem key={location.id} value={location.id}>
                {location.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={incidentState} onValueChange={setIncidentState}>
          <SelectTrigger size="sm" className="w-[190px]" aria-label="Incident state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All late events</SelectItem>
            <SelectItem value="active">Active overdue</SelectItem>
            <SelectItem value="resolved">Resolved late returns</SelectItem>
            <SelectItem value="extended">Extended after overdue</SelectItem>
          </SelectContent>
        </Select>
        <Select value={userState} onValueChange={setUserState}>
          <SelectTrigger size="sm" className="w-[175px]" aria-label="User status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Active and inactive</SelectItem>
            <SelectItem value="active">Active users</SelectItem>
            <SelectItem value="inactive">Inactive users</SelectItem>
          </SelectContent>
        </Select>
      </ReportToolbar>

      <ReportMetricGrid>
        <MetricCard
          value={data.metrics.peopleNeedingAttention}
          label="People needing attention"
          tooltip={`People with at least one late event in ${scopeLabel.toLowerCase()}`}
        />
        <MetricCard
          value={data.metrics.lateEvents}
          label="Late events"
          tooltip="Late returns, checkouts still overdue, and extensions made after the prior due time"
        />
        <MetricCard
          value={formatHours(data.metrics.totalLateHours)}
          label="Total late time"
          tooltip="Combined hours past due across every late event in this view"
        />
        <MetricCard
          value={data.metrics.activeOverdue}
          label="Currently overdue"
          color={data.metrics.activeOverdue > 0 ? "var(--red)" : undefined}
          tooltip="Checkouts still out past their due time right now"
          href="/checkouts?filter=overdue"
        />
        <MetricCard
          value={data.metrics.excludedRecords}
          label="Excluded records"
          tooltip="Data-quality exceptions held out of this ranking"
        />
      </ReportMetricGrid>

      {chartRows.length > 0 && (
        <ReportChartCard
          title={chartByEvents ? "Late events by person" : "Late time by person"}
          description={`Top ${chartRows.length} in ${scopeLabel.toLowerCase()}`}
          className="mb-4"
        >
          <ChartContainer
            config={{
              value: {
                label: chartByEvents ? "Late events" : "Late hours",
                color: "var(--chart-5)",
              },
            }}
            className="w-full"
            style={{ height: Math.max(150, chartRows.length * 36) }}
          >
            <BarChart data={chartRows} layout="vertical" margin={{ left: 0, right: 12 }}>
              <YAxis
                dataKey="name"
                type="category"
                width={120}
                tickLine={false}
                axisLine={false}
                className="text-xs"
              />
              <XAxis type="number" hide />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="value" name={chartByEvents ? "Late events" : "Late hours"} radius={[0, 4, 4, 0]}>
                {chartRows.map((_, index) => (
                  <Cell key={index} fill={REPORT_OVERDUE_CHART_COLORS[index]} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </ReportChartCard>
      )}

      <ReportSectionCard
        title="Needs attention"
        description={`${data.methodology.ranking}. Rank 1 is the pattern most worth reviewing, not an award.`}
        className="mb-4"
        contentClassName="p-0"
      >
        {leaderboard.length === 0 ? (
          <div className="p-4">
            <ReportEmptyState
              icon="check"
              title="No late-return patterns in this view"
              description="Try another academic year or broaden the filters."
            />
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Person</TableHead>
                    <TableHead className={cn("text-right", !rankByTime && "text-foreground")}>
                      Late events
                    </TableHead>
                    <TableHead className="text-right">Overdue now</TableHead>
                    <TableHead className={cn("text-right", rankByTime && "text-foreground")}>
                      Total late
                    </TableHead>
                    <TableHead className="text-right">Worst</TableHead>
                    <TableHead className="text-right">On time</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaderboard.map((person, index) => (
                    <PersonRows
                      key={person.userId}
                      person={person}
                      rank={index + 1}
                      rankByTime={rankByTime}
                      now={clock}
                      expanded={expanded.has(person.userId)}
                      onToggle={() => toggle(person.userId)}
                      onExclude={setExcludeTarget}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="md:hidden">
              {leaderboard.map((person, index) => (
                <PersonMobileCard
                  key={person.userId}
                  person={person}
                  rank={index + 1}
                  rankByTime={rankByTime}
                  now={clock}
                  expanded={expanded.has(person.userId)}
                  onToggle={() => toggle(person.userId)}
                  onExclude={setExcludeTarget}
                />
              ))}
            </div>
          </>
        )}
      </ReportSectionCard>

      <ReportSectionCard
        title="Excluded records"
        description="Reversible data-quality exceptions for this filtered period."
        className="mb-4"
      >
        {data.excluded.length === 0 ? (
          <p className="text-sm text-muted-foreground">No records are excluded in this view.</p>
        ) : (
          <div className="divide-y">
            {data.excluded.map((entry) => (
              <div
                key={entry.bookingId}
                className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <ReportTableLink href={`/checkouts/${entry.bookingId}`}>
                    {entry.bookingTitle}
                  </ReportTableLink>
                  <ReportMetaLine
                    className="text-sm"
                    items={[
                      entry.requester,
                      entry.reason.replaceAll("_", " ").toLowerCase(),
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

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="h-10 text-muted-foreground">
            How this ranking works
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
              checkouts. Exclusions affect this page only and never remove custody history.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Dialog
        open={excludeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !mutating) setExcludeTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <div>
              <DialogTitle>Exclude checkout from accountability</DialogTitle>
              <DialogDescription>
                This keeps the checkout and all custody evidence intact.
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
              disabled={mutating || (reason === "OTHER" && !note.trim())}
            >
              {mutating ? "Excluding..." : "Exclude record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FadeUp>
  );
}

function PersonSubline({ person, now }: { person: Person; now: Date }) {
  return (
    <ReportMetaLine
      className="text-xs"
      items={[
        areaLabel(person.primaryArea),
        `${person.checkoutCount} checkouts`,
        `typical ${formatHours(person.medianLateHours)} late`,
        `last ${formatRelativeTime(person.lastIncidentAt, now)}`,
        !person.active && "Inactive",
      ]}
    />
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={(event) => event.stopPropagation()}
          aria-label={`Actions for ${incident.title}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onExclude(incident)}>
          Exclude from accountability
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PersonRows({
  person,
  rank,
  rankByTime,
  now,
  expanded,
  onToggle,
  onExclude,
}: {
  person: Person;
  rank: number;
  rankByTime: boolean;
  now: Date;
  expanded: boolean;
  onToggle: () => void;
  onExclude: (incident: Incident) => void;
}) {
  const ChevronIcon = expanded ? ChevronUp : ChevronDown;

  return (
    <>
      <TableRow
        className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
        onClick={onToggle}
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${person.name}`}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <TableCell className="text-muted-foreground tabular-nums">{rank}</TableCell>
        <TableCell>
          <Link
            href={`/users/${person.userId}`}
            onClick={(event) => event.stopPropagation()}
            className="font-semibold hover:underline"
          >
            {person.name}
          </Link>
          <PersonSubline person={person} now={now} />
        </TableCell>
        <TableCell className="text-right">
          <Badge variant={rankByTime ? "secondary" : "red"}>{person.lateEventCount}</Badge>
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {person.activeOverdueCount > 0 ? (
            <span className="font-semibold text-[var(--red-text)]">{person.activeOverdueCount}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell
          className={cn(
            "text-right tabular-nums",
            rankByTime ? "font-semibold text-[var(--red-text)]" : "font-medium",
          )}
        >
          {formatHours(person.totalLateHours)}
        </TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">
          {formatHours(person.worstLateHours)}
        </TableCell>
        <TableCell className="text-right">
          <OnTimeRate person={person} />
        </TableCell>
        <TableCell className="text-center text-muted-foreground">
          <ChevronIcon className="mx-auto size-4" aria-hidden="true" />
        </TableCell>
      </TableRow>
      {expanded &&
        person.incidents.map((incident) => (
          <TableRow key={incident.incidentId} className="bg-muted/30">
            <TableCell />
            <TableCell colSpan={3} className="pl-6">
              <ReportTableLink href={`/checkouts/${incident.bookingId}`}>
                {incident.title}
              </ReportTableLink>
              <ReportMetaLine
                className="text-sm"
                items={[
                  incident.location.name,
                  `Due ${formatDate(incident.dueAt)}`,
                  incident.itemSummary || null,
                ]}
              />
            </TableCell>
            <TableCell className="text-right text-sm font-medium text-[var(--red-text)] tabular-nums">
              {formatHours(incident.lateHours)}
            </TableCell>
            <TableCell colSpan={2} className="text-right">
              <IncidentStateBadge incident={incident} />
            </TableCell>
            <TableCell>
              <IncidentActions incident={incident} onExclude={onExclude} />
            </TableCell>
          </TableRow>
        ))}
    </>
  );
}

function PersonMobileCard({
  person,
  rank,
  rankByTime,
  now,
  expanded,
  onToggle,
  onExclude,
}: {
  person: Person;
  rank: number;
  rankByTime: boolean;
  now: Date;
  expanded: boolean;
  onToggle: () => void;
  onExclude: (incident: Incident) => void;
}) {
  const ChevronIcon = expanded ? ChevronUp : ChevronDown;

  return (
    <ReportMobileCard
      className="cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
      onClick={onToggle}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${person.name}`}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground tabular-nums">{rank}</span>
            <span className="truncate font-semibold">{person.name}</span>
          </div>
          <PersonSubline person={person} now={now} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={rankByTime ? "secondary" : "red"}>{person.lateEventCount}</Badge>
          <ChevronIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className={cn("tabular-nums", rankByTime && "font-semibold text-[var(--red-text)]")}>
          {formatHours(person.totalLateHours)} total
        </span>
        <span className="text-muted-foreground tabular-nums">
          worst {formatHours(person.worstLateHours)}
        </span>
        {person.activeOverdueCount > 0 && (
          <span className="font-semibold text-[var(--red-text)] tabular-nums">
            {person.activeOverdueCount} overdue now
          </span>
        )}
        <span className="text-muted-foreground">
          on time <OnTimeRate person={person} />
        </span>
      </div>
      {expanded && (
        <div className="divide-y border-t pt-1">
          {person.incidents.map((incident) => (
            <div key={incident.incidentId} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <ReportTableLink
                  href={`/checkouts/${incident.bookingId}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  {incident.title}
                </ReportTableLink>
                <ReportMetaLine
                  className="text-xs"
                  items={[incident.location.name, `Due ${formatDate(incident.dueAt)}`]}
                />
                <div className="mt-1">
                  <IncidentStateBadge incident={incident} />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="text-sm font-medium text-[var(--red-text)] tabular-nums">
                  {formatHours(incident.lateHours)}
                </span>
                <IncidentActions incident={incident} onExclude={onExclude} />
              </div>
            </div>
          ))}
        </div>
      )}
    </ReportMobileCard>
  );
}
