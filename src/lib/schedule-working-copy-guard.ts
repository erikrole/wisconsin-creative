import { HttpError } from "@/lib/http";

export const WORKING_COPY_MUTATION_MESSAGE =
  "This event has unpublished Schedule changes. Review or discard the private working schedule before changing live assignments.";

export const LIVE_SCHEDULE_MUTATION_RETIRED_MESSAGE =
  "Live schedule edits are retired. Open the Event and use its private working schedule editor.";

export const SCHEDULE_CLAIM_PAUSED_MESSAGE =
  "Staff are updating this crew. Try again after the changes are released. If this continues, contact staff.";

export function assertNoWorkingCopy(
  workingCopy: { version: number } | null | undefined,
  message = WORKING_COPY_MUTATION_MESSAGE,
): void {
  if (workingCopy) {
    throw new HttpError(409, message);
  }
}

export function rejectRetiredLiveScheduleMutation(): never {
  throw new HttpError(410, LIVE_SCHEDULE_MUTATION_RETIRED_MESSAGE);
}
