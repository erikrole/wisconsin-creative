import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { addKitBulkMember, removeKitBulkMember } from "@/lib/services/kits";
import { z } from "zod";

const addBulkMemberSchema = z.object({
  bulkSkuId: z.string().min(1),
  quantity: z.number().int().min(1).max(999),
});

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "kit", "edit");
  const body = addBulkMemberSchema.parse(await req.json());
  const membership = await addKitBulkMember(params.id, body, user.id, user.role);
  return ok({ data: membership }, 201);
});

export const DELETE = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "kit", "edit");
  const { searchParams } = new URL(req.url);
  const membershipId = searchParams.get("membershipId");
  if (!membershipId) throw new HttpError(400, "membershipId required");
  await removeKitBulkMember(params.id, membershipId, user.id, user.role);
  return ok({ success: true });
});
