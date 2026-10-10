import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { checkPlaylistAdditions } from "@/lib/youtube/publish-service";

/** Read-only: settles playlist additions whose result was unclear. */
export const POST = withAuth<{ videoId: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "youtube", "publish");
  const settled = await checkPlaylistAdditions(user, params.videoId);
  return ok({ phases: settled.map((record) => record.phase) });
});
