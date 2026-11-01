import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { legacyGuideMarkdown } from "@/lib/guide-content";
import { checklistFromMarkdown } from "@/lib/shared-case-checklist";

const bodySchema = z.object({ resourceId: z.string().min(1).max(64) });

/**
 * POST /api/settings/shared-case-checklist/import — reads the list items out of
 * a Resources guide so the old checklist moves over without retyping. Saves
 * nothing; the editor adds the items to the draft for review.
 */
export const POST = withAuth(async (req, { user }) => {
  requireRole(user.role, ["ADMIN"]);
  const { resourceId } = bodySchema.parse(await req.json());
  const resource = await db.resource.findUnique({
    where: { id: resourceId },
    select: { title: true, markdown: true, content: true },
  });
  if (!resource) throw new HttpError(404, "That guide no longer exists");
  const items = checklistFromMarkdown(legacyGuideMarkdown(resource.markdown, resource.content));
  if (items.length === 0) throw new HttpError(409, `${resource.title} has no list items to bring over`);
  return ok({ data: { title: resource.title, items } });
});
