"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Eye, ImagePlus, MoreHorizontal, Plus, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";
import { AnnouncementDialog } from "@/components/announcements/AnnouncementDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_KIND_LABEL,
  audienceIdForRoles,
  parseAnnouncementBody,
  validateAnnouncementDraft,
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
  imageUrls: string[];
  imageAlt: string | null;
  roles: ("ADMIN" | "STAFF" | "STUDENT")[];
  showOnWeb: boolean;
  showOnIos: boolean;
  publishedAt: string | null;
  endsAt: string | null;
  createdByName: string;
  seenCount: number;
  audienceSize: number;
  state: AnnouncementState;
};

type Draft = {
  id: string | null;
  state: AnnouncementState;
  kind: AnnouncementKindValue;
  title: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  imageUrls: string[];
  imageAlt: string;
  audience: string;
  showOnWeb: boolean;
  showOnIos: boolean;
  endsAt: string;
};

const EMPTY: Draft = {
  id: null,
  state: "draft",
  kind: "FEATURE",
  title: "",
  body: "",
  ctaLabel: "",
  ctaUrl: "",
  imageUrls: [],
  imageAlt: "",
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

  /** A fresh draft with the same content, so a recurring message starts from the last one. */
  function duplicate(row: Row) {
    setDraft({
      ...EMPTY,
      kind: row.kind,
      title: `${row.title} (copy)`.slice(0, 80),
      body: row.body,
      ctaLabel: row.ctaLabel ?? "",
      ctaUrl: row.ctaUrl ?? "",
      imageUrls: row.imageUrls,
      imageAlt: row.imageAlt ?? "",
      audience: audienceIdForRoles(row.roles),
      showOnWeb: row.showOnWeb,
      showOnIos: row.showOnIos,
    });
  }

  function edit(row: Row) {
    setDraft({
      id: row.id,
      state: row.state,
      kind: row.kind,
      title: row.title,
      body: row.body,
      ctaLabel: row.ctaLabel ?? "",
      ctaUrl: row.ctaUrl ?? "",
      imageUrls: row.imageUrls,
      imageAlt: row.imageAlt ?? "",
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
                  <button
                    type="button"
                    onClick={() => edit(row)}
                    className="mt-1.5 block max-w-full truncate rounded-sm text-left text-sm font-semibold text-foreground outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  >
                    {row.title}
                  </button>
                  <p className="m-0 mt-0.5 text-xs text-muted-foreground">
                    {audience} · {where}
                    {row.state === "live" || row.state === "ended"
                      ? ` · Seen by ${row.seenCount} of ${row.audienceSize}`
                      : ""}
                    {row.publishedAt ? ` · Posted ${formatRelativeTime(row.publishedAt, new Date())}` : ""}
                  </p>
                  {row.state === "live" && row.audienceSize > 0 ? (
                    <div
                      className="mt-2.5 h-1 w-full max-w-60 overflow-hidden rounded-full bg-muted"
                      role="img"
                      aria-label={`Seen by ${row.seenCount} of ${row.audienceSize}`}
                    >
                      <div
                        className="h-full rounded-full bg-[var(--wi-red)]"
                        style={{ width: `${Math.min(100, Math.round((row.seenCount / row.audienceSize) * 100))}%` }}
                      />
                    </div>
                  ) : null}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Actions for ${row.title}`}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => edit(row)}>Edit</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => duplicate(row)}>
                      <Copy className="size-4" aria-hidden="true" />
                      Duplicate
                    </DropdownMenuItem>
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

      {draft ? (
        <Composer key={draft.id ?? "new"} initial={draft} onClose={() => setDraft(null)} onSaved={() => void refresh()} />
      ) : null}
    </SettingsPageShell>
  );
}

type Field = "title" | "body" | "ctaLabel" | "ctaUrl" | "platforms" | "endsAt";

/** Where each field's error shows, in page order, so saving can focus the first one. */
const FIELD_INPUT_ID: Record<Field, string> = {
  title: "ann-title",
  body: "ann-body",
  ctaLabel: "ann-cta-label",
  ctaUrl: "ann-cta-url",
  endsAt: "ann-ends",
  platforms: "ann-web",
};

function toPayload(draft: Draft, initial: Draft) {
  const audience = ANNOUNCEMENT_AUDIENCES.find((a) => a.id === draft.audience) ?? ANNOUNCEMENT_AUDIENCES[0];
  return {
    kind: draft.kind,
    title: draft.title,
    body: draft.body,
    ctaLabel: draft.ctaLabel,
    ctaUrl: draft.ctaUrl.trim(),
    imageUrls: draft.imageUrls,
    imageAlt: draft.imageUrls.length ? draft.imageAlt : "",
    roles: audience.roles,
    showOnWeb: draft.showOnWeb,
    showOnIos: draft.showOnIos,
    // An edit leaves an untouched end date alone, so fixing a typo on an ended announcement still saves.
    ...(draft.id && draft.endsAt === initial.endsAt ? {} : { endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null }),
  };
}

/**
 * The shared rules, plus one editor-only allowance: an ended announcement keeps
 * its past end date when you only fix its words, but publishing needs a future one.
 */
function validate(draft: Draft, initial: Draft, publish: boolean): Partial<Record<Field, string>> {
  const errors = validateAnnouncementDraft(draft);
  if (errors.endsAt && draft.id && !publish && draft.endsAt === initial.endsAt) delete errors.endsAt;
  return errors;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="m-0 text-xs text-destructive">
      {message}
    </p>
  );
}

function Composer({ initial, onClose, onSaved }: { initial: Draft; onClose: () => void; onSaved: () => void }) {
  const confirm = useConfirm();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState<null | "draft" | "publish">(null);
  const [uploading, setUploading] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  // Errors appear after the first save attempt, so a blank form isn't shouted at.
  const [attempt, setAttempt] = useState<null | "save" | "publish">(null);
  const [error, setError] = useState<string | null>(null);
  // Updates go through the latest draft, so an upload that finishes while you type never undoes your typing.
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const recent = useMemo(() => releases.slice(0, 8), []);
  const blocks = useMemo(() => parseAnnouncementBody(draft.body), [draft.body]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const errors = attempt ? validate(draft, initial, attempt === "publish") : {};
  const describedBy = (field: Field) => (errors[field] ? `${FIELD_INPUT_ID[field]}-error` : undefined);

  async function fromRelease(index: string) {
    const r = recent[Number(index)];
    if (!r) return;
    if (draft.title.trim() || draft.body.trim()) {
      const ok = await confirm({
        title: "Replace what you wrote?",
        message: `The title, message, and button switch to the "${r.title}" release note.`,
        confirmLabel: "Replace",
      });
      if (!ok) return;
    }
    const bullets = (r.details ?? [])
      .slice(0, 4)
      .map((d) => `- ${d}`)
      .join("\n");
    setDraft((d) => ({
      ...d,
      kind: r.type === "feature" ? "FEATURE" : "UPDATE",
      title: r.title.slice(0, 80),
      body: [r.summary, bullets].filter(Boolean).join("\n\n").slice(0, 1200),
      ctaLabel: "See what's new",
      ctaUrl: "/releases",
    }));
  }

  // Closing the tab with unsaved edits gets the browser's own warning.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function close(): Promise<boolean> {
    if (saving) return false;
    if (dirty) {
      const ok = await confirm({
        title: "Discard your changes?",
        message: draft.id ? "Your edits to this announcement won't be saved." : "This announcement hasn't been saved.",
        confirmLabel: "Discard",
        variant: "danger",
      });
      if (!ok) return false;
    }
    onClose();
    return true;
  }

  const audience = ANNOUNCEMENT_AUDIENCES.find((a) => a.id === draft.audience) ?? ANNOUNCEMENT_AUDIENCES[0];
  const isLive = draft.state === "live" || draft.state === "scheduled";
  const hasCta = Boolean(draft.ctaLabel.trim() && draft.ctaUrl.trim());
  const previewAnnouncement = {
    kind: draft.kind,
    kindLabel: ANNOUNCEMENT_KIND_LABEL[draft.kind],
    title: draft.title,
    blocks,
    ctaLabel: hasCta ? draft.ctaLabel : null,
    ctaUrl: hasCta ? draft.ctaUrl : null,
    imageUrls: draft.imageUrls,
    imageAlt: draft.imageAlt,
  };

  async function save(publish: boolean) {
    setAttempt(publish ? "publish" : "save");
    const problems = validate(draft, initial, publish);
    const first = (Object.keys(FIELD_INPUT_ID) as Field[]).find((f) => problems[f]);
    if (first) {
      setError(null);
      document.getElementById(FIELD_INPUT_ID[first])?.focus();
      return;
    }
    if (publish) {
      const where = [draft.showOnWeb ? "the website" : null, draft.showOnIos ? "the iPhone app" : null]
        .filter(Boolean)
        .join(" and ");
      const ok = await confirm({
        title: `Publish to ${audience.label.toLowerCase()}?`,
        message: `They see it once, the next time they open ${where}. You can end it any time.`,
        confirmLabel: "Publish",
      });
      if (!ok) return;
    }
    setSaving(publish ? "publish" : "draft");
    setError(null);
    const payload = toPayload(draft, initial);
    try {
      if (draft.id) {
        await send(`/api/announcements/${draft.id}`, "PATCH", { ...payload, ...(publish ? { state: "live" } : {}) });
      } else {
        await send("/api/announcements", "POST", { ...payload, publish });
      }
      toast.success(publish ? "Published. People see it the next time they open the app." : isLive ? "Changes saved" : "Saved");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(null);
    }
  }

  const busy = saving !== null || uploading > 0;
  const primaryLabel = draft.state === "ended" ? "Publish again" : "Publish now";

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : void close())}>
      <DialogContent
        className="max-h-[min(94dvh,54rem)] max-w-[920px] sm:rounded-2xl"
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter saves, the way it does in most editors.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) {
            e.preventDefault();
            void save(false);
          }
        }}
      >
        <DialogHeader className="flex-col items-start gap-1 px-6 pt-6 pr-14 text-left">
          <DialogTitle>{draft.id ? "Edit announcement" : "New announcement"}</DialogTitle>
          <DialogDescription>
            People see it once, then it is gone for them. Change it any time without a deploy. Need a crew to act on it?{" "}
            <Link
              href="/blasts"
              className="font-medium text-foreground underline underline-offset-2"
              onClick={(e) => {
                // Leaving goes through the same unsaved-changes check as closing.
                e.preventDefault();
                void close().then((closed) => closed && router.push("/blasts"));
              }}
            >
              Send a blast
            </Link>{" "}
            instead.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 px-6 pb-2 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="flex flex-col gap-4">
            {!draft.id ? (
              <div className="flex flex-col gap-1.5">
                <Label>Start from a release note</Label>
                <Select value="" onValueChange={(v) => void fromRelease(v)}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    {recent.map((r, i) => (
                      <SelectItem key={`${r.date}-${r.title}`} value={String(i)}>{r.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
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
              <div className="flex items-baseline justify-between">
                <Label htmlFor="ann-title">Title</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{draft.title.length}/80</span>
              </div>
              <Input
                id="ann-title"
                value={draft.title}
                maxLength={80}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Scheduling is faster now"
                aria-invalid={Boolean(errors.title) || undefined}
                aria-describedby={describedBy("title")}
              />
              <FieldError id="ann-title-error" message={errors.title} />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="ann-body">Message</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{draft.body.length}/1200</span>
              </div>
              <Textarea
                id="ann-body"
                rows={6}
                value={draft.body}
                maxLength={1200}
                onChange={(e) => set("body", e.target.value)}
                placeholder={"One or two sentences.\n\n- Start a line with a dash for a bullet"}
                aria-invalid={Boolean(errors.body) || undefined}
                aria-describedby={describedBy("body") ?? "ann-body-hint"}
              />
              {errors.body ? (
                <FieldError id="ann-body-error" message={errors.body} />
              ) : (
                <p id="ann-body-hint" className="m-0 text-xs text-muted-foreground">
                  A blank line starts a new paragraph. Start a line with a dash for a bullet.
                </p>
              )}
            </div>

            <ImagePicker
              images={draft.imageUrls}
              alt={draft.imageAlt}
              onImagesChange={(update) => setDraft((d) => ({ ...d, imageUrls: update(d.imageUrls) }))}
              onAltChange={(imageAlt) => set("imageAlt", imageAlt)}
              onUploadingChange={(delta) => setUploading((n) => n + delta)}
            />

            <div className="flex flex-col gap-1.5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ann-cta-label">Button label (optional)</Label>
                  <Input
                    id="ann-cta-label"
                    value={draft.ctaLabel}
                    maxLength={32}
                    onChange={(e) => set("ctaLabel", e.target.value)}
                    placeholder="See what's new"
                    aria-invalid={Boolean(errors.ctaLabel) || undefined}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ann-cta-url">Button link</Label>
                  <Input
                    id="ann-cta-url"
                    value={draft.ctaUrl}
                    maxLength={500}
                    inputMode="url"
                    autoCapitalize="off"
                    spellCheck={false}
                    onChange={(e) => set("ctaUrl", e.target.value)}
                    placeholder="/releases"
                    aria-invalid={Boolean(errors.ctaUrl) || undefined}
                    aria-describedby={describedBy("ctaUrl") ?? "ann-cta-hint"}
                  />
                </div>
              </div>
              {errors.ctaUrl || errors.ctaLabel ? (
                <FieldError id="ann-cta-url-error" message={errors.ctaUrl ?? errors.ctaLabel} />
              ) : (
                <p id="ann-cta-hint" className="m-0 text-xs text-muted-foreground">
                  A page in the app like /schedule, or a full https:// link. Without a button, people see Got it.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ann-ends">Stop showing on (optional)</Label>
                <div className="flex items-center gap-1">
                  <Input
                    id="ann-ends"
                    type="datetime-local"
                    value={draft.endsAt}
                    min={toLocalInput(new Date().toISOString())}
                    onChange={(e) => set("endsAt", e.target.value)}
                    aria-invalid={Boolean(errors.endsAt) || undefined}
                    aria-describedby={describedBy("endsAt")}
                  />
                  {draft.endsAt ? (
                    <Button type="button" variant="ghost" size="icon" aria-label="Clear the end date" onClick={() => set("endsAt", "")}>
                      <X className="size-4" />
                    </Button>
                  ) : null}
                </div>
                <FieldError id="ann-ends-error" message={errors.endsAt} />
              </div>
              <div className="flex flex-col justify-end gap-2 pb-1.5">
                <label className="flex items-center justify-between gap-3 text-sm">
                  Web
                  <Switch
                    id="ann-web"
                    checked={draft.showOnWeb}
                    onCheckedChange={(v) => set("showOnWeb", v)}
                    aria-invalid={Boolean(errors.platforms) || undefined}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  iPhone app
                  <Switch checked={draft.showOnIos} onCheckedChange={(v) => set("showOnIos", v)} />
                </label>
              </div>
            </div>
            {errors.platforms ? (
              <FieldError id="ann-web-error" message={errors.platforms} />
            ) : draft.showOnIos ? (
              <p className="m-0 -mt-2 text-xs text-muted-foreground">The iPhone app starts showing announcements with its next update.</p>
            ) : null}

            {isLive ? (
              <p className="m-0 rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                This is live. People who already closed it won&rsquo;t see your edit unless you choose Show to everyone again.
              </p>
            ) : null}

            {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
          </div>

          <div className="hidden flex-col gap-2 self-start md:sticky md:top-4 md:flex">
            <p className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
            <div className="overflow-hidden rounded-[22px] border border-black/[0.06] bg-popover shadow-[0_24px_64px_-16px_rgb(0_0_0/0.22),0_2px_6px_rgb(0_0_0/0.05)] dark:border-white/10">
              <AnnouncementCard preview announcement={previewAnnouncement} />
            </div>
          </div>
        </div>

        {/* One row on phones too: the header's X already cancels, and Preview shrinks to its icon. */}
        <DialogFooter className="sticky bottom-0 z-10 flex-row items-center border-t bg-background px-4 py-3 sm:px-6 sm:py-4">
          <Button variant="ghost" onClick={() => setPreviewing(true)} className="mr-auto max-sm:px-2.5" aria-label="Preview as people see it">
            <Eye className="size-4" aria-hidden="true" />
            <span className="max-sm:hidden">Preview as people see it</span>
          </Button>
          {uploading > 0 ? (
            <span role="status" className="text-xs text-muted-foreground max-sm:hidden">
              Uploading images…
            </span>
          ) : null}
          <Button variant="ghost" onClick={() => void close()} disabled={saving !== null} className="max-sm:hidden">
            Cancel
          </Button>
          {isLive ? (
            <Button variant="brand" onClick={() => void save(false)} loading={saving === "draft"} disabled={busy}>
              Save changes
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => void save(false)} loading={saving === "draft"} disabled={busy}>
                {draft.state === "ended" ? "Save" : "Save draft"}
              </Button>
              <Button variant="brand" onClick={() => void save(true)} loading={saving === "publish"} disabled={busy}>
                {primaryLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
      {previewing ? (
        <AnnouncementDialog
          announcement={{ ...previewAnnouncement, publishedAt: null }}
          onCta={() => setPreviewing(false)}
          onDismiss={() => setPreviewing(false)}
        />
      ) : null}
    </Dialog>
  );
}

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Banner images: upload, reorder, remove, and a shared description for screen readers. */
function ImagePicker({
  images,
  alt,
  onImagesChange,
  onAltChange,
  onUploadingChange,
}: {
  images: string[];
  alt: string;
  onImagesChange: (update: (current: string[]) => string[]) => void;
  onAltChange: (alt: string) => void;
  onUploadingChange: (delta: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const all = Array.from(files);
    const room = MAX_IMAGES - images.length - uploading;
    if (all.length > room) toast.error(`Up to ${MAX_IMAGES} images. Only the first ${room} were added.`);
    // Check type and size here so a wrong file fails at once instead of after an upload.
    const picked = all.slice(0, Math.max(0, room)).filter((file) => {
      if (!IMAGE_TYPES.includes(file.type)) {
        toast.error(`${file.name}: use a JPEG, PNG, WebP, or GIF`);
        return false;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`${file.name}: images must be under 4.5 MB`);
        return false;
      }
      return true;
    });
    if (inputRef.current) inputRef.current.value = "";
    if (!picked.length) return;
    setUploading((n) => n + picked.length);
    onUploadingChange(picked.length);
    for (const file of picked) {
      const body = new FormData();
      body.append("file", file);
      try {
        const res = await fetch("/api/announcements/images", { method: "POST", body });
        const json = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
        if (!res.ok || !json?.url) throw new Error(json?.error ?? "Upload failed");
        const url = json.url;
        onImagesChange((current) => (current.length < MAX_IMAGES ? [...current, url] : current));
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : "Upload failed"}`);
      } finally {
        setUploading((n) => n - 1);
        onUploadingChange(-1);
      }
    }
  }

  function moveEarlier(index: number) {
    onImagesChange((current) => {
      const moved = current[index];
      if (moved === undefined || index < 1) return current;
      const next = current.filter((_, i) => i !== index);
      next.splice(index - 1, 0, moved);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <Label>Banner images (optional)</Label>
        <span className="text-xs text-muted-foreground">Wide, about 2:1. Up to {MAX_IMAGES}; more than one swipes.</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {images.map((src, i) => (
          <div key={src} className="group relative aspect-[2/1] w-32 overflow-hidden rounded-lg border bg-muted">
            <Image src={src} alt="" fill sizes="128px" className="object-cover" />
            {i > 0 ? (
              <Button
                type="button"
                variant="secondary"
                size="icon-xs"
                aria-label={`Move image ${i + 1} earlier`}
                onClick={() => moveEarlier(i)}
                className="absolute left-1 top-1 rounded-full bg-background/90 shadow-sm"
              >
                <ArrowLeft />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="icon-xs"
              aria-label={`Remove image ${i + 1}`}
              onClick={() => onImagesChange((current) => current.filter((url) => url !== src))}
              className="absolute right-1 top-1 rounded-full bg-background/90 shadow-sm"
            >
              <X />
            </Button>
          </div>
        ))}
        {Array.from({ length: uploading }).map((_, i) => (
          <div key={`up-${i}`} className="flex aspect-[2/1] w-32 items-center justify-center rounded-lg border bg-muted">
            <Spinner />
          </div>
        ))}
        {images.length + uploading < MAX_IMAGES ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex aspect-[2/1] w-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none"
          >
            <ImagePlus className="size-4" aria-hidden="true" />
            Add image
          </button>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => void upload(e.target.files)}
        />
      </div>
      {images.length ? (
        <>
          <Input
            id="ann-image-alt"
            aria-label="Image description"
            className="mt-1"
            value={alt}
            maxLength={200}
            onChange={(e) => onAltChange(e.target.value)}
            placeholder="Image description, read aloud by screen readers"
          />
          {!alt.trim() ? (
            <p className="m-0 text-xs text-muted-foreground">
              Add a description so people using screen readers know what the banner shows.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
