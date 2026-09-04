import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { previewCheckoutMerge } from "@/lib/services/bookings";

const schema = z.object({
  ids: z.array(z.string().cuid()).min(2).max(25),
}).strict();

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "checkout", "merge");
  const body = schema.parse(await req.json());
  return ok({ data: await previewCheckoutMerge(body.ids) });
});
