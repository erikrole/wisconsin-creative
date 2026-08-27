import { z } from "zod";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { normalizeOpponentName, scheduleVenueDisplayName } from "@/lib/schedule-event-identity";
import { getScoreboardScope } from "@/lib/services/scoreboard";
import { normalizeSportCode } from "@/lib/sports";
import { getTeamScoreboard } from "@/lib/services/team-scoreboard";

const optionalDimensionSchema = (maximum: number) => z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).max(maximum).optional(),
);

/**
 * A sport code that is on record, not one that is currently varsity. Facets are
 * built from the sport codes the events actually carry, and `sportLabel` still
 * names retired codes such as `SWIM` and `XC`. Validating against the current
 * varsity set rejected a code the Scoreboard had just offered, so the filter
 * snapped back to "All sports" with a 400 the reader never saw. An unknown code
 * now answers honestly with an empty intersection instead.
 */
const storedSportCodeSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).max(20).transform(normalizeSportCode).optional(),
);

const scoreboardQuerySchema = z.object({
  season: z.string().trim().max(20).optional(),
  sportCode: storedSportCodeSchema,
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
