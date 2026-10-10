import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { BADGERS_CHANNEL_ID } from "@/lib/youtube/google";
import { decodeCatalog, decodeVideo, type VideoResource } from "@/lib/youtube/payload";
import { createReader, importLibrary, type YouTubeReader } from "@/lib/youtube/reader";
import { buildRecapDocument } from "@/lib/youtube/recap";
import { loadReplay, replayKey } from "@/lib/youtube/replay";
import {
  chooseGame,
  draftDescription,
  emptyDraft,
  prepareDraft,
  reviewChecks,
  reviewStatus,
  reviewVideo,
  suggestedTitle,
  type ReviewDraft,
  type ReviewSources,
} from "@/lib/youtube/review";
import { DESCRIPTION_FOOTER } from "@/lib/youtube/rules";
import type { CatalogVideo, Game } from "@/lib/youtube/types";
import { createScheduleSource, parseSchedule } from "@/lib/youtube/uwbadgers";

const NOW = new Date("2026-10-04T04:10:00Z"); // Oct. 3 evening in Madison

function resource(id: string, title: string, overrides: Partial<VideoResource["snippet"]> = {}, privacy = "public"): VideoResource {
  return {
    id,
    etag: `etag-${id}`,
    snippet: {
      title,
      description: "Old description",
      channelId: BADGERS_CHANNEL_ID,
      categoryId: "17",
      liveBroadcastContent: "none",
      publishedAt: "2026-09-27T15:00:00Z",
      thumbnails: { default: { url: "http://insecure.example/x.jpg" }, high: { url: "https://i.ytimg.com/vi/x/hq.jpg" } },
      ...overrides,
    },
    status: { privacyStatus: privacy, uploadStatus: "processed", license: "youtube", embeddable: true },
  };
}

const catalog = (id: string, title: string, overrides: Partial<VideoResource["snippet"]> = {}, privacy = "public"): CatalogVideo =>
  decodeCatalog(resource(id, title, overrides, privacy));

const PSU: Game = { id: "17144", date: "2026-09-26", sport: "Football", opponent: "Penn State", recapUrl: "https://uwbadgers.com/news/2026/9/26/psu", atVs: "at" };
const PARAGRAPHS = [
  "STATE COLLEGE, Pa. — Wisconsin beat No. 13 Penn State 24-20 on Saturday. The defense held late.",
  "Quarterback Danny O'Neil threw two touchdowns in the win.",
  "Up next: Wisconsin hosts Michigan State on Oct. 3.",
];

function sources(games: Game[], paragraphs = PARAGRAPHS): ReviewSources & { recapCalls: string[] } {
  const recapCalls: string[] = [];
  return {
    recapCalls,
    async games(date) {
      return games.filter((game) => game.date === date);
    },
    async recap(url) {
      recapCalls.push(url);
      return buildRecapDocument(url, paragraphs, NOW);
    },
  };
}

describe("YouTube payload decoding", () => {
  it("keeps the fields the write guards compare and prefers an https thumbnail", () => {
    const item = catalog("abc", "Highlights at Penn State || Wisconsin Football || Sept. 26, 2026");
    expect(item.live.etag).toBe("etag-abc");
    expect(item.live.snapshot).toMatchObject({ id: "abc", isPublic: true, isLive: false, channelId: BADGERS_CHANNEL_ID, categoryId: "17" });
    expect(item.live.snapshot.status).toEqual({ privacyStatus: "public", uploadStatus: "processed", license: "youtube", embeddable: true });
    expect(item.thumbnailUrl).toBe("https://i.ytimg.com/vi/x/hq.jpg");
    expect(item.publishedAt).toBe("2026-09-27T15:00:00.000Z");
  });

  it("rejects incomplete items and other channels instead of guessing", () => {
    expect(() => decodeVideo({ ...resource("a", "T"), etag: "" })).toThrow(/incomplete/);
    expect(() => decodeVideo(resource("a", "T", { channelId: "UCother" }))).toThrow(/another channel/);
    expect(() => decodeCatalog(resource("a", "T", { publishedAt: "not a date" }))).toThrow(/publication date/);
  });

  it("treats upcoming broadcasts as live", () => {
    expect(decodeVideo(resource("a", "T", { liveBroadcastContent: "upcoming" })).snapshot.isLive).toBe(true);
  });
});

describe("UWBadgers schedule", () => {
  const week = [
    {
      date: "2026-09-26T00:00:00",
      events: [
        { id: 17144, date: "2026-09-26T16:00:00", atVs: "at", sport: { title: "Football" }, opponent: { title: "Penn State" }, result: { recap: { url: "/news/2026/9/26/psu" } } },
        { id: 1, date: "2026-09-26T00:00:00", sport: { title: "Rowing" }, opponent: { title: "Head of the Rock" }, result: { recap: { url: "https://evil.example/news/x" } } },
      ],
    },
    { date: "2026-09-27T00:00:00", events: [] },
  ];

  it("keeps official recap links only and registers empty days", () => {
    const days = parseSchedule(week);
    expect(days.get("2026-09-26")?.[0]).toEqual({ ...PSU });
    expect(days.get("2026-09-26")?.[1]?.recapUrl).toBeNull();
    expect(days.get("2026-09-27")).toEqual([]);
  });

  it("requests a week once and serves its other days from cache", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(week), { status: 200 }));
    const source = createScheduleSource(fetcher as unknown as typeof fetch);
    await Promise.all([source.games("2026-09-26"), source.games("2026-09-26")]);
    expect(await source.games("2026-09-27")).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toBe("https://uwbadgers.com/api/v2/Calendar/events?date=2026-09-26");
  });

  it("refuses a redirect that leaves uwbadgers.com", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    const source = createScheduleSource(fetcher as unknown as typeof fetch);
    await expect(source.games("2026-09-26")).rejects.toThrow(/official HTTPS UWBadgers/);
    await expect(source.recap("https://uwbadgers.com/calendar")).rejects.toThrow(/No official recap/);
  });
});

describe("recorded YouTube replay", () => {
  it("uses the recorder's key: path plus the query sorted by name", () => {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,status");
    url.searchParams.set("id", "a,b");
    expect(replayKey(url)).toBe("GET videos?id=a%2Cb&part=snippet%2Cstatus");
    expect(replayKey("https://uwbadgers.com/api")).toBeNull();
  });

  it("serves recorded GETs, reports missing ones, and passes other hosts through", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yt-replay-"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ recordedAt: "2026-10-04T04:10:38+00:00" }));
    writeFileSync(join(dir, "a.json"), JSON.stringify({ key: "GET channels?mine=true&part=snippet", status: 200, body: { items: [] } }));
    const passthrough = vi.fn(async () => new Response("ok"));
    const replay = loadReplay(dir, passthrough as unknown as typeof fetch);
    expect(replay.recordedAt.toISOString()).toBe("2026-10-04T04:10:38.000Z");
    expect(await (await replay.fetcher("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true")).json()).toEqual({ items: [] });
    expect((await replay.fetcher("https://www.googleapis.com/youtube/v3/videos?id=x")).status).toBe(404);
    expect((await replay.fetcher("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { method: "PUT" })).status).toBe(404);
    await replay.fetcher("https://uwbadgers.com/api/v2/Calendar/events?date=2026-09-26");
    expect(passthrough).toHaveBeenCalledTimes(1);
  });
});

describe("library import", () => {
  function fakeReader(pages: Array<{ ids: string[]; nextToken: string | null }>, videos: Record<string, CatalogVideo>): YouTubeReader & { batches: string[][] } {
    const batches: string[][] = [];
    return {
      batches,
      now: () => NOW,
      replay: false,
      uploadPage: async (token) => pages[token ? Number(token) : 0]!,
      catalogVideos: async (ids) => {
        batches.push(ids);
        return ids.map((id) => videos[id]!);
      },
      playlistPage: async () => ({ items: [] }),
      playlistVideoPage: async () => ({ ids: [] }),
    };
  }

  it("dedupes across pages and keeps only the 30-day window, newest first", async () => {
    const videos = {
      a: catalog("a", "A", { publishedAt: "2026-09-20T12:00:00Z" }),
      b: catalog("b", "B", { publishedAt: "2026-10-02T12:00:00Z" }),
      old: catalog("old", "Old", { publishedAt: "2026-08-01T12:00:00Z" }),
    };
    const reader = fakeReader([{ ids: ["a", "b"], nextToken: "1" }, { ids: ["b", "old"], nextToken: null }], videos);
    const result = await importLibrary(reader);
    expect(reader.batches).toEqual([["a", "b"], ["old"]]);
    expect(result.reachedLimit).toBe(false);
    expect(result.videos.map((video) => video.live.snapshot.id)).toEqual(["b", "a"]);
  });

  it("stops on a repeated page token", async () => {
    const reader = fakeReader([{ ids: [], nextToken: "1" }, { ids: [], nextToken: "1" }], {});
    await expect(importLibrary(reader)).rejects.toThrow(/repeated a library page/);
  });

  it("refuses a videos response for ids it did not request", async () => {
    const fetcher = (async () => new Response(JSON.stringify({ items: [resource("zzz", "Other")] }))) as unknown as typeof fetch;
    await expect(createReader({ accessToken: "t", fetcher }).catalogVideos(["abc"])).rejects.toThrow(/not requested/);
  });
});

describe("review preparation", () => {
  const highlight = catalog("hl", "Highlights at Penn State || Wisconsin Football || Sept. 26, 2026");

  it("matches a highlight to its recap and selects the opening without time-sensitive copy", async () => {
    const video = reviewVideo(highlight, null, NOW);
    const draft = await prepareDraft(video, null, sources([PSU]), NOW);
    expect(draft).toMatchObject({ matchKind: "matched", hold: null, matchedTitle: highlight.live.snapshot.title, matchedGame: PSU });
    const description = draftDescription(draft, highlight.live.snapshot);
    expect(description.startsWith("Wisconsin beat No. 13 Penn State 24-20 on Saturday.")).toBe(true);
    expect(description).not.toContain("Up next");
    expect(description.endsWith(DESCRIPTION_FOOTER)).toBe(true);
  });

  it("keeps the selection while the recap is unchanged and resets only the selection when it changes", async () => {
    const video = reviewVideo(highlight, null, NOW);
    const first = await prepareDraft(video, null, sources([PSU]), NOW);
    const edited: ReviewDraft = { ...first, version: 2, selectedSentenceIds: first.selectedSentenceIds.slice(0, 1), editedTitle: "Kept title" };
    const again = await prepareDraft(video, edited, sources([PSU]), NOW);
    expect(again.selectedSentenceIds).toEqual(edited.selectedSentenceIds);

    const changed = await prepareDraft(video, { ...edited, editedDescription: "Manual text" }, sources([PSU], ["New lead paragraph that is long enough."]), NOW);
    expect(changed.selectedSentenceIds).toHaveLength(1);
    expect(changed.selectedSentenceIds).not.toEqual(edited.selectedSentenceIds);
    expect(changed.editedDescription).toBe("Manual text");
    expect(changed.editedTitle).toBe("Kept title");
  });

  it("holds a highlight with no official game and never invents a source", async () => {
    const draft = await prepareDraft(reviewVideo(highlight, null, NOW), null, sources([]), NOW);
    expect(draft.hold).toMatch(/^No matching game/);
    expect(draft.recap).toBeNull();
    const video = reviewVideo(highlight, draft, NOW);
    const checks = reviewChecks(video, draft, highlight.live.snapshot, { existing: [], checked: true });
    expect(reviewStatus(video, draft, highlight.live.snapshot, checks)).toBe("Needs source");
  });

  it("turns a source failure into a hold", async () => {
    const failing: ReviewSources = { games: async () => { throw new Error("UWBadgers is down"); }, recap: async () => { throw new Error("unused"); } };
    const draft = await prepareDraft(reviewVideo(highlight, null, NOW), null, failing, NOW);
    expect(draft.hold).toBe("UWBadgers is down");
  });

  it("offers official games for an unassigned sport and loads the chosen recap", async () => {
    const item = catalog("u", "Highlights vs Penn State || Sept. 26, 2026");
    const video = reviewVideo(item, null, NOW);
    expect(video.sport).toBe("Unassigned");
    const src = sources([PSU]);
    const draft = await prepareDraft(video, null, src, NOW);
    expect(draft.gameChoices.map((game) => game.id)).toEqual(["17144"]);
    const chosen = await chooseGame(video, { ...draft, version: 1 }, "17144", src);
    expect(chosen).toMatchObject({ matchKind: "matched", hold: null, matchedGame: PSU });
    expect(reviewVideo(item, chosen, NOW)).toMatchObject({ sport: "Football", identityHold: null });
    await expect(chooseGame(video, chosen, "999", src)).rejects.toThrow(/official choices/);
  });

  it("prepares a postgame conference from the template and keeps YouTube's description until edited", async () => {
    const item = catalog("pc", "Luke Fickell Postgame Press Conference || Wisconsin Football at Penn State || Sept. 26, 2026");
    const video = reviewVideo(item, null, NOW);
    const draft = await prepareDraft(video, null, sources([PSU]), NOW);
    expect(draft).toMatchObject({ manualVideo: true, matchedGame: null, hold: null });
    expect(draft.gameChoices).toEqual([PSU]);
    expect(draftDescription(draft, item.live.snapshot)).toBe("Old description");
    const checks = reviewChecks(video, draft, item.live.snapshot, { existing: [], checked: true });
    expect(checks.find((check) => check.id === "game")).toMatchObject({ complete: false, detail: "Match the official event" });
  });

  it("excludes protected, scheduled and out-of-window uploads", () => {
    expect(reviewVideo(catalog("Bge051LX6DM", "Football"), null, NOW).protectedReason).toMatch(/protected/);
    expect(reviewVideo(catalog("old", "Old", { publishedAt: "2026-08-01T12:00:00Z" }), null, NOW).protectedReason).toMatch(/30-day/);
    const scheduled = resource("s", "Scheduled", {}, "private");
    scheduled.status!.publishAt = "2026-10-10T12:00:00Z";
    expect(reviewVideo(decodeCatalog(scheduled), null, NOW).protectedReason).toMatch(/scheduled/);
  });
});

describe("titles and status", () => {
  it("suggests the FORMATS.md highlight title with an AP date and the schedule's at/vs", async () => {
    const item = catalog("hl", "Highlights at Penn State || Wisconsin Football || Sep. 26, 2026");
    const video = reviewVideo(item, null, NOW);
    const draft = await prepareDraft(video, null, sources([PSU]), NOW);
    expect(suggestedTitle(video, draft)).toBe("Highlights at Penn State || Wisconsin Football || Sept. 26, 2026");
    const vb = { ...PSU, id: "v1", sport: "Women's Volleyball", opponent: "Purdue", atVs: "at" };
    const vbItem = catalog("vb", "Highlights at Purdue || Wisconsin Volleyball || Sept. 26, 2026");
    const vbDraft = await prepareDraft(reviewVideo(vbItem, null, NOW), null, sources([vb]), NOW);
    expect(suggestedTitle(reviewVideo(vbItem, vbDraft, NOW), vbDraft)).toBe("Highlights at Purdue || Wisconsin Volleyball || Sept. 26, 2026");
  });

  it("cleans other titles mechanically only", () => {
    const item = catalog("x", "Mike Hastings Post Game Media Conference||Wisconsin Men's Hockey || Oct. 3, 2026");
    expect(suggestedTitle(reviewVideo(item, null, NOW), emptyDraft("x"))).toBe("Mike Hastings Postgame Media Conference || Wisconsin Men's Hockey || Oct. 3, 2026");
  });

  it("is Published only when YouTube already matches a complete review", async () => {
    const recap = buildRecapDocument(PSU.recapUrl!, PARAGRAPHS, NOW);
    const base = catalog("hl", "Highlights at Penn State || Wisconsin Football || Sept. 26, 2026");
    const video = reviewVideo(base, null, NOW);
    const draft = await prepareDraft(video, null, sources([PSU]), NOW);
    const description = draftDescription(draft, null);
    const published = catalog("hl", base.live.snapshot.title, { description });
    const inPlaylist = { existing: [{ id: "p", title: "2026 Football", channelId: BADGERS_CHANNEL_ID, privacy: "public", itemCount: 1 }], checked: true };
    const checks = reviewChecks(video, draft, published.live.snapshot, inPlaylist);
    expect(checks.every((check) => check.complete)).toBe(true);
    expect(reviewStatus(video, draft, published.live.snapshot, checks)).toBe("Published");
    expect(recap.sentences.length).toBeGreaterThan(2);

    const noPlaylist = reviewChecks(video, draft, published.live.snapshot, { existing: [], checked: true });
    expect(reviewStatus(video, draft, published.live.snapshot, noPlaylist)).toBe("Needs review");
    expect(noPlaylist.find((check) => check.id === "playlists")?.detail).toBe("Not in a suggested playlist");
  });
});
