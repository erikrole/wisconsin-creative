import { z } from "zod";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { normalizeOpponentName, scheduleVenueDisplayName } from "@/lib/schedule-event-identity";
import { getScoreboardScope } from "@/lib/services/scoreboard";
import { getTeamScoreboard } from "@/lib/services/team-scoreboard";
import { optionalSportCodeSchema } from "@/lib/validation";

const optionalDimensionSchema = (maximum: number) => z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).max(maximum).optional(),
);

const scoreboardQuerySchema = z.object({
  season: z.string().trim().max(20).optional(),
  sportCode: optionalSportCodeSchema,
  venue: optionalDimensionSchema(200),
  opponent: optionalDimensionSchema(200),
  site: z.enum(["HOME", "AWAY", "NEUTRAL"]).optional(),
});

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "scoreboard", "view");
  const url = new URL(req.url);
  const query = scoreboardQuerySchema.parse({
    season: url.searchParams.get("season") ?? undefined,
    sportCode: url.searchParams.get("sportCode") ?? undefined,
    venue: url.searchParams.get("venue") ?? undefined,
    opponent: url.searchParams.get("opponent") ?? undefined,
    site: url.searchParams.get("site") ?? undefined,
  });
  if (!getScoreboardScope(query.season)) {
    throw new HttpError(400, "Unsupported scoreboard season");
  }

  return ok({
    data: await getTeamScoreboard({
      filters: {
        sportCode: query.sportCode,
        venue: query.venue ? scheduleVenueDisplayName(query.venue) ?? undefined : undefined,
        opponent: query.opponent ? normalizeOpponentName(query.opponent) ?? undefined : undefined,
        site: query.site,
      },
    }),
  });
});
