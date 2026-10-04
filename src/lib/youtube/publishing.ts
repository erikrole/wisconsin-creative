// Write coordinators. Both follow the same contract:
//   1. re-read the live video and refuse if it differs from the reviewed baseline,
//   2. durably record the intent before any write is dispatched,
//   3. send exactly once (never retried automatically),
//   4. verify by read-back; an unclear result is recorded as uncertain and
//      blocks further writes to that video until it is reconciled read-only.
// Transports and journals are injected so tests use fakes and production uses
// the YouTube API and the database.

import { randomUUID } from "node:crypto";

import {
  prepareDescription,
  prepareMetadata,
  prepareRollback,
  prepareVisibility,
} from "./write-guard";
import {
  liveVideosEqual,
  snapshotsEqual,
  statusesEqual,
  YouTubeToolError,
  type LiveVideo,
  type PlaylistMembership,
  type PlaylistPage,
  type UploadPage,
  type VideoSnapshot,
  type YouTubePlaylist,
} from "./types";

export interface YouTubeTransport {
  read(id: string): Promise<LiveVideo>;
  update(video: VideoSnapshot, ifMatch: string): Promise<void>;
  publish(video: VideoSnapshot, ifMatch: string): Promise<void>;
  changeVisibility(video: VideoSnapshot, ifMatch: string): Promise<void>;
}

export type PublishPhase = "pending" | "verified" | "uncertain" | "conflict" | "notApplied";
export type PublishOperation = "send" | "launch" | "visibility" | "metadata" | "undo";

export interface PublishPreview {
  id: string;
  createdAt: string;
  operation: PublishOperation;
  undoOf: string | null;
  before: LiveVideo;
  expected: VideoSnapshot;
  sourceUrl: string;
  sourceSha256: string;
}

export interface PublishRecord extends PublishPreview {
  phase: PublishPhase;
  verifiedAt: string | null;
  readBack: LiveVideo | null;
  failureMessage: string | null;
}

export interface PublishJournal {
  /** Records for one video, newest first. */
  records(videoId: string): Promise<PublishRecord[]>;
  record(id: string): Promise<PublishRecord | null>;
  /** Must throw (and nothing may be written) when the record cannot be stored durably. */
  save(record: PublishRecord): Promise<void>;
}

export const PREVIEW_TTL_MS = 5 * 60_000;
const OPEN_PHASES: PublishPhase[] = ["pending", "uncertain", "conflict"];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPreview(fields: Omit<PublishPreview, "id" | "createdAt" | "undoOf" | "operation"> & Partial<Pick<PublishPreview, "operation" | "undoOf">>): PublishPreview {
  return { id: randomUUID(), createdAt: new Date().toISOString(), operation: "send", undoOf: null, ...fields };
}

export class PublishingCoordinator {
  constructor(
    private readonly transport: YouTubeTransport,
    private readonly journal: PublishJournal,
    private readonly options: {
      allowedVideoIds: Set<string>;
      channelId: string;
      waitForPropagation?: () => Promise<void>;
      now?: () => Date;
    },
  ) {}

  private wait() {
    return (this.options.waitForPropagation ?? (() => sleep(1500)))();
  }

  async send(preview: PublishPreview): Promise<PublishRecord> {
    await this.validate(preview);
    const history = await this.journal.records(preview.expected.id);
    if (history.some((record) => record.id === preview.id)) {
      throw new YouTubeToolError("This send was already attempted. Check its result instead of sending it again.");
    }
    if (history.some((record) => OPEN_PHASES.includes(record.phase))) {
      throw new YouTubeToolError("A previous send needs verification. Check its result before sending another change.");
    }
    const live = await this.transport.read(preview.expected.id);
    if (!liveVideosEqual(live, preview.before)) {
      throw new YouTubeToolError("YouTube changed after the preview. Close this preview and check the current version again.");
    }
    if (snapshotsEqual(live.snapshot, preview.expected)) throw new YouTubeToolError("YouTube already has this change. No update is needed.");

    const record: PublishRecord = { ...preview, phase: "pending", verifiedAt: null, readBack: null, failureMessage: null };
    await this.journal.save(record); // Must succeed before any write request is dispatched.
    try {
      if (preview.operation === "visibility") await this.transport.changeVisibility(preview.expected, live.etag);
      else if (preview.operation === "launch") await this.transport.publish(preview.expected, live.etag);
      else await this.transport.update(preview.expected, live.etag);

      let readBack = await this.transport.read(preview.expected.id);
      record.readBack = readBack;
      // YouTube can briefly return the previous revision after accepting a
      // write. Recheck only that exact old snapshot; never repeat the write.
      for (let attempt = 0; attempt < 3 && snapshotsEqual(readBack.snapshot, preview.before.snapshot); attempt += 1) {
        await this.wait();
        readBack = await this.transport.read(preview.expected.id);
        record.readBack = readBack;
      }
      if (!snapshotsEqual(readBack.snapshot, preview.expected)) {
        const stillPrevious = snapshotsEqual(readBack.snapshot, preview.before.snapshot);
        record.phase = stillPrevious ? "uncertain" : "conflict";
        record.failureMessage = stillPrevious
          ? "YouTube accepted the update but is still returning the previous version. Its final result is not yet verified."
          : "YouTube returned metadata that differs from both the previous version and the approved change. Newer edits may be present.";
        await this.journal.save(record);
        throw new YouTubeToolError(record.failureMessage);
      }
      record.phase = "verified";
      record.verifiedAt = new Date().toISOString();
      await this.journal.save(record);
      return record;
    } catch (error) {
      if (record.phase === "pending" || record.phase === "verified") {
        record.phase = "uncertain";
        record.failureMessage = error instanceof Error ? error.message : String(error);
        await this.journal.save(record).catch(() => undefined);
      }
      throw new YouTubeToolError(`${record.failureMessage} No second update was sent. Use Check last send to verify the result.`);
    }
  }

  /** Read-only: classify an open record by reading the live video. Never writes to YouTube. */
  async reconcile(record: PublishRecord): Promise<PublishRecord> {
    const live = await this.transport.read(record.expected.id);
    const updated: PublishRecord = { ...record, readBack: live };
    if (snapshotsEqual(live.snapshot, record.expected)) {
      Object.assign(updated, { phase: "verified", verifiedAt: new Date().toISOString(), failureMessage: null });
    } else if (snapshotsEqual(live.snapshot, record.before.snapshot)) {
      Object.assign(updated, { phase: "notApplied", verifiedAt: null, failureMessage: null });
    } else {
      Object.assign(updated, { phase: "conflict", verifiedAt: null });
    }
    await this.journal.save(updated);
    return updated;
  }

  private async validate(preview: PublishPreview): Promise<void> {
    const before = preview.before.snapshot;
    const after = preview.expected;
    const { allowedVideoIds, channelId } = this.options;
    const op = preview.operation;
    if (
      !allowedVideoIds.has(after.id) ||
      before.id !== after.id ||
      before.channelId !== channelId ||
      after.channelId !== channelId ||
      !(before.isPublic || op === "launch" || op === "visibility" || op === "metadata") ||
      !(after.isPublic || op === "visibility" || op === "metadata") ||
      before.isLive !== false ||
      after.isLive !== false
    ) {
      throw new YouTubeToolError("This video is outside the approved editing scope.");
    }
    const now = (this.options.now ?? (() => new Date()))();
    if (now.getTime() - new Date(preview.createdAt).getTime() >= PREVIEW_TTL_MS) {
      throw new YouTubeToolError("This preview expired. Check the live version again.");
    }
    const review = { text: after.description, approvedText: after.description, reviewedFacts: true };
    if (op === "metadata") {
      const prepared = prepareMetadata({ baseline: before, live: before, title: after.title, description: after.description });
      if (!snapshotsEqual(prepared, after) || !statusesEqual(before.status, after.status)) throw new YouTubeToolError("Only the reviewed title and description may change.");
    } else if (op === "visibility") {
      const target = after.status?.privacyStatus;
      const prepared = target ? prepareVisibility({ baseline: before, live: before, target }) : null;
      if (!prepared || !snapshotsEqual(prepared, after) || !statusesEqual(prepared.status, after.status)) {
        throw new YouTubeToolError("Only the reviewed visibility setting may change.");
      }
    } else if (op === "send" || op === "launch") {
      const prepared = prepareDescription({ baseline: before, live: before, review, makePublic: op === "launch" });
      if (!snapshotsEqual(prepared, after) || (op === "launch" && !statusesEqual(prepared.status, after.status))) {
        throw new YouTubeToolError("Only the reviewed description may change.");
      }
    } else {
      const original = preview.undoOf ? await this.journal.record(preview.undoOf) : null;
      if (
        !original ||
        original.operation !== "send" ||
        original.phase !== "verified" ||
        !snapshotsEqual(prepareRollback({ before: original.before.snapshot, written: original.expected, live: before }), after)
      ) {
        throw new YouTubeToolError("This rollback does not match a verified send.");
      }
    }
  }
}


// ---------------------------------------------------------------- pagination

export interface LibraryTransport {
  uploadPage(token: string | null): Promise<UploadPage>;
}

/** Collects every page, failing on a repeated token or when the page budget runs out. */
async function collectPages<T>(
  load: (token: string | null) => Promise<{ items: T[]; nextToken?: string | null }>,
  maxPages: number,
  messages: { repeated: string; tooLarge: string | null },
): Promise<{ items: T[]; reachedLimit: boolean }> {
  const items: T[] = [];
  const seen = new Set<string>();
  let token: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await load(token);
    items.push(...result.items);
    const next = result.nextToken;
    if (!next) return { items, reachedLimit: false };
    if (seen.has(next)) throw new YouTubeToolError(messages.repeated);
    seen.add(next);
    token = next;
  }
  if (messages.tooLarge) throw new YouTubeToolError(messages.tooLarge);
  return { items, reachedLimit: true };
}

/** Bounded upload window (default 6 pages of 50). Returns ids newest first, deduplicated. */
export async function loadUploadIds(transport: LibraryTransport, maxPages = 6): Promise<{ ids: string[]; reachedLimit: boolean }> {
  const result = await collectPages(async (token) => {
    const page = await transport.uploadPage(token);
    return { items: page.ids, nextToken: page.nextToken };
  }, maxPages, { repeated: "YouTube repeated a library page. The previous library was kept.", tooLarge: null });
  return { ids: [...new Set(result.items)], reachedLimit: result.reachedLimit };
}

export interface PlaylistTransport extends Pick<YouTubeTransport, "read"> {
  playlistPage(token: string | null): Promise<PlaylistPage>;
  readPlaylist(id: string): Promise<YouTubePlaylist>;
  playlistVideoPage(playlistId: string, token: string | null): Promise<UploadPage>;
  membership(videoId: string, playlistId: string): Promise<PlaylistMembership | null>;
  insert(videoId: string, playlistId: string): Promise<PlaylistMembership>;
}

export async function loadPlaylists(transport: PlaylistTransport, channelId: string, maxPages = 100): Promise<YouTubePlaylist[]> {
  const { items } = await collectPages((token) => transport.playlistPage(token), maxPages, {
    repeated: "YouTube repeated a playlist page. Refresh to try again.",
    tooLarge: "The playlist library is too large to finish loading. No partial list was used.",
  });
  const byId = new Map<string, YouTubePlaylist>();
  for (const item of items) {
    if (item.channelId !== channelId) throw new YouTubeToolError("A playlist belongs to a different channel. Reconnect YouTube.");
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title, "en", { numeric: true }));
}

export async function loadPlaylistVideoIds(transport: PlaylistTransport, playlistId: string, maxPages = 100): Promise<Set<string>> {
  const { items } = await collectPages(async (token) => {
    const page = await transport.playlistVideoPage(playlistId, token);
    return { items: page.ids, nextToken: page.nextToken };
  }, maxPages, {
    repeated: "YouTube repeated a playlist page. Refresh to try again.",
    tooLarge: "This playlist exceeds 5,000 entries. Its filter could not be loaded completely.",
  });
  return new Set(items);
}

// ---------------------------------------------------------------- playlist additions

export type PlaylistAdditionPhase = "pending" | "verified" | "uncertain" | "notApplied";

export interface PlaylistAddition {
  id: string;
  createdAt: string;
  videoId: string;
  videoTitle: string;
  playlist: YouTubePlaylist;
  phase: PlaylistAdditionPhase;
  membership: PlaylistMembership | null;
  failureMessage: string | null;
}

export interface PlaylistJournal {
  records(videoId: string): Promise<PlaylistAddition[]>;
  save(record: PlaylistAddition): Promise<void>;
}

const editableForPlaylist = (video: VideoSnapshot, channelId: string) =>
  video.channelId === channelId &&
  (video.isPublic || video.status?.uploadStatus === "processed") &&
  video.status?.publishAt == null &&
  video.isLive === false;

export class PlaylistCoordinator {
  constructor(
    private readonly transport: PlaylistTransport,
    private readonly journal: PlaylistJournal,
    private readonly options: { channelId: string; waitForPropagation?: () => Promise<void> },
  ) {}

  private wait() {
    return (this.options.waitForPropagation ?? (() => sleep(1500)))();
  }

  /** Returns the existing membership without inserting if another editor already added it. */
  async add(video: VideoSnapshot, playlist: YouTubePlaylist, allowedVideoIds: Set<string>): Promise<PlaylistMembership> {
    const { channelId } = this.options;
    if (!allowedVideoIds.has(video.id) || !editableForPlaylist(video, channelId) || playlist.channelId !== channelId) {
      throw new YouTubeToolError("This video or playlist is outside the connected channel's editing scope.");
    }
    const history = await this.journal.records(video.id);
    if (history.some((record) => record.playlist.id === playlist.id && (record.phase === "pending" || record.phase === "uncertain"))) {
      throw new YouTubeToolError("Check the previous playlist addition before trying this destination again.");
    }
    const live = await this.transport.read(video.id);
    if (live.snapshot.id !== video.id || live.snapshot.title !== video.title || !editableForPlaylist(live.snapshot, channelId)) {
      throw new YouTubeToolError("The video changed on YouTube. Refresh the library and try again.");
    }
    const destination = await this.transport.readPlaylist(playlist.id);
    if (destination.id !== playlist.id || destination.channelId !== channelId || destination.title !== playlist.title || destination.privacy !== playlist.privacy) {
      throw new YouTubeToolError("The destination playlist changed. Load it again.");
    }
    const existing = await this.transport.membership(video.id, playlist.id);
    if (existing) return validated(existing, video.id, playlist.id);

    const record: PlaylistAddition = {
      id: randomUUID(), createdAt: new Date().toISOString(), videoId: video.id, videoTitle: video.title,
      playlist: destination, phase: "pending", membership: null, failureMessage: null,
    };
    await this.journal.save(record);
    try {
      record.membership = validated(await this.transport.insert(video.id, playlist.id), video.id, playlist.id);
      const verified = await this.check(video.id, playlist.id);
      if (!verified) throw new YouTubeToolError("YouTube accepted the addition but its membership is not visible yet.");
      record.membership = verified;
      record.phase = "verified";
      await this.journal.save(record);
      return verified;
    } catch (error) {
      record.phase = "uncertain";
      record.failureMessage = error instanceof Error ? error.message : String(error);
      await this.journal.save(record).catch(() => undefined);
      throw new YouTubeToolError(`${record.failureMessage} No second addition was sent. Use Check last additions to verify it.`);
    }
  }

  async reconcile(record: PlaylistAddition): Promise<PlaylistAddition> {
    if (record.playlist.channelId !== this.options.channelId) throw new YouTubeToolError("Playlist recovery is unavailable right now.");
    const playlist = await this.transport.readPlaylist(record.playlist.id);
    if (playlist.id !== record.playlist.id || playlist.channelId !== this.options.channelId) {
      throw new YouTubeToolError("YouTube returned a different playlist or channel.");
    }
    const membership = await this.check(record.videoId, record.playlist.id);
    const updated: PlaylistAddition = { ...record, membership, phase: membership ? "verified" : "notApplied", failureMessage: null };
    await this.journal.save(updated);
    return updated;
  }

  private async check(videoId: string, playlistId: string): Promise<PlaylistMembership | null> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await this.wait();
      const member = await this.transport.membership(videoId, playlistId);
      if (member) return validated(member, videoId, playlistId);
    }
    return null;
  }
}

function validated(member: PlaylistMembership, videoId: string, playlistId: string): PlaylistMembership {
  if (!member.id || member.videoId !== videoId || member.playlistId !== playlistId) {
    throw new YouTubeToolError("YouTube returned a playlist entry for a different video or destination.");
  }
  return member;
}
