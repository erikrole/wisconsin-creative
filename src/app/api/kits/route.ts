import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { parsePagination } from "@/lib/http";
import { requirePermission, requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { createKit, listKits, suggestFootballGamedayKit } from "@/lib/services/kits";
import { optionalFootballGamedayKitRoleSchema } from "@/lib/football-gameday-kits";
import { optionalSportCodeSchema } from "@/lib/validation";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional().nullable(),
  locationId: z.string().min(1, "Location is required"),
  sportCode: optionalSportCodeSchema,
  gamedayRole: optionalFootballGamedayKitRoleSchema,
});

function suggestedRequesterId(
  user: { id: string; role: string },
  requested: string | undefined,
) {
  if (!requested) return null;
  if (user.role === "ADMIN" || user.role === "STAFF" || requested === user.id) {
    return requested;
  }
  return user.id;
}

export const GET = withAuth(async (req, { user }) => {
  requirePermissionOrCollaboratorCapability(user, "kit", "view", "RESERVATION_CREATE");

  const { searchParams } = new URL(req.url);
  const { limit, offset } = parsePagination(searchParams);
  const canManageKits = user.role === "ADMIN" || user.role === "STAFF";
  const locationId = searchParams.get("location_id") || undefined;
  const requesterUserId = suggestedRequesterId(
    user,
    searchParams.get("requester_user_id")?.trim() || undefined,
  );

  const result = await listKits({
    search: searchParams.get("q")?.trim() || undefined,
    locationId,
    includeArchived: canManageKits && searchParams.get("include_archived") === "true",
    sortBy: searchParams.get("sort") || undefined,
    sortOrder: (searchParams.get("order") as "asc" | "desc") || undefined,
    limit,
    offset,
  });

  const suggestedKitId = requesterUserId && locationId
    ? await suggestFootballGamedayKit({ requesterUserId, locationId })
    : null;

  return ok({ ...result, suggestedKitId, limit, offset });
});

export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "kit", "create");

  const body = createSchema.parse(await req.json());
  const kit = await createKit(body, user.id, user.role);

  return ok({ data: kit }, 201);
});
