import { z } from "zod";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { getWrappedRecap, resetWrappedRecap } from "@/lib/services/wrapped";

const querySchema = z.object({
  userId: z.string().trim().min(1).max(64).optional(),
  preview: z.enum(["1", "true"]).optional(),
});

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "wrapped", "view");
  const url = new URL(req.url);
  const query = querySchema.parse({
    userId: url.searchParams.get("userId") ?? undefined,
    preview: url.searchParams.get("preview") ?? undefined,
  });
  const targetId = query.userId ?? user.id;
  const other = targetId !== user.id;
  if (other || query.preview) requirePermission(user.role, "wrapped", "preview");

  const data = await getWrappedRecap(targetId, { preview: Boolean(query.preview) || other, readOnly: other });
  if (!data) throw new HttpError(404, "No recap for that person");
  return ok({ data });
});

/** Admin: regenerate a frozen recap on its next open. */
export const DELETE = withAuth(async (req, { user }) => {
  requirePermission(user.role, "wrapped", "preview");
  const userId = querySchema.parse({ userId: new URL(req.url).searchParams.get("userId") ?? undefined }).userId;
  if (!userId) throw new HttpError(400, "userId is required");
  return ok({ data: { reset: await resetWrappedRecap(userId) } });
});
