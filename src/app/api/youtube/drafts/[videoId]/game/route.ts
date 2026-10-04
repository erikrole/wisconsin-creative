import { z } from "zod";

import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { chooseDraftGame } from "@/lib/youtube/queue";

const schema = z.object({ version: z.number().int().nonnegative(), gameId: z.string().min(1).max(32) }).strict();

/** Confirms one of the official games offered for this video and loads its recap. */
export const POST = withAuth<{ videoId: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "youtube", "draft");
  const { version, gameId } = schema.parse(await req.json());
  return ok(await chooseDraftGame(user, params.videoId, version, gameId));
});
