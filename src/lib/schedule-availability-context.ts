import type { CandidateRecommendation } from "@/lib/candidate-scoring-types";
import {
  evaluateAvailabilityPreferences,
  type AvailabilityBlockLike,
  type AvailabilityWindow,
} from "@/lib/student-availability";

type ScheduleAvailabilityContext = {
  state: "blocked" | "advisory" | "preferred";
  label: string;
  detail: string;
  blocking: boolean;
};

function contextFromNote(args: {
  state: ScheduleAvailabilityContext["state"];
  label: string;
  detail?: string | null;
}): ScheduleAvailabilityContext | null {
  const detail = args.detail?.trim();
  if (!detail) return null;
  return {
    state: args.state,
    label: args.label,
    detail,
    blocking: args.state === "blocked",
  };
}

export function availabilityContextFromCandidate(recommendation: CandidateRecommendation | null): ScheduleAvailabilityContext | null {
  if (!recommendation) return null;

  const approvedTimeOff = recommendation.warnings.find((warning) => warning.code === "approved_time_off");
  if (approvedTimeOff) {
    return contextFromNote({
      state: "blocked",
      label: "Approved time off",
      detail: approvedTimeOff.label,
    });
  }

  const advisory = recommendation.warnings.find((warning) =>
    warning.code === "availability_conflict" || warning.code === "pending_time_off"
  );
  if (advisory) {
    return contextFromNote({
      state: "advisory",
      label: advisory.code === "pending_time_off" ? "Pending time off" : "Availability warning",
      detail: advisory.label,
    });
  }

  const preferred = recommendation.reasons.find((reason) => reason.code === "preferred_window");
  if (preferred) {
    return contextFromNote({
      state: "preferred",
      label: "Preferred window",
      detail: preferred.label,
    });
  }

  return null;
}

export function availabilityContextFromBlocks(
  blocks: AvailabilityBlockLike[],
  window: AvailabilityWindow,
): ScheduleAvailabilityContext | null {
  const evaluation = evaluateAvailabilityPreferences(blocks, window);
  if (evaluation.blocking) {
    return contextFromNote({
      state: "blocked",
      label: "Approved time off",
      detail: evaluation.blocking.note,
    });
  }
  if (evaluation.advisory) {
    return contextFromNote({
      state: "advisory",
      label: evaluation.advisory.intent === "TIME_OFF" ? "Pending time off" : "Availability warning",
      detail: evaluation.advisory.note,
    });
  }
  if (evaluation.preferred) {
    return contextFromNote({
      state: "preferred",
      label: "Preferred window",
      detail: evaluation.preferred.note,
    });
  }
  return null;
}
