"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AwardIcon, BellOffIcon, Trash2Icon } from "lucide-react";
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

type CreditUser = {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  active: boolean;
};

type EventCredit = {
  id: string;
  note: string | null;
  createdAt: string;
  user: CreditUser;
  createdBy: { id: string; name: string } | null;
  alsoAssigned: boolean;
};

type PickerUser = { id: string; name: string; role: string; avatarUrl?: string | null };

const NOTE_MAX = 200;

function roleLabel(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/**
 * Scoreboard credit for people who worked an event without a scheduled shift —
 * a late addition, a fill-in, or a collaborator who is tracked but never
 * staffed. Admin-only, silent, and separate from the crew table on purpose:
 * writing here moves season stats and touches nothing else.
 */
export function EventCreditsCard({ eventId, isAdmin }: { eventId: string; isAdmin: boolean }) {
  const [credits, setCredits] = useState<EventCredit[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<PickerUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const savingRef = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/calendar-events/${eventId}/credits`, { signal });
      if (signal?.aborted) return;
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Failed to load event credits"));
        return;
      }
      const json = await parseJsonSafely<{ data?: EventCredit[] }>(response);
      setCredits(json?.data ?? []);
    } catch (error) {
      if (isAbortError(error)) return;
      toast.error("Failed to load event credits");
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

  const creditedIds = useMemo(() => new Set(credits.map((credit) => credit.user.id)), [credits]);

  const options = useMemo<ComboboxOption[]>(() => users
    .filter((user) => !creditedIds.has(user.id))
    .map((user) => ({
      value: user.id,
      label: user.name,
      keywords: [user.name, roleLabel(user.role)],
    })), [users, creditedIds]);

  async function addCredit() {
    if (!selectedUserId || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const response = await fetch(`/api/calendar-events/${eventId}/credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId, note: note.trim() || undefined }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Failed to add credit"));
        return;
      }
      const json = await parseJsonSafely<{ data?: EventCredit[] }>(response);
      setCredits(json?.data ?? []);
      setSelectedUserId("");
      setNote("");
      toast.success("Credit added. No one was notified.");
    } catch (error) {
      if (isAbortError(error)) return;
      toast.error("Network error - credit not added");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function removeCredit(credit: EventCredit) {
    if (removing) return;
    setRemoving(credit.id);
    try {
      const response = await fetch(`/api/calendar-events/${eventId}/credits/${credit.id}`, {
        method: "DELETE",
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Failed to remove credit"));
        return;
      }
      const json = await parseJsonSafely<{ data?: EventCredit[] }>(response);
      setCredits(json?.data ?? []);
      toast.success(`Removed ${credit.user.name}'s credit`);
    } catch (error) {
      if (isAbortError(error)) return;
      toast.error("Network error - credit not removed");
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
            Scoreboard credit
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Counts toward Scoreboard and profile stats only. No shift, no notification, and it never
            appears on their schedule.
          </p>
        </div>
        <Badge variant="outline" size="sm" className="shrink-0 gap-1">
          <BellOffIcon className="size-3" />
          Silent
        </Badge>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading credits…</p>
        ) : credits.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No one is credited outside the scheduled crew.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {credits.map((credit) => (
              <li key={credit.id} className="flex flex-wrap items-center gap-3 py-2 first:pt-0">
                <UserAvatar name={credit.user.name} avatarUrl={credit.user.avatarUrl} size="sm" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm">{credit.user.name}</span>
                    <Badge variant="outline" size="sm">{roleLabel(credit.user.role)}</Badge>
                    {credit.alsoAssigned && (
                      <Badge variant="gray" size="sm">Also on crew</Badge>
                    )}
                    {!credit.user.active && <Badge variant="gray" size="sm">Inactive</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {credit.note ? `${credit.note} · ` : ""}
                    Added{credit.createdBy ? ` by ${credit.createdBy.name}` : ""}{" "}
                    {formatRelativeTime(credit.createdAt, new Date())}
                  </span>
                </div>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${credit.user.name}'s credit`}
                    disabled={removing === credit.id}
                    onClick={() => void removeCredit(credit)}
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
              <Label htmlFor="event-credit-person">Person</Label>
              <Combobox
                id="event-credit-person"
                options={options}
                value={selectedUserId}
                onValueChange={setSelectedUserId}
                placeholder="Select a person"
                searchPlaceholder="Search people…"
                emptyMessage="No one left to credit."
              />
            </div>
            <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
              <Label htmlFor="event-credit-note">Note (optional)</Label>
              <Input
                id="event-credit-note"
                value={note}
                maxLength={NOTE_MAX}
                placeholder="Why this credit exists"
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <Button
              className="min-h-10"
              disabled={!selectedUserId || saving}
              onClick={() => void addCredit()}
            >
              {saving ? "Adding…" : "Add credit"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
