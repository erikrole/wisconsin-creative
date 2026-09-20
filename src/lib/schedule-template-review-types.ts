import type { CandidateScoreBucket, CandidateScoreSignal } from "@/lib/candidate-scoring-types";

type ScheduleTemplateSlotCount = {
  area: string;
  workerType: string;
  expected: number;
  current: number;
};

type ScheduleTemplateMissingSlot = {
  area: string;
  workerType: string;
  count: number;
  startsAt: string;
  endsAt: string;
};

type ScheduleTemplateExtraSlot = {
  area: string;
  workerType: string;
  count: number;
};

export type ScheduleTemplateDriftPreview = {
  status: "ready" | "no_event_sport" | "no_active_template";
  message: string;
  manuallyEdited: boolean;
  expected: ScheduleTemplateSlotCount[];
  missing: ScheduleTemplateMissingSlot[];
  extra: ScheduleTemplateExtraSlot[];
};

export type CopyForwardSourceEvent = {
  id: string;
  summary: string;
  startsAt: string;
  isHome: boolean | null;
  locationId: string | null;
};

export type CopyForwardProposal = {
  shiftId: string;
  sourceShiftId: string;
  sourceAssignmentId: string;
  area: string;
  workerType: string;
  userId: string;
  userName: string;
  userRole: string;
  userStaffingType?: string | null;
  score: number | null;
  bucket: CandidateScoreBucket | null;
  reasons: CandidateScoreSignal[];
  warnings: CandidateScoreSignal[];
  advisoryConflict: boolean;
  advisoryConflictNote: string | null;
};

export type CopyForwardSkippedSlot = {
  shiftId: string;
  area: string;
  workerType: string;
  reason: string;
  sourceShiftId?: string;
  sourceAssignmentId?: string;
  userId?: string;
  userName?: string;
};

export type CopyForwardPreview = {
  sourceEvent: CopyForwardSourceEvent | null;
  proposals: CopyForwardProposal[];
  skipped: CopyForwardSkippedSlot[];
  summary: {
    openSlots: number;
    proposed: number;
    skipped: number;
    warnings: number;
  };
};

export type ScheduleTemplateReview = {
  shiftGroupId: string;
  eventId: string;
  eventSummary: string;
  generatedAt: string;
  template: ScheduleTemplateDriftPreview;
  copyForward: CopyForwardPreview;
};

export type CopyForwardApplyResult = {
  shiftGroupId: string;
  sourceEvent: CopyForwardSourceEvent | null;
  assigned: number;
  skipped: number;
  conflicts: number;
  results: Array<{
    shiftId: string;
    userId: string;
    userName: string;
    status: "assigned" | "skipped";
    reason?: string;
  }>;
};
