import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { checkLastSend } from "@/lib/youtube/publish-service";

/** Read-only: settles a send whose result was unclear by reading the live video. */
export const POST = withAuth<{ videoId: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "youtube", "publish");
  const record = await checkLastSend(user, params.videoId);
  return ok({ id: record.id, phase: record.phase, verifiedAt: record.verifiedAt });
});
