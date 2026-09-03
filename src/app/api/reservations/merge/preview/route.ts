import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { previewReservationMerge } from "@/lib/services/bookings";

const schema = z.object({
  ids: z.array(z.string().cuid()).min(2).max(25),
}).strict();

export const POST = withAuth(async (req, { user }) => {
  requireRole(user.role, ["ADMIN", "STAFF"]);
  const body = schema.parse(await req.json());
  return ok({ data: await previewReservationMerge(body.ids) });
});
