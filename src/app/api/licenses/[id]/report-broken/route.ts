import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { reportBrokenCode } from "@/lib/services/licenses";

const REPORT_LIMIT = { max: 5, windowMs: 60_000 };

// "Code not working?" — retire the holder's code and hand them another open one.
export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "license", "claim");
  const { allowed } = await checkRateLimit(`license:report-broken:${user.id}`, REPORT_LIMIT);
  if (!allowed) throw new HttpError(429, "Too many requests. Please wait a moment.");
  const { replacement } = await reportBrokenCode(params.id, user.id, user.role);
  return ok({ data: { replacement } });
});
