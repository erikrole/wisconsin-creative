import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { withIntegrationToken } from "@/lib/integration-token";
import { visibleActiveUserWhere } from "@/lib/user-visibility";

/**
 * People for the Media Asset Manager: who shot what. The MAM matches
 * photographer and camera folders on the media drive to these users and shows
 * their name and avatar. Read-only, and limited to what a credit needs: no
 * email, phone or card details. Authenticated by `MEDIA_LIBRARY_TOKEN`.
 */
export const GET = withIntegrationToken("MEDIA_LIBRARY_TOKEN", async () => {
  const rows = await db.user.findMany({
    where: visibleActiveUserWhere(),
    select: { id: true, name: true, role: true, title: true, avatarUrl: true },
    orderBy: { name: "asc" },
  });
  return ok({
    data: rows.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      title: u.title ?? null,
      avatarUrl: u.avatarUrl ?? null,
    })),
  });
});
