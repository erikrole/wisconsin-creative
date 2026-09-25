import { start } from "workflow/api";
import { SHIFT_REMINDER_LEAD_MS } from "@/lib/services/notifications";
import { shiftReminderWorkflow } from "@/workflows/shift-reminder";

/**
 * Starts the two-hour reminder for an assignment's current call time.
 * Best-effort: a missing reminder costs a heads-up, never the assignment.
 * Skipped when the reminder time has already passed; the assignment
 * notification the worker just got covers a shift that close.
 */
export async function enqueueShiftReminder(args: {
  assignmentId: string;
  callStartsAt: Date;
  now?: Date;
}): Promise<string | null> {
  const now = args.now ?? new Date();
  if (args.callStartsAt.getTime() - SHIFT_REMINDER_LEAD_MS <= now.getTime()) return null;
  try {
    const run = await start(shiftReminderWorkflow, [args.assignmentId, args.callStartsAt.toISOString()]);
    return run.runId;
  } catch (error) {
    console.error("[Schedule] failed to enqueue shift reminder", { assignmentId: args.assignmentId, error });
    return null;
  }
}
