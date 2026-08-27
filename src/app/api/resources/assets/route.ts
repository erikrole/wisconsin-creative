import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import {
  listResourceAssets,
  prepareResourceAssetUpload,
  prepareResourceAssetUploadSchema,
} from "@/lib/resource-assets";
import { ResourceAssetKind } from "@prisma/client";

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "resource", "view");
  const searchParams = new URL(req.url).searchParams;
  const kindValue = searchParams.get("kind");
  const kind = kindValue && Object.values(ResourceAssetKind).includes(kindValue as ResourceAssetKind)
    ? kindValue as ResourceAssetKind
    : null;
  const data = await listResourceAssets({
    folderId: searchParams.get("folderId"),
    search: searchParams.get("q"),
    kind,
    favoritesOnly: searchParams.get("favorites") === "1",
    favoriteUserId: user.id,
    scope: searchParams.get("scope") === "all" ? "all" : "folder",
    sort: searchParams.get("sort") === "updated" || searchParams.get("sort") === "type"
      ? searchParams.get("sort") as "updated" | "type"
      : "name",
  });
  return ok({ data });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "resource", "edit");
  const body = prepareResourceAssetUploadSchema.parse(await req.json());
  const data = await prepareResourceAssetUpload({
    ...body,
    actorId: user.id,
    actorRole: user.role,
  });
  return ok({ data }, 201);
});
