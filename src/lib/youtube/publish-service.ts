// Server-only: sends one reviewed title and description to YouTube. Everything
// that can go wrong is stopped by the coordinator's contract (see publishing.ts):
// the live video must still match the reviewed baseline, the intent is journaled
// before the request, the request is sent once, and the result is read back.

import { createHash } from "node:crypto";

import type { AuthUser } from "@/lib/auth";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";

import { channelAccessToken } from "./connection";
import { BADGERS_CHANNEL_ID } from "./google";
import { createPlaylistJournal } from "./playlist-journal";
import { createPublishJournal } from "./publish-journal";
import { createPreview, PlaylistCoordinator, PublishingCoordinator, type PlaylistAddition, type PublishRecord } from "./publishing";
import { replayDirectory } from "./reader";
import { actorRole, conflict, editableVideo } from "./queue";
import { draftDescription, draftTitle } from "./review";
import { createPlaylistTransport, createTransport } from "./transport";
import { YouTubeToolError, type YouTubePlaylist } from "./types";
import { prepareDescription, prepareMetadata } from "./write-guard";
import { titleProblems } from "./rules";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

async function coordinatorFor(user: AuthUser, videoId: string) {
  // A recorded replay is sample data. It must never reach a real channel.
  if (replayDirectory()) throw new HttpError(409, "This preview shows recorded YouTube data, so nothing can be sent.");
  const transport = createTransport(await channelAccessToken());
  return new PublishingCoordinator(transport, createPublishJournal(user.id), { allowedVideoIds: new Set([videoId]), channelId: BADGERS_CHANNEL_ID });
}

const failure = (error: unknown): never => {
  if (error instanceof YouTubeToolError) throw new HttpError(409, error.message);
  throw error;
};

async function adoptVerified(record: PublishRecord) {
  if (record.phase !== "verified" || !record.readBack) return;
  await db.youTubeLibraryVideo.updateMany({
    where: { videoId: record.expected.id },
    data: { live: record.readBack as unknown as object, checkedAt: new Date() },
  });
}

/** Sends the saved draft's title and description. `version` must be the draft the admin approved. */
export async function publishDraft(user: AuthUser, videoId: string, version: number, factsReviewed: boolean): Promise<PublishRecord> {
  const { item, draft, video } = await editableVideo(videoId);
  if (draft.version !== version) throw conflict();
  if (draft.hold) throw new HttpError(409, draft.hold);
  const live = item.live;
  const title = draftTitle(video, draft);
  const description = draftDescription(draft, live.snapshot);
  if (title === live.snapshot.title && description === live.snapshot.description) throw new HttpError(409, "YouTube already has this title and description.");

  if (description !== live.snapshot.description && !factsReviewed) throw new HttpError(409, "Check the description's facts against the official recap before sending.");

  const coordinator = await coordinatorFor(user, videoId);
  let record: PublishRecord;
  try {
    const expected = prepareMetadata({ baseline: live.snapshot, live: live.snapshot, title, description });
    const preview = createPreview({
      operation: "metadata",
      before: live,
      expected,
      sourceUrl: draft.recap?.url ?? `https://www.youtube.com/watch?v=${videoId}`,
      sourceSha256: draft.recap?.sha256 ?? sha256(description),
    });
    record = await coordinator.send(preview);
  } catch (error) {
    return failure(error);
  }
  await adoptVerified(record);
  await createAuditEntry({
    actorId: user.id,
    actorRole: actorRole(user),
    entityType: "YouTubeVideo",
    entityId: videoId,
    action: "PUBLISH_METADATA",
    before: { title: live.snapshot.title, descriptionLength: live.snapshot.description.length },
    after: { title, descriptionLength: description.length, recordId: record.id, phase: record.phase },
  });
  return record;
}

/** Read-only: re-reads YouTube to settle a send whose result was unclear. Never sends. */
export async function checkLastSend(user: AuthUser, videoId: string): Promise<PublishRecord> {
  const journal = createPublishJournal(user.id);
  const open = (await journal.records(videoId)).find((record) => ["pending", "uncertain", "conflict"].includes(record.phase));
  if (!open) throw new HttpError(404, "There is no send to check for this video.");
  const coordinator = await coordinatorFor(user, videoId);
  let record: PublishRecord;
  try {
    record = await coordinator.reconcile(open);
  } catch (error) {
    return failure(error);
  }
  await adoptVerified(record);
  await createAuditEntry({
    actorId: user.id,
    actorRole: actorRole(user),
    entityType: "YouTubeVideo",
    entityId: videoId,
    action: "CHECK_PUBLISH",
    after: { recordId: record.id, phase: record.phase },
  });
  return record;
}

/** Makes an unlisted or private video public, with the reviewed description. The title must already match YouTube. */
export async function makePublic(user: AuthUser, videoId: string, version: number, factsReviewed: boolean): Promise<PublishRecord> {
  const { item, draft, video } = await editableVideo(videoId);
  if (draft.version !== version) throw conflict();
  if (draft.hold) throw new HttpError(409, draft.hold);
  const live = item.live;
  if (live.snapshot.isPublic) throw new HttpError(409, "This video is already public.");
  const title = draftTitle(video, draft);
  if (title !== live.snapshot.title || titleProblems(title).length) throw new HttpError(409, "Send the title change first, then make the video public.");
  if (!factsReviewed) throw new HttpError(409, "Check the description's facts against the official recap before making the video public.");
  const description = draftDescription(draft, live.snapshot);

  const coordinator = await coordinatorFor(user, videoId);
  let record: PublishRecord;
  try {
    const expected = prepareDescription({ baseline: live.snapshot, live: live.snapshot, review: { text: description, approvedText: description, reviewedFacts: true }, makePublic: true });
    record = await coordinator.send(
      createPreview({
        operation: "launch",
        before: live,
        expected,
        sourceUrl: draft.recap?.url ?? `https://www.youtube.com/watch?v=${videoId}`,
        sourceSha256: draft.recap?.sha256 ?? sha256(description),
      }),
    );
  } catch (error) {
    return failure(error);
  }
  await adoptVerified(record);
  await createAuditEntry({
    actorId: user.id,
    actorRole: actorRole(user),
    entityType: "YouTubeVideo",
    entityId: videoId,
    action: "MAKE_PUBLIC",
    before: { privacy: live.snapshot.status?.privacyStatus ?? null },
    after: { privacy: "public", descriptionLength: description.length, recordId: record.id, phase: record.phase },
  });
  return record;
}

// ---------------------------------------------------------------- playlists

async function playlistCoordinator(user: AuthUser) {
  if (replayDirectory()) throw new HttpError(409, "This preview shows recorded YouTube data, so nothing can be sent.");
  const transport = createPlaylistTransport(await channelAccessToken());
  return new PlaylistCoordinator(transport, createPlaylistJournal(user.id), { channelId: BADGERS_CHANNEL_ID });
}

/** Remembers a verified membership so the queue shows the video as already in the playlist. */
async function rememberMember(videoId: string, playlistId: string) {
  const state = await db.youTubeLibraryState.findUnique({ where: { channelId: BADGERS_CHANNEL_ID } });
  if (!state) return;
  const members = (state.playlistMembers as Record<string, string[]> | null) ?? {};
  const current = members[playlistId] ?? [];
  if (current.includes(videoId)) return;
  await db.youTubeLibraryState.update({ where: { channelId: BADGERS_CHANNEL_ID }, data: { playlistMembers: { ...members, [playlistId]: [...current, videoId] } } });
}

/** Adds the video to each playlist chosen in the saved draft, one verified insert at a time. */
export async function addToPlannedPlaylists(user: AuthUser, videoId: string, version: number): Promise<{ added: string[] }> {
  const { item, draft, playlists } = await editableVideo(videoId);
  if (draft.version !== version) throw conflict();
  const state = await db.youTubeLibraryState.findUnique({ where: { channelId: BADGERS_CHANNEL_ID } });
  const members = (state?.playlistMembers as Record<string, string[]> | null) ?? {};
  const targets = draft.plannedPlaylistIds
    .filter((id) => !(members[id] ?? []).includes(videoId))
    .map((id) => playlists.find((playlist) => playlist.id === id))
    .filter((playlist): playlist is YouTubePlaylist => Boolean(playlist));
  if (targets.length === 0) throw new HttpError(409, "There are no new playlists to add. Choose a playlist and save the draft first.");

  const coordinator = await playlistCoordinator(user);
  const added: string[] = [];
  try {
    for (const playlist of targets) {
      await coordinator.add(item.live.snapshot, playlist, new Set([videoId]));
      await rememberMember(videoId, playlist.id);
      added.push(playlist.title);
    }
  } catch (error) {
    if (added.length > 0) await auditPlaylists(user, videoId, added);
    return failure(error);
  }
  await auditPlaylists(user, videoId, added);
  return { added };
}

const auditPlaylists = (user: AuthUser, videoId: string, added: string[]) =>
  createAuditEntry({ actorId: user.id, actorRole: actorRole(user), entityType: "YouTubeVideo", entityId: videoId, action: "ADD_TO_PLAYLISTS", after: { playlists: added } });

/** Read-only: settles playlist additions whose result was unclear. */
export async function checkPlaylistAdditions(user: AuthUser, videoId: string): Promise<PlaylistAddition[]> {
  const open = (await createPlaylistJournal(user.id).records(videoId)).filter((record) => record.phase === "pending" || record.phase === "uncertain");
  if (open.length === 0) throw new HttpError(404, "There are no playlist additions to check for this video.");
  const coordinator = await playlistCoordinator(user);
  const settled: PlaylistAddition[] = [];
  try {
    for (const record of open) {
      const updated = await coordinator.reconcile(record);
      if (updated.phase === "verified") await rememberMember(videoId, updated.playlist.id);
      settled.push(updated);
    }
  } catch (error) {
    return failure(error);
  }
  await createAuditEntry({ actorId: user.id, actorRole: actorRole(user), entityType: "YouTubeVideo", entityId: videoId, action: "CHECK_PLAYLISTS", after: { phases: settled.map((r) => r.phase) } });
  return settled;
}
