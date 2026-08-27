import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import {
  createResourceAssetFolder,
  createResourceAssetFolderSchema,
} from "@/lib/resource-assets";

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "resource", "edit");
  const body = createResourceAssetFolderSchema.parse(await req.json());
  const data = await createResourceAssetFolder({
    ...body,
    actorId: user.id,
    actorRole: user.role,
  });
  return ok({ data }, 201);
});

