// Server-only: the live YouTube transport behind the publishing coordinator.
// Wired: a title and description update (`videos.update`, part=snippet) and a
// launch (snippet plus a verified public status). Visibility-only changes throw.

import { youtubeApi } from "./google";
import { decodeVideo, type VideoResource } from "./payload";
import type { PlaylistTransport, YouTubeTransport } from "./publishing";
import { createReader } from "./reader";
import { YouTubeToolError, type LiveVideo, type PlaylistMembership, type VideoSnapshot, type YouTubePlaylist } from "./types";
import { updateBody } from "./write-guard";

export function createTransport(accessToken: string, fetcher: typeof fetch = fetch): YouTubeTransport {
  const refuse = () => {
    throw new YouTubeToolError("Only title, description and launch updates are enabled.");
  };
  return {
    async read(id): Promise<LiveVideo> {
      // The same parts the library import requests, so the etag is comparable with the stored baseline.
      const json = await youtubeApi<{ items?: VideoResource[] }>(accessToken, "videos", { query: { part: "snippet,status", id } }, fetcher);
      const item = json.items?.[0];
      if (!item || item.id !== id) throw new YouTubeToolError("YouTube did not return this video.");
      return decodeVideo(item);
    },
    async update(video: VideoSnapshot, ifMatch: string) {
      await youtubeApi(accessToken, "videos", { method: "PUT", query: { part: "snippet" }, body: updateBody(video), ifMatch }, fetcher);
    },
    async publish(video: VideoSnapshot, ifMatch: string) {
      await youtubeApi(accessToken, "videos", { method: "PUT", query: { part: "snippet,status" }, body: updateBody(video, true), ifMatch }, fetcher);
    },
    changeVisibility: async () => refuse(),
  };
}

/** Playlist reads and the single-insert write. Listing reuses the library reader's read-only calls. */
export function createPlaylistTransport(accessToken: string, fetcher: typeof fetch = fetch): PlaylistTransport {
  const reader = createReader({ accessToken, fetcher });
  const api = <T>(path: string, options: Parameters<typeof youtubeApi>[2]) => youtubeApi<T>(accessToken, path, options, fetcher);
  return {
    read: createTransport(accessToken, fetcher).read,
    playlistPage: (token) => reader.playlistPage(token),
    playlistVideoPage: (playlistId, token) => reader.playlistVideoPage(playlistId, token),
    async readPlaylist(id): Promise<YouTubePlaylist> {
      const json = await api<{ items?: Array<{ id?: string; snippet?: { title?: string; channelId?: string }; status?: { privacyStatus?: string }; contentDetails?: { itemCount?: number } }> }>(
        "playlists",
        { query: { part: "snippet,contentDetails,status", id } },
      );
      const item = json.items?.[0];
      if (!item?.id || !item.snippet?.channelId) throw new YouTubeToolError("YouTube did not return this playlist.");
      return { id: item.id, title: item.snippet.title ?? "", channelId: item.snippet.channelId, privacy: item.status?.privacyStatus ?? "", itemCount: item.contentDetails?.itemCount ?? 0 };
    },
    async membership(videoId, playlistId): Promise<PlaylistMembership | null> {
      const json = await api<{ items?: Array<{ id?: string; snippet?: { playlistId?: string; resourceId?: { videoId?: string } } }> }>("playlistItems", {
        query: { part: "snippet", playlistId, videoId, maxResults: "1" },
      });
      const item = json.items?.[0];
      if (!item?.id) return null;
      return { id: item.id, playlistId: item.snippet?.playlistId ?? "", videoId: item.snippet?.resourceId?.videoId ?? "" };
    },
    async insert(videoId, playlistId): Promise<PlaylistMembership> {
      const item = await api<{ id?: string; snippet?: { playlistId?: string; resourceId?: { videoId?: string } } }>("playlistItems", {
        method: "POST",
        query: { part: "snippet" },
        body: { snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } },
      });
      if (!item.id) throw new YouTubeToolError("YouTube did not confirm the playlist addition.");
      return { id: item.id, playlistId: item.snippet?.playlistId ?? "", videoId: item.snippet?.resourceId?.videoId ?? "" };
    },
  };
}
