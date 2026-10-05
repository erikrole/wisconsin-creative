import { z } from "zod";

import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { saveDraft } from "@/lib/youtube/queue";

const nullableText = z.string().nullable().optional();
const ids = z.array(z.string().min(1).max(64)).max(200).optional();

const editSchema = z
  .object({
    version: z.number().int().nonnegative(),
    editedTitle: nullableText,
    editedDescription: nullableText,
    selectedSentenceIds: ids,
    conferenceKind: z.enum(["Weekly", "Postgame"]).nullable().optional(),
    speakerIds: ids,
    plannedPlaylistIds: ids,
  })
  .strict();

/** Saves manual review choices for one video. The version guards against overwriting another admin's edit. */
export const PATCH = withAuth<{ videoId: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "youtube", "draft");
  return ok(await saveDraft(user, params.videoId, editSchema.parse(await req.json())));
});
