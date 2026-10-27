import { ShiftArea } from "@/lib/client-enums";
import { z } from "zod";
import type { CandidateRecommendation, CandidateScoreSignal } from "@/lib/candidate-scoring-types";
import { ASSIGNMENT_PERIOD_VALUES } from "@/lib/schedule-assignment-window";
import { normalizeSportCode } from "@/lib/sports";
import { unique } from "@/lib/utils";
import {
  BULK_ASSIGNMENT_WORKER_SCOPES,
  MAX_BULK_ASSIGNMENT_SPORTS,
} from "@/lib/bulk-schedule-assignment-shared";

// The browser imports these from the shared file so it doesn't also load zod.
export {
  BULK_ASSIGNMENT_WORKER_SCOPES,
  BULK_ASSIGNMENT_WORKER_SCOPE_LABELS,
  MAX_BULK_ASSIGNMENT_SPORTS,
  summarizeAssignmentPeople,
  type BulkAssignmentWorkerScope,
} from "@/lib/bulk-schedule-assignment-shared";

const isoDate = z.string().datetime({ offset: true });

export const bulkAssignmentScopeSchema = z.object({
  /** Empty means every sport in the window, including non-sport events. */
  sportCodes: z.array(z.string().trim().min(1).max(40))
    .max(MAX_BULK_ASSIGNMENT_SPORTS)
    .default([])
    .transform((codes) => unique(codes.map(normalizeSportCode)).sort()),
  rangeStartsAt: isoDate,
  rangeEndsAt: isoDate,
  area: z.nativeEnum(ShiftArea).nullable().default(null),
  workerScope: z.enum(BULK_ASSIGNMENT_WORKER_SCOPES).default("ALL"),
  /**
   * Narrow to specific events (Event detail's Auto assign). Empty means every
   * event in the window. The window and sport filters still apply.
   */
  eventIds: z.array(z.string().trim().min(1).max(64))
    .max(50)
    .default([])
    .transform((ids) => unique(ids).sort()),
  /** Label only -- the window itself is always the explicit range above. */
  period: z.enum(ASSIGNMENT_PERIOD_VALUES).default("custom"),
}).superRefine((scope, ctx) => {
  if (new Date(scope.rangeEndsAt) <= new Date(scope.rangeStartsAt)) {
    ctx.addIssue({ code: "custom", path: ["rangeEndsAt"], message: "End date must be after start date" });
  }
});

const bulkAssignmentProposalSchema = z.object({
  proposalId: z.string().min(1).max(240),
  shiftGroupId: z.string().min(1),
  shiftId: z.string().min(1),
  eventId: z.string().min(1),
  userId: z.string().min(1),
});

export const bulkAssignmentApplySchema = z.object({
  scope: bulkAssignmentScopeSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  proposals: z.array(bulkAssignmentProposalSchema).min(1).max(500),
});

export type BulkAssignmentScope = z.infer<typeof bulkAssignmentScopeSchema>;
type BulkAssignmentProposalInput = z.infer<typeof bulkAssignmentProposalSchema>;
export type BulkAssignmentApplyInput = z.infer<typeof bulkAssignmentApplySchema>;

/** One person for a slot: the proposed pick, or a runner-up staff can swap in. */
export type BulkAssignmentPerson = {
  userId: string;
  userName: string;
  userRole: string;
  score: number;
  bucket: CandidateRecommendation["bucket"];
  reasons: CandidateScoreSignal[];
  warnings: CandidateScoreSignal[];
  advisoryConflict: boolean;
  advisoryConflictNote: string | null;
};

export type BulkAssignmentPreviewProposal = BulkAssignmentProposalInput & BulkAssignmentPerson & {
  eventSummary: string;
  eventStartsAt: string;
  eventSportCode: string | null;
  area: ShiftArea;
  workerType: "FT" | "ST";
  /** The next best eligible people for this slot, best first. */
  alternatives: BulkAssignmentPerson[];
};

export type BulkAssignmentPreviewSkipped = {
  shiftId: string | null;
  area: ShiftArea | null;
  workerType: "FT" | "ST" | null;
  reasonCode:
    | "no_shift_group"
    | "sport_policy_hold"
    | "pending_working_copy"
    | "no_open_slots"
    | "no_visible_candidates"
    | "no_sport_roster"
    | "no_travel_roster"
    | "no_scheduling_class_match"
    | "no_area_fit"
    | "approved_time_off_blocked"
    | "overlapping_assignment_blocked"
    | "already_proposed"
    | "no_safe_candidate";
  reason: string;
  reasonDetails: string[];
};

export type BulkAssignmentPreviewEvent = {
  shiftGroupId: string | null;
  eventId: string;
  summary: string;
  startsAt: string;
  sportCode: string | null;
  workingVersion: number | null;
  publishedVersion: number | null;
  status: "ready" | "skipped";
  proposals: BulkAssignmentPreviewProposal[];
  skipped: BulkAssignmentPreviewSkipped[];
  openSlots: number;
  /** Open slots in scope this run cannot fill. Zero means a full crew. */
  unfilledSlots: number;
  fullyCrewed: boolean;
};

/**
 * One worker's share of a proposed batch: the "who is getting added, and to how
 * many shifts" answer staff want before they apply anything.
 */
export type BulkAssignmentPreviewPerson = {
  userId: string;
  userName: string;
  userRole: string;
  workerType: "FT" | "ST";
  shiftCount: number;
  eventCount: number;
  areas: ShiftArea[];
  sportCodes: string[];
  warningCount: number;
  advisoryConflictCount: number;
};

export type BulkAssignmentPreviewResponse = {
  generatedAt: string;
  scope: BulkAssignmentScope;
  fingerprint: string;
  events: BulkAssignmentPreviewEvent[];
  people: BulkAssignmentPreviewPerson[];
  summary: {
    eventsMatched: number;
    eventsReady: number;
    openSlots: number;
    proposed: number;
    skipped: number;
    warnings: number;
    peopleAffected: number;
    /** Events this run leaves fully crewed. */
    eventsFullyCrewed: number;
    /** Events this run fills only partway -- the half-crewed risk, counted. */
    eventsPartiallyCrewed: number;
    /** Events skipped because staff have unreleased changes pending on them. */
    eventsPendingChanges: number;
    /** Events skipped because their sport is held back from auto assignment. */
    eventsOnHold: number;
  };
};
