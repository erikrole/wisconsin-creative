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
  // The preview is intentionally conflict-aware. Staff still get hard
  // custody/context guards, but return-window and source-reservation
  // differences need to reach the modal so they can make an explicit choice.
  return ok({ data: await previewCheckoutMerge(body.ids, { allowContextOverrides: true }) });
});
