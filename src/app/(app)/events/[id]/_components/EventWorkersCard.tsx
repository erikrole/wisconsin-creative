"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { toast } from "@/lib/toast";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CREW_ROW_GROUP } from "@/components/shift-detail/crew-row";

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
const NO_USERS: PickerUser[] = [];
const NO_WORKERS: EventWorker[] = [];

function roleLabel(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/**
 * People recorded on this event without a scheduled slot. Lives inside Crew:
 * future events use Assign; ended events use this silent Scoreboard record.
 */
export function EventWorkersCard({
  eventId,
  isAdmin,
  eventHasEnded,
}: {
  eventId: string;
  isAdmin: boolean;
  eventHasEnded: boolean;
}) {
  const queryClient = useQueryClient();
  const workersKey = ["calendar-event-workers", eventId] as const;
  const workersQuery = useQuery({
    queryKey: workersKey,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/calendar-events/${eventId}/workers`, { signal });
      if (handleAuthRedirect(response)) throw new DOMException("Auth redirect", "AbortError");
      if (!response.ok) {
        const message = await parseErrorMessage(response, "Failed to load workers");
        toast.error(message);
        throw new Error(message);
      }
      const json = await parseJsonSafely<{ data?: EventWorker[] }>(response);
      return json?.data ?? [];
    },
    // One toast per failed read; Retry is offered inline.
    retry: false,
  });
  const workers = workersQuery.data ?? NO_WORKERS;
  const loading = workersQuery.isFetching && !workersQuery.data;
  /**
   * A failed read must not render as an empty list. "No one has been added" is
   * a claim about the event; silently making it when the request failed would
   * hide a broken deploy behind a reassuring empty state.
   */
  const loadFailed = !loading && workersQuery.isError && !workersQuery.data;
  const setWorkers = (next: EventWorker[]) => queryClient.setQueryData(workersKey, next);
  const usersQuery = useQuery({
    queryKey: ["users", "active-picker"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/users?limit=200&active=true", { signal });
      if (handleAuthRedirect(response) || !response.ok) throw new Error("Could not load people");
      const json = await parseJsonSafely<{ data?: PickerUser[]; users?: PickerUser[] }>(response);
      const list = json?.data ?? json?.users;
      return Array.isArray(list) ? list : [];
    },
    enabled: isAdmin && eventHasEnded,
    retry: false,
  });
  const users = usersQuery.data ?? NO_USERS;
  const [selectedUserId, setSelectedUserId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const savingRef = useRef(false);

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
      toast.success("Recorded on Scoreboard.");
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

  const showAddForm = isAdmin && eventHasEnded;
  if (!eventHasEnded && (loading || (!loadFailed && workers.length === 0))) return null;

  return (
    <div className="mt-4 border-t border-border/60 pt-4">
      <div className="mb-2 flex flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/70">
            Recorded work
          </span>
          {!loading && !loadFailed && (
            <span className="text-[11px] tabular-nums text-muted-foreground">{workers.length}</span>
          )}
        </div>
        {eventHasEnded ? (
          <p className="text-xs text-muted-foreground">
            People who worked this event without a scheduled slot. Silent Scoreboard record only.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Recorded for Scoreboard. Use Assign above to staff the live crew.
          </p>
        )}
      </div>

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
            onClick={() => void workersQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : workers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {eventHasEnded
            ? "No one else is on record for this event."
            : "No one has been added outside the scheduled crew."}
        </p>
      ) : (
        <ul className="flex flex-col">
          {workers.map((worker) => (
            <li
              key={worker.id}
              className={cn(CREW_ROW_GROUP, "flex flex-wrap items-center gap-3 border-b border-border/40 py-2.5 last:border-b-0")}
            >
              <UserAvatar name={worker.user.name} avatarUrl={worker.user.avatarUrl} size="sm" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm">{worker.user.name}</span>
                  <span className="text-xs text-muted-foreground">{roleLabel(worker.user.role)}</span>
                  {worker.alsoAssigned && (
                    <Badge variant="gray" size="sm">Also assigned</Badge>
                  )}
                  {!worker.user.active && <Badge variant="gray" size="sm">Inactive</Badge>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {worker.note ? `${worker.note} · ` : ""}
                  Recorded{worker.addedBy ? ` by ${worker.addedBy.name}` : ""}{" "}
                  {formatRelativeTime(worker.createdAt, new Date())}
                </span>
              </div>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10"
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

      {showAddForm && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
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
            {saving ? "Recording…" : "Record who worked"}
          </Button>
        </div>
      )}
    </div>
  );
}
