import { withAuth } from "@/lib/api";
import { HttpError, ok, parsePagination } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { postTradeSchema } from "@/lib/validation";
import { listTrades, postTrade } from "@/lib/services/shift-trades";
import { createAuditEntry } from "@/lib/audit";
import type { ShiftTradeStatus } from "@prisma/client";
import { enforceRateLimit, SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { parseAreaFilter } from "@/lib/services/schedule-open-work";

const TRADE_STATUS_FILTERS = ["OPEN", "CLAIMED", "COMPLETED", "CANCELLED"] as const;

function parseStatusFilter(value: string | null): ShiftTradeStatus | undefined {
  if (!value) return undefined;
  if (!(TRADE_STATUS_FILTERS as readonly string[]).includes(value)) {
    throw new HttpError(400, "status must be OPEN, CLAIMED, COMPLETED, or CANCELLED");
  }
  return value as ShiftTradeStatus;
}

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "shift_trade", "view");

  const url = new URL(req.url);
  const status = parseStatusFilter(url.searchParams.get("status"));
  const area = parseAreaFilter(url.searchParams.get("area"));
  const { limit: rawLimit, offset } = parsePagination(url.searchParams);
  const limit = Math.min(rawLimit, 100);

  const { data: trades, total } = await listTrades({
    status,
    area,
    limit,
    offset,
    userId: user.id,
  });

  return ok({ data: trades, total });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "shift_trade", "post");
  await enforceRateLimit(`shift-trade:post:${user.id}`, SCHEDULE_MUTATION_LIMIT);

  const body = postTradeSchema.parse(await req.json());
  const trade = await postTrade(body.shiftAssignmentId, { id: user.id, role: user.role }, body.notes);

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "shift_trade",
    entityId: trade.id,
    action: "trade_posted",
    after: {
      shiftAssignmentId: body.shiftAssignmentId,
      // Owner is the poster of record; flag when staff posted on their behalf.
      postedByUserId: trade.postedByUserId,
      postedByStaff: trade.postedByUserId !== user.id,
    },
  });

  return ok({ data: trade }, 201);
});
