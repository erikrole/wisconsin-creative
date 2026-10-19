import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { getBudgetTrend } from "@/lib/services/budget";

const querySchema = z.object({ name: z.string().trim().min(1).max(80) });

/** Totals for one budget name (Creative, Football) across every fiscal year. */
export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "budget", "view");
  const { name } = querySchema.parse({ name: new URL(req.url).searchParams.get("name") });
  return ok({ data: await getBudgetTrend(name) });
});
