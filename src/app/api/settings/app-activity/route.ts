import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { getAppActivityReport, parseAppActivityPeriod } from "@/lib/services/app-activity-report";
import { canViewUsageAnalytics } from "@/lib/usage-analytics";

export const GET = withAuth(async (req, { user }) => {
  if (!canViewUsageAnalytics(user)) throw new HttpError(403, "Forbidden");
  const days = parseAppActivityPeriod(new URL(req.url).searchParams.get("days"));
  return ok(await getAppActivityReport(days));
});
