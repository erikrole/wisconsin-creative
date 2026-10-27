"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "@/lib/toast";
import { MegaphoneIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { FormCombobox } from "@/components/FormCombobox";
import { UserAvatar } from "@/components/UserAvatar";
import { useConfirm } from "@/components/ConfirmDialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useFetch } from "@/hooks/use-fetch";
import { classifyError, isAbortError, parseErrorMessage, handleAuthRedirect, ERROR_MESSAGES } from "@/lib/errors";
import { SPORT_CODES } from "@/lib/sports";
import { cn } from "@/lib/utils";

const AREAS = [
  { value: "VIDEO", label: "Video" },
  { value: "PHOTO", label: "Photo" },
  { value: "GRAPHICS", label: "Graphics" },
  { value: "SOCIAL", label: "Social" },
  { value: "COMMS", label: "Comms" },
  { value: "LIVE_PRODUCTION", label: "Live Production" },
] as const;

const WORKER_TYPES = [
  { value: "FT", label: "Staff" },
  { value: "ST", label: "Students" },
] as const;

const SEVERITIES = [
  { value: "INFO", label: "Info" },
  { value: "WARNING", label: "Warning" },
  { value: "URGENT", label: "Urgent" },
] as const;

/** Hours until the banner stops showing. "Never" is deliberate, not the default. */
const EXPIRY_OPTIONS = [
  { value: "4", label: "4 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "24 hours" },
  { value: "72", label: "3 days" },
  { value: "", label: "Never expires" },
];

type TargetKind = "EVENT_CREW" | "USERS" | "DYNAMIC";

type TargetSpec =
  | { kind: "EVENT_CREW"; eventId: string }
  | { kind: "USERS"; userIds: string[] }
  | { kind: "DYNAMIC"; areas?: string[]; workerTypes?: string[]; sportCodes?: string[] };

type PreviewUser = {
  id: string;
  name: string;
  role: string;
  primaryArea: string | null;
  staffingType: string;
};

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; count: number; summary: string; users: PreviewUser[] }
  | { status: "error"; message: string };

type EventOption = { id: string; summary: string; startsAt: string };
type UserOption = { id: string; name: string; role: string; avatarUrl?: string | null };

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** A multi-select pill row. Simpler than FilterChip, which is single-select. */
function PillGroup({
  options,
  selected,
  onToggle,
}: {
  options: readonly { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onToggle(option.value)}
            aria-pressed={active}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              active
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function ComposeBlastDialog({
  open,
  onOpenChange,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}) {
  const confirm = useConfirm();
  const { data: me } = useCurrentUser();
  const isAdmin = me?.role === "ADMIN";

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<string>("INFO");
  const [expiryHours, setExpiryHours] = useState("24");
  const [tab, setTab] = useState<TargetKind>("EVENT_CREW");
  const [eventId, setEventId] = useState("");
  const [userIds, setUserIds] = useState<string[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [workerTypes, setWorkerTypes] = useState<string[]>([]);
  const [sportCodes, setSportCodes] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [sending, setSending] = useState(false);

  const events = useFetch<EventOption[]>({
    url: "/api/calendar-events?limit=100",
    enabled: open,
    transform: (json) => (json.data as EventOption[]) ?? [],
  });
  const users = useFetch<UserOption[]>({
    url: "/api/users?limit=200",
    enabled: open,
    transform: (json) => (json.data as UserOption[]) ?? [],
  });

  const spec: TargetSpec | null = useMemo(() => {
    if (tab === "EVENT_CREW") return eventId ? { kind: "EVENT_CREW", eventId } : null;
    if (tab === "USERS") return userIds.length > 0 ? { kind: "USERS", userIds } : null;
    if (areas.length + workerTypes.length + sportCodes.length === 0) return null;
    return {
      kind: "DYNAMIC",
      ...(areas.length ? { areas } : {}),
      ...(workerTypes.length ? { workerTypes } : {}),
      ...(sportCodes.length ? { sportCodes } : {}),
    };
  }, [tab, eventId, userIds, areas, workerTypes, sportCodes]);

  const specKey = spec ? JSON.stringify(spec) : "";

  // Debounced dry run. Nobody should commit an irreversible fan-out without
  // first seeing exactly who it reaches.
  useEffect(() => {
    if (!open || !specKey) {
      setPreview({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setPreview({ status: "loading" });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/blasts/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: JSON.parse(specKey) }),
          signal: controller.signal,
        });
        if (handleAuthRedirect(res, "/blasts")) return;
        if (!res.ok) {
          setPreview({ status: "error", message: await parseErrorMessage(res, "Could not resolve that target.") });
          return;
        }
        const json = (await res.json()) as { data: { count: number; summary: string; users: PreviewUser[] } };
        setPreview({ status: "ready", ...json.data });
      } catch (err) {
        if (isAbortError(err)) return;
        setPreview({ status: "error", message: ERROR_MESSAGES[classifyError(err)].description });
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, specKey]);

  const reset = useCallback(() => {
    setTitle("");
    setBody("");
    setSeverity("INFO");
    setExpiryHours("24");
    setTab("EVENT_CREW");
    setEventId("");
    setUserIds([]);
    setAreas([]);
    setWorkerTypes([]);
    setSportCodes([]);
    setPreview({ status: "idle" });
  }, []);

  const canSend =
    !sending && title.trim().length > 0 && body.trim().length > 0 && preview.status === "ready" && preview.count > 0;

  async function send() {
    if (!spec || preview.status !== "ready") return;

    const ok = await confirm({
      title: `Send to ${preview.count} ${preview.count === 1 ? "person" : "people"}?`,
      message:
        "Everyone targeted gets a push notification and a banner they have to acknowledge. This cannot be undone -- cancelling later clears the banner but cannot recall alerts already delivered.",
      confirmLabel: "Send blast",
    });
    if (!ok) return;

    setSending(true);
    try {
      const res = await fetch("/api/blasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          severity,
          requiresAck: true,
          expiresAt: expiryHours
            ? new Date(Date.now() + Number(expiryHours) * 3_600_000).toISOString()
            : null,
          target: spec,
        }),
      });
      if (handleAuthRedirect(res, "/blasts")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Could not send that blast."));
        return;
      }
      const json = (await res.json()) as { data: { recipientCount: number } };
      toast.success(`Sent to ${json.data.recipientCount} ${json.data.recipientCount === 1 ? "person" : "people"}.`);
      reset();
      onOpenChange(false);
      onSent();
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error(ERROR_MESSAGES[classifyError(err)].description);
    } finally {
      setSending(false);
    }
  }

  const eventOptions = useMemo(
    () =>
      (events.data ?? []).map((event) => ({
        value: event.id,
        label: `${event.summary} · ${new Date(event.startsAt).toLocaleDateString()}`,
      })),
    [events.data],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New blast</DialogTitle>
          <DialogDescription>
            Reaches every targeted person on iOS with a push and a banner they must acknowledge.
            {isAdmin ? (
              <>
                {" "}
                News that everyone should see once, with no push?{" "}
                <Link href="/settings/announcements" className="font-medium text-foreground underline underline-offset-2">
                  Post an announcement
                </Link>{" "}
                instead.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="blast-title">Title</Label>
            <Input
              id="blast-title"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Call time moved"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="blast-body">Message</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{body.length}/1000</span>
            </div>
            <Textarea
              id="blast-body"
              value={body}
              maxLength={1000}
              rows={4}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Be at gate 3 by 4:00 instead of 4:30. Bring the long lens."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Severity</Label>
              <ToggleGroup
                type="single"
                value={severity}
                onValueChange={(value) => {
                  if (value) setSeverity(value);
                }}
                className="w-full"
              >
                {SEVERITIES.map((option) => (
                  <ToggleGroupItem key={option.value} value={option.value} className="flex-1">
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="blast-expiry">Banner expires</Label>
              <FormCombobox
                id="blast-expiry"
                value={expiryHours}
                onValueChange={setExpiryHours}
                options={EXPIRY_OPTIONS}
                placeholder="24 hours"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Who gets this</Label>
            <Tabs value={tab} onValueChange={(value) => setTab(value as TargetKind)}>
              <TabsList className="w-full">
                <TabsTrigger value="EVENT_CREW" className="flex-1">Event crew</TabsTrigger>
                <TabsTrigger value="USERS" className="flex-1">People</TabsTrigger>
                <TabsTrigger value="DYNAMIC" className="flex-1">Groups</TabsTrigger>
              </TabsList>

              <TabsContent value="EVENT_CREW" className="pt-3">
                {events.error && !events.data ? (
                  <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-sm text-destructive">
                      {events.error === "network"
                        ? "Couldn’t load events. Check your connection."
                        : "Couldn’t load events right now."}
                    </p>
                    <Button type="button" variant="outline" className="h-10" onClick={events.reload}>
                      Try again
                    </Button>
                  </div>
                ) : (
                  <>
                    <FormCombobox
                      value={eventId}
                      onValueChange={setEventId}
                      options={eventOptions}
                      placeholder={events.loading ? "Loading events..." : "Pick an event"}
                      searchPlaceholder="Search events..."
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Everyone actively assigned on the event&apos;s published schedule.
                    </p>
                  </>
                )}
              </TabsContent>

              <TabsContent value="USERS" className="pt-3">
                {users.error && !users.data ? (
                  <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-sm text-destructive">
                      {users.error === "network"
                        ? "Couldn’t load people. Check your connection."
                        : "Couldn’t load people right now."}
                    </p>
                    <Button type="button" variant="outline" className="h-10" onClick={users.reload}>
                      Try again
                    </Button>
                  </div>
                ) : (
                  <div className="max-h-56 overflow-y-auto rounded-md border">
                    {users.loading && !users.data ? (
                      <p className="px-3 py-4 text-sm text-muted-foreground">Loading people...</p>
                    ) : (users.data ?? []).length === 0 ? (
                      <p className="px-3 py-4 text-sm text-muted-foreground">
                        No people are available to target.
                      </p>
                    ) : (
                      (users.data ?? []).map((user) => {
                        const checked = userIds.includes(user.id);
                        return (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => setUserIds((prev) => toggle(prev, user.id))}
                            className={cn(
                              "flex min-h-10 w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0",
                              checked ? "bg-accent" : "hover:bg-accent/50",
                            )}
                          >
                            <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="xs" />
                            <span className="flex-1 truncate">{user.name}</span>
                            <span className="text-xs text-muted-foreground">{user.role}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="DYNAMIC" className="space-y-3 pt-3">
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Area</span>
                  <PillGroup options={AREAS} selected={areas} onToggle={(v) => setAreas((p) => toggle(p, v))} />
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Worker type</span>
                  <PillGroup
                    options={WORKER_TYPES}
                    selected={workerTypes}
                    onToggle={(v) => setWorkerTypes((p) => toggle(p, v))}
                  />
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Sport</span>
                  <PillGroup
                    options={SPORT_CODES.map((sport) => ({ value: sport.code, label: sport.code }))}
                    selected={sportCodes}
                    onToggle={(v) => setSportCodes((p) => toggle(p, v))}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Matches anyone in <em>any</em> selected option within a row, and <em>all</em> rows you use.
                </p>
              </TabsContent>
            </Tabs>
          </div>

          <div className="rounded-md border bg-muted/40 p-3">
            {preview.status === "idle" && (
              <p className="text-sm text-muted-foreground">Pick a target to see who this reaches.</p>
            )}
            {preview.status === "loading" && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-3.5" /> Resolving recipients...
              </p>
            )}
            {preview.status === "error" && <p className="text-sm text-destructive">{preview.message}</p>}
            {preview.status === "ready" && (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm">
                  <UsersIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>
                    Will reach <strong className="tabular-nums">{preview.count}</strong>{" "}
                    {preview.count === 1 ? "person" : "people"}
                  </span>
                  <span className="truncate text-muted-foreground">· {preview.summary}</span>
                </p>
                {preview.count > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {preview.users.slice(0, 24).map((user) => (
                      <span
                        key={user.id}
                        className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {user.name}
                      </span>
                    ))}
                    {preview.users.length > 24 && (
                      <span className="px-2 py-0.5 text-xs text-muted-foreground">
                        +{preview.users.length - 24} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={send} disabled={!canSend}>
            {sending ? <Spinner className="size-4" /> : <MegaphoneIcon aria-hidden="true" />}
            Send blast
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
