import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit } from "@/lib/rate-limit";
import { stripQuery, summarizeUserAgent } from "@/lib/error-reporting/grouping";
import { supportReportBodySchema } from "@/lib/schemas/error-reports";
import { createSupportReport, listSupportReports } from "@/lib/services/error-reports";

/** GET /api/support-reports — "Report a problem" submissions (ADMIN). */
export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "diagnostics", "view");
  const status = new URL(req.url).searchParams.get("status");
  return ok({ data: await listSupportReports(status === "closed" || status === "all" ? status : "open") });
});

/** POST /api/support-reports — anyone signed in reports a problem with app context attached. */
export const POST = withAuth(async (req, { user }) => {
  await enforceRateLimit(`support-reports:${user.id}`, { max: 10, windowMs: 60 * 60_000 });
  const body = supportReportBodySchema.parse(await req.json());
  const agent = body.client.platform === "web" ? summarizeUserAgent(req.headers.get("user-agent")) : null;
  const report = await createSupportReport(
    {
      message: body.message,
      platform: body.client.platform,
      appVersion: body.client.appVersion ?? null,
      appBuild: body.client.appBuild ?? null,
      releaseChannel: body.client.releaseChannel ?? null,
      osVersion: body.client.osVersion ?? agent?.os ?? null,
      deviceModel: body.client.deviceModel ?? agent?.browser ?? null,
      screen: stripQuery(body.screen),
      breadcrumbs: body.breadcrumbs,
    },
    { id: user.id, name: user.name, role: user.role },
  );
  return ok({ data: { id: report.id } });
});
