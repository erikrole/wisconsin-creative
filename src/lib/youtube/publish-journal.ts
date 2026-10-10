// Server-only: the database journal for the publishing coordinator. `save`
// throws when the row cannot be stored, which is what stops a write from being
// dispatched without a durable record.

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import type { PublishJournal, PublishRecord } from "./publishing";
import type { LiveVideo, VideoSnapshot } from "./types";

type Row = Prisma.YouTubePublishRecordGetPayload<object>;

const toRecord = (row: Row): PublishRecord => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  operation: row.operation as PublishRecord["operation"],
  undoOf: row.undoOf,
  before: row.before as unknown as LiveVideo,
  expected: row.expected as unknown as VideoSnapshot,
  sourceUrl: row.sourceUrl,
  sourceSha256: row.sourceSha256,
  phase: row.phase as PublishRecord["phase"],
  verifiedAt: row.verifiedAt?.toISOString() ?? null,
  readBack: (row.readBack as unknown as LiveVideo | null) ?? null,
  failureMessage: row.failureMessage,
});

export function createPublishJournal(actorId: string | null): PublishJournal {
  return {
    async records(videoId) {
      return (await db.youTubePublishRecord.findMany({ where: { videoId }, orderBy: { createdAt: "desc" } })).map(toRecord);
    },
    async record(id) {
      const row = await db.youTubePublishRecord.findUnique({ where: { id } });
      return row ? toRecord(row) : null;
    },
    async save(record) {
      const data = {
        videoId: record.expected.id,
        operation: record.operation,
        undoOf: record.undoOf,
        phase: record.phase,
        before: record.before as unknown as Prisma.InputJsonValue,
        expected: record.expected as unknown as Prisma.InputJsonValue,
        readBack: record.readBack ? (record.readBack as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        sourceUrl: record.sourceUrl,
        sourceSha256: record.sourceSha256,
        failureMessage: record.failureMessage,
        verifiedAt: record.verifiedAt ? new Date(record.verifiedAt) : null,
      };
      await db.youTubePublishRecord.upsert({
        where: { id: record.id },
        create: { id: record.id, actorId, createdAt: new Date(record.createdAt), ...data },
        update: data,
      });
    },
  };
}
