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
import { createPublishJournal } from "./publish-journal";
import { createPreview, PublishingCoordinator, type PublishRecord } from "./publishing";
import { replayDirectory } from "./reader";
import { actorRole, conflict, editableVideo } from "./queue";
import { draftDescription, draftTitle } from "./review";
import { createTransport } from "./transport";
import { YouTubeToolError } from "./types";
import { prepareMetadata } from "./write-guard";

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
export async function publishDraft(user: AuthUser, videoId: string, version: number): Promise<PublishRecord> {
  const { item, draft, video } = await editableVideo(videoId);
  if (draft.version !== version) throw conflict();
  if (draft.hold) throw new HttpError(409, draft.hold);
  const live = item.live;
  const title = draftTitle(video, draft);
  const description = draftDescription(draft, live.snapshot);
  if (title === live.snapshot.title && description === live.snapshot.description) throw new HttpError(409, "YouTube already has this title and description.");

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
