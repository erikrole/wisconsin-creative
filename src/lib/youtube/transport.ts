// Server-only: the live YouTube transport behind the publishing coordinator.
// Only a title and description update (`videos.update`, part=snippet) is wired.
// Visibility changes and launches throw: this slice never sends them.

import { youtubeApi } from "./google";
import { decodeVideo, type VideoResource } from "./payload";
import type { YouTubeTransport } from "./publishing";
import { YouTubeToolError, type LiveVideo, type VideoSnapshot } from "./types";
import { updateBody } from "./write-guard";

export function createTransport(accessToken: string, fetcher: typeof fetch = fetch): YouTubeTransport {
  const refuse = () => {
    throw new YouTubeToolError("Only title and description updates are enabled.");
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
    publish: async () => refuse(),
    changeVisibility: async () => refuse(),
  };
}
