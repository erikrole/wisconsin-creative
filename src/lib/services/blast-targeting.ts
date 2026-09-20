import type { Prisma, Role, ShiftArea, ShiftWorkerType } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { GUIDE_AREA_LABELS } from "@/lib/guide-categories";
import { shiftWorkerLabel } from "@/lib/shift-display";
import { visibleActiveUserWhere } from "@/lib/user-visibility";
import { unique } from "@/lib/utils";

export const MAX_BLAST_RECIPIENTS = 500;

/**
 * Who a blast goes to. Stored verbatim on `Blast.targetSpec` so the tracking page
 * can re-resolve it later and show who joined the crew after the blast was sent.
 */
export type BlastTargetSpec =
  | { kind: "EVENT_CREW"; eventId: string }
  | { kind: "USERS"; userIds: string[] }
  | { kind: "DYNAMIC"; areas?: ShiftArea[]; workerTypes?: ShiftWorkerType[]; sportCodes?: string[] };

type BlastTargetUser = {
  id: string;
  name: string;
  role: Role;
  primaryArea: ShiftArea | null;
  staffingType: ShiftWorkerType;
};

type ResolvedBlastTarget = {
  userIds: string[];
  /** Frozen at send time onto `Blast.targetSummary`. */
  summary: string;
  users: BlastTargetUser[];
  /** Denormalized onto `Blast.eventId` for tracking joins. */
  eventId: string | null;
};

const TARGET_USER_SELECT = {
  id: true,
  name: true,
  role: true,
  primaryArea: true,
  staffingType: true,
} satisfies Prisma.UserSelect;

/**
 * Dynamic-group matching: AND across dimensions, OR within one.
 * "VIDEO + PHOTO students" means (video OR photo) AND student.
 *
 * Area membership deliberately checks both `primaryArea` and `StudentAreaAssignment` --
 * staff carry the former and students the latter, so testing only one silently drops
 * half the roster from every area-targeted blast.
 *
 * Exported separately from `resolveBlastTargets` so the where-clause shape can be
 * unit-tested without a database.
 */
export function buildDynamicTargetWhere(spec: {
  areas?: ShiftArea[];
  workerTypes?: ShiftWorkerType[];
  sportCodes?: string[];
}): Prisma.UserWhereInput {
  const clauses: Prisma.UserWhereInput[] = [];
  if (spec.areas?.length) {
    clauses.push({
      OR: [
        { primaryArea: { in: spec.areas } },
        { areaAssignments: { some: { area: { in: spec.areas } } } },
      ],
    });
  }
  if (spec.workerTypes?.length) {
    clauses.push({ staffingType: { in: spec.workerTypes } });
  }
  if (spec.sportCodes?.length) {
    clauses.push({ sportAssignments: { some: { sportCode: { in: spec.sportCodes } } } });
  }
  return clauses.length > 0 ? { AND: clauses } : {};
}

export function describeDynamicTarget(spec: {
  areas?: ShiftArea[];
  workerTypes?: ShiftWorkerType[];
  sportCodes?: string[];
}): string {
  const parts: string[] = [];
  if (spec.areas?.length) parts.push(spec.areas.map((a) => GUIDE_AREA_LABELS[a] ?? a).join(" + "));
  if (spec.workerTypes?.length) parts.push(spec.workerTypes.map(shiftWorkerLabel).join(" + "));
  if (spec.sportCodes?.length) parts.push(spec.sportCodes.join(", "));
  return parts.join(" · ");
}

/**
 * Turns a target spec into the set of people who will actually receive the blast.
 *
 * Every branch ends at the same `visibleActiveUserWhere` gate -- inactive accounts,
 * roster-hidden accounts, and COLLABORATORs are excluded in exactly one place. Do not
 * add a branch that returns ids without passing through it.
 */
export async function resolveBlastTargets(spec: BlastTargetSpec): Promise<ResolvedBlastTarget> {
  // Explicit-id branches narrow by id; DYNAMIC narrows by a where clause instead.
  let idFilter: Prisma.UserWhereInput = {};
  let where: Prisma.UserWhereInput = {};
  let summary: string;
  let eventId: string | null = null;

  switch (spec.kind) {
    case "EVENT_CREW": {
      const event = await db.calendarEvent.findUnique({
        where: { id: spec.eventId },
        select: { id: true, summary: true, shiftGroup: { select: { publishedAt: true } } },
      });
      if (!event) throw new HttpError(404, "Event not found");
      // Only published crews. Blasting a draft assignment tells someone they are
      // scheduled before the schedule exists.
      if (!event.shiftGroup?.publishedAt) {
        throw new HttpError(400, "That event's schedule has not been published yet.");
      }
      idFilter = {
        shiftAssignments: {
          some: {
            status: { in: ACTIVE_ASSIGNMENT_STATUSES },
            shift: {
              shiftGroup: {
                eventId: spec.eventId,
                publishedAt: { not: null },
              },
            },
          },
        },
      };
      summary = `${event.summary} crew`;
      eventId = event.id;
      break;
    }
    case "USERS": {
      const ids = unique(spec.userIds);
      idFilter = { id: { in: ids } };
      summary = `${ids.length} selected ${ids.length === 1 ? "person" : "people"}`;
      break;
    }
    case "DYNAMIC": {
      const described = describeDynamicTarget(spec);
      if (!described) {
        // An empty dynamic spec silently means "everyone", which is out of scope.
        throw new HttpError(400, "Pick at least one area, worker type, or sport.");
      }
      summary = described;
      where = buildDynamicTargetWhere(spec);
      break;
    }
  }

  const users = await db.user.findMany({
    where: visibleActiveUserWhere({
      ...where,
      ...idFilter,
      role: { in: ["ADMIN", "STAFF", "STUDENT"] },
    }),
    select: TARGET_USER_SELECT,
    orderBy: { name: "asc" },
    take: MAX_BLAST_RECIPIENTS + 1,
  });

  return { userIds: users.map((u) => u.id), summary, users, eventId };
}
