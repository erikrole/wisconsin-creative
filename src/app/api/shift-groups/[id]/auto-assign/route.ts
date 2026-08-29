import { withAuth } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit } from "@/lib/rate-limit";

const RETIRED_MESSAGE =
  "Auto assign from Shift Detail is retired. Use Schedule Auto assign to review and stage changes safely.";

export const POST = withAuth<{ id: string }>(async (_req, { user }) => {
  requirePermission(user.role, "shift", "manage");
  await enforceRateLimit(`shift:auto-assign:${user.id}`, { max: 10, windowMs: 60_000 });

  throw new HttpError(410, RETIRED_MESSAGE);
});
