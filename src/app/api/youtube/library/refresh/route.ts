import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { refreshLibrary } from "@/lib/youtube/queue";

export const maxDuration = 60;

/** Reads recent uploads, playlists and official sources, then stores prepared drafts. Never writes to YouTube. */
export const POST = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "youtube", "draft");
  return ok(await refreshLibrary(user));
});
