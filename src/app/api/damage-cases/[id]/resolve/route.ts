import { z } from "zod";
import { ReportResolution } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { resolveDamageCase } from "@/lib/services/damage-cases";

const body = z.object({
  resolution: z.nativeEnum(ReportResolution),
  note: z.string().max(1000).optional(),
}).strict();

/** POST /api/damage-cases/[id]/resolve — close a case and release or retire the item. */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "checkin_report", "dismiss");
  const input = body.parse(await req.json());
  const result = await resolveDamageCase({
    reportId: params.id,
    resolution: input.resolution,
    note: input.note,
    actor: { id: user.id, role: user.role },
  });
  return ok({ data: result });
});
