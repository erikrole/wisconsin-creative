import { withCron } from "@/lib/cron";
import { ok } from "@/lib/http";
import { isFootballSeason } from "@/lib/football-results";
import { refreshFootballResults } from "@/lib/services/football-results";
import { recordJobRun } from "@/lib/services/job-runs";

export const maxDuration = 60;

export const GET = withCron(async () => {
  const now = new Date();
  // Neon cost: no fetch, no query and no job-run row outside the season.
  if (!isFootballSeason(now)) return ok({ data: { skipped: "off_season" } });
  // Scheduled just before morning-refresh (08:00) in vercel.json so tonight's badge pass sees fresh scores and one Neon wake covers both.
  const dueAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7, 50));
  try {
    const data = await refreshFootballResults();
    await recordJobRun({ job: "football_results", outcome: data.ok ? "succeeded" : "failed", dueAt,
      detail: data.ok ? null : `${data.issues.length} unresolved provider matches` });
    return ok({ data });
  } catch (error) {
    await recordJobRun({ job: "football_results", outcome: "failed", dueAt, detail: "Refresh failed; previous observations retained" });
    throw error;
  }
});
