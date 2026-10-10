import { z } from "zod";

import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { prepareOne } from "@/lib/youtube/queue";

const schema = z.object({ version: z.number().int().nonnegative() }).strict();

/** Matches one video to its official schedule and recap again. Manual edits are kept. */
export const POST = withAuth<{ videoId: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "youtube", "draft");
  const { version } = schema.parse(await req.json());
  return ok(await prepareOne(user, params.videoId, version));
});
