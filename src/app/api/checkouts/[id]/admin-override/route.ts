import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAdminOverride } from "@/lib/services/scans";
import { overrideSchema } from "@/lib/validation";

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "checkout", "admin_override");
  const { id } = params;
  const body = overrideSchema.parse(await req.json());

  // createAdminOverride writes the audit entry, with what the override bypassed.
  const event = await createAdminOverride({
    bookingId: id,
    actorUserId: user.id,
    actorRole: user.role,
    reason: body.reason,
    details: body.details
  });

  return ok({ data: event }, 201);
});
