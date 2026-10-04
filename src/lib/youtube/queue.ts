// Server-only: the /youtube review queue. Refresh reads the channel and the
// official UWBadgers sources and stores the library and prepared drafts;
// the page renders from the database. Refresh only reads; sending a reviewed
// title and description lives in publish-service.ts.

import { Prisma } from "@prisma/client";

import type { AuthUser } from "@/lib/auth";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";

import { BADGERS_CHANNEL_ID } from "./google";
import { loadPlaylists, loadPlaylistVideoIds } from "./publishing";
import { importLibrary, libraryNow, openReader } from "./reader";
import {
  chooseGame,
  draftDescription,
  draftTitle,
  playlistSuggestions,
  prepareDraft,
  reviewChecks,
  reviewReason,
  reviewStatus,
  reviewVideo,
  suggestedTitle,
  type ReviewCheck,
  type ReviewDraft,
  type ReviewStatus,
  type ReviewVideo,
} from "./review";
import { CONFERENCE_COACHES, DESCRIPTION_MAX, TITLE_MAX } from "./rules";
import { createScheduleSource } from "./uwbadgers";
import { YouTubeToolError, type CatalogVideo, type Game, type LiveVideo, type RecapDocument, type YouTubePlaylist } from "./types";

export const actorRole = (user: AuthUser) => user.preview?.actualRole ?? user.role;

/** Refresh stops preparing new videos after this long so the request stays inside the function budget. */
export const PREPARE_BUDGET_MS = 40_000;
/** Playlist membership checks stop here; an incomplete check is reported, never shown as "not in a playlist". */
const MEMBERSHIP_BUDGET_MS = 50_000;
const RECAP_CONCURRENCY = 4;

type DraftRow = Prisma.YouTubeReviewDraftGetPayload<object>;
type LibraryRow = Prisma.YouTubeLibraryVideoGetPayload<object>;

export function draftFromRow(row: DraftRow): ReviewDraft {
  return {
    videoId: row.videoId,
    version: row.version,
    matchedTitle: row.matchedTitle,
    matchedGame: (row.matchedGame as Game | null) ?? null,
    recap: (row.recap as RecapDocument | null) ?? null,
    selectedSentenceIds: row.selectedSentenceIds,
    editedTitle: row.editedTitle,
    editedDescription: row.editedDescription,
    manualSource: row.manualSource,
    manualVideo: row.manualVideo,
    conferenceKind: row.conferenceKind === "Weekly" || row.conferenceKind === "Postgame" ? row.conferenceKind : null,
    speakerIds: row.speakerIds,
    plannedPlaylistIds: row.plannedPlaylistIds,
    matchKind: (row.matchKind as ReviewDraft["matchKind"]) ?? null,
    gameChoices: (row.gameChoices as Game[] | null) ?? [],
    hold: row.hold,
    preparedAt: row.preparedAt?.toISOString() ?? null,
  };
}

const json = (value: unknown) => (value == null ? Prisma.DbNull : (value as Prisma.InputJsonValue));

/** Columns that preparation owns. Manual edits (title, description, speakers, playlists) are never touched. */
function preparedColumns(draft: ReviewDraft) {
  return {
    matchedTitle: draft.matchedTitle,
    matchedGame: json(draft.matchedGame),
    recap: json(draft.recap),
    selectedSentenceIds: draft.selectedSentenceIds,
    manualSource: draft.manualSource,
    manualVideo: draft.manualVideo,
    matchKind: draft.matchKind,
    gameChoices: json(draft.gameChoices),
    hold: draft.hold,
    preparedAt: draft.preparedAt ? new Date(draft.preparedAt) : null,
  };
}

const catalogFromRow = (row: LibraryRow): CatalogVideo => ({
  live: row.live as unknown as LiveVideo,
  publishedAt: row.publishedAt.toISOString(),
  thumbnailUrl: row.thumbnailUrl,
});

async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]!);
      }
    }),
  );
  return results;
}

/**
 * Saves a prepared draft unless someone edited it meanwhile; their edit wins
 * and the next refresh prepares it again.
 */
async function storePrepared(draft: ReviewDraft, expectedVersion: number | null, userId: string | null): Promise<boolean> {
  if (expectedVersion === null) {
    try {
      await db.youTubeReviewDraft.create({ data: { videoId: draft.videoId, ...preparedColumns(draft), updatedById: userId } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  }
  const { count } = await db.youTubeReviewDraft.updateMany({
    where: { videoId: draft.videoId, version: expectedVersion },
    data: { ...preparedColumns(draft), version: { increment: 1 }, updatedById: userId },
  });
  return count === 1;
}

export interface RefreshSummary {
  videos: number;
  prepared: number;
  held: number;
  skipped: number;
  reachedLimit: boolean;
  playlistFailure: string | null;
  replay: boolean;
}

/** Reads the channel and official sources, then stores the library, playlists and prepared drafts. */
export async function refreshLibrary(user: AuthUser): Promise<RefreshSummary> {
  const started = Date.now();
  const reader = await openReader();
  const now = reader.now();

  let library: Awaited<ReturnType<typeof importLibrary>>;
  try {
    library = await importLibrary(reader);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.youTubeLibraryState.upsert({
      where: { channelId: BADGERS_CHANNEL_ID },
      create: { channelId: BADGERS_CHANNEL_ID, lastFailure: message },
      update: { lastFailure: message },
    });
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, `${message} The saved library was kept.`);
  }

  const checkedAt = new Date();
  const ids = library.videos.map((video) => video.live.snapshot.id);
  await db.$transaction([
    db.youTubeLibraryVideo.deleteMany({ where: { videoId: { notIn: ids } } }),
    ...library.videos.map((video) => {
      const data = {
        live: video.live as unknown as Prisma.InputJsonValue,
        publishedAt: new Date(video.publishedAt),
        thumbnailUrl: video.thumbnailUrl ?? null,
        checkedAt,
      };
      return db.youTubeLibraryVideo.upsert({ where: { videoId: video.live.snapshot.id }, create: { videoId: video.live.snapshot.id, ...data }, update: data });
    }),
  ]);

  let playlists: YouTubePlaylist[] = [];
  let playlistFailure: string | null = null;
  try {
    playlists = await loadPlaylists(reader, BADGERS_CHANNEL_ID);
  } catch (error) {
    playlistFailure = error instanceof Error ? error.message : String(error);
  }

  const existing = new Map(
    (await db.youTubeReviewDraft.findMany({ where: { videoId: { in: ids } } })).map((row) => [row.videoId, draftFromRow(row)]),
  );
  const sources = createScheduleSource();
  const queue = library.videos
    .map((item) => ({ item, video: reviewVideo(item, existing.get(item.live.snapshot.id) ?? null, now) }))
    .filter(({ video }) => !video.protectedReason);

  let prepared = 0, held = 0, skipped = 0;
  await mapLimit(queue, RECAP_CONCURRENCY, async ({ video }) => {
    if (Date.now() - started > PREPARE_BUDGET_MS) {
      skipped += 1;
      return;
    }
    const current = existing.get(video.id) ?? null;
    const draft = await prepareDraft(video, current, sources, now);
    if (await storePrepared(draft, current?.version ?? null, user.id)) {
      if (draft.hold) held += 1;
      else prepared += 1;
    }
  });

  // Memberships only for playlists suggested to a queued video: a full channel scan costs too much quota.
  const members: Record<string, string[]> = {};
  if (!playlistFailure) {
    const suggested = new Map<string, YouTubePlaylist>();
    for (const { video } of queue) for (const playlist of playlistSuggestions(video, playlists)) suggested.set(playlist.id, playlist);
    try {
      await mapLimit([...suggested.values()], 3, async (playlist) => {
        if (Date.now() - started > MEMBERSHIP_BUDGET_MS) throw new YouTubeToolError("Playlist checks ran out of time. Refresh again to finish them.");
        members[playlist.id] = [...(await loadPlaylistVideoIds(reader, playlist.id))];
      });
    } catch (error) {
      playlistFailure = error instanceof Error ? error.message : String(error);
    }
  }

  const stateData = {
    checkedAt,
    reachedLimit: library.reachedLimit,
    lastFailure: null,
    playlists: playlists as unknown as Prisma.InputJsonValue,
    playlistMembers: members,
    playlistFailure,
  };
  await db.youTubeLibraryState.upsert({ where: { channelId: BADGERS_CHANNEL_ID }, create: { channelId: BADGERS_CHANNEL_ID, ...stateData }, update: stateData });

  const summary: RefreshSummary = { videos: library.videos.length, prepared, held, skipped, reachedLimit: library.reachedLimit, playlistFailure, replay: reader.replay };
  await createAuditEntry({
    actorId: user.id,
    actorRole: actorRole(user),
    entityType: "YouTubeLibrary",
    entityId: BADGERS_CHANNEL_ID,
    action: "REFRESH",
    after: { ...summary },
  });
  return summary;
}

// ---------------------------------------------------------------- queue

export interface QueueItem {
  id: string;
  video: ReviewVideo;
  publishedAt: string;
  thumbnailUrl: string | null;
  live: { title: string; description: string; privacyStatus: string; isPublic: boolean };
  draft: ReviewDraft | null;
  status: ReviewStatus;
  reason: string;
  checks: ReviewCheck[];
  suggestedTitle: string;
  title: string;
  description: string;
  existingPlaylists: YouTubePlaylist[];
  suggestedPlaylists: YouTubePlaylist[];
  /** The newest send for this video, or null when none was attempted. */
  publish: PublishSummary | null;
  /** Why playlist additions are blocked (an unverified earlier attempt), or null. */
  playlistOpen: string | null;
}

export interface PublishSummary {
  id: string;
  phase: "pending" | "verified" | "uncertain" | "conflict" | "notApplied";
  message: string | null;
  at: string;
}

export interface Queue {
  checkedAt: string | null;
  reachedLimit: boolean;
  lastFailure: string | null;
  playlistFailure: string | null;
  playlists: YouTubePlaylist[];
  items: QueueItem[];
}

export function evaluate(
  item: CatalogVideo,
  draft: ReviewDraft | null,
  now: Date,
  playlists: YouTubePlaylist[],
  members: Record<string, string[]>,
  playlistsChecked: boolean,
): QueueItem {
  const snapshot = item.live.snapshot;
  const video = reviewVideo(item, draft, now);
  const suggested = playlistSuggestions(video, playlists);
  const existingPlaylists = playlists.filter((playlist) => members[playlist.id]?.includes(video.id));
  const checks = reviewChecks(video, draft, snapshot, { existing: existingPlaylists, checked: playlistsChecked && suggested.every((p) => members[p.id]) });
  return {
    id: video.id,
    video,
    publishedAt: item.publishedAt,
    thumbnailUrl: item.thumbnailUrl ?? null,
    live: { title: snapshot.title, description: snapshot.description, privacyStatus: snapshot.status?.privacyStatus ?? (snapshot.isPublic ? "public" : "private"), isPublic: snapshot.isPublic },
    draft,
    status: reviewStatus(video, draft, snapshot, checks),
    reason: reviewReason(video, draft, checks),
    checks,
    suggestedTitle: suggestedTitle(video, draft),
    title: draftTitle(video, draft),
    description: draftDescription(draft, snapshot),
    existingPlaylists,
    suggestedPlaylists: suggested,
    publish: null,
    playlistOpen: null,
  };
}

export async function loadQueue(): Promise<Queue> {
  const [state, rows] = await Promise.all([
    db.youTubeLibraryState.findUnique({ where: { channelId: BADGERS_CHANNEL_ID } }),
    db.youTubeLibraryVideo.findMany({ orderBy: { publishedAt: "desc" } }),
  ]);
  const drafts = new Map(
    (await db.youTubeReviewDraft.findMany({ where: { videoId: { in: rows.map((row) => row.videoId) } } })).map((row) => [row.videoId, draftFromRow(row)]),
  );
  const latestSend = new Map<string, PublishSummary>();
  for (const row of await db.youTubePublishRecord.findMany({ where: { videoId: { in: rows.map((row) => row.videoId) } }, orderBy: { createdAt: "desc" } })) {
    if (!latestSend.has(row.videoId)) {
      latestSend.set(row.videoId, { id: row.id, phase: row.phase as PublishSummary["phase"], message: row.failureMessage, at: (row.verifiedAt ?? row.updatedAt).toISOString() });
    }
  }
  const playlistOpen = new Map<string, string>();
  for (const row of await db.youTubePlaylistAddition.findMany({
    where: { videoId: { in: rows.map((row) => row.videoId) }, phase: { in: ["pending", "uncertain"] } },
    orderBy: { createdAt: "desc" },
  })) {
    if (!playlistOpen.has(row.videoId)) playlistOpen.set(row.videoId, row.failureMessage ?? "A playlist addition has not been verified yet.");
  }
  const playlists = (state?.playlists as YouTubePlaylist[] | undefined) ?? [];
  const members = (state?.playlistMembers as Record<string, string[]> | undefined) ?? {};
  const now = libraryNow();
  const checked = Boolean(state?.checkedAt) && !state?.playlistFailure;
  return {
    checkedAt: state?.checkedAt?.toISOString() ?? null,
    reachedLimit: state?.reachedLimit ?? false,
    lastFailure: state?.lastFailure ?? null,
    playlistFailure: state?.playlistFailure ?? null,
    playlists,
    items: rows.map((row) => ({
      ...evaluate(catalogFromRow(row), drafts.get(row.videoId) ?? null, now, playlists, members, checked),
      publish: latestSend.get(row.videoId) ?? null,
      playlistOpen: playlistOpen.get(row.videoId) ?? null,
    })),
  };
}

// ---------------------------------------------------------------- draft edits

export interface DraftEdit {
  version: number;
  editedTitle?: string | null;
  editedDescription?: string | null;
  selectedSentenceIds?: string[];
  conferenceKind?: "Weekly" | "Postgame" | null;
  speakerIds?: string[];
  plannedPlaylistIds?: string[];
}

export async function editableVideo(videoId: string) {
  const [row, draftRow, state] = await Promise.all([
    db.youTubeLibraryVideo.findUnique({ where: { videoId } }),
    db.youTubeReviewDraft.findUnique({ where: { videoId } }),
    db.youTubeLibraryState.findUnique({ where: { channelId: BADGERS_CHANNEL_ID } }),
  ]);
  if (!row) throw new HttpError(404, "This video is not in the recent library. Refresh the library.");
  const item = catalogFromRow(row);
  const draft = draftRow ? draftFromRow(draftRow) : null;
  const video = reviewVideo(item, draft, libraryNow());
  if (video.protectedReason) throw new HttpError(409, video.protectedReason);
  if (!draft) throw new HttpError(409, "Refresh the library to prepare this video before editing it.");
  return { item, draft, video, playlists: (state?.playlists as YouTubePlaylist[] | undefined) ?? [] };
}

const auditDraft = (draft: ReviewDraft) => ({
  editedTitle: draft.editedTitle,
  editedDescriptionLength: draft.editedDescription?.length ?? null,
  selectedSentences: draft.selectedSentenceIds.length,
  matchedGameId: draft.matchedGame?.id ?? null,
  conferenceKind: draft.conferenceKind,
  speakerIds: draft.speakerIds,
  plannedPlaylistIds: draft.plannedPlaylistIds,
});

export function conflict(): HttpError {
  return new HttpError(409, "This draft changed since you opened it. Reload to see the current version.");
}

async function saveVersioned(user: AuthUser, before: ReviewDraft, data: Prisma.YouTubeReviewDraftUpdateManyMutationInput, action: string): Promise<ReviewDraft> {
  const { count } = await db.youTubeReviewDraft.updateMany({
    where: { videoId: before.videoId, version: before.version },
    data: { ...data, version: { increment: 1 }, updatedById: user.id },
  });
  if (count !== 1) throw conflict();
  const after = draftFromRow((await db.youTubeReviewDraft.findUnique({ where: { videoId: before.videoId } }))!);
  await createAuditEntry({
    actorId: user.id,
    actorRole: actorRole(user),
    entityType: "YouTubeReviewDraft",
    entityId: before.videoId,
    action,
    before: auditDraft(before),
    after: auditDraft(after),
  });
  return after;
}

/** Saves manual review choices. Every value is checked against the video's own source and the channel's playlists. */
export async function saveDraft(user: AuthUser, videoId: string, edit: DraftEdit): Promise<ReviewDraft> {
  const { draft, playlists } = await editableVideo(videoId);
  if (draft.version !== edit.version) throw conflict();
  const data: Prisma.YouTubeReviewDraftUpdateManyMutationInput = {};
  if (edit.editedTitle !== undefined) {
    if (edit.editedTitle !== null && edit.editedTitle.length > TITLE_MAX * 2) throw new HttpError(400, "The title is far longer than YouTube allows.");
    data.editedTitle = edit.editedTitle;
  }
  if (edit.editedDescription !== undefined) {
    if (edit.editedDescription !== null && edit.editedDescription.length > DESCRIPTION_MAX * 2) throw new HttpError(400, "The description is far longer than YouTube allows.");
    data.editedDescription = edit.editedDescription;
  }
  if (edit.selectedSentenceIds !== undefined) {
    const allowed = new Set((draft.recap?.sentences ?? []).filter((sentence) => !sentence.isTimeSensitive).map((sentence) => sentence.id));
    if (!edit.selectedSentenceIds.every((id) => allowed.has(id))) throw new HttpError(400, "A selected sentence is not part of this video's recap.");
    data.selectedSentenceIds = [...new Set(edit.selectedSentenceIds)];
  }
  if (edit.conferenceKind !== undefined) data.conferenceKind = edit.conferenceKind;
  if (edit.speakerIds !== undefined) {
    const coaches = new Set(CONFERENCE_COACHES.map((coach) => coach.id));
    if (!edit.speakerIds.every((id) => coaches.has(id))) throw new HttpError(400, "Unknown speaker.");
    data.speakerIds = [...new Set(edit.speakerIds)];
  }
  if (edit.plannedPlaylistIds !== undefined) {
    const known = new Set(playlists.map((playlist) => playlist.id));
    if (!edit.plannedPlaylistIds.every((id) => known.has(id))) throw new HttpError(400, "A chosen playlist is not on the channel. Refresh the library.");
    data.plannedPlaylistIds = [...new Set(edit.plannedPlaylistIds)];
  }
  if (Object.keys(data).length === 0) return draft;
  return saveVersioned(user, draft, data, "UPDATE_DRAFT");
}

function sourceError(error: unknown): never {
  if (error instanceof YouTubeToolError) throw new HttpError(502, error.message);
  throw error;
}

/** Confirms one of the official games offered for the video. */
export async function chooseDraftGame(user: AuthUser, videoId: string, version: number, gameId: string): Promise<ReviewDraft> {
  const { draft, video } = await editableVideo(videoId);
  if (draft.version !== version) throw conflict();
  if (!draft.gameChoices.some((game) => game.id === gameId)) throw new HttpError(400, "That game is not one of the official choices for this video.");
  const chosen = await chooseGame(video, draft, gameId, createScheduleSource()).catch(sourceError);
  return saveVersioned(user, draft, preparedColumns(chosen), "CHOOSE_GAME");
}

/** Matches one video to its official source again, keeping manual edits. */
export async function prepareOne(user: AuthUser, videoId: string, version: number): Promise<ReviewDraft> {
  const { draft, item } = await editableVideo(videoId);
  if (draft.version !== version) throw conflict();
  const now = libraryNow();
  const prepared = await prepareDraft(reviewVideo(item, draft, now), draft, createScheduleSource(), now);
  return saveVersioned(user, draft, preparedColumns(prepared), "PREPARE_DRAFT");
}
