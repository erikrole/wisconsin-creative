import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { routeTemplate, stripQuery, summarizeUserAgent, type ErrorReportInput } from "@/lib/error-reporting/grouping";
import { errorReportBodySchema } from "@/lib/schemas/error-reports";
import { recordErrorReports } from "@/lib/services/error-reports";

const MAX_BODY_BYTES = 200_000;

/**
 * POST /api/errors — a signed-in client reports uncaught errors with the
 * context needed to reproduce them. Reports are grouped into issues for the
 * admin Issues page. Clients dedupe repeats; the server caps each person.
 */
export const POST = withAuth(async (req, { user }) => {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) throw new HttpError(413, "Error report too large");
  const limit = await checkRateLimit(`error-reports:${user.id}`, { max: 60, windowMs: 60 * 60_000 });
  if (!limit.allowed) return ok({ data: { stored: 0, throttled: true } });

  const body = errorReportBodySchema.parse(await req.json());
  const agent = body.client.platform === "web" ? summarizeUserAgent(req.headers.get("user-agent")) : null;
  const now = Date.now();
  const inputs: ErrorReportInput[] = body.reports.map((report) => {
    const occurredAt = report.occurredAt ? new Date(report.occurredAt) : new Date(now);
    const screen = stripQuery(report.screen);
    return {
      platform: body.client.platform,
      kind: report.kind,
      name: report.name ?? null,
      message: report.message,
      stack: report.stack ?? null,
      digest: report.digest ?? null,
      // Web groups by page; native screens are already names, not paths.
      culprit: body.client.platform === "web" ? routeTemplate(screen) : screen,
      screen,
      requestId: report.requestId ?? null,
      // A device clock ahead of the server is clamped to now.
      occurredAt: occurredAt.getTime() > now ? new Date(now) : occurredAt,
      appVersion: body.client.appVersion ?? null,
      appBuild: body.client.appBuild ?? null,
      releaseChannel: body.client.releaseChannel ?? null,
      osVersion: body.client.osVersion ?? agent?.os ?? null,
      deviceModel: body.client.deviceModel ?? agent?.browser ?? null,
      breadcrumbs: report.breadcrumbs,
      context: report.context,
    };
  });
  const results = await recordErrorReports(inputs, { id: user.id, role: user.role });
  return ok({ data: { stored: results.filter((result) => result.stored).length } });
});
