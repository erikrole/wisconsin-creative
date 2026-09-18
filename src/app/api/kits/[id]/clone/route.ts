import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { cloneKit } from "@/lib/services/kits";

export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "kit", "create");
  const kit = await cloneKit(params.id, user.id, user.role);
  return ok({ data: kit }, 201);
});
