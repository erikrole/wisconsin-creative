"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_KIND_LABEL,
  audienceIdForRoles,
  type AnnouncementKindValue,
  type AnnouncementState,
} from "@/lib/announcements";
import { formatRelativeTime } from "@/lib/format";
import { SettingsGroup } from "../_components/SettingsGroup";
import { SettingsPageShell } from "../SettingsPageShell";
import { Composer, send, toLocalInput, type Draft } from "./AnnouncementComposer";

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

const ANNOUNCEMENT_GROUPS: Array<{ states: Array<Row["state"]>; title: string }> = [
  { states: ["live"], title: "Live now" },
  { states: ["scheduled"], title: "Scheduled" },
  { states: ["draft"], title: "Drafts" },
  { states: ["ended"], title: "Ended" },
];

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
        <Button onClick={() => setDraft({ ...EMPTY })}>
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
        <div className="flex flex-col gap-7">
          {ANNOUNCEMENT_GROUPS.map(({ states, title }) => {
            const rows = data.filter((row) => states.includes(row.state));
            if (rows.length === 0) return null;
            return (
              <SettingsGroup key={title} title={title}>
                {rows.map((row) => {
                  const badge = STATE_BADGE[row.state];
                  const audience = ANNOUNCEMENT_AUDIENCES.find((a) => a.id === audienceIdForRoles(row.roles))?.label;
                  const where = [row.showOnWeb ? "Web" : null, row.showOnIos ? "iOS" : null].filter(Boolean).join(" and ");
                  return (
                  <li key={row.id} className="flex items-start gap-4 px-4 py-4">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => edit(row)}
                        className="block max-w-full truncate rounded-sm text-left text-sm font-bold text-foreground outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40"
                      >
                        {row.title}
                      </button>
                      <p className="m-0 mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        <span>{ANNOUNCEMENT_KIND_LABEL[row.kind]} · {audience} · {where}
                        {row.state === "live" || row.state === "ended"
                          ? ` · Seen by ${row.seenCount} of ${row.audienceSize}`
                          : ""}
                        {row.publishedAt ? ` · Posted ${formatRelativeTime(row.publishedAt, new Date())}` : ""}</span>
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
              </SettingsGroup>
            );
          })}
        </div>
      )}

      {draft ? (
        <Composer key={draft.id ?? "new"} initial={draft} onClose={() => setDraft(null)} onSaved={() => void refresh()} />
      ) : null}
    </SettingsPageShell>
  );
}
