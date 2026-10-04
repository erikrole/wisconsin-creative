"use client";

import { CircleAlertIcon, CircleCheckIcon, CircleIcon, ExternalLinkIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/ConfirmDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { wordDiff } from "@/lib/youtube/diff";
import type { QueueItem } from "@/lib/youtube/queue";
import {
  conferenceCoaches,
  conferenceTemplate,
  draftConferenceKind,
  draftDescription,
  draftTitle,
  reviewChecks,
  suggestedTitle,
  type ReviewDraft,
} from "@/lib/youtube/review";
import { descriptionProblems, DESCRIPTION_MAX, isConference, MATCH_LABELS, titleProblems, TITLE_MAX } from "@/lib/youtube/rules";
import type { Game, VideoSnapshot, YouTubePlaylist } from "@/lib/youtube/types";

import { RecapPicker } from "./RecapPicker";
import { STATUS_BADGE } from "./status";

type Edits = Pick<ReviewDraft, "editedTitle" | "editedDescription" | "selectedSentenceIds" | "conferenceKind" | "speakerIds" | "plannedPlaylistIds">;
const EDIT_KEYS: Array<keyof Edits> = ["editedTitle", "editedDescription", "selectedSentenceIds", "conferenceKind", "speakerIds", "plannedPlaylistIds"];

/** Shows what changes between the live text and the draft: removed words struck in red, added words in green. */
function Diff({ before, after }: { before: string; after: string }) {
  if (before === after) return <p className="text-xs text-muted-foreground">Matches YouTube.</p>;
  return (
    <p className="yt-mono rounded-md border bg-muted/40 p-2 text-xs leading-relaxed whitespace-pre-wrap" aria-label="Changes from the live text">
      {wordDiff(before, after).map((part, index) =>
        part.kind === "same" ? (
          <span key={index}>{part.text}</span>
        ) : part.kind === "removed" ? (
          <del key={index} className="rounded-sm bg-[var(--red-bg)] text-[var(--red-text)]">
            {part.text}
          </del>
        ) : (
          <ins key={index} className="rounded-sm bg-[var(--green-bg)] text-[var(--green-text)] no-underline">
            {part.text}
          </ins>
        ),
      )}
    </p>
  );
}

const gameLabel = (game: Game) => `${game.sport} ${game.atVs ?? "vs"} ${game.opponent} · ${game.date}`;

async function send(url: string, method: "PATCH" | "POST", body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(json?.error ?? "The draft could not be saved.");
  }
}

/** The editor for one upload. Everything here saves to the draft only; nothing is sent to YouTube. */
export function VideoReview({ item, playlists, canSend }: { item: QueueItem; playlists: YouTubePlaylist[]; canSend: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [factsReviewed, setFactsReviewed] = useState(false);
  const saved = item.draft;
  const initial: Edits = {
    editedTitle: saved?.editedTitle ?? null,
    editedDescription: saved?.editedDescription ?? null,
    selectedSentenceIds: saved?.selectedSentenceIds ?? [],
    conferenceKind: saved?.conferenceKind ?? null,
    speakerIds: saved?.speakerIds ?? [],
    plannedPlaylistIds: saved?.plannedPlaylistIds ?? [],
  };
  const [edits, setEdits] = useState<Edits>(initial);
  const [busy, setBusy] = useState(false);
  const update = (patch: Partial<Edits>) => setEdits((current) => ({ ...current, ...patch }));

  const { video } = item;
  const live: VideoSnapshot = {
    id: item.id, title: item.live.title, description: item.live.description, categoryId: "", isPublic: item.live.isPublic,
    status: { privacyStatus: item.live.privacyStatus },
  };
  const draft: ReviewDraft | null = saved ? { ...saved, ...edits } : null;
  const title = draftTitle(video, draft);
  const description = draftDescription(draft, live);
  const suggestion = suggestedTitle(video, draft);
  const checks = useMemo(
    () => reviewChecks(video, draft, live, { existing: item.existingPlaylists, checked: item.checks.find((check) => check.id === "playlists")?.detail !== "Playlist check incomplete" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edits, item],
  );
  const changed = EDIT_KEYS.filter((key) => JSON.stringify(edits[key]) !== JSON.stringify(initial[key]));
  const editable = Boolean(saved) && video.protectedReason == null;
  const conference = isConference(video.title);
  const kind = draftConferenceKind(video, draft);
  const recap = saved?.recap ?? null;
  const existingIds = new Set(item.existingPlaylists.map((playlist) => playlist.id));

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(
      () => send(`/api/youtube/drafts/${item.id}`, "PATCH", { version: saved!.version, ...Object.fromEntries(changed.map((key) => [key, edits[key]])) }),
      "Draft saved",
    );
  const chooseGame = (game: Game) => run(() => send(`/api/youtube/drafts/${item.id}/game`, "POST", { version: saved!.version, gameId: game.id }), "Game confirmed");
  const prepareAgain = () => run(() => send(`/api/youtube/drafts/${item.id}/prepare`, "POST", { version: saved!.version }), "Source checked again");

  const openSend = item.publish && ["pending", "uncertain", "conflict"].includes(item.publish.phase) ? item.publish : null;
  const differsFromLive = title !== item.live.title || description !== item.live.description;
  const canPress = canSend && editable && changed.length === 0 && differsFromLive && factsReviewed && !openSend && !busy;

  async function sendToYouTube() {
    const proceed = await confirm({
      title: "Send to YouTube?",
      message: "The title and description change on the Wisconsin Badgers channel now. YouTube is read back afterwards to confirm it.",
      confirmLabel: "Send",
    });
    if (!proceed) return;
    await run(() => send(`/api/youtube/drafts/${item.id}/publish`, "POST", { version: saved!.version, factsReviewed: true }), "Sent to YouTube and verified");
  }
  const plannedNew = edits.plannedPlaylistIds.filter((id) => !existingIds.has(id));
  const canAddPlaylists = canSend && editable && changed.length === 0 && plannedNew.length > 0 && !item.playlistOpen && !busy;

  async function addPlaylists() {
    const names = plannedNew.map((id) => playlists.find((playlist) => playlist.id === id)?.title ?? id).join(", ");
    const proceed = await confirm({ title: "Add to playlists?", message: `This video is added to ${names} on the Wisconsin Badgers channel now.`, confirmLabel: "Add" });
    if (!proceed) return;
    await run(() => send(`/api/youtube/drafts/${item.id}/playlists`, "POST", { version: saved!.version }), "Added to playlists and verified");
  }
  const checkPlaylists = () => run(() => send(`/api/youtube/drafts/${item.id}/check-playlists`, "POST", {}), "Checked playlists");
  const checkLastSend = () => run(() => send(`/api/youtube/drafts/${item.id}/check-send`, "POST", {}), "Checked YouTube");

  function setTitle(value: string) {
    update({ editedTitle: value === item.live.title ? null : value });
  }
  function setSpeakers(ids: string[]) {
    const next = { ...edits, speakerIds: ids };
    const text = conferenceTemplate(video, saved ? { ...saved, ...next } : null);
    update(text ? { speakerIds: ids, editedDescription: text } : { speakerIds: ids });
  }
  function setKind(value: string) {
    if (value !== "Weekly" && value !== "Postgame") return;
    const text = conferenceTemplate(video, saved ? { ...saved, ...edits, conferenceKind: value } : null);
    update(text ? { conferenceKind: value, editedDescription: text } : { conferenceKind: value });
  }

  const hold = item.status === "Needs source" || item.status === "Needs attention" || item.status === "Protected" ? item.reason : null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="yt-sheet yt-rise">
        {item.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbnailUrl} alt="" className="aspect-[21/9] w-full rounded-t-[14px] object-cover" />
        )}
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_BADGE[item.status]}>{item.status}</Badge>
            <span className="text-xs text-muted-foreground">
              {video.sport} · uploaded {video.uploadDate} · {item.live.privacyStatus}
            </span>
          </div>
          <CardTitle className="text-base">{item.live.title}</CardTitle>
          <CardDescription className="flex flex-wrap gap-3">
            <a className="inline-flex items-center gap-1 underline-offset-4 hover:underline" href={`https://www.youtube.com/watch?v=${item.id}`} target="_blank" rel="noreferrer">
              Watch <ExternalLinkIcon className="size-3" />
            </a>
            <a className="inline-flex items-center gap-1 underline-offset-4 hover:underline" href={`https://studio.youtube.com/video/${item.id}/edit`} target="_blank" rel="noreferrer">
              YouTube Studio <ExternalLinkIcon className="size-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {hold && (
            <Alert variant={item.status === "Needs attention" ? "destructive" : "default"}>
              <CircleAlertIcon />
              <AlertDescription>{hold}</AlertDescription>
            </Alert>
          )}
          <div className="flex items-center gap-3">
            <div className="flex flex-1 gap-1" aria-hidden="true">
              {checks.map((check) => (
                <span key={check.id} className={`h-1.5 flex-1 rounded-full ${check.complete ? "bg-[var(--green-text)]" : "bg-muted"}`} />
              ))}
            </div>
            <span className="yt-mono text-xs text-muted-foreground">
              {checks.filter((check) => check.complete).length}/{checks.length} checks
            </span>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Review checklist">
            {checks.map((check) => (
              <li key={check.id} className="flex items-start gap-2 text-sm">
                {check.complete ? <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-[var(--green-text)]" /> : <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                <span>
                  <span className="font-medium">{check.title}</span>
                  <span className="block text-muted-foreground">{check.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {editable && (
        <>
          <Card className="yt-sheet yt-rise">
            <CardHeader>
              <CardTitle className="text-base">Official game</CardTitle>
              <CardDescription>
                {saved?.matchedGame
                  ? gameLabel(saved.matchedGame)
                  : saved?.matchKind
                    ? MATCH_LABELS[saved.matchKind]
                    : conference || saved?.gameChoices.length
                      ? "Not matched yet"
                      : "This format does not need a game."}
                {saved?.recap && (
                  <>
                    {" · "}
                    <a className="underline-offset-4 hover:underline" href={saved.recap.url} target="_blank" rel="noreferrer">
                      Official recap
                    </a>
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(saved?.gameChoices ?? []).map((game) => (
                <Button key={game.id} size="sm" variant={saved?.matchedGame?.id === game.id ? "secondary" : "outline"} disabled={busy || changed.length > 0} onClick={() => chooseGame(game)}>
                  {gameLabel(game)}
                </Button>
              ))}
              <Button size="sm" variant="ghost" disabled={busy || changed.length > 0} onClick={prepareAgain}>
                Check source again
              </Button>
              {changed.length > 0 && <p className="w-full text-xs text-muted-foreground">Save or discard your edits before changing the game or source.</p>}
            </CardContent>
          </Card>

          <Card className="yt-sheet yt-rise">
            <CardHeader>
              <CardTitle className="text-base">Title</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Title" maxLength={TITLE_MAX * 2} />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{titleProblems(title).join(" ") || (suggestion === title ? "Matches the title format." : `Suggested: ${suggestion}`)}</span>
                <span>
                  {title.length}/{TITLE_MAX}
                </span>
              </div>
              <Diff before={item.live.title} after={title === item.live.title ? suggestion : title} />
              {suggestion !== title && (
                <Button className="self-start" size="sm" variant="outline" onClick={() => setTitle(suggestion)}>
                  Use suggested title
                </Button>
              )}
            </CardContent>
          </Card>

          <Card className="yt-sheet yt-rise">
            <CardHeader>
              <CardTitle className="text-base">Description</CardTitle>
              <CardDescription>
                {recap
                  ? "Choose sentences from the official recap. Only the opening dateline is removed."
                  : conference
                    ? "Choose who spoke. The template never states a result."
                    : "Edit the current YouTube description."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {conference && (
                <div className="flex flex-col gap-2">
                  <ToggleGroup type="single" value={kind} onValueChange={setKind} aria-label="Conference type">
                    <ToggleGroupItem value="Weekly">Weekly</ToggleGroupItem>
                    <ToggleGroupItem value="Postgame">Postgame</ToggleGroupItem>
                  </ToggleGroup>
                  <ToggleGroup type="multiple" className="flex-wrap" value={edits.speakerIds} onValueChange={setSpeakers} aria-label="Speakers">
                    {conferenceCoaches(video).map((coach) => (
                      <ToggleGroupItem key={coach.id} value={coach.id}>
                        {coach.name}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {kind === "Postgame" && !saved?.matchedGame && <p className="text-xs text-muted-foreground">Postgame wording needs the official game above.</p>}
                </div>
              )}
              {recap && <RecapPicker recap={recap} selectedIds={edits.selectedSentenceIds} onChange={(ids) => update({ selectedSentenceIds: ids })} />}
              <Textarea
                value={description}
                onChange={(event) => update({ editedDescription: event.target.value })}
                rows={8}
                aria-label="Description"
                maxLength={DESCRIPTION_MAX * 2}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{descriptionProblems(description).join(" ") || (description === item.live.description ? "Matches YouTube." : "Differs from YouTube.")}</span>
                <span>
                  {description.length}/{DESCRIPTION_MAX}
                </span>
              </div>
              <Diff before={item.live.description} after={description} />
              {recap && edits.editedDescription != null && (
                <Button className="self-start" size="sm" variant="outline" onClick={() => update({ editedDescription: null })}>
                  Use selected excerpt
                </Button>
              )}
            </CardContent>
          </Card>

          <Card className="yt-sheet yt-rise">
            <CardHeader>
              <CardTitle className="text-base">Playlists</CardTitle>
              <CardDescription>
                {item.existingPlaylists.length ? `In ${item.existingPlaylists.map((playlist) => playlist.title).join(", ")}.` : "Not in a suggested playlist."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {item.suggestedPlaylists.length === 0 && <p className="text-sm text-muted-foreground">No channel playlist matches this sport and year.</p>}
              {item.suggestedPlaylists.map((playlist) => (
                <div key={playlist.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`p-${playlist.id}`}
                    checked={existingIds.has(playlist.id) || edits.plannedPlaylistIds.includes(playlist.id)}
                    disabled={existingIds.has(playlist.id) || !playlists.some((known) => known.id === playlist.id)}
                    onCheckedChange={(on) =>
                      update({ plannedPlaylistIds: on ? [...edits.plannedPlaylistIds, playlist.id] : edits.plannedPlaylistIds.filter((id) => id !== playlist.id) })
                    }
                  />
                  <Label htmlFor={`p-${playlist.id}`} className="font-normal">
                    {playlist.title}
                    {existingIds.has(playlist.id) ? " (already added)" : ""}
                  </Label>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="yt-sheet yt-rise">
            <CardHeader>
              <CardTitle className="text-base">Send to YouTube</CardTitle>
              <CardDescription>
                {!differsFromLive
                  ? "YouTube already matches this draft."
                  : changed.length > 0
                    ? "Save your edits first. The saved draft is what gets sent."
                    : "Sends the title and description above, and adds the playlists you chose. Thumbnails are not changed."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {openSend && (
                <Alert variant="destructive">
                  <CircleAlertIcon />
                  <AlertDescription className="flex flex-col gap-2">
                    <span>{openSend.message ?? "The last send has not been verified yet."} Further sends are blocked until it is checked.</span>
                    <Button className="self-start" size="sm" variant="outline" disabled={busy} onClick={checkLastSend}>
                      Check last send
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {item.playlistOpen && (
                <Alert variant="destructive">
                  <CircleAlertIcon />
                  <AlertDescription className="flex flex-col gap-2">
                    <span>{item.playlistOpen} Playlist additions are blocked until it is checked.</span>
                    <Button className="self-start" size="sm" variant="outline" disabled={busy} onClick={checkPlaylists}>
                      Check last additions
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {item.publish?.phase === "verified" && <p className="text-xs text-muted-foreground">Last send verified {new Date(item.publish.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.</p>}
              {!canSend && <p className="text-xs text-muted-foreground">This preview shows recorded YouTube data, so sending is switched off.</p>}
              <div className="flex items-center gap-2 text-sm">
                <Checkbox id="facts-reviewed" checked={factsReviewed} onCheckedChange={(on) => setFactsReviewed(on === true)} disabled={!canSend} />
                <Label htmlFor="facts-reviewed" className="font-normal">
                  I checked the description&apos;s facts against the official recap
                </Label>
              </div>
            </CardContent>
          </Card>

          <div className="yt-sheet sticky bottom-3 flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <p className="text-xs text-muted-foreground">Drafts stay in the studio until you send them.</p>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={busy || changed.length === 0} onClick={() => setEdits(initial)}>
                Discard
              </Button>
              <Button variant="outline" disabled={busy || changed.length === 0} onClick={save}>
                Save draft
              </Button>
              <Button variant="outline" disabled={!canAddPlaylists} onClick={addPlaylists}>
                {plannedNew.length === 0 ? "Add to playlists" : `Add to ${plannedNew.length} ${plannedNew.length === 1 ? "playlist" : "playlists"}`}
              </Button>
              <Button variant="brand" disabled={!canPress} onClick={sendToYouTube}>
                Send to YouTube
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
