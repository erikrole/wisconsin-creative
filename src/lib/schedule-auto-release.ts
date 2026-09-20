import { start } from "workflow/api";
import { HttpError } from "@/lib/http";
import { pendingScheduleReleaseWorkflow } from "@/workflows/pending-schedule-release";

export const SCHEDULE_RELEASE_DELAY_MS = 10 * 60_000;

type PendingScheduleRelease = {
  at: Date;
  runId: string;
};

/**
 * Enqueue before committing the corresponding pending version. An orphaned
 * run is harmless because it can release only the exact version it names;
 * committing a version without a run would leave staff changes hidden.
 */
export async function enqueuePendingScheduleRelease(args: {
  shiftGroupId: string;
  version: number;
  now?: Date;
  batchId?: string;
}): Promise<PendingScheduleRelease> {
  const at = new Date((args.now ?? new Date()).getTime() + SCHEDULE_RELEASE_DELAY_MS);
  try {
    const workflowArgs: [string, number, string] | [string, number, string, string] = [
      args.shiftGroupId,
      args.version,
      at.toISOString(),
    ];
    if (args.batchId) workflowArgs.push(args.batchId);
    const run = await start(pendingScheduleReleaseWorkflow, workflowArgs);
    return { at, runId: run.runId };
  } catch (error) {
    console.error("[Schedule] failed to enqueue pending release", {
      shiftGroupId: args.shiftGroupId,
      version: args.version,
      error,
    });
    throw new HttpError(503, "Your change was not saved because the automatic release timer could not start. Try again.");
  }
}
