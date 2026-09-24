import { getWorkflowMetadata, sleep } from "workflow";
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

  // The version alone does not identify a draft: publish and discard delete
  // the working copy, and the next one starts again at version 1. The row
  // records the run that owns its timer, so a superseded run can tell.
  const { workflowRunId } = getWorkflowMetadata();
  const releaseAt = new Date(releaseAtIso);
  if (releaseAt.getTime() > Date.now()) await sleep(releaseAt);
  return releasePendingScheduleVersion(shiftGroupId, expectedVersion, batchId, workflowRunId);
}

export async function releasePendingScheduleVersion(
  shiftGroupId: string,
  expectedVersion: number,
  batchId?: string,
  /** Omitted only by direct callers; a workflow run always passes its own id. */
  runId?: string,
) {
  "use step";

  const pending = await db.shiftGroupWorkingCopy.findUnique({
    where: { shiftGroupId },
    select: {
      version: true,
      autoReleaseRunId: true,
      updatedById: true,
      updatedBy: { select: { role: true } },
      shiftGroup: { select: { event: { select: { endsAt: true } } } },
    },
  });
  const superseded = async () => {
    if (batchId) {
      await recordBulkScheduleReleaseOutcome({
        batchId,
        shiftGroupId,
        expectedVersion,
        status: "SUPERSEDED",
      });
    }
    return { status: "superseded" as const, shiftGroupId, expectedVersion };
  };
  const ownsDraft = (row: { version: number; autoReleaseRunId: string | null } | null) =>
    row !== null
    && row.version === expectedVersion
    && (runId === undefined || row.autoReleaseRunId === runId);
  if (!pending || !ownsDraft(pending)) return superseded();

  try {
    const eventHasEnded = pending.shiftGroup.event.endsAt.getTime() <= Date.now();
    const result = await publishShiftGroup(
      shiftGroupId,
      pending.updatedById,
      expectedVersion,
      pending.updatedBy.role,
      // Re-checked inside the publish transaction: the draft can be discarded
      // and recreated at the same version between the read above and here.
      ...(eventHasEnded || runId !== undefined
        ? [{
          ...(eventHasEnded ? { clearNotificationPending: true } : {}),
          ...(runId !== undefined ? { expectedAutoReleaseRunId: runId } : {}),
        }]
        : []),
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
      // A blocker on a draft this run no longer owns belongs to nobody; writing
      // it would stamp a stale error on the newer draft.
      const current = await db.shiftGroupWorkingCopy.findUnique({
        where: { shiftGroupId },
        select: { version: true, autoReleaseRunId: true },
      });
      if (!ownsDraft(current)) return superseded();
      await db.shiftGroupWorkingCopy.updateMany({
        where: {
          shiftGroupId,
          version: expectedVersion,
          ...(runId !== undefined ? { autoReleaseRunId: runId } : {}),
        },
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
