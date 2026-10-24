import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { badgesEnabled } from "@/lib/badges";
import { getBadgeGallery } from "@/lib/badges/gallery";

export const GET = withAuth(async (_req, { user }) => {
  requireRole(user.role, ["ADMIN", "STAFF", "STUDENT"]);
  if (!badgesEnabled()) {
    return ok({
      data: { viewerId: user.id, canCompare: false, badges: [], people: [], undiscoveredSurprises: 0 },
      disabled: true,
    });
  }

  return ok({ data: await getBadgeGallery(user) });
});
