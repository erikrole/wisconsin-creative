import { z } from "zod";

import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { publishDraft } from "@/lib/youtube/publish-service";

const schema = z.object({ version: z.number().int().nonnegative(), factsReviewed: z.boolean() }).strict();

/** Sends the saved title and description to YouTube. The admin must have checked the facts against the recap when the description changes. */
export const POST = withAuth<{ videoId: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "youtube", "publish");
  const body = schema.parse(await req.json());
  const record = await publishDraft(user, params.videoId, body.version, body.factsReviewed);
  return ok({ id: record.id, phase: record.phase, verifiedAt: record.verifiedAt });
});
