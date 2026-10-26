import { describe, expect, it, vi } from "vitest";
import { BADGERS_CHANNEL_ID } from "@/lib/youtube/google";
import { createReader } from "@/lib/youtube/reader";

type Route = (url: URL) => unknown;

function fakeYouTube(routes: Record<string, Route>) {
  const calls: URL[] = [];
  const fetcher = vi.fn(async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    calls.push(url);
    const route = routes[url.pathname.split("/").pop() ?? ""];
    if (!route) return new Response(JSON.stringify({ error: { message: "nope" } }), { status: 404 });
    return new Response(JSON.stringify(route(url)), { status: 200 });
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

const channels = () => ({ items: [{ id: BADGERS_CHANNEL_ID, contentDetails: { relatedPlaylists: { uploads: "UU-badgers" } } }] });

function video(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    etag: `etag-${id}`,
    snippet: {
      title: `Video ${id}`,
      channelId: BADGERS_CHANNEL_ID,
      categoryId: "17",
      liveBroadcastContent: "none",
      publishedAt: "2026-10-20T12:00:00Z",
      thumbnails: { default: { url: "http://insecure.example/t.jpg" }, high: { url: "https://i.ytimg.com/t.jpg" } },
    },
    status: { privacyStatus: "public" },
    ...extra,
  };
}

describe("createReader", () => {
  it("pages the Badgers uploads playlist, looking the playlist up once", async () => {
    const { fetcher, calls } = fakeYouTube({
      channels,
      playlistItems: (url) => ({
        nextPageToken: url.searchParams.get("pageToken") ? undefined : "p2",
        items: [{ contentDetails: { videoId: "v1" } }, { contentDetails: {} }],
      }),
    });
    const reader = createReader({ accessToken: "token", fetcher });

    expect(await reader.uploadPage(null)).toEqual({ ids: ["v1"], nextToken: "p2" });
    expect(await reader.uploadPage("p2")).toEqual({ ids: ["v1"], nextToken: null });
    expect(calls.filter((url) => url.pathname.endsWith("/channels"))).toHaveLength(1);
    expect(calls[1]?.searchParams.get("playlistId")).toBe("UU-badgers");
  });

  it("stops when the account no longer manages the Badgers channel", async () => {
    const { fetcher } = fakeYouTube({ channels: () => ({ items: [{ id: "UC-other", contentDetails: { relatedPlaylists: { uploads: "UU-x" } } }] }) });

    await expect(createReader({ accessToken: "token", fetcher }).uploadPage(null))
      .rejects.toThrow("The connected account no longer manages the Wisconsin Badgers channel.");
  });

  it("reads requested videos with an https thumbnail and refuses surprises", async () => {
    const { fetcher } = fakeYouTube({ videos: (url) => ({ items: url.searchParams.get("id")!.split(",").map((id) => video(id === "v2" ? "v9" : id)) }) });
    const reader = createReader({ accessToken: "token", fetcher });

    expect(await reader.catalogVideos([])).toEqual([]);
    const [first] = await reader.catalogVideos(["v1"]);
    expect(first).toEqual(expect.objectContaining({ publishedAt: "2026-10-20T12:00:00.000Z", thumbnailUrl: "https://i.ytimg.com/t.jpg" }));
    await expect(reader.catalogVideos(["v2"])).rejects.toThrow("YouTube returned a video that was not requested.");
    await expect(reader.catalogVideos(Array.from({ length: 51 }, (_, index) => `v${index}`))).rejects.toThrow("Invalid library request.");
  });

  it("lists the channel's playlists and refuses an incomplete one", async () => {
    const { fetcher } = fakeYouTube({
      playlists: (url) => (url.searchParams.get("pageToken") === "bad"
        ? { items: [{ id: "PL-x", snippet: { title: "No channel" } }] }
        : { nextPageToken: "n", items: [{ id: "PL-1", snippet: { title: "Highlights", channelId: BADGERS_CHANNEL_ID }, status: { privacyStatus: "public" }, contentDetails: { itemCount: 12 } }, { id: "PL-2", snippet: { channelId: BADGERS_CHANNEL_ID } }] }),
    });
    const reader = createReader({ accessToken: "token", fetcher });

    expect(await reader.playlistPage(null)).toEqual({
      items: [
        { id: "PL-1", title: "Highlights", channelId: BADGERS_CHANNEL_ID, privacy: "public", itemCount: 12 },
        { id: "PL-2", title: "", channelId: BADGERS_CHANNEL_ID, privacy: "", itemCount: 0 },
      ],
      nextToken: "n",
    });
    await expect(reader.playlistPage("bad")).rejects.toThrow("YouTube returned an incomplete playlist.");
  });

  it("lists only videos in a playlist and refuses entries from another playlist", async () => {
    const { fetcher } = fakeYouTube({
      playlistItems: (url) => (url.searchParams.get("playlistId") === "PL-mixed"
        ? { items: [{ snippet: { playlistId: "PL-other", resourceId: { kind: "youtube#video", videoId: "v1" } } }] }
        : { items: [
          { snippet: { playlistId: "PL-1", resourceId: { kind: "youtube#video", videoId: "v1" } } },
          { snippet: { playlistId: "PL-1", resourceId: { kind: "youtube#channel", videoId: "c1" } } },
        ] }),
    });
    const reader = createReader({ accessToken: "token", fetcher });

    expect(await reader.playlistVideoPage("PL-1", null)).toEqual({ ids: ["v1"], nextToken: null });
    await expect(reader.playlistVideoPage("PL-mixed", null)).rejects.toThrow("YouTube returned entries for a different playlist.");
  });

  it("passes YouTube's error reason through", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Quota", errors: [{ reason: "quotaExceeded" }] } }), { status: 403 }));

    await expect(createReader({ accessToken: "token", fetcher: fetcher as unknown as typeof fetch }).playlistPage(null))
      .rejects.toThrow("YouTube returned an error (quotaExceeded): Quota");
  });

  it("uses the injected clock and replay flag", () => {
    const now = new Date("2026-10-25T12:00:00Z");
    const reader = createReader({ accessToken: "replay", now: () => now, replay: true });

    expect(reader.now()).toBe(now);
    expect(reader.replay).toBe(true);
    expect(createReader({ accessToken: "token" }).replay).toBe(false);
  });
});
