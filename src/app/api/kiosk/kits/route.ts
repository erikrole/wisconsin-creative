import { withKiosk } from "@/lib/api";
import { compareFootballGamedayKits } from "@/lib/football-gameday-kits";
import { ok } from "@/lib/http";
import { listKits, suggestFootballGamedayKit } from "@/lib/services/kits";

export const GET = withKiosk(async (req, { kiosk }) => {
  const { searchParams } = new URL(req.url);
  const requesterUserId = searchParams.get("requester_user_id")
    || searchParams.get("userId")
    || undefined;
  const result = await listKits({
    locationId: kiosk.locationId,
    includeArchived: false,
    sortBy: "name",
    sortOrder: "asc",
    limit: 100,
    offset: 0,
  });

  const data = result.data
    .map((kit) => ({
      id: kit.id,
      name: kit.name,
      sportCode: kit.sportCode,
      gamedayRole: kit.gamedayRole,
      contents: kit._count.members + kit._count.bulkMembers,
    }))
    .filter((kit) => kit.contents > 0)
    .sort(compareFootballGamedayKits);

  const suggestedKitId = requesterUserId
    ? await suggestFootballGamedayKit({ requesterUserId, locationId: kiosk.locationId })
    : null;

  return ok({ data, suggestedKitId });
});
