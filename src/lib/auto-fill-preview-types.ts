import type { CandidateRecommendation, CandidateScoreSignal } from "@/lib/candidate-scoring-types";

export type AutoFillPreviewSkippedReasonCode =
  | "sport_policy_hold"
  | "sport_policy_staff_only"
  | "no_visible_candidates"
  | "no_sport_roster"
  | "no_scheduling_class_match"
  | "no_area_fit"
  | "approved_time_off_blocked"
  | "overlapping_assignment_blocked"
  | "already_proposed"
  | "no_safe_candidate";

export type AutoFillPreviewProposal = {
  shiftId: string;
  area: string;
  workerType: string;
  userId: string;
  userName: string;
  userRole: string;
  userStaffingType?: string | null;
  score: number;
  bucket: CandidateRecommendation["bucket"];
  reasons: CandidateScoreSignal[];
  warnings: CandidateScoreSignal[];
  advisoryConflict: boolean;
  advisoryConflictNote: string | null;
};

export type AutoFillPreviewSkippedSlot = {
  shiftId: string;
  area: string;
  workerType: string;
  reasonCode: AutoFillPreviewSkippedReasonCode;
  reason: string;
  reasonDetails: string[];
  candidateCount: number;
  schedulingClassMatchCount: number;
  areaFitCount: number;
  blockingCandidateCount: number;
  approvedTimeOffBlockCount: number;
  overlappingAssignmentBlockCount: number;
  alreadyProposedCount: number;
};

export type AutoFillPreviewResponse = {
  shiftGroupId: string;
  eventId: string;
  eventSummary: string;
  generatedAt: string;
  proposals: AutoFillPreviewProposal[];
  skipped: AutoFillPreviewSkippedSlot[];
  summary: {
    openSlots: number;
    proposed: number;
    skipped: number;
    warnings: number;
  };
};
