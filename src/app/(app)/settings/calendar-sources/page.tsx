"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { formatDateTime } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TruncatedText } from "@/components/ui/truncated-text";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, classifyError, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import StatusIndicator from "@/components/ui/status-indicator";
import { SettingsPageShell } from "../SettingsPageShell";
import { RefreshCw, Trash2, Power, PowerOff } from "lucide-react";
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

  return (
    <SettingsPageShell
      title="Calendar Sources"
      description="Manage ICS calendar feeds for event syncing. Events are automatically imported and used for shift scheduling."
    >
        <div className="flex gap-2">
          {!showAdd && (
            <Button className="h-10" onClick={() => setShowAdd(true)}>
              Add source
            </Button>
          )}
        </div>

        <Alert>
          <RefreshCw className="size-4" />
          <AlertDescription>
            Automatic sync runs daily in morning refresh. Use Sync now for schedule changes that cannot wait for the next run.
          </AlertDescription>
        </Alert>

        {showAdd && (
          <Card className="p-4 mb-4">
            <form onSubmit={handleAdd}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="calendar-source-name">Name</Label>
                  <Input
                    id="calendar-source-name"
                    name="calendarSourceName"
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. UW Badgers Football"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="calendar-source-url">ICS URL</Label>
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
                      className={`mt-1 rounded-md border p-2.5 text-xs ${testResult.ok ? "border-[var(--green)]/30 bg-[var(--green-bg)]" : "border-destructive/40 bg-destructive/5"}`}
                    >
                      {testResult.ok ? (
                        <>
                          <div className="font-medium text-foreground">
                            ✓ Reachable — {testResult.eventCount} event{testResult.eventCount === 1 ? "" : "s"} in feed ({Math.round(testResult.byteSize / 1024)} KB)
                          </div>
                          {testResult.sampleSummaries.length > 0 && (
                            <ul className="mt-1.5 list-disc pl-4 flex flex-col gap-0.5 text-muted-foreground">
                              {testResult.sampleSummaries.slice(0, 3).map((s, i) => (
                                <li key={i}>
                                  <TruncatedText text={s} />
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      ) : (
                        <div className="font-medium text-destructive">
                          ✗ {testResult.error ?? "Probe failed"}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button className="h-10" type="submit" disabled={addBusy}>
                    {addBusy ? "Adding..." : "Add"}
                  </Button>
                  <Button className="h-10" type="button" variant="outline" onClick={() => { setShowAdd(false); setNewName(""); setNewUrl(""); setTestResult(null); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            </form>
          </Card>
        )}

        {loading ? (
          <Card className="p-10">
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex items-center justify-between py-3">
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              ))}
            </div>
          </Card>
        ) : hasInitialLoadError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>Calendar sources could not load. Existing feeds may still be syncing, but this page cannot show them yet.</span>
              <Button className="h-10" type="button" variant="outline" onClick={reload}>
                Retry sources
              </Button>
            </AlertDescription>
          </Alert>
        ) : sources.length === 0 ? (
          <Card>
            <EmptyState
              inline
              icon="calendar"
              title="No calendar sources configured"
              description="Add an ICS feed to start syncing events for shift scheduling."
            />
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead className="hidden md:table-cell">Events</TableHead>
                  <TableHead className="hidden md:table-cell">Last synced</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell>
                      <div className="font-semibold">{source.name}</div>
                      <div className="text-xs text-muted-foreground break-all max-w-[300px]">
                        {source.url}
                      </div>
                    </TableCell>
                    <TableCell>{healthBadge(source)}</TableCell>
                    <TableCell className="hidden md:table-cell">{source._count?.events ?? 0}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {source.lastFetchedAt ? formatDateTime(source.lastFetchedAt) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <OperationalRowActions
                          label={`Actions for ${source.name}`}
                          icon={syncing === source.id || toggling === source.id ? <RefreshCw className="size-4 animate-spin" /> : undefined}
                        >
                          <DropdownMenuItem
                            onSelect={() => handleToggle(source)}
                            disabled={Boolean(syncing || toggling)}
                          >
                            {source.enabled ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                            {source.enabled ? "Disable source" : "Enable source"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => handleSync(source)}
                            disabled={Boolean(syncing || toggling) || !source.enabled}
                          >
                            <RefreshCw className="size-4" />
                            {syncing === source.id ? "Syncing" : "Sync now"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => handleDelete(source)}
                            variant="destructive"
                          >
                            <Trash2 className="size-4" />
                            Delete source
                          </DropdownMenuItem>
                        </OperationalRowActions>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {sources.some((s) => s.lastError) && (
              <div className="px-4 py-3 border-t text-sm">
                <strong>Errors:</strong>
                {sources.filter((s) => s.lastError).map((s) => (
                  <div key={s.id} className="text-destructive mt-1">
                    {s.name}: {s.lastError}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
    </SettingsPageShell>
  );
}
