import { ShiftArea } from "@prisma/client";
import { z } from "zod";
import type { CandidateRecommendation, CandidateScoreSignal } from "@/lib/candidate-scoring-types";
import { ASSIGNMENT_PERIOD_VALUES } from "@/lib/schedule-assignment-window";
import { normalizeSportCode } from "@/lib/sports";

const isoDate = z.string().datetime({ offset: true });

/** Guardrail on the sport multi-select; the full varsity list is 23 codes. */
export const MAX_BULK_ASSIGNMENT_SPORTS = 30;

/**
 * Which scheduling classes auto assignment is allowed to fill.
 *
 * Slots are already typed `ST` (student) or `FT` (staff) and only a matching
 * worker may take one, so this narrows *which slots are touched* rather than
 * loosening who may fill them: `ST` fills student slots only and leaves staff
 * slots open, and vice versa.
 */
export const BULK_ASSIGNMENT_WORKER_SCOPES = ["ALL", "ST", "FT"] as const;
export type BulkAssignmentWorkerScope = (typeof BULK_ASSIGNMENT_WORKER_SCOPES)[number];

export const BULK_ASSIGNMENT_WORKER_SCOPE_LABELS: Record<BulkAssignmentWorkerScope, string> = {
  ALL: "Everyone",
  ST: "Students only",
  FT: "Staff only",
};

export const bulkAssignmentScopeSchema = z.object({
  /** Empty means every sport in the window, including non-sport events. */
  sportCodes: z.array(z.string().trim().min(1).max(40))
    .max(MAX_BULK_ASSIGNMENT_SPORTS)
    .default([])
    .transform((codes) => [...new Set(codes.map(normalizeSportCode))].sort()),
  rangeStartsAt: isoDate,
  rangeEndsAt: isoDate,
  area: z.nativeEnum(ShiftArea).nullable().default(null),
  workerScope: z.enum(BULK_ASSIGNMENT_WORKER_SCOPES).default("ALL"),
  /**
   * Refuse to half-crew an event: when set, an event is proposed only if every
   * open slot in scope can be filled, so applying never releases a schedule
   * that is short a position.
   */
  requireFullCrew: z.boolean().default(false),
  /** Label only -- the window itself is always the explicit range above. */
  period: z.enum(ASSIGNMENT_PERIOD_VALUES).default("custom"),
}).superRefine((scope, ctx) => {
  if (new Date(scope.rangeEndsAt) <= new Date(scope.rangeStartsAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rangeEndsAt"], message: "End date must be after start date" });
  }
});

export const bulkAssignmentProposalSchema = z.object({
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
export type BulkAssignmentScopeInput = z.input<typeof bulkAssignmentScopeSchema>;
export type BulkAssignmentProposalInput = z.infer<typeof bulkAssignmentProposalSchema>;
export type BulkAssignmentApplyInput = z.infer<typeof bulkAssignmentApplySchema>;

export type BulkAssignmentPreviewProposal = BulkAssignmentProposalInput & {
  eventSummary: string;
  eventStartsAt: string;
  eventSportCode: string | null;
  area: ShiftArea;
  workerType: "FT" | "ST";
  userName: string;
  userRole: string;
  score: number;
  bucket: CandidateRecommendation["bucket"];
  reasons: CandidateScoreSignal[];
  warnings: CandidateScoreSignal[];
  advisoryConflict: boolean;
  advisoryConflictNote: string | null;
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
    | "partial_crew_blocked"
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

/**
 * Roll proposals up by worker. Shared by the server response and the dialog, so
 * the count next to a name always matches the current event selection.
 */
export function summarizeAssignmentPeople(
  proposals: BulkAssignmentPreviewProposal[],
): BulkAssignmentPreviewPerson[] {
  const byUser = new Map<string, BulkAssignmentPreviewPerson & { eventIds: Set<string> }>();

  for (const proposal of proposals) {
    const current = byUser.get(proposal.userId) ?? {
      userId: proposal.userId,
      userName: proposal.userName,
      userRole: proposal.userRole,
      workerType: proposal.workerType,
      shiftCount: 0,
      eventCount: 0,
      areas: [],
      sportCodes: [],
      warningCount: 0,
      advisoryConflictCount: 0,
      eventIds: new Set<string>(),
    };
    current.shiftCount += 1;
    current.eventIds.add(proposal.eventId);
    if (!current.areas.includes(proposal.area)) current.areas.push(proposal.area);
    if (proposal.eventSportCode && !current.sportCodes.includes(proposal.eventSportCode)) {
      current.sportCodes.push(proposal.eventSportCode);
    }
    if (proposal.warnings.length > 0) current.warningCount += 1;
    if (proposal.advisoryConflict) current.advisoryConflictCount += 1;
    byUser.set(proposal.userId, current);
  }

  return [...byUser.values()]
    .map(({ eventIds, ...person }) => ({
      ...person,
      eventCount: eventIds.size,
      areas: [...person.areas].sort(),
      sportCodes: [...person.sportCodes].sort(),
    }))
    .sort((a, b) => b.shiftCount - a.shiftCount || a.userName.localeCompare(b.userName));
}

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
