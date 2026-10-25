// The Trade Board read model, with viewer claimability and review deadlines.

import { Prisma, ShiftTradeStatus, type ShiftArea } from "@prisma/client";
import { db } from "@/lib/db";
import { availabilityContextFromBlocks } from "@/lib/schedule-availability-context";
import { claimReviewDeadlines } from "@/lib/claim-review-deadlines";
import {
  claimableShiftAreas,
  shiftClaimEligibilityReason,
  type ShiftClaimProfile,
} from "@/lib/shift-claim-eligibility";
import {
  effectiveAssignmentWindow,
  futureEffectiveAssignmentWhere,
  liveTradeEventWhere,
  availabilityBlockSelect,
} from "./shift-trades-shared";

const tradeListInclude = {
  shiftAssignment: {
    include: {
      shift: {
        include: {
          shiftGroup: {
            include: {
              event: {
                select: {
                  id: true,
                  summary: true,
                  startsAt: true,
                  endsAt: true,
                  allDay: true,
                  sportCode: true,
                  opponent: true,
                  isHome: true,
                  site: true,
                },
              },
            },
          },
        },
      },
      user: { select: { id: true, name: true, primaryArea: true } },
    },
  },
  postedBy: { select: { id: true, name: true } },
  claimedBy: { select: { id: true, name: true } },
} satisfies Prisma.ShiftTradeInclude;

/**
 * List trades, optionally filtered by status and area.
 */
export async function listTrades(filters: {
  status?: ShiftTradeStatus;
  area?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}) {
  const where: Prisma.ShiftTradeWhereInput = {};
  const and: Prisma.ShiftTradeWhereInput[] = [];
  const viewerRows = filters.userId
    ? await db.user.findMany({
      where: { id: { in: [filters.userId] } },
      select: {
        id: true,
        role: true,
        staffingType: true,
        active: true,
        primaryArea: true,
        availabilityBlocks: { select: availabilityBlockSelect },
      },
    })
    : [];
  const viewer = viewerRows[0] ?? null;
  if (filters.status) where.status = filters.status;
  if (filters.area) {
    and.push({ shiftAssignment: { shift: { area: filters.area as ShiftArea } } });
  }
  const actionableStatuses: ShiftTradeStatus[] = ["OPEN", "CLAIMED"];
  const now = new Date();
  // Resolved history stays visible; only a post someone could still act on
  // must be on a future shift of a live event.
  if (filters.status && actionableStatuses.includes(filters.status)) {
    and.push({ shiftAssignment: futureEffectiveAssignmentWhere(now) });
    and.push(liveTradeEventWhere);
  } else if (!filters.status) {
    and.push({
      OR: [
        { status: { notIn: actionableStatuses } },
        { AND: [{ shiftAssignment: futureEffectiveAssignmentWhere(now) }, liveTradeEventWhere] },
      ],
    });
  }
  if (filters.userId && viewer?.role === "STUDENT") {
    and.push({
      OR: [
        { status: { not: "OPEN" } },
        { postedByUserId: filters.userId },
        {
          shiftAssignment: {
            shift: { area: { in: claimableShiftAreas(viewer.primaryArea) } },
          },
        },
      ],
    });
  }
  if (and.length > 0) where.AND = and;

  const include = tradeListInclude;
  // Actionable before resolved, then newest first. `ShiftTradeStatus` is
  // declared OPEN, CLAIMED, APPROVED, COMPLETED, CANCELLED, so ascending
  // status puts everything someone still owes a decision on ahead of history.
  // Without it an unfiltered page is pure recency, and COMPLETED/CANCELLED
  // rows accumulate forever — a season in, a claim waiting on Admin falls off
  // the end of the window and out of the review queue entirely. `id` is the
  // tiebreaker so offset paging (native "load more") cannot repeat or skip a
  // row when two trades share a timestamp.
  const orderBy: Prisma.ShiftTradeOrderByWithRelationInput[] = [
    { status: "asc" },
    { postedAt: "desc" },
    { id: "asc" },
  ];
  const data = viewer?.role === "ADMIN" && !filters.status
    ? await findClaimedFirstPage(where, include, orderBy, filters.limit, filters.offset)
    : await db.shiftTrade.findMany({
      where,
      take: filters.limit,
      skip: filters.offset,
      include,
      orderBy,
    });
  const total = await db.shiftTrade.count({ where });
  // Another student's availability — a time-off reason, a standing note — is
  // for the people deciding the claim, not the rest of the board.
  const canSeeClaimerAvailability = viewer?.role === "ADMIN" || viewer?.role === "STAFF";
  const availabilityUserIds = new Set<string>();
  for (const trade of canSeeClaimerAvailability ? data : []) {
    if (trade.status === "CLAIMED" && trade.claimedByUserId) {
      availabilityUserIds.add(trade.claimedByUserId);
    }
  }
  const relatedAvailabilityUsers = availabilityUserIds.size > 0
    ? await db.user.findMany({
      where: { id: { in: [...availabilityUserIds] } },
      select: {
        id: true,
        role: true,
        staffingType: true,
        active: true,
        primaryArea: true,
        availabilityBlocks: { select: availabilityBlockSelect },
      },
    })
    : [];
  const availabilityUsers = [...viewerRows, ...relatedAvailabilityUsers];
  const usersById = new Map(availabilityUsers.map((user) => [user.id, user]));
  const viewerBlocks = viewer?.availabilityBlocks ?? [];

  return {
    data: data.map((trade) => {
      const window = effectiveAssignmentWindow(trade.shiftAssignment);
      const reviewDeadlines = trade.status === "CLAIMED"
        ? claimReviewDeadlines(window.startsAt, trade.claimedAt ?? now)
        : null;
      const viewerAvailabilityContext = filters.userId && trade.postedByUserId !== filters.userId
        ? availabilityContextFromBlocks(viewerBlocks, window)
        : null;
      const claimedByAvailabilityContext = canSeeClaimerAvailability && trade.claimedByUserId
        ? availabilityContextFromBlocks(usersById.get(trade.claimedByUserId)?.availabilityBlocks ?? [], window)
        : null;
      const viewerEligibilityReason = viewer
        ? shiftClaimEligibilityReason(viewer as ShiftClaimProfile, trade.shiftAssignment.shift)
        : null;
      let viewerCanClaim = false;
      let viewerClaimReason: string | null = null;
      if (trade.status === "CLAIMED") {
        // "Not open" is true but useless here. Whoever is looking is either the
        // person waiting on the decision or the person who has to make it.
        viewerClaimReason = trade.claimedByUserId === filters.userId
          ? "Waiting for an admin to approve your claim"
          : trade.postedByUserId === filters.userId
            ? `${trade.claimedBy?.name ?? "Someone"} claimed this — waiting for Admin approval`
            : "Claimed and waiting for Admin approval";
      } else if (trade.status !== "OPEN") {
        viewerClaimReason = "This trade is not open";
      } else if (!filters.userId || !viewer) {
        viewerClaimReason = "Your scheduling profile is unavailable";
      } else if (trade.postedByUserId === filters.userId) {
        viewerClaimReason = "You posted this trade";
      } else if (viewerEligibilityReason) {
        viewerClaimReason = viewerEligibilityReason;
      } else if (viewerAvailabilityContext?.blocking) {
        viewerClaimReason = viewerAvailabilityContext.detail;
      } else {
        viewerCanClaim = true;
      }

      return {
        ...trade,
        viewerAvailabilityContext,
        claimedByAvailabilityContext,
        viewerCanClaim,
        viewerClaimReason,
        reviewEscalatesAt: reviewDeadlines?.escalateAt.toISOString() ?? null,
        reviewAutoApprovesAt: reviewDeadlines?.autoApproveAt.toISOString() ?? null,
      };
    }),
    total,
  };
}

/**
 * One page of the unfiltered board with CLAIMED rows ahead of everything else.
 * Admin works the review queue from page one; the enum order alone puts every
 * OPEN post ahead of it. Pages the two slices back to back so offset paging
 * stays stable across the boundary.
 */
async function findClaimedFirstPage(
  where: Prisma.ShiftTradeWhereInput,
  include: typeof tradeListInclude,
  orderBy: Prisma.ShiftTradeOrderByWithRelationInput[],
  limit: number | undefined,
  offset: number | undefined,
) {
  const skip = offset ?? 0;
  const claimedWhere: Prisma.ShiftTradeWhereInput = { AND: [where, { status: "CLAIMED" }] };
  const restWhere: Prisma.ShiftTradeWhereInput = { AND: [where, { status: { not: "CLAIMED" } }] };
  const claimedCount = await db.shiftTrade.count({ where: claimedWhere });
  const claimed = skip < claimedCount
    ? await db.shiftTrade.findMany({ where: claimedWhere, take: limit, skip, include, orderBy })
    : [];
  const remaining = limit === undefined ? undefined : limit - claimed.length;
  if (remaining !== undefined && remaining <= 0) return claimed;
  const rest = await db.shiftTrade.findMany({
    where: restWhere,
    take: remaining,
    skip: Math.max(0, skip - claimedCount),
    include,
    orderBy,
  });
  return [...claimed, ...rest];
}
