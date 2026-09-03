import { AREA_LABELS } from "@/types/areas";
import { formatAppDateTime, formatAppWindow } from "@/lib/app-time";
import {
  reportableWindow,
  type ScheduleWorkerChange,
  type WorkerShiftFacts,
} from "@/lib/services/schedule-notification-diff";

/**
 * Areas reach workers as words, never as the enum.
 *
 * The rest of the app has read through `AREA_LABELS` for a long time; only the
 * notification layer still interpolated the raw value, which is how
 * LIVE_PRODUCTION ended up on people's lock screens.
 */
export function areaLabel(area: string): string {
  return AREA_LABELS[area] ?? area;
}

export type ScheduleChangeCopy = {
  /** Reuses the existing notification types so stored rows and iOS keep working. */
  type: string;
  title: string;
  body: string;
};

function windowPhrase(facts: WorkerShiftFacts): string {
  const window = reportableWindow(facts);
  return formatAppWindow(window.startsAt, window.endsAt);
}

function hasCallWindow(facts: WorkerShiftFacts): boolean {
  return facts.workerType === "ST"
    && facts.callStartsAt !== null
    && facts.callEndsAt !== null;
}

function scheduleTiming(facts: WorkerShiftFacts): string {
  if (hasCallWindow(facts)) return ` Call ${windowPhrase(facts)}.`;
  // Staff still need the operational shift window. It is not a Student call
  // time, so keep it in the existing notification without labeling it "Call".
  if (facts.workerType === "FT") return ` Shift ${windowPhrase(facts)}.`;
  return "";
}

function withNote(body: string, facts: WorkerShiftFacts): string {
  return hasCallWindow(facts) && facts.callNote ? `${body} ${facts.callNote}` : body;
}

/**
 * One worker-facing line for one change.
 *
 * The title is the event, not the kind of change: on a lock screen the event is
 * what lets someone tell this message apart from the four others they got this
 * week, and the body has room to say what actually happened.
 */
export function scheduleChangeCopy(args: {
  eventTitle: string;
  change: ScheduleWorkerChange;
  /** Additional changes folded into the same message, if any. */
  alsoCount?: number;
}): ScheduleChangeCopy {
  const { eventTitle, change } = args;
  const also = args.alsoCount && args.alsoCount > 0
    ? ` +${args.alsoCount} more change${args.alsoCount === 1 ? "" : "s"}.`
    : "";

  switch (change.kind) {
    case "added": {
      const area = areaLabel(change.after.area);
      const timing = scheduleTiming(change.after);
      return {
        type: "shift_assigned",
        title: eventTitle,
        body: withNote(`You're on ${area}.${timing}`, change.after) + also,
      };
    }
    case "removed": {
      const area = areaLabel(change.before.area);
      const when = formatAppDateTime(reportableWindow(change.before).startsAt);
      return {
        type: "shift_assignment_removed",
        title: eventTitle,
        body: `You're off ${area}, ${when}. Nothing else changed for you.` + also,
      };
    }
    case "reassigned": {
      const from = areaLabel(change.before.area);
      const to = areaLabel(change.after.area);
      const lead = change.areaChanged
        ? `Moved from ${from} to ${to}.`
        : "Your slot changed.";
      const timing = scheduleTiming(change.after);
      return {
        type: "shift_assigned",
        title: eventTitle,
        body: withNote(`${lead}${timing}`, change.after) + also,
      };
    }
    case "updated": {
      if (!hasCallWindow(change.after)) {
        return {
          type: "shift_time_changed",
          title: eventTitle,
          body: change.after.workerType === "FT"
            ? `${areaLabel(change.after.area)} shift is now ${windowPhrase(change.after)}.` + also
            : `${areaLabel(change.after.area)} schedule updated.` + also,
        };
      }
      if (!change.windowChanged && change.noteChanged) {
        return {
          type: "shift_time_changed",
          title: eventTitle,
          body: `${areaLabel(change.after.area)} note: ${change.after.callNote ?? "cleared"}` + also,
        };
      }
      const before = windowPhrase(change.before);
      const after = windowPhrase(change.after);
      return {
        type: "shift_time_changed",
        title: eventTitle,
        body: withNote(`Call time moved to ${after}, was ${before}.`, change.after) + also,
      };
    }
  }
}
