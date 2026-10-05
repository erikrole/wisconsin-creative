// Server-only: the database journal for playlist additions. `save` throws when
// the row cannot be stored, so no insert is dispatched without a durable record.

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import type { PlaylistAddition, PlaylistJournal } from "./publishing";
import type { PlaylistMembership, YouTubePlaylist } from "./types";

const toRecord = (row: Prisma.YouTubePlaylistAdditionGetPayload<object>): PlaylistAddition => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  videoId: row.videoId,
  videoTitle: row.videoTitle,
  playlist: row.playlist as unknown as YouTubePlaylist,
  phase: row.phase as PlaylistAddition["phase"],
  membership: (row.membership as unknown as PlaylistMembership | null) ?? null,
  failureMessage: row.failureMessage,
});

export function createPlaylistJournal(actorId: string | null): PlaylistJournal {
  return {
    async records(videoId) {
      return (await db.youTubePlaylistAddition.findMany({ where: { videoId }, orderBy: { createdAt: "desc" } })).map(toRecord);
    },
    async save(record) {
      const data = {
        videoId: record.videoId,
        videoTitle: record.videoTitle,
        playlist: record.playlist as unknown as Prisma.InputJsonValue,
        playlistId: record.playlist.id,
        phase: record.phase,
        membership: record.membership ? (record.membership as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        failureMessage: record.failureMessage,
      };
      await db.youTubePlaylistAddition.upsert({
        where: { id: record.id },
        create: { id: record.id, actorId, createdAt: new Date(record.createdAt), ...data },
        update: data,
      });
    },
  };
}
