import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntryTx } from "@/lib/audit";

const maintenanceRequest = z.object({
  status: z.enum(["AVAILABLE", "MAINTENANCE"]),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();

export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "asset", "maintenance");
  const { id } = params;
  // Older native clients send no body. New callers set an explicit state
  // against the version they reviewed so a retry cannot toggle it back.
  const text = await req.text();
  let body: unknown = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, "Invalid JSON body");
    }
  }
  const request = body === null ? null : maintenanceRequest.parse(body);

  const asset = await db.$transaction(async (tx) => {
    const before = await tx.asset.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, "Asset not found");
    if (before.status === "RETIRED") {
      throw new HttpError(409, "Retired items cannot be placed in or released from maintenance.");
    }
    if (request && before.updatedAt.getTime() !== new Date(request.expectedUpdatedAt).getTime()) {
      throw new HttpError(409, "This item changed since you reviewed it. Refresh before changing maintenance.");
    }

    const toggled = request?.status ?? (before.status === "MAINTENANCE" ? "AVAILABLE" : "MAINTENANCE");
    if (toggled === before.status) return before;
    const updated = await tx.asset.update({
      where: { id },
      data: { status: toggled },
      include: { location: true, category: true },
    });
    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "asset",
      entityId: id,
      action: toggled === "MAINTENANCE" ? "marked_maintenance" : "cleared_maintenance",
      before: { status: before.status },
      after: { status: toggled },
    });
    return updated;
  }, { isolationLevel: "Serializable" });

  return ok({ data: asset });
});
