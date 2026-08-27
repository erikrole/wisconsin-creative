import { sleep } from "workflow";
import { badges } from "@/lib/badges";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import {
  createPublishedShiftGroupNotifications,
  notifyPublishedScheduleFollowers,
  notifyPublishedShiftGroupWorkers,
} from "@/lib/services/notifications";
import { recordBulkScheduleReleaseOutcome } from "@/lib/services/bulk-schedule-assignment";
import { publishShiftGroup } from "@/lib/services/schedule-publication";

export async function pendingScheduleReleaseWorkflow(
  shiftGroupId: string,
  expectedVersion: number,
  releaseAtIso: string,
  batchId?: string,
) {
  "use workflow";

  const releaseAt = new Date(releaseAtIso);
  if (releaseAt.getTime() > Date.now()) await sleep(releaseAt);
  return releasePendingScheduleVersion(shiftGroupId, expectedVersion, batchId);
}

export async function releasePendingScheduleVersion(
  shiftGroupId: string,
  expectedVersion: number,
  batchId?: string,
) {
  "use step";

  const pending = await db.shiftGroupWorkingCopy.findUnique({
    where: { shiftGroupId },
    select: {
      version: true,
      updatedById: true,
      updatedBy: { select: { role: true } },
      shiftGroup: { select: { event: { select: { endsAt: true } } } },
    },
  });
  if (!pending || pending.version !== expectedVersion) {
    if (batchId) {
      await recordBulkScheduleReleaseOutcome({
        batchId,
        shiftGroupId,
        expectedVersion,
        status: "SUPERSEDED",
      });
    }
    return { status: "superseded" as const, shiftGroupId, expectedVersion };
  }

  try {
    const eventHasEnded = pending.shiftGroup.event.endsAt.getTime() <= Date.now();
    const result = await publishShiftGroup(
      shiftGroupId,
      pending.updatedById,
      expectedVersion,
      pending.updatedBy.role,
      ...(eventHasEnded ? [{ clearNotificationPending: true }] : []),
    );

    if (eventHasEnded) {
      // A queued future release can wake after the event ends. Publication is
      // still useful for correcting the relational schedule, but the
      // backfill contract is completely silent for every recipient channel.
      await Promise.allSettled(
        result.affectedUserIds.map((userId) => badges.onShiftsWorked({ userId }, { notify: false })),
      );
      if (batchId) {
        await recordBulkScheduleReleaseOutcome({
          batchId,
          shiftGroupId,
          expectedVersion,
          status: "RELEASED",
          releasedVersion: result.workingVersion ?? expectedVersion,
        });
      }
    } else if (batchId) {
      if (result.publishedSnapshotChanged) {
        await Promise.allSettled([notifyPublishedScheduleFollowers(shiftGroupId)]);
      }
      await recordBulkScheduleReleaseOutcome({
        batchId,
        shiftGroupId,
        expectedVersion,
        status: "RELEASED",
        releasedVersion: result.workingVersion ?? expectedVersion,
      });
    } else if (!result.before.publishedAt) {
      await createPublishedShiftGroupNotifications(shiftGroupId);
    } else if (result.publishedSnapshotChanged) {
      await Promise.allSettled([
        notifyPublishedShiftGroupWorkers(shiftGroupId, result.affectedUserIds),
        notifyPublishedScheduleFollowers(shiftGroupId),
      ]);
    }

    return {
      status: "released" as const,
      shiftGroupId,
      releasedVersion: result.after,
    };
  } catch (error) {
    if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
      await db.shiftGroupWorkingCopy.updateMany({
        where: { shiftGroupId, version: expectedVersion },
        data: { autoReleaseError: error.message },
      });
      if (batchId) {
        await recordBulkScheduleReleaseOutcome({
          batchId,
          shiftGroupId,
          expectedVersion,
          status: "BLOCKED",
          error: error.message,
        });
      }
      return {
        status: "blocked" as const,
        shiftGroupId,
        expectedVersion,
        error: error.message,
      };
    }
    throw error;
  }
}
