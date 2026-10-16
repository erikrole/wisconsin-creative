import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { searchItemsToLink } from "@/lib/services/budget";

export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "budget", "view");
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return ok({ data: await searchItemsToLink(q.slice(0, 80)) });
});
