import { z } from "zod";

import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { addToPlannedPlaylists } from "@/lib/youtube/publish-service";

const schema = z.object({ version: z.number().int().nonnegative() }).strict();

/** Adds the video to the playlists chosen in the saved draft. Each insert is journaled and verified. */
export const POST = withAuth<{ videoId: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "youtube", "publish");
  const body = schema.parse(await req.json());
  return ok(await addToPlannedPlaylists(user, params.videoId, body.version));
});
