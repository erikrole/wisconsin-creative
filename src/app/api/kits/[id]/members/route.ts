import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { MAX_EQUIPMENT_SELECTIONS_PER_REQUEST } from "@/lib/request-limits";
import { addKitMembers } from "@/lib/services/kits";
import { z } from "zod";

const addMembersSchema = z.object({
  assetIds: z
    .array(z.string().min(1))
    .min(1, "At least one asset is required")
    .max(MAX_EQUIPMENT_SELECTIONS_PER_REQUEST),
});

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "kit", "edit");
  const body = addMembersSchema.parse(await req.json());
  const { kit } = await addKitMembers(params.id, body.assetIds, user.id, user.role);
  return ok({ data: kit });
});
