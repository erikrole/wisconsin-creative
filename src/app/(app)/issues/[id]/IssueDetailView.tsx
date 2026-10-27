"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, EyeOffIcon, RotateCcwIcon } from "lucide-react";
import { BreadcrumbLabel } from "@/components/BreadcrumbContext";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { chromeFont } from "@/lib/chrome-font";
import { copyTextToClipboard } from "@/lib/clipboard";
import { formatDateTime, formatRelativeTime, pluralize } from "@/lib/format";
import type { Breadcrumb } from "@/lib/error-reporting/grouping";
import { parseErrorMessage, readApiData } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { ActionTimeline, CHANNEL_LABELS, KIND_LABELS, PLATFORM_META, PlatformBadge, StatusPill } from "../issue-ui";

type Frame = { binaryName: string | null; binaryUUID: string | null; offset: number | null; address: number | null };
type EventRow = {
  id: string;
  occurredAt: string;
  platform: string;
  appVersion: string | null;
  appBuild: string | null;
  releaseChannel: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  role: string | null;
  screen: string | null;
  requestId: string | null;
  digest: string | null;
  message: string;
  stack: string | null;
  breadcrumbs: Breadcrumb[];
  context: Record<string, unknown> | null;
  user: { id: string; name: string; email: string } | null;
};
type Detail = {
  issue: {
    id: string;
    platform: string;
    kind: string;
    title: string;
    culprit: string | null;
    status: string;
    note: string | null;
    eventCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    firstVersion: string | null;
    lastVersion: string | null;
    resolvedAt: string | null;
    resolvedByName: string | null;
    regressedAt: string | null;
  };
  versions: Array<{ version: string; channel: string | null; count: number }>;
  people: Array<{ id: string; name: string; count: number }>;
  events: EventRow[];
};

function Stat({ label, value, helper }: { label: string; value: string; helper?: string | null }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card px-4 py-3.5">
      <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-[22px] font-black leading-tight tracking-[-0.02em] tabular-nums">{value}</div>
      {helper ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{helper}</div> : null}
    </div>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border bg-card", className)}>
      <h2 className="m-0 border-b px-4 py-3 text-[13px] font-black sm:px-5">{title}</h2>
      <div className="px-4 py-3.5 sm:px-5">{children}</div>
    </section>
  );
}

function CopyValue({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => void copyTextToClipboard(value).then((copied) => (copied ? toast.success(`${label} copied.`) : toast.error("Copy failed.")))}
      className="group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded font-mono text-[12px] outline-none hover:text-[#3E63DD] focus-visible:ring-2 focus-visible:ring-ring"
      title={`Copy ${label.toLowerCase()}`}
    >
      <span className="truncate">{value}</span>
      <CopyIcon className="size-3 shrink-0 opacity-50 group-hover:opacity-100" aria-hidden="true" />
    </button>
  );
}

/** `atos` commands for the app's own frames; the load address is the frame address minus its offset. */
function symbolicationCommands(frames: Frame[], build: string | null): string[] {
  const byBinary = new Map<string, { load: number; addresses: number[] }>();
  for (const frame of frames) {
    if (!frame.binaryName || !/^(Wisconsin|GearOps)/.test(frame.binaryName) || frame.address === null || frame.offset === null) continue;
    const entry = byBinary.get(frame.binaryName) ?? { load: frame.address - frame.offset, addresses: [] };
    entry.addresses.push(frame.address);
    byBinary.set(frame.binaryName, entry);
  }
  return [...byBinary.entries()].map(([binary, entry]) => {
    const dsym = `${binary}.app.dSYM/Contents/Resources/DWARF/${binary}`;
    const hex = (value: number) => `0x${value.toString(16)}`;
    return `${build ? `# build ${build}\n` : ""}xcrun atos -arch arm64e -o ${dsym} -l ${hex(entry.load)} ${entry.addresses.map(hex).join(" ")}`;
  });
}

export function IssueDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const detail = useQuery<Detail>({
    queryKey: ["issues", "detail", id],
    queryFn: async ({ signal }) => readApiData(await fetch(`/api/issues/${id}`, { signal }), "Couldn't load this issue", `/issues/${id}`),
  });
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const now = useMemo(() => new Date(), [detail.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seed the note once, from the first loaded issue.
  if (detail.data && note === null) setNote(detail.data.issue.note ?? "");

  async function update(body: { status?: string; note?: string | null }, success: string) {
    setSaving(body.status ?? "note");
    try {
      const response = await fetch(`/api/issues/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "That change wasn't saved."));
        return;
      }
      toast.success(success);
      await queryClient.invalidateQueries({ queryKey: ["issues"] });
      await queryClient.invalidateQueries({ queryKey: ["sidebar-counts"] });
    } finally {
      setSaving(null);
    }
  }

  if (detail.isLoading) return <Skeleton className="h-[480px] w-full rounded-2xl" />;
  if (detail.isError || !detail.data) {
    return (
      <EmptyState
        icon="wifi-off"
        title="Couldn't load this issue"
        description={detail.error?.message ?? "It may have been pruned after 90 days without a new occurrence."}
        actionLabel="Back to issues"
        actionHref="/issues"
      />
    );
  }

  const { issue, versions, people, events } = detail.data;
  const event = events[Math.min(index, Math.max(0, events.length - 1))];
  const kind = KIND_LABELS[issue.kind] ?? issue.kind;
  const platform = PLATFORM_META[issue.platform]?.label ?? issue.platform;
  const maxVersion = Math.max(1, ...versions.map((row) => row.count));

  return (
    <div className="flex flex-col gap-5">
      <BreadcrumbLabel label={issue.title} />
      <header data-page-header className={cn(chromeFont.variable, "flex flex-col gap-4 sm:flex-row sm:items-start")}>
        <PlatformBadge platform={issue.platform} className="size-10 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
            <span>{platform}</span>
            <span aria-hidden="true">·</span>
            <span>{kind}</span>
            <StatusPill status={issue.regressedAt && issue.status === "open" ? "regressed" : issue.status} />
          </div>
          <h1 className="m-0 break-words">{issue.title}</h1>
          {issue.culprit ? <p className="m-0 mt-1.5 break-all font-mono text-[12.5px] text-muted-foreground">{issue.culprit}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {issue.status === "open" ? (
            <>
              <Button type="button" variant="outline" disabled={saving !== null} onClick={() => void update({ status: "ignored" }, "Issue ignored.")}>
                <EyeOffIcon data-icon="inline-start" />
                Ignore
              </Button>
              <Button type="button" disabled={saving !== null} onClick={() => void update({ status: "resolved" }, "Marked fixed. It reopens if it happens again.")}>
                <CheckIcon data-icon="inline-start" />
                Mark fixed
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" disabled={saving !== null} onClick={() => void update({ status: "open" }, "Issue reopened.")}>
              <RotateCcwIcon data-icon="inline-start" />
              Reopen
            </Button>
          )}
        </div>
      </header>

      {issue.regressedAt && issue.status === "open" ? (
        <p className="m-0 rounded-xl bg-[#FFEBEC] px-4 py-3 text-[13.5px] text-[#C62A2F] dark:bg-red-500/15 dark:text-red-300">
          This came back {formatRelativeTime(issue.regressedAt, now)} after it was marked fixed.
        </p>
      ) : issue.status === "resolved" && issue.resolvedAt ? (
        <p className="m-0 rounded-xl bg-muted px-4 py-3 text-[13.5px] text-muted-foreground">
          Marked fixed {formatRelativeTime(issue.resolvedAt, now)}{issue.resolvedByName ? ` by ${issue.resolvedByName}` : ""}. A new occurrence reopens it.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Times" value={issue.eventCount.toLocaleString()} helper={events.length < issue.eventCount ? `${events.length} kept with details` : null} />
        <Stat label="People" value={String(people.length)} helper={people[0] ? `Most: ${people[0].name}` : "None signed in"} />
        <Stat label="First seen" value={formatRelativeTime(issue.firstSeenAt, now)} helper={issue.firstVersion} />
        <Stat label="Last seen" value={formatRelativeTime(issue.lastSeenAt, now)} helper={issue.lastVersion} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-5">
          {event ? (
            <EventPanel event={event} index={index} total={events.length} onIndex={setIndex} now={now} />
          ) : (
            <Section title="Occurrences">
              <p className="m-0 text-sm text-muted-foreground">Details for older occurrences were pruned. New ones will appear here.</p>
            </Section>
          )}
        </div>
        <aside className="flex min-w-0 flex-col gap-5">
          <Section title="Versions">
            {versions.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">No version information.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {versions.map((row) => (
                  <li key={`${row.version}-${row.channel}`} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="min-w-0 truncate font-bold">{row.version}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {row.channel && CHANNEL_LABELS[row.channel] ? `${CHANNEL_LABELS[row.channel]} · ` : ""}
                        {row.count}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-[#3E63DD]/70" style={{ width: `${(row.count / maxVersion) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="People">
            {people.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">No signed-in person is attached to these reports.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
                {people.map((person) => (
                  <li key={person.id} className="flex items-center justify-between gap-2">
                    <Link href={`/staff/${person.id}`} className="min-w-0 truncate text-foreground no-underline hover:underline">
                      {person.name}
                    </Link>
                    <span className="tabular-nums text-muted-foreground">{person.count}×</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Notes">
            <Textarea
              aria-label="Notes"
              rows={4}
              value={note ?? ""}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What you found, or the PR that fixes it"
            />
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
               
                variant="outline"
                disabled={saving !== null || (note ?? "") === (issue.note ?? "")}
                onClick={() => void update({ note: note ?? "" }, "Note saved.")}
              >
                Save note
              </Button>
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}

function EventPanel({ event, index, total, onIndex, now }: { event: EventRow; index: number; total: number; onIndex: (i: number) => void; now: Date }) {
  const [showStack, setShowStack] = useState(false);
  const context = event.context ?? {};
  const frames = Array.isArray(context.frames) ? (context.frames as Frame[]) : [];
  const build = event.appVersion && event.appBuild ? `${event.appVersion} (${event.appBuild})` : event.appVersion ?? event.appBuild;
  const commands = symbolicationCommands(frames, build);
  const version = event.platform === "web" || event.platform === "server"
    ? event.appBuild ? `Deploy ${event.appBuild}` : "Local build"
    : build ?? "Unknown";
  const channel = event.releaseChannel ? CHANNEL_LABELS[event.releaseChannel] ?? event.releaseChannel : null;
  const device = [event.deviceModel, event.osVersion].filter(Boolean).join(" · ");
  // Kiosk crashes have no person; the kiosk and its location stand in.
  const kiosk = typeof context.kiosk === "string"
    ? [context.kiosk, typeof context.location === "string" ? context.location : null].filter(Boolean).join(" · ") + " (kiosk)"
    : null;
  // Native crashes report a code location as "Where"; the screen comes from the run's recent actions.
  const lastScreen = typeof context.lastScreen === "string" ? context.lastScreen : null;

  const rows: Array<[string, React.ReactNode]> = [
    ["When", `${formatDateTime(event.occurredAt)} (${formatRelativeTime(event.occurredAt, now)})`],
    [
      "Person",
      event.user ? (
        <Link href={`/staff/${event.user.id}`} className="text-foreground no-underline hover:underline">
          {event.user.name}
          {event.role ? <span className="text-muted-foreground"> · {event.role.toLowerCase()}</span> : null}
        </Link>
      ) : kiosk ? (
        <span>{kiosk}</span>
      ) : (
        <span className="text-muted-foreground">Not signed in or unknown</span>
      ),
    ],
    [event.platform === "web" || event.platform === "server" ? "Page" : "Where", event.screen ? <span className="break-all font-mono text-[12px]">{event.screen}</span> : "Unknown"],
    ...(lastScreen ? ([["Last screen", lastScreen]] as Array<[string, React.ReactNode]>) : []),
    ["Version", [version, channel].filter(Boolean).join(" · ")],
    ...(device ? ([["Device", device]] as Array<[string, React.ReactNode]>) : []),
    ...(event.requestId ? ([["Request", <CopyValue key="r" value={event.requestId} label="Request ID" />]] as Array<[string, React.ReactNode]>) : []),
    ...(event.digest ? ([["Error ID", <CopyValue key="d" value={event.digest} label="Error ID" />]] as Array<[string, React.ReactNode]>) : []),
  ];

  return (
    <>
      <section className="rounded-2xl border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-2.5 sm:px-5">
          <h2 className="m-0 flex-1 text-[13px] font-black">
            {total > 1 ? `Occurrence ${index + 1} of ${total}` : "Latest occurrence"}
          </h2>
          {total > 1 ? (
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="icon" aria-label="Newer occurrence" disabled={index === 0} onClick={() => onIndex(index - 1)}>
                <ChevronLeftIcon />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Older occurrence" disabled={index >= total - 1} onClick={() => onIndex(index + 1)}>
                <ChevronRightIcon />
              </Button>
            </div>
          ) : null}
        </div>
        <div className="px-4 py-3.5 sm:px-5">
          <p className="m-0 mb-3 break-words font-mono text-[12.5px] leading-relaxed">{event.message}</p>
          <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="m-0 min-w-0">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <Section title={event.breadcrumbs.length > 0 ? `What happened before (${event.breadcrumbs.length})` : "What happened before"}>
        <ActionTimeline crumbs={event.breadcrumbs} endAt={event.occurredAt} />
      </Section>

      {event.stack ? (
        <section className="rounded-2xl border bg-card">
          <button
            type="button"
            onClick={() => setShowStack((v) => !v)}
            aria-expanded={showStack}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-black outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl sm:px-5"
          >
            <span className="flex-1">{frames.length ? "Stack (unsymbolicated)" : "Stack trace"}</span>
            <ChevronRightIcon className={cn("size-4 text-muted-foreground transition-transform", showStack && "rotate-90")} aria-hidden="true" />
          </button>
          {showStack ? (
            <div className="flex flex-col gap-3 border-t px-4 py-3.5 sm:px-5">
              <pre className="m-0 max-h-80 overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-[11.5px] leading-relaxed">{event.stack}</pre>
              {commands.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p className="m-0 text-[12.5px] text-muted-foreground">
                    To see function names, run this on the Mac with the dSYM for {build ?? "this build"} (Xcode Organizer, Archives, Show in Finder, then the dSYMs folder):
                  </p>
                  {commands.map((command) => (
                    <div key={command} className="flex items-start gap-2">
                      <pre className="m-0 min-w-0 flex-1 overflow-x-auto rounded-lg bg-muted/60 p-3 font-mono text-[11.5px]">{command}</pre>
                      <Button type="button" variant="ghost" size="icon" aria-label="Copy command" onClick={() => void copyTextToClipboard(command).then((copied) => (copied ? toast.success("Command copied.") : toast.error("Copy failed.")))}>
                        <CopyIcon />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      {total > 1 ? (
        <p className="m-0 text-[12px] text-muted-foreground">{pluralize(total, "occurrence")} kept with full details. Older ones keep only the count.</p>
      ) : null}
    </>
  );
}
