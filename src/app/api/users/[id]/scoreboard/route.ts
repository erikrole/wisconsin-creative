import { z } from "zod";
import { withAuth } from "@/lib/api";
import { canReadSharedScoreboard } from "@/lib/user-visibility";
import { normalizeSportCode } from "@/lib/sports";
import { HttpError, ok, parsePagination } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { db } from "@/lib/db";
import {
  getScoreboardForUser,
  getScoreboardScope,
  type ScoreboardResult,
} from "@/lib/services/scoreboard";

const scoreboardQuerySchema = z.object({
  season: z.string().trim().max(20).optional(),
  sportCode: z.string().trim().max(20).optional(),
  result: z.enum(["WIN", "LOSS"]).optional(),
});

export const GET = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "scoreboard", "view");

  const target = await db.user.findUnique({
    where: { id: params.id },
    select: { id: true, active: true, hiddenFromRoster: true },
  });
  if (!target || !canReadSharedScoreboard(user, target)) {
    throw new HttpError(404, "User not found");
  }

  const url = new URL(req.url);
  const query = scoreboardQuerySchema.parse({
    season: url.searchParams.get("season") ?? undefined,
    sportCode: url.searchParams.get("sportCode") ?? undefined,
    result: url.searchParams.get("result") ?? undefined,
  });
  if (!getScoreboardScope(query.season)) {
    throw new HttpError(400, "Unsupported scoreboard season");
  }

  const { limit, offset } = parsePagination(url.searchParams);
  const scoreboard = await getScoreboardForUser(
    params.id,
    {
      sportCode: query.sportCode ? normalizeSportCode(query.sportCode) : undefined,
      result: query.result as ScoreboardResult | undefined,
    },
    { limit, offset },
  );

  return ok({ data: scoreboard });
});
