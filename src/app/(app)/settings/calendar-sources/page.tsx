"use client";

import { useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { formatDateTime } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { TruncatedText } from "@/components/ui/truncated-text";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, classifyError, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import StatusIndicator from "@/components/ui/status-indicator";
import { SettingsGroup, SettingsRow } from "../_components/SettingsGroup";
import { SettingsPageShell } from "../SettingsPageShell";
import { Plus, RefreshCw, Trash2, Power, PowerOff } from "lucide-react";
import {
  calendarSourceHealthErrorFromSync,
  calendarSourceSyncToast,
  type CalendarSourceSyncResult,
} from "./calendar-source-sync-copy";
import {
  calendarSourceFreshnessLabel,
  getCalendarSourceFreshness,
} from "@/lib/calendar-source-freshness";

type CalendarSource = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastError: string | null;
  createdAt: string;
  _count?: { events: number };
};

export default function CalendarSourcesPage() {
  const confirm = useConfirm();
  const { data: fetchedSources, loading, error: sourcesError, reload } = useFetch<CalendarSource[]>({
    url: "/api/calendar-sources",
    returnTo: "/settings/calendar-sources",
    transform: (json) => (json.data as CalendarSource[]) ?? [],
  });
  // Local state for optimistic mutation updates
  const [localSources, setLocalSources] = useState<CalendarSource[] | null>(null);
  const sources = localSources ?? fetchedSources ?? [];
  const hasInitialLoadError = Boolean(sourcesError && !fetchedSources && !localSources);
  const [prevFetched, setPrevFetched] = useState(fetchedSources);
  if (fetchedSources !== prevFetched) {
    setPrevFetched(fetchedSources);
    setLocalSources(null);
  }
  const setSources = (updater: CalendarSource[] | ((prev: CalendarSource[]) => CalendarSource[])) => {
    setLocalSources(typeof updater === "function" ? updater(sources) : updater);
  };
  const [syncing, setSyncing] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const sourceActionRef = useRef<string | null>(null);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const addBusyRef = useRef(false);

  // Test URL probe
  type TestResult = {
    ok: boolean;
    status: number;
    contentType: string | null;
    byteSize: number;
    eventCount: number;
    sampleSummaries: string[];
    error?: string;
  };
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const testingRef = useRef(false);

  async function handleTest() {
    if (testingRef.current) return;
    if (!newUrl.trim()) {
      toast.error("Paste an ICS URL first");
      return;
    }
    testingRef.current = true;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/calendar-sources/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newUrl.trim() }),
      });
      if (handleAuthRedirect(res, "/settings/calendar-sources")) return;
      if (res.ok) {
        const json = await parseJsonSafely<{ data?: TestResult }>(res);
        if (!json?.data) {
          toast.error("Test completed, but the response could not be read.");
          return;
        }
        setTestResult(json.data);
      } else {
        const msg = await parseErrorMessage(res, "Test failed");
        toast.error(msg);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You’re offline. Check your connection." : "Test failed");
    } finally {
      testingRef.current = false;
      setTesting(false);
    }
  }

  async function handleToggle(source: CalendarSource) {
    if (sourceActionRef.current) return;
    sourceActionRef.current = source.id;
    setToggling(source.id);
    try {
      const res = await fetch(`/api/calendar-sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !source.enabled }),
      });
      if (handleAuthRedirect(res, "/settings/calendar-sources")) return;
      if (res.ok) {
        setSources((prev) =>
          prev.map((s) => s.id === source.id ? { ...s, enabled: !s.enabled } : s)
        );
        toast.success(`${source.name} ${source.enabled ? "disabled" : "enabled"}`);
      } else {
        const msg = await parseErrorMessage(res, "Toggle failed");
        toast.error(msg);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You\u2019re offline. Check your connection." : "Toggle failed");
    } finally {
      sourceActionRef.current = null;
      setToggling(null);
    }
  }

  async function handleSync(source: CalendarSource) {
    if (sourceActionRef.current) return;
    sourceActionRef.current = source.id;
    setSyncing(source.id);
    try {
      const res = await fetch(`/api/calendar-sources/${source.id}/sync`, { method: "POST" });
      if (handleAuthRedirect(res, "/settings/calendar-sources")) return;
      if (res.ok) {
        const json = await parseJsonSafely<{ data?: CalendarSourceSyncResult }>(res);
        if (!json?.data) {
          toast.error(`${source.name} sync completed, but the response could not be read.`);
          return;
        }
        const toastCopy = calendarSourceSyncToast(source.name, json.data);
        const lastError = calendarSourceHealthErrorFromSync(json.data);
        const syncedAt = new Date().toISOString();
        setSources((prev) =>
          prev.map((s) =>
            s.id === source.id
              ? { ...s, lastFetchedAt: syncedAt, lastError }
              : s
          )
        );
        if (toastCopy.variant === "error") {
          toast.error(toastCopy.message);
        } else if (toastCopy.variant === "warning") {
          toast.warning(toastCopy.message);
        } else {
          toast.success(toastCopy.message);
        }
        reload();
      } else {
        const msg = await parseErrorMessage(res, "Sync failed");
        toast.error(msg);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You\u2019re offline. Check your connection." : "Sync failed");
    } finally {
      sourceActionRef.current = null;
      setSyncing(null);
    }
  }

  async function handleDelete(source: CalendarSource) {
    if (sourceActionRef.current) return;
    const ok = await confirm({
      title: "Delete calendar source",
      message: `Delete "${source.name}" and its ${source._count?.events ?? 0} synced event${source._count?.events === 1 ? "" : "s"}? Shift coverage that depends on those events will no longer have this feed as a source.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    sourceActionRef.current = source.id;
    try {
      const res = await fetch(`/api/calendar-sources/${source.id}`, { method: "DELETE" });
      if (handleAuthRedirect(res, "/settings/calendar-sources")) return;
      if (res.ok) {
        setSources((prev) => prev.filter((s) => s.id !== source.id));
        toast.success(`Deleted ${source.name}`);
      } else {
        toast.error("Delete failed");
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You\u2019re offline. Check your connection." : "Delete failed");
    } finally {
      sourceActionRef.current = null;
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (addBusyRef.current) return;
    if (!newName.trim() || !newUrl.trim()) return;
    addBusyRef.current = true;
    setAddBusy(true);
    try {
      const res = await fetch("/api/calendar-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), url: newUrl.trim() }),
      });
      if (handleAuthRedirect(res, "/settings/calendar-sources")) return;
      if (res.ok) {
        setNewName("");
        setNewUrl("");
        setShowAdd(false);
        toast.success("Calendar source added");
        reload();
      } else {
        const msg = await parseErrorMessage(res, "Add failed");
        toast.error(msg);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You\u2019re offline. Check your connection." : "Add failed");
    } finally {
      addBusyRef.current = false;
      setAddBusy(false);
    }
  }

  function healthBadge(source: CalendarSource) {
    const freshness = getCalendarSourceFreshness(source);
    const label = calendarSourceFreshnessLabel(freshness);
    if (freshness === "disabled") return <StatusIndicator state="idle" label={label} size="sm" />;
    if (freshness === "error") return <span title={source.lastError ?? undefined}><StatusIndicator state="down" label={label} size="sm" /></span>;
    if (freshness === "never-synced") return <StatusIndicator state="idle" label={label} size="sm" />;
    if (freshness === "stale") return <StatusIndicator state="fixing" label={label} size="sm" />;
    return <StatusIndicator state="active" label={label} size="sm" />;
  }

  function cancelAdd() {
    setShowAdd(false);
    setNewName("");
    setNewUrl("");
    setTestResult(null);
  }

  return (
    <SettingsPageShell
      href="/settings/calendar-sources"
      description="Calendar feeds that bring games and events into Schedule. They sync every morning; use Sync now when a change can't wait."
      mainClassName="flex flex-col gap-7"
      actions={
        !showAdd ? (
          <Button className="h-10" onClick={() => setShowAdd(true)}>
            <Plus className="size-4 mr-1.5" />
            Add calendar
          </Button>
        ) : undefined
      }
    >
      {showAdd && (
        <form onSubmit={handleAdd}>
          <SettingsGroup title="New calendar">
            <SettingsRow label="Name" htmlFor="calendar-source-name" description="Shown on events that come from this feed.">
              <Input
                id="calendar-source-name"
                name="calendarSourceName"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. UW Badgers Football"
                required
              />
            </SettingsRow>
            <SettingsRow
              stacked
              label="Calendar link"
              htmlFor="calendar-source-url"
              description="The .ics address. Test it to see a few events before adding."
            >
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input
                    id="calendar-source-url"
                    name="calendarSourceUrl"
                    type="url"
                    value={newUrl}
                    onChange={(e) => { setNewUrl(e.target.value); setTestResult(null); }}
                    placeholder="https://example.com/calendar.ics"
                    required
                    className="flex-1"
                  />
                  <Button className="h-10" type="button" variant="outline" onClick={handleTest} disabled={testing || !newUrl.trim()}>
                    {testing ? "Testing…" : "Test"}
                  </Button>
                </div>
                {testResult && (
                  <div
                    role="status"
                    className={`rounded-lg border px-3 py-2.5 text-[13px] ${testResult.ok ? "border-[var(--green)]/30 bg-[var(--green-bg)]" : "border-destructive/40 bg-destructive/5"}`}
                  >
                    {testResult.ok ? (
                      <>
                        <div className="font-bold text-foreground">
                          Found {testResult.eventCount} event{testResult.eventCount === 1 ? "" : "s"} ({Math.round(testResult.byteSize / 1024)} KB)
                        </div>
                        {testResult.sampleSummaries.length > 0 && (
                          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-muted-foreground">
                            {testResult.sampleSummaries.slice(0, 3).map((s, i) => (
                              <li key={i}>
                                <TruncatedText text={s} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    ) : (
                      <div className="font-bold text-destructive">
                        {testResult.error ?? "Couldn't read that calendar"}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </SettingsRow>
            <div className="flex justify-end gap-2 bg-muted/40 px-4 py-3">
              <Button type="button" variant="ghost" onClick={cancelAdd} disabled={addBusy}>
                Cancel
              </Button>
              <Button type="submit" disabled={addBusy || !newName.trim() || !newUrl.trim()}>
                {addBusy ? "Adding..." : "Add calendar"}
              </Button>
            </div>
          </SettingsGroup>
        </form>
      )}

      {loading ? (
        <SettingsGroup>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3.5">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </SettingsGroup>
      ) : hasInitialLoadError ? (
        <SettingsGroup>
          <div className="flex flex-col gap-3 px-4 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-destructive">Calendar sources could not load. Existing feeds may still be syncing, but this page cannot show them yet.</span>
            <Button className="h-10" type="button" variant="outline" onClick={reload}>
              Retry sources
            </Button>
          </div>
        </SettingsGroup>
      ) : sources.length === 0 ? (
        <SettingsGroup>
          <EmptyState
            inline
            icon="calendar"
            title="No calendar sources configured"
            description="Add a calendar feed to start bringing events into Schedule."
          />
        </SettingsGroup>
      ) : (
        <SettingsGroup>
          {sources.map((source) => {
            const events = source._count?.events ?? 0;
            return (
              <div key={source.id} className={`flex items-start gap-3 px-4 py-3.5 ${source.enabled ? "" : "bg-muted/20"}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="text-sm font-bold text-foreground">{source.name}</span>
                    {healthBadge(source)}
                  </div>
                  <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">
                    {events} event{events === 1 ? "" : "s"}
                    {" · "}
                    {source.lastFetchedAt ? `Synced ${formatDateTime(source.lastFetchedAt)}` : "Not synced yet"}
                  </p>
                  <p className="m-0 mt-0.5 truncate text-xs text-muted-foreground/80" title={source.url}>
                    {source.url}
                  </p>
                  {source.lastError ? (
                    <p className="m-0 mt-1.5 text-[13px] text-destructive">{source.lastError}</p>
                  ) : null}
                </div>
                <OperationalRowActions
                  label={`Actions for ${source.name}`}
                  icon={syncing === source.id || toggling === source.id ? <RefreshCw className="size-4 animate-spin" /> : undefined}
                >
                  <DropdownMenuItem
                    onSelect={() => handleSync(source)}
                    disabled={Boolean(syncing || toggling) || !source.enabled}
                  >
                    <RefreshCw className="size-4" />
                    {syncing === source.id ? "Syncing" : "Sync now"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => handleToggle(source)}
                    disabled={Boolean(syncing || toggling)}
                  >
                    {source.enabled ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                    {source.enabled ? "Disable source" : "Enable source"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => handleDelete(source)}
                    variant="destructive"
                  >
                    <Trash2 className="size-4" />
                    Delete source
                  </DropdownMenuItem>
                </OperationalRowActions>
              </div>
            );
          })}
        </SettingsGroup>
      )}
    </SettingsPageShell>
  );
}
