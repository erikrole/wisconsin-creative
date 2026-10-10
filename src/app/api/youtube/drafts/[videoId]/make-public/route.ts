import { z } from "zod";

import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { makePublic } from "@/lib/youtube/publish-service";

const schema = z.object({ version: z.number().int().nonnegative(), factsReviewed: z.boolean() }).strict();

/** Makes an unlisted or private video public with its reviewed description. The admin must have checked the facts. */
export const POST = withAuth<{ videoId: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "youtube", "publish");
  const body = schema.parse(await req.json());
  const record = await makePublic(user, params.videoId, body.version, body.factsReviewed);
  return ok({ id: record.id, phase: record.phase, verifiedAt: record.verifiedAt });
});
