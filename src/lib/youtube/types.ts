// Shared data shapes for the YouTube metadata tool. Ported from the Badger
// Metadata macOS app (MetadataCore). Everything here is plain data so it can
// cross the server/client boundary and be stored as JSON.

export class YouTubeToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YouTubeToolError";
  }
}

export type PrivacyStatus = "private" | "unlisted" | "public";

export interface VideoStatus {
  privacyStatus: string;
  license?: string | null;
  embeddable?: boolean | null;
  publicStatsViewable?: boolean | null;
  selfDeclaredMadeForKids?: boolean | null;
  containsSyntheticMedia?: boolean | null;
  publishAt?: string | null;
  uploadStatus?: string | null;
}

export interface VideoSnapshot {
  id: string;
  title: string;
  description: string;
  tags?: string[] | null;
  categoryId: string;
  defaultLanguage?: string | null;
  defaultAudioLanguage?: string | null;
  isPublic: boolean;
  channelId?: string | null;
  isLive?: boolean | null;
  status?: VideoStatus | null;
}

export interface LiveVideo {
  snapshot: VideoSnapshot;
  etag: string;
}

export interface CatalogVideo {
  live: LiveVideo;
  publishedAt: string; // ISO instant from the video, never the playlist insertion date
  thumbnailUrl?: string | null;
}

export interface Game {
  id: string;
  date: string; // yyyy-MM-dd
  sport: string;
  opponent: string;
  recapUrl?: string | null;
}

export interface RecapSentence {
  id: string; // "<paragraph>:<sha256 prefix>"
  paragraph: number;
  text: string;
  isTimeSensitive: boolean;
}

export interface RecapDocument {
  url: string;
  fetchedAt: string;
  sha256: string;
  paragraphs: string[];
  sentences: RecapSentence[];
}

export interface YouTubePlaylist {
  id: string;
  title: string;
  channelId: string;
  privacy: string;
  itemCount: number;
}

export interface PlaylistMembership {
  id: string;
  playlistId: string;
  videoId: string;
}

export interface UploadPage {
  ids: string[];
  nextToken?: string | null;
}

export interface PlaylistPage {
  items: YouTubePlaylist[];
  nextToken?: string | null;
}

const optional = <T>(value: T | null | undefined): T | null => (value === undefined ? null : value);

function statusFieldsEqual(a: VideoStatus, b: VideoStatus): boolean {
  return (
    a.privacyStatus === b.privacyStatus &&
    optional(a.license) === optional(b.license) &&
    optional(a.embeddable) === optional(b.embeddable) &&
    optional(a.publicStatsViewable) === optional(b.publicStatsViewable) &&
    optional(a.selfDeclaredMadeForKids) === optional(b.selfDeclaredMadeForKids) &&
    optional(a.containsSyntheticMedia) === optional(b.containsSyntheticMedia) &&
    optional(a.publishAt) === optional(b.publishAt) &&
    optional(a.uploadStatus) === optional(b.uploadStatus)
  );
}

/** Strict status comparison: unlike snapshot equality, a missing status only equals a missing status. */
export function statusesEqual(a?: VideoStatus | null, b?: VideoStatus | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return statusFieldsEqual(a, b);
}

function tagsEqual(a?: string[] | null, b?: string[] | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

/**
 * Snapshot equality used by every write guard. A missing status on either
 * side is treated as "not compared" so older description-only records keep
 * their original scope.
 */
export function snapshotsEqual(a: VideoSnapshot, b: VideoSnapshot): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.description === b.description &&
    tagsEqual(a.tags, b.tags) &&
    a.categoryId === b.categoryId &&
    optional(a.defaultLanguage) === optional(b.defaultLanguage) &&
    optional(a.defaultAudioLanguage) === optional(b.defaultAudioLanguage) &&
    a.isPublic === b.isPublic &&
    optional(a.channelId) === optional(b.channelId) &&
    optional(a.isLive) === optional(b.isLive) &&
    (a.status == null || b.status == null || statusFieldsEqual(a.status, b.status))
  );
}

export function liveVideosEqual(a: LiveVideo, b: LiveVideo): boolean {
  return a.etag === b.etag && snapshotsEqual(a.snapshot, b.snapshot);
}

export function snapshot(fields: Partial<VideoSnapshot> & Pick<VideoSnapshot, "id" | "title" | "description">): VideoSnapshot {
  return { categoryId: "17", isPublic: true, ...fields };
}

export function visibilityLabel(video: VideoSnapshot): string {
  const privacy = video.status?.privacyStatus;
  if (privacy) return privacy.charAt(0).toUpperCase() + privacy.slice(1);
  return video.isPublic ? "Public" : "Nonpublic";
}
