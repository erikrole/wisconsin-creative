"use client";

import { RefreshCwIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { Queue, QueueItem, RefreshSummary } from "@/lib/youtube/queue";
import { apDate, UNASSIGNED } from "@/lib/youtube/rules";

import { STATUS_BADGE, STATUS_RAIL } from "./status";
import { VisibilityBadge } from "./VisibilityBadge";
import { VideoReview } from "./VideoReview";

const isOpen = (item: QueueItem) => item.status !== "Published" && item.status !== "Protected";
/** Every check passes and YouTube does not match yet: this upload only needs approval. */
const isReady = (item: QueueItem) => isOpen(item) && item.checks.length > 0 && item.checks.every((check) => check.complete);
/** "Men's Hockey vs. Robert Morris · Oct. 3", or just "Men's Hockey · Oct. 3" when the opponent is unknown. */
function gameKey(item: QueueItem): string {
  const game = item.draft?.matchedGame;
  const sport = item.video.sport === UNASSIGNED ? "" : item.video.sport;
  const opponent = game?.opponent ?? item.video.opponent;
  const direction = game?.atVs === "at" ? "at" : "vs.";
  const day = game?.date ?? item.video.uploadDate;
  const what = [sport, opponent ? `${sport ? direction : "Game vs."} ${opponent}` : ""].filter(Boolean).join(" ") || "Other uploads";
  return `${what} · ${apDate(day) ?? day}`;
}

const checkedLabel = (value: string | null) =>
  value ? `Checked ${new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Not checked yet";

async function errorMessage(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function ReviewQueue({ queue, canRefresh, replay }: { queue: Queue; canRefresh: boolean; replay: boolean }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<"queue" | "ready" | "all">("queue");
  const [sport, setSport] = useState("All sports");
  const [search, setSearch] = useState("");
  const [privacy, setPrivacy] = useState("All visibility");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sports = useMemo(() => [...new Set(queue.items.map((item) => item.video.sport))].sort(), [queue.items]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return queue.items.filter(
      (item) =>
        (view === "all" || (view === "ready" ? isReady(item) : isOpen(item))) &&
        (sport === "All sports" || item.video.sport === sport) &&
        (privacy === "All visibility" || item.live.privacyStatus === privacy) &&
        (!needle || [item.title, item.video.opponent, item.video.sport].some((text) => text.toLowerCase().includes(needle))),
    );
  }, [queue.items, view, sport, privacy, search]);
  const selected = visible.find((item) => item.id === selectedId) ?? null;
  const waiting = queue.items.filter(isOpen).length;
  const ready = queue.items.filter(isReady).length;
  const groups = useMemo(() => {
    const byGame = new Map<string, QueueItem[]>();
    for (const item of visible) byGame.set(gameKey(item), [...(byGame.get(gameKey(item)) ?? []), item]);
    return [...byGame.entries()];
  }, [visible]);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/youtube/library/refresh", { method: "POST" });
      if (!res.ok) throw new Error(await errorMessage(res, "The library could not be refreshed."));
      const data = (await res.json()) as RefreshSummary;
      const extra = [data.held ? `${data.held} held` : "", data.skipped ? `${data.skipped} left for the next refresh` : ""].filter(Boolean).join(", ");
      toast.success(`${data.videos} recent uploads checked${extra ? ` · ${extra}` : ""}`);
      if (data.playlistFailure) toast.error(`Playlists: ${data.playlistFailure}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The library could not be refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Review queue">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full gap-2 sm:w-auto">
          <div className="yt-stat">
            <b className="yt-mono">{waiting}</b>
            <span>Need a look</span>
          </div>
          <div className="yt-stat">
            <b className="yt-mono">{queue.items.length - waiting}</b>
            <span>Good to go</span>
          </div>
          <div className="yt-stat">
            <b className="yt-mono">{queue.items.length}</b>
            <span>Recent uploads</span>
          </div>
        </div>
        <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:items-end">
          <p className="yt-mono text-xs text-muted-foreground">
            {checkedLabel(queue.checkedAt)}
            {queue.reachedLimit ? " · latest 300 uploads" : ""}
            {replay ? " · recorded YouTube data" : ""}
          </p>
          <Button onClick={refresh} disabled={!canRefresh || refreshing} variant="outline" className="bg-card">
            {refreshing ? <Spinner /> : <RefreshCwIcon />}
            {refreshing ? "Checking uploads…" : "Refresh library"}
          </Button>
        </div>
      </div>

      {queue.lastFailure && (
        <Alert variant="destructive">
          <AlertDescription>The last refresh failed: {queue.lastFailure}</AlertDescription>
        </Alert>
      )}

      {queue.items.length === 0 ? (
        <Empty className="yt-sheet">
          <EmptyHeader>
            <EmptyTitle>No uploads loaded</EmptyTitle>
            <EmptyDescription>
              {canRefresh ? "Refresh the library to load the last 30 days of uploads." : "Connect the channel, then refresh the library."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs className="[&_[role=tablist]]:bg-card" value={view} onValueChange={(value) => setView(value as "queue" | "ready" | "all")}>
              <TabsList>
                <TabsTrigger value="queue">Needs attention</TabsTrigger>
                <TabsTrigger value="ready">Ready ({ready})</TabsTrigger>
                <TabsTrigger value="all">All uploads</TabsTrigger>
              </TabsList>
            </Tabs>
            <NativeSelect className="w-auto bg-card" value={sport} onChange={(event) => setSport(event.target.value)} aria-label="Sport">
              <option>All sports</option>
              {sports.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </NativeSelect>
            <NativeSelect className="w-auto bg-card" value={privacy} onChange={(event) => setPrivacy(event.target.value)} aria-label="Visibility">
              <option>All visibility</option>
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </NativeSelect>
            <div className="relative min-w-48 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="bg-card pl-9" placeholder="Search titles" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search titles" />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
            <ul className="yt-sheet flex max-h-[72vh] flex-col gap-1 self-start overflow-y-auto p-1.5" aria-label="Uploads">
              {visible.length === 0 && <li className="p-4 text-sm text-muted-foreground">Nothing matches. Try loosening the filters.</li>}
              {groups.map(([key, items]) => (
                <li key={key} className="flex flex-col gap-1">
                  <p className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-md bg-card/95 px-2 pt-2 pb-1 text-xs font-semibold">
                    <span className="truncate">{key}</span>
                    <span className="yt-mono shrink-0 font-normal text-muted-foreground">
                      {items.filter(isReady).length}/{items.length} ready
                    </span>
                  </p>
                  <ul className="flex flex-col gap-1">
                    {items.map((item) => (
                      <li key={item.id}>
                        <QueueRow item={item} active={item.id === selected?.id} onSelect={() => setSelectedId(item.id)} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            {selected ? (
              <VideoReview key={`${selected.id}:${selected.draft?.version ?? 0}:${selected.publish?.phase ?? ""}`} item={selected} playlists={queue.playlists} canSend={!replay && canRefresh} />
            ) : (
              <p className="yt-sheet p-6 text-sm text-muted-foreground">Pick an upload from the strip to start.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function QueueRow({ item, active, onSelect }: { item: QueueItem; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      style={{ "--yt-rail": STATUS_RAIL[item.status] } as React.CSSProperties}
      className={cn("yt-row flex w-full gap-3 rounded-lg py-2 pr-2 pl-3.5 text-left hover:bg-accent", active && "bg-accent")}
    >
      {item.thumbnailUrl ? (
        // YouTube thumbnails are already sized; next/image would proxy them for no gain.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.thumbnailUrl} alt="" className="aspect-video w-24 shrink-0 rounded-md object-cover shadow-sm" loading="lazy" />
      ) : (
        <div className="aspect-video w-24 shrink-0 rounded-md bg-muted" />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <span className="line-clamp-2 text-sm font-medium">{item.title}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant={STATUS_BADGE[item.status]} size="sm">
            {item.status}
          </Badge>
          <VisibilityBadge privacy={item.live.privacyStatus} size="sm" />
          <span className="line-clamp-1">{item.status === "Published" ? item.video.uploadDate : item.reason}</span>
        </span>
      </div>
    </button>
  );
}
