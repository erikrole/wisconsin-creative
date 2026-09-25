import { sleep } from "workflow";
import { getShiftReminderTiming, sendShiftReminder } from "@/lib/services/notifications";
import { recordJobRun } from "@/lib/services/job-runs";

/**
 * One reminder per assignment and call time, two hours ahead. The run is keyed
 * to the call time it was started for: if the shift moves, the move starts a
 * new run and this one finds itself superseded and does nothing.
 */
export async function shiftReminderWorkflow(assignmentId: string, expectedCallStartsAtIso: string) {
  "use workflow";

  const timing = await getShiftReminderTimingStep(assignmentId, expectedCallStartsAtIso);
  if (timing.status !== "scheduled") return timing.status;

  const remindAt = new Date(timing.remindAt);
  if (remindAt.getTime() > Date.now()) await sleep(remindAt);

  return sendShiftReminderStep(assignmentId, expectedCallStartsAtIso, timing.remindAt);
}

async function getShiftReminderTimingStep(assignmentId: string, expectedCallStartsAtIso: string) {
  "use step";
  return getShiftReminderTiming({ assignmentId, expectedCallStartsAt: new Date(expectedCallStartsAtIso) });
}

async function sendShiftReminderStep(assignmentId: string, expectedCallStartsAtIso: string, remindAtIso: string) {
  "use step";
  const dueAt = new Date(remindAtIso);
  try {
    const result = await sendShiftReminder({ assignmentId, expectedCallStartsAt: new Date(expectedCallStartsAtIso) });
    await recordJobRun({ job: "shift_reminder", outcome: result === "sent" ? "succeeded" : "skipped", dueAt, detail: result });
    return result;
  } catch (error) {
    await recordJobRun({ job: "shift_reminder", outcome: "failed", dueAt });
    throw error;
  }
}
