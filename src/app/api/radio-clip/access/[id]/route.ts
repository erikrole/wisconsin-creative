import { z } from "zod";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok, HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntryTx } from "@/lib/audit";
const input = z.object({ enabled: z.boolean() }).strict();
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "radio_clip", "manage_access");
  const { enabled } = input.parse(await req.json());
  await db.$transaction(async tx => {
    const target = await tx.user.findUnique({ where: { id: params.id } });
    if (!target) throw new HttpError(404, "Account not found.");
    if (enabled && (!target.active || target.role === "COLLABORATOR")) throw new HttpError(400, "Radio Clip access requires an active internal account.");
    await tx.user.update({ where: { id: target.id }, data: { radioClipEnabled: enabled } });
    if (!enabled) {
      await tx.radioClipAuthorization.deleteMany({ where: { parentSession: { userId: target.id } } });
      await tx.radioClipSession.deleteMany({ where: { parentSession: { userId: target.id } } });
    }
    await createAuditEntryTx(tx, { actorId: user.id, actorRole: user.role, entityType: "RadioClipAccess", entityId: target.id, action: enabled ? "GRANT" : "REVOKE", before: { enabled: target.radioClipEnabled }, after: { enabled } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return ok({ enabled });
});
