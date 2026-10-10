import { withCron } from "@/lib/cron";
import { ok } from "@/lib/http";
import { refreshFootballResults } from "@/lib/services/football-results";
import { recordJobRun } from "@/lib/services/job-runs";

export const maxDuration = 60;

export const GET = withCron(async () => {
  const now = new Date();
  const dueAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 30));
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
