// Server-only read access to the Badgers channel: uploads, video metadata and
// playlists. Every call is a GET; nothing here can change YouTube.

import { isPreviewEnvironment } from "@/lib/environment-safety";

import { channelAccessToken } from "./connection";
import { BADGERS_CHANNEL_ID, ownedChannels, youtubeApi } from "./google";
import { decodeCatalog, type VideoResource } from "./payload";
import { loadReplay } from "./replay";
import { LibraryWindow } from "./rules";
import { YouTubeToolError, type CatalogVideo, type PlaylistPage, type UploadPage, type YouTubePlaylist } from "./types";

export interface YouTubeReader {
  /** The clock the library window is measured against. Replays use the recording time. */
  now(): Date;
  replay: boolean;
  uploadPage(token: string | null): Promise<UploadPage>;
  catalogVideos(ids: string[]): Promise<CatalogVideo[]>;
  playlistPage(token: string | null): Promise<PlaylistPage>;
  playlistVideoPage(playlistId: string, token: string | null): Promise<UploadPage>;
}

interface PlaylistResource {
  id?: string;
  snippet?: { title?: string; channelId?: string };
  status?: { privacyStatus?: string };
  contentDetails?: { itemCount?: number };
}

export function createReader(options: { accessToken: string; fetcher?: typeof fetch; now?: () => Date; replay?: boolean }): YouTubeReader {
  const { accessToken, fetcher = fetch, replay = false } = options;
  const api = <T>(path: string, query: Record<string, string | undefined>) => youtubeApi<T>(accessToken, path, { query }, fetcher);
  let uploads: Promise<string> | null = null;
  const uploadsPlaylistId = () =>
    (uploads ??= ownedChannels(accessToken, fetcher).then((channels) => {
      const channel = channels.find((item) => item.id === BADGERS_CHANNEL_ID);
      if (!channel?.uploadsPlaylistId) throw new YouTubeToolError("The connected account no longer manages the Wisconsin Badgers channel.");
      return channel.uploadsPlaylistId;
    }));

  return {
    now: options.now ?? (() => new Date()),
    replay,
    async uploadPage(token) {
      const page = await api<{ nextPageToken?: string; items?: Array<{ contentDetails?: { videoId?: string } }> }>("playlistItems", {
        part: "contentDetails", playlistId: await uploadsPlaylistId(), maxResults: "50", pageToken: token ?? undefined,
      });
      return { ids: (page.items ?? []).map((item) => item.contentDetails?.videoId).filter((id): id is string => Boolean(id)), nextToken: page.nextPageToken ?? null };
    },
    async catalogVideos(ids) {
      if (ids.length === 0) return [];
      if (ids.length > 50) throw new YouTubeToolError("Invalid library request.");
      const json = await api<{ items?: VideoResource[] }>("videos", { part: "snippet,status", id: ids.join(",") });
      return (json.items ?? []).map((item) => {
        if (!item.id || !ids.includes(item.id)) throw new YouTubeToolError("YouTube returned a video that was not requested.");
        return decodeCatalog(item);
      });
    },
    async playlistPage(token) {
      const page = await api<{ nextPageToken?: string; items?: PlaylistResource[] }>("playlists", {
        part: "snippet,contentDetails,status", mine: "true", maxResults: "50", pageToken: token ?? undefined,
      });
      const items: YouTubePlaylist[] = (page.items ?? []).map((item) => {
        if (!item.id || !item.snippet?.channelId) throw new YouTubeToolError("YouTube returned an incomplete playlist.");
        return {
          id: item.id,
          title: item.snippet.title ?? "",
          channelId: item.snippet.channelId,
          privacy: item.status?.privacyStatus ?? "",
          itemCount: item.contentDetails?.itemCount ?? 0,
        };
      });
      return { items, nextToken: page.nextPageToken ?? null };
    },
    async playlistVideoPage(playlistId, token) {
      const page = await api<{
        nextPageToken?: string;
        items?: Array<{ snippet?: { playlistId?: string; resourceId?: { kind?: string; videoId?: string } } }>;
      }>("playlistItems", { part: "snippet", playlistId, maxResults: "50", pageToken: token ?? undefined });
      const items = page.items ?? [];
      if (!items.every((item) => item.snippet?.playlistId === playlistId)) throw new YouTubeToolError("YouTube returned entries for a different playlist.");
      return {
        ids: items.filter((item) => item.snippet?.resourceId?.kind === "youtube#video").map((item) => item.snippet!.resourceId!.videoId!).filter(Boolean),
        nextToken: page.nextPageToken ?? null,
      };
    },
  };
}

/**
 * Bounded upload window (default 6 pages of 50), fetched page by page like the
 * Mac app. Only videos inside the recent library window are returned, newest first.
 */
export async function importLibrary(reader: YouTubeReader, maxPages = 6): Promise<{ videos: CatalogVideo[]; reachedLimit: boolean }> {
  const seenTokens = new Set<string>();
  const seenIds = new Set<string>();
  const videos: CatalogVideo[] = [];
  let token: string | null = null;
  let reachedLimit = true;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await reader.uploadPage(token);
    const fresh = result.ids.filter((id) => !seenIds.has(id) && seenIds.add(id));
    if (fresh.length) videos.push(...(await reader.catalogVideos(fresh)));
    const next = result.nextToken;
    if (!next) {
      reachedLimit = false;
      break;
    }
    if (seenTokens.has(next)) throw new YouTubeToolError("YouTube repeated a library page. The previous library was kept.");
    seenTokens.add(next);
    token = next;
  }
  const now = reader.now();
  return {
    videos: videos
      .filter((video) => LibraryWindow.contains(new Date(video.publishedAt), now))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    reachedLimit,
  };
}

/** Recorded responses are honoured only by a local preview dev server, never a deployment. */
export function replayDirectory(): string {
  if (process.env.NODE_ENV === "production" || !isPreviewEnvironment()) return "";
  return process.env.WC_PREVIEW_YOUTUBE_REPLAY_DIR ?? "";
}

/** The library clock: the recording time during a replay, otherwise now. */
export function libraryNow(): Date {
  const directory = replayDirectory();
  return directory ? loadReplay(directory).recordedAt : new Date();
}

/** The live reader for the connected channel, or the local recording when one is configured. */
export async function openReader(): Promise<YouTubeReader> {
  const directory = replayDirectory();
  if (directory) {
    const replay = loadReplay(directory);
    return createReader({ accessToken: "replay", fetcher: replay.fetcher, now: () => replay.recordedAt, replay: true });
  }
  return createReader({ accessToken: await channelAccessToken() });
}
