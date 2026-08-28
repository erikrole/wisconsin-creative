"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Plane, Trash2, AlertCircle } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/UserAvatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import EmptyState from "@/components/EmptyState";

/* ── Types ──────────────────────────────────────────────── */

type TravelUser = {
  id: string;
  name: string;
  role: string;
  primaryArea: string | null;
  avatarUrl: string | null;
};

type TravelMember = {
  id: string;
  eventId: string;
  userId: string;
  notes: string | null;
  createdAt: string;
  user: TravelUser;
};

type RosterEntry = {
  id: string; // assignment id
  userId: string;
  sportCode: string;
  defaultTraveler: boolean;
  user: { id: string; name: string; role: string; primaryArea: string | null };
};

const USER_ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  STAFF: "Staff",
  STUDENT: "Student",
};

function userRoleLabel(role: string) {
  return USER_ROLE_LABELS[role] ?? role;
}

/* ── Roster picker ──────────────────────────────────────── */

function RosterPicker({
  sportCode,
  eventId,
  currentMemberIds,
  onAdded,
  onClose,
}: {
  sportCode: string;
  eventId: string;
  currentMemberIds: Set<string>;
  onAdded: (member: TravelMember) => void;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [localRoster, setLocalRoster] = useState<RosterEntry[] | null>(null);
  const addingRef = useRef(new Set<string>());
  const togglingRef = useRef(new Set<string>());

  const {
    data: fetchedRoster,
    loading,
    error: rosterError,
    reload: reloadRoster,
  } = useFetch<RosterEntry[]>({
    url: `/api/sport-configs/${sportCode}/roster`,
    transform: (json) => (json.data as RosterEntry[]) ?? [],
  });

  const [prevFetched, setPrevFetched] = useState(fetchedRoster);
  if (fetchedRoster !== prevFetched) {
    setPrevFetched(fetchedRoster);
    setLocalRoster(null);
  }

  const roster = localRoster ?? fetchedRoster ?? [];

  // Default travelers first, then alphabetical
  const sorted = [...roster].sort((a, b) => {
    if (a.defaultTraveler && !b.defaultTraveler) return -1;
    if (!a.defaultTraveler && b.defaultTraveler) return 1;
    return a.user.name.localeCompare(b.user.name);
  });

  async function handleAdd(userId: string) {
    if (addingRef.current.has(userId)) return;
    addingRef.current.add(userId);
    setAdding(userId);
    try {
      const res = await fetch(`/api/calendar-events/${eventId}/travel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to add");
        toast.error(msg);
        return;
      }
      const json = await parseJsonSafely<{ data?: TravelMember }>(res);
      if (!json?.data) {
        toast.error("Traveler was added, but the response was incomplete. Refresh and try again.");
        return;
      }
      onAdded(json.data);
      onClose();
    } catch (err) {
      toast.error(err instanceof TypeError ? "You’re offline. Check your connection." : "Failed to add traveler");
    } finally {
      addingRef.current.delete(userId);
      setAdding(null);
    }
  }

  async function handleToggleDefault(entry: RosterEntry) {
    if (togglingRef.current.has(entry.id)) return;
    togglingRef.current.add(entry.id);
    setToggling(entry.id);
    try {
      const res = await fetch(`/api/sport-configs/${sportCode}/roster`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: entry.id, defaultTraveler: !entry.defaultTraveler }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to update default traveler"));
        return;
      }
      setLocalRoster((prev) =>
        (prev ?? fetchedRoster ?? []).map((r) =>
          r.id === entry.id ? { ...r, defaultTraveler: !entry.defaultTraveler } : r
        )
      );
    } catch (err) {
      toast.error(err instanceof TypeError ? "You’re offline. Check your connection." : "Failed to update default traveler");
    } finally {
      togglingRef.current.delete(entry.id);
      setToggling(null);
    }
  }

  if (loading) {
    return (
      <div className="p-2 flex flex-col gap-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  }

  if (rosterError) {
    return (
      <Alert variant="destructive" className="m-1">
        <AlertCircle className="size-4" />
        <AlertTitle>Failed to load roster</AlertTitle>
        <AlertDescription className="mt-2 flex flex-col gap-2 text-sm">
          <span>Sport roster members could not load, so travelers cannot be added yet.</span>
          <Button variant="outline" onClick={reloadRoster} className="h-10 w-fit">
            Retry roster
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const eligible = sorted.filter((r) => !currentMemberIds.has(r.userId));

  if (eligible.length === 0) {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        All sport roster members are already on the travel roster.
      </p>
    );
  }

  return (
    <div className="max-h-60 overflow-y-auto">
      {eligible.map((entry) => (
        <div
          key={entry.id}
          className="flex items-center justify-between px-2 py-1.5 hover:bg-muted/50 rounded"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleToggleDefault(entry)}
                  disabled={toggling === entry.id}
                  className={`size-10 ${
                    entry.defaultTraveler
                      ? "text-[var(--yellow-text)] hover:brightness-110"
                      : "text-muted-foreground/30 hover:text-muted-foreground"
                  }`}
                  aria-label={entry.defaultTraveler ? `Remove ${entry.user.name} as default traveler` : `Mark ${entry.user.name} as default traveler`}
                >
                  <Plane className="size-3.5" fill={entry.defaultTraveler ? "currentColor" : "none"} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {entry.defaultTraveler ? "Default traveler - click to unset" : "Mark as default traveler"}
              </TooltipContent>
            </Tooltip>
            <span className="text-sm truncate">{entry.user.name}</span>
            <Badge variant="gray" size="sm" className="shrink-0">
              {userRoleLabel(entry.user.role)}
            </Badge>
          </div>
          <Button
            size="default"
            variant="ghost"
            className="ml-2 h-10 shrink-0 px-3 text-xs"
            onClick={() => handleAdd(entry.userId)}
            disabled={adding !== null}
            aria-label={`Add ${entry.user.name} to travel roster`}
          >
            {adding === entry.userId ? "..." : "Add"}
          </Button>
        </div>
      ))}
    </div>
  );
}

/* ── Main Card ──────────────────────────────────────────── */

export function EventTravelCard({
  eventId,
  sportCode,
  isStaff,
}: {
  eventId: string;
  sportCode: string;
  isStaff: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [localMembers, setLocalMembers] = useState<TravelMember[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const removingRef = useRef(new Set<string>());

  const {
    data: fetchedMembers,
    loading,
    error,
    reload,
  } = useFetch<TravelMember[]>({
    url: `/api/calendar-events/${eventId}/travel`,
    transform: (json) => (json.data as TravelMember[]) ?? [],
  });

  const [prevFetched, setPrevFetched] = useState(fetchedMembers);
  if (fetchedMembers !== prevFetched) {
    setPrevFetched(fetchedMembers);
    setLocalMembers(null);
  }

  const members = localMembers ?? fetchedMembers ?? [];
  const memberIds = new Set(members.map((m) => m.userId));

  function handleAdded(member: TravelMember) {
    setLocalMembers((prev) => [...(prev ?? fetchedMembers ?? []), member]);
  }

  async function handleRemove(memberId: string) {
    if (removingRef.current.has(memberId)) return;
    removingRef.current.add(memberId);
    setRemoving(memberId);
    try {
      const res = await fetch(`/api/calendar-events/${eventId}/travel/${memberId}`, {
        method: "DELETE",
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to remove");
        toast.error(msg);
        return;
      }
      setLocalMembers((prev) => (prev ?? fetchedMembers ?? []).filter((m) => m.id !== memberId));
    } catch (err) {
      toast.error(err instanceof TypeError ? "You’re offline. Check your connection." : "Failed to remove traveler");
    } finally {
      removingRef.current.delete(memberId);
      setRemoving(null);
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-sm font-semibold">Travel Roster</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Who is traveling to this away event.
          </p>
        </div>
        {isStaff && (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="default" className="h-10" disabled={loading}>
                <Plus className="size-3.5 mr-1.5" />
                Add
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2" align="end">
              <p className="text-xs font-medium text-muted-foreground px-1 pb-2">
                Sport roster - marked users are default travelers
              </p>
              <RosterPicker
                sportCode={sportCode}
                eventId={eventId}
                currentMemberIds={memberIds}
                onAdded={handleAdded}
                onClose={() => setPickerOpen(false)}
              />
            </PopoverContent>
          </Popover>
        )}
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Failed to load</AlertTitle>
            <AlertDescription className="mt-1">
              <Button variant="outline" className="h-10" onClick={reload}>Retry</Button>
            </AlertDescription>
          </Alert>
        ) : members.length === 0 ? (
          <EmptyState
            inline
            icon="users"
            title="No travelers added"
            description={isStaff ? "Add sport-roster travelers for this away event." : "Travelers will appear here once staff adds them."}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <UserAvatar
                    name={m.user.name}
                    avatarUrl={m.user.avatarUrl}
                    size="default"
                    className="shrink-0"
                  />
                  <span className="text-sm truncate">{m.user.name}</span>
                  <Badge variant="gray" size="sm" className="shrink-0">
                    {userRoleLabel(m.user.role)}
                  </Badge>
                </div>
                {isStaff && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemove(m.id)}
                    disabled={removing === m.id}
                    className="size-10 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${m.user.name} from travel roster`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
