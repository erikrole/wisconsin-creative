// Decodes YouTube Data API video resources into the tool's snapshots. Ported
// from the Mac app's YouTubePayload: incomplete or foreign-channel items are
// rejected instead of being shown with guessed values.

import { BADGERS_CHANNEL_ID } from "./google";
import { YouTubeToolError, type CatalogVideo, type LiveVideo, type VideoStatus } from "./types";

export interface VideoResource {
  id?: string;
  etag?: string;
  snippet?: {
    title?: string;
    description?: string;
    channelId?: string;
    categoryId?: string;
    tags?: string[];
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
    liveBroadcastContent?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string } | undefined>;
  };
  status?: Partial<VideoStatus> & { privacyStatus?: string };
}

const STATUS_FIELDS = ["license", "embeddable", "publicStatsViewable", "selfDeclaredMadeForKids", "containsSyntheticMedia", "publishAt", "uploadStatus"] as const;

export function decodeVideo(item: VideoResource, channelId = BADGERS_CHANNEL_ID): LiveVideo {
  const { snippet, status } = item;
  if (!item.id || !item.etag || !snippet?.categoryId || typeof snippet.title !== "string" || !status?.privacyStatus) {
    throw new YouTubeToolError("YouTube returned incomplete video metadata.");
  }
  if (snippet.channelId !== channelId) throw new YouTubeToolError("A library video belongs to another channel.");
  const videoStatus: VideoStatus = { privacyStatus: status.privacyStatus };
  for (const field of STATUS_FIELDS) {
    const value = status[field];
    if (value !== undefined) (videoStatus as unknown as Record<string, unknown>)[field] = value;
  }
  return {
    etag: item.etag,
    snapshot: {
      id: item.id,
      title: snippet.title,
      description: snippet.description ?? "",
      tags: snippet.tags ?? null,
      categoryId: snippet.categoryId,
      defaultLanguage: snippet.defaultLanguage ?? null,
      defaultAudioLanguage: snippet.defaultAudioLanguage ?? null,
      isPublic: status.privacyStatus === "public",
      channelId: snippet.channelId,
      isLive: snippet.liveBroadcastContent !== "none",
      status: videoStatus,
    },
  };
}

/** Publish dates come from the video itself, never the playlist insertion date. */
export function decodeCatalog(item: VideoResource, channelId = BADGERS_CHANNEL_ID): CatalogVideo {
  const live = decodeVideo(item, channelId);
  const published = item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : null;
  if (!published || Number.isNaN(published.getTime())) throw new YouTubeToolError("YouTube returned an invalid publication date.");
  const thumbnails = item.snippet?.thumbnails ?? {};
  const thumbnailUrl = ["medium", "high", "standard", "default"]
    .map((key) => thumbnails[key]?.url)
    .find((url): url is string => typeof url === "string" && url.startsWith("https://"));
  return { live, publishedAt: published.toISOString(), thumbnailUrl: thumbnailUrl ?? null };
}
