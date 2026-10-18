"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_KIND_LABEL,
  audienceIdForRoles,
  parseAnnouncementBody,
  type AnnouncementKindValue,
  type AnnouncementState,
} from "@/lib/announcements";
import { formatRelativeTime } from "@/lib/format";
import { releases } from "@/lib/releases";
import { SettingsPageShell } from "../SettingsPageShell";

type Row = {
  id: string;
  kind: AnnouncementKindValue;
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  roles: ("ADMIN" | "STAFF" | "STUDENT" | "COLLABORATOR")[];
  showOnWeb: boolean;
  showOnIos: boolean;
  publishedAt: string | null;
  endsAt: string | null;
  createdByName: string;
  seenCount: number;
  state: AnnouncementState;
};

type Draft = {
  id: string | null;
  kind: AnnouncementKindValue;
  title: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  audience: string;
  showOnWeb: boolean;
  showOnIos: boolean;
  endsAt: string;
};

const EMPTY: Draft = {
  id: null,
  kind: "FEATURE",
  title: "",
  body: "",
  ctaLabel: "",
  ctaUrl: "",
  audience: "everyone",
  showOnWeb: true,
  showOnIos: true,
  endsAt: "",
};

const STATE_BADGE: Record<AnnouncementState, { label: string; variant: "green" | "gray" | "orange" | "outline" }> = {
  live: { label: "Live", variant: "green" },
  scheduled: { label: "Scheduled", variant: "orange" },
  draft: { label: "Draft", variant: "gray" },
  ended: { label: "Ended", variant: "outline" },
};

const QUERY_KEY = ["announcements", "admin"] as const;

/** `<input type="datetime-local">` wants local wall time, not UTC. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: string; details?: { message?: string }[] } | null;
    throw new Error(json?.details?.[0]?.message ?? json?.error ?? "Something went wrong. Try again.");
  }
  return res.json();
}

export default function AnnouncementsSettingsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<Row[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/announcements");
      if (!res.ok) throw new Error("load");
      return ((await res.json()) as { data: Row[] }).data;
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const act = useMutation({
    mutationFn: ({ id, body, ok }: { id: string; body: unknown; ok: string }) =>
      send(`/api/announcements/${id}`, "PATCH", body).then(() => ok),
    onSuccess: (message) => {
      toast.success(message);
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function remove(row: Row) {
    const confirmed = await confirm({
      title: "Delete this announcement?",
      message: `"${row.title}" disappears for everyone, including people who haven't seen it yet.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;
    try {
      await send(`/api/announcements/${row.id}`, "DELETE");
      toast.success("Announcement deleted");
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  function edit(row: Row) {
    setDraft({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      ctaLabel: row.ctaLabel ?? "",
      ctaUrl: row.ctaUrl ?? "",
      audience: audienceIdForRoles(row.roles),
      showOnWeb: row.showOnWeb,
      showOnIos: row.showOnIos,
      endsAt: toLocalInput(row.endsAt),
    });
  }

  return (
    <SettingsPageShell
      href="/settings/announcements"
      actions={
        <Button variant="brand" onClick={() => setDraft({ ...EMPTY })}>
          <Plus className="size-4" aria-hidden="true" />
          New announcement
        </Button>
      }
    >
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : isError ? (
        <EmptyState icon="wifi-off" title="Could not load announcements" actionLabel="Try again" onAction={() => void refetch()} />
      ) : !data?.length ? (
        <EmptyState
          icon="bell"
          title="Nothing posted yet"
          description="Post a short message and everyone sees it once, the next time they open the app. No deploy needed."
          actionLabel="New announcement"
          onAction={() => setDraft({ ...EMPTY })}
        />
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-xl border bg-card p-0">
          {data.map((row) => {
            const badge = STATE_BADGE[row.state];
            const audience = ANNOUNCEMENT_AUDIENCES.find((a) => a.id === audienceIdForRoles(row.roles))?.label;
            const where = [row.showOnWeb ? "Web" : null, row.showOnIos ? "iOS" : null].filter(Boolean).join(" and ");
            return (
              <li key={row.id} className="flex items-start gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <span className="text-xs font-medium text-muted-foreground">{ANNOUNCEMENT_KIND_LABEL[row.kind]}</span>
                  </div>
                  <p className="mb-0 mt-1.5 truncate text-sm font-semibold text-foreground">{row.title}</p>
                  <p className="m-0 mt-0.5 text-xs text-muted-foreground">
                    {audience} · {where}
                    {row.state === "live" || row.state === "ended"
                      ? ` · ${row.seenCount} ${row.seenCount === 1 ? "person has" : "people have"} dismissed it`
                      : ""}
                    {row.publishedAt ? ` · Posted ${formatRelativeTime(row.publishedAt, new Date())}` : ""}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Actions for ${row.title}`}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => edit(row)}>Edit</DropdownMenuItem>
                    {row.state === "draft" || row.state === "ended" ? (
                      <DropdownMenuItem onSelect={() => act.mutate({ id: row.id, body: { state: "live" }, ok: "Published" })}>
                        {row.state === "ended" ? "Publish again" : "Publish"}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => act.mutate({ id: row.id, body: { state: "ended" }, ok: "Announcement ended" })}>
                        End now
                      </DropdownMenuItem>
                    )}
                    {row.state === "live" ? (
                      <DropdownMenuItem onSelect={() => act.mutate({ id: row.id, body: { showAgain: true }, ok: "Everyone will see it again" })}>
                        Show to everyone again
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => void remove(row)}>
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}

      {draft ? <Composer draft={draft} onChange={setDraft} onClose={() => setDraft(null)} onSaved={() => void refresh()} /> : null}
    </SettingsPageShell>
  );
}

function Composer({
  draft,
  onChange,
  onClose,
  onSaved,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState<null | "draft" | "publish">(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value });
  const recent = useMemo(() => releases.slice(0, 8), []);
  const blocks = useMemo(() => parseAnnouncementBody(draft.body), [draft.body]);

  function fromRelease(index: string) {
    const r = recent[Number(index)];
    if (!r) return;
    const bullets = (r.details ?? []).slice(0, 4).map((d) => `- ${d}`).join("\n");
    onChange({
      ...draft,
      kind: r.type === "feature" ? "FEATURE" : "UPDATE",
      title: r.title,
      body: [r.summary, bullets].filter(Boolean).join("\n\n"),
      ctaLabel: "See what's new",
      ctaUrl: "/releases",
    });
  }

  async function save(publish: boolean) {
    setSaving(publish ? "publish" : "draft");
    setError(null);
    const audience = ANNOUNCEMENT_AUDIENCES.find((a) => a.id === draft.audience) ?? ANNOUNCEMENT_AUDIENCES[0];
    const payload = {
      kind: draft.kind,
      title: draft.title,
      body: draft.body,
      ctaLabel: draft.ctaLabel,
      ctaUrl: draft.ctaUrl,
      roles: audience.roles,
      showOnWeb: draft.showOnWeb,
      showOnIos: draft.showOnIos,
      endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
    };
    try {
      if (draft.id) {
        await send(`/api/announcements/${draft.id}`, "PATCH", { ...payload, ...(publish ? { state: "live" } : {}) });
      } else {
        await send("/api/announcements", "POST", { ...payload, publish });
      }
      toast.success(publish ? "Published. People see it the next time they open the app." : "Draft saved");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[min(94dvh,54rem)] max-w-[920px] sm:rounded-2xl">
        <DialogHeader className="flex-col items-start gap-1 px-6 pt-6 pr-14 text-left">
          <DialogTitle>{draft.id ? "Edit announcement" : "New announcement"}</DialogTitle>
          <DialogDescription>People see it once, then it is gone for them. Change it any time without a deploy.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 px-6 pb-2 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="flex flex-col gap-4">
            {!draft.id ? (
              <div className="flex flex-col gap-1.5">
                <Label>Start from a release note</Label>
                <Select onValueChange={fromRelease}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    {recent.map((r, i) => (
                      <SelectItem key={`${r.date}-${r.title}`} value={String(i)}>{r.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Type</Label>
                <Select value={draft.kind} onValueChange={(v) => set("kind", v as AnnouncementKindValue)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FEATURE">New feature</SelectItem>
                    <SelectItem value="UPDATE">Update</SelectItem>
                    <SelectItem value="NOTICE">Heads up</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Who sees it</Label>
                <Select value={draft.audience} onValueChange={(v) => set("audience", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ANNOUNCEMENT_AUDIENCES.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ann-title">Title</Label>
              <Input id="ann-title" value={draft.title} maxLength={80} onChange={(e) => set("title", e.target.value)} placeholder="Scheduling is faster now" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ann-body">Message</Label>
              <Textarea id="ann-body" rows={6} value={draft.body} maxLength={1200} onChange={(e) => set("body", e.target.value)} placeholder={"One or two sentences.\n\n- Start a line with a dash for a bullet"} />
              <p className="m-0 text-xs text-muted-foreground">A blank line starts a new paragraph. Start a line with a dash for a bullet.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ann-cta-label">Button label (optional)</Label>
                <Input id="ann-cta-label" value={draft.ctaLabel} maxLength={32} onChange={(e) => set("ctaLabel", e.target.value)} placeholder="See what's new" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ann-cta-url">Button link</Label>
                <Input id="ann-cta-url" value={draft.ctaUrl} onChange={(e) => set("ctaUrl", e.target.value)} placeholder="/releases" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ann-ends">Stop showing on (optional)</Label>
                <Input id="ann-ends" type="datetime-local" value={draft.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
              </div>
              <div className="flex flex-col justify-end gap-2 pb-1.5">
                <label className="flex items-center justify-between gap-3 text-sm">
                  Web
                  <Switch checked={draft.showOnWeb} onCheckedChange={(v) => set("showOnWeb", v)} />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  iOS app
                  <Switch checked={draft.showOnIos} onCheckedChange={(v) => set("showOnIos", v)} />
                </label>
              </div>
            </div>

            {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
          </div>

          <div className="hidden flex-col gap-2 md:flex">
            <p className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
            <div className="overflow-hidden rounded-2xl border bg-background shadow-lg">
              <AnnouncementCard
                preview
                announcement={{
                  kind: draft.kind,
                  kindLabel: ANNOUNCEMENT_KIND_LABEL[draft.kind],
                  title: draft.title,
                  blocks,
                  ctaLabel: draft.ctaLabel && draft.ctaUrl ? draft.ctaLabel : null,
                  ctaUrl: draft.ctaLabel && draft.ctaUrl ? draft.ctaUrl : null,
                }}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 pb-6">
          <Button variant="ghost" onClick={onClose} disabled={saving !== null}>Cancel</Button>
          <Button variant="outline" onClick={() => void save(false)} loading={saving === "draft"} disabled={saving !== null}>
            Save draft
          </Button>
          <Button variant="brand" onClick={() => void save(true)} loading={saving === "publish"} disabled={saving !== null}>
            {draft.id ? "Save and publish" : "Publish now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
