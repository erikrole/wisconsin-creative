"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AwardIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { formatRelativeTime } from "@/lib/format";

type WorkerUser = {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  active: boolean;
};

type EventWorker = {
  id: string;
  note: string | null;
  createdAt: string;
  user: WorkerUser;
  addedBy: { id: string; name: string } | null;
  alsoAssigned: boolean;
};

type PickerUser = { id: string; name: string; role: string; avatarUrl?: string | null };

const NOTE_MAX = 200;

function roleLabel(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/**
 * People who worked an event without a scheduled shift — a late addition, a
 * fill-in, or a collaborator who is tracked but never staffed. Admin-only,
 * silent, and separate from the crew table on purpose: adding someone here
 * moves season stats and touches nothing else.
 */
export function EventWorkersCard({ eventId, isAdmin }: { eventId: string; isAdmin: boolean }) {
  const [workers, setWorkers] = useState<EventWorker[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * A failed read must not render as an empty list. "No one has been added" is
   * a claim about the event; silently making it when the request failed would
   * hide a broken deploy behind a reassuring empty state.
   */
  const [loadFailed, setLoadFailed] = useState(false);
  const [users, setUsers] = useState<PickerUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const savingRef = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/calendar-events/${eventId}/workers`, { signal });
      if (signal?.aborted) return;
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        setLoadFailed(true);
        toast.error(await parseErrorMessage(response, "Failed to load workers"));
        return;
      }
      const json = await parseJsonSafely<{ data?: EventWorker[] }>(response);
      setWorkers(json?.data ?? []);
      setLoadFailed(false);
    } catch (error) {
      if (isAbortError(error)) return;
      setLoadFailed(true);
      toast.error("Failed to load workers");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/users?limit=200&active=true", { signal: controller.signal });
        if (controller.signal.aborted || handleAuthRedirect(response) || !response.ok) return;
        const json = await parseJsonSafely<{ data?: PickerUser[]; users?: PickerUser[] }>(response);
        const list = json?.data ?? json?.users;
        if (Array.isArray(list)) setUsers(list);
      } catch (error) {
        if (isAbortError(error)) return;
      }
    })();
    return () => controller.abort();
  }, [isAdmin]);

  const addedIds = useMemo(() => new Set(workers.map((worker) => worker.user.id)), [workers]);

  const options = useMemo<ComboboxOption[]>(() => users
    .filter((user) => !addedIds.has(user.id))
    .map((user) => ({
      value: user.id,
      label: user.name,
      keywords: [user.name, roleLabel(user.role)],
    })), [users, addedIds]);

  async function addWorker() {
    if (!selectedUserId || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const response = await fetch(`/api/calendar-events/${eventId}/workers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId, note: note.trim() || undefined }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Failed to add worker"));
        return;
      }
      const json = await parseJsonSafely<{ data?: EventWorker[] }>(response);
      setWorkers(json?.data ?? []);
      setSelectedUserId("");
      setNote("");
      toast.success("Worker added.");
    } catch (error) {
      if (isAbortError(error)) return;
      toast.error("Network error - worker not added");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function removeWorker(worker: EventWorker) {
    if (removing) return;
    setRemoving(worker.id);
    try {
      const response = await fetch(`/api/calendar-events/${eventId}/workers/${worker.id}`, {
        method: "DELETE",
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Failed to remove worker"));
        return;
      }
      const json = await parseJsonSafely<{ data?: EventWorker[] }>(response);
      setWorkers(json?.data ?? []);
      toast.success(`Removed ${worker.user.name}`);
    } catch (error) {
      if (isAbortError(error)) return;
      toast.error("Network error - worker not removed");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="flex items-center gap-2">
            <AwardIcon className="size-4 shrink-0 text-muted-foreground" />
            Added workers
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            People who worked this event but were not on the crew. Counts toward Scoreboard, profile
            stats, and badges only — it never appears on their schedule.
          </p>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading workers…</p>
        ) : loadFailed ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-[var(--red-text)]">
              Could not load who has been added to this event.
            </p>
            <Button
              variant="outline"
              className="h-10 text-xs"
              onClick={() => {
                setLoading(true);
                void load();
              }}
            >
              Retry
            </Button>
          </div>
        ) : workers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No one has been added outside the scheduled crew.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {workers.map((worker) => (
              <li key={worker.id} className="flex flex-wrap items-center gap-3 py-2 first:pt-0">
                <UserAvatar name={worker.user.name} avatarUrl={worker.user.avatarUrl} size="sm" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm">{worker.user.name}</span>
                    <Badge variant="outline" size="sm">{roleLabel(worker.user.role)}</Badge>
                    {worker.alsoAssigned && (
                      <Badge variant="gray" size="sm">Also on crew</Badge>
                    )}
                    {!worker.user.active && <Badge variant="gray" size="sm">Inactive</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {worker.note ? `${worker.note} · ` : ""}
                    Added{worker.addedBy ? ` by ${worker.addedBy.name}` : ""}{" "}
                    {formatRelativeTime(worker.createdAt, new Date())}
                  </span>
                </div>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${worker.user.name}`}
                    disabled={removing === worker.id}
                    onClick={() => void removeWorker(worker)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
              <Label htmlFor="event-worker-person">Person</Label>
              <Combobox
                id="event-worker-person"
                options={options}
                value={selectedUserId}
                onValueChange={setSelectedUserId}
                placeholder="Select a person"
                searchPlaceholder="Search people…"
                emptyMessage="No one left to add."
              />
            </div>
            <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
              <Label htmlFor="event-worker-note">Note (optional)</Label>
              <Input
                id="event-worker-note"
                value={note}
                maxLength={NOTE_MAX}
                placeholder="Why they are on this list"
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <Button
              className="min-h-10"
              disabled={!selectedUserId || saving}
              onClick={() => void addWorker()}
            >
              {saving ? "Adding…" : "Add worker"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
